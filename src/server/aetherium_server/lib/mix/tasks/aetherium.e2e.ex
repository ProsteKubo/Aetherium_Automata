defmodule Mix.Tasks.Aetherium.E2e do
  use Mix.Task

  @shortdoc "E2E smoke test: gateway -> server -> device and back"

  require Logger

  @default_gateway_ws_url "ws://localhost:8080/socket/websocket"
  @default_ui_token "dev_secret_token"

  @impl true
  def run(args) do
    # We only need websocket client deps for this E2E harness.
    # Starting the full app would bind the device listener on :4000, which
    # conflicts when running inside an already-running server container.
    Mix.Task.run("app.start", ["--no-start"])
    ensure_deps_started!()

    opts = parse_args(args)

    gateway_url = Keyword.fetch!(opts, :gateway_url)
    ui_token = Keyword.fetch!(opts, :token)
    device_id_opt = Keyword.get(opts, :device_id)
    server_id_opt = Keyword.get(opts, :server_id)

    Logger.info("Connecting to gateway at #{gateway_url}")

    {:ok, socket} =
      PhoenixClient.Socket.start_link(
        url: gateway_url,
        params: %{"token" => ui_token}
      )

    wait_for_socket!(socket, Keyword.fetch!(opts, :timeout_ms))

    gw_chan =
      join_with_retry!(
        socket,
        "gateway:control",
        %{"token" => ui_token},
        Keyword.fetch!(opts, :timeout_ms)
      )

    auto_chan =
      join_with_retry!(
        socket,
        "automata:control",
        %{"token" => ui_token},
        Keyword.fetch!(opts, :timeout_ms)
      )

    {server_id, device_id} =
      resolve_target(gw_chan, server_id_opt, device_id_opt, Keyword.fetch!(opts, :wait_ms))

    Logger.info("Target selected server_id=#{server_id} device_id=#{device_id}")

    automata = build_minimal_automata()

    {:ok, create_reply} =
      push_sync!(auto_chan, "create_automata", automata, Keyword.fetch!(opts, :timeout_ms))

    automata_id = create_reply["automata_id"] || create_reply[:automata_id]

    if is_nil(automata_id) or automata_id == "" do
      raise "create_automata returned unexpected payload: #{inspect(create_reply)}"
    end

    Logger.info("Created automata #{automata_id}; deploying")

    {:ok, _reply} =
      push_sync!(
        auto_chan,
        "deploy",
        %{"automata_id" => automata_id, "device_id" => device_id, "server_id" => server_id},
        Keyword.fetch!(opts, :timeout_ms)
      )

    wait_for_events(auto_chan, gw_chan, automata_id, device_id, Keyword.fetch!(opts, :timeout_ms))

    # Optional: poke input path (maps to set_input via gateway bridge)
    case Keyword.get(opts, :set_input) do
      nil ->
        :ok

      {name, value} ->
        Logger.info("Sending set_variable #{name}=#{inspect(value)}")

        _ =
          push_sync!(
            auto_chan,
            "set_variable",
            %{"device_id" => device_id, "name" => name, "value" => value},
            Keyword.fetch!(opts, :timeout_ms)
          )

        :ok
    end

    Logger.info("E2E OK")
  end

  defp ensure_deps_started! do
    # Keep this minimal; do NOT start :aetherium_server.
    for app <- [:logger, :crypto, :ssl, :websocket_client, :phoenix_client, :jason] do
      case Application.ensure_all_started(app) do
        {:ok, _} ->
          :ok

        {:error, {:already_started, _}} ->
          :ok

        {:error, reason} ->
          raise "Failed to start #{app}: #{inspect(reason)}"
      end
    end
  end

  defp parse_args(args) do
    {opts, _rest, _invalid} =
      OptionParser.parse(args,
        strict: [
          gateway_url: :string,
          token: :string,
          server_id: :string,
          device_id: :string,
          timeout_ms: :integer,
          wait_ms: :integer,
          set_input: :string
        ]
      )

    gateway_url = Keyword.get(opts, :gateway_url, @default_gateway_ws_url)
    token = Keyword.get(opts, :token, @default_ui_token)
    timeout_ms = Keyword.get(opts, :timeout_ms, 20_000)
    wait_ms = Keyword.get(opts, :wait_ms, 10_000)

    set_input =
      case Keyword.get(opts, :set_input) do
        nil ->
          nil

        s ->
          # format: name=value
          case String.split(s, "=", parts: 2) do
            [name, value] -> {name, parse_scalar(value)}
            _ -> raise "--set-input must be name=value"
          end
      end

    [
      gateway_url: gateway_url,
      token: token,
      server_id: Keyword.get(opts, :server_id),
      device_id: Keyword.get(opts, :device_id),
      timeout_ms: timeout_ms,
      wait_ms: wait_ms,
      set_input: set_input
    ]
  end

  defp wait_for_socket!(socket, timeout_ms) do
    deadline = System.monotonic_time(:millisecond) + timeout_ms

    until_connected(socket, deadline)
  end

  defp until_connected(socket, deadline) when is_integer(deadline) do
    if System.monotonic_time(:millisecond) > deadline do
      raise "Timed out waiting for gateway websocket connection"
    end

    # PhoenixClient.Socket.connected?/1 is the best signal.
    # It becomes true once the websocket transport reports connected.
    case PhoenixClient.Socket.connected?(socket) do
      true ->
        :ok

      false ->
        Process.sleep(100)
        until_connected(socket, deadline)
    end
  end

  defp join_with_retry!(socket, topic, payload, timeout_ms) do
    deadline = System.monotonic_time(:millisecond) + timeout_ms

    do_join_with_retry(socket, topic, payload, deadline)
  end

  defp do_join_with_retry(socket, topic, payload, deadline) do
    if System.monotonic_time(:millisecond) > deadline do
      raise "Timed out joining #{topic}"
    end

    case PhoenixClient.Channel.join(socket, topic, payload) do
      {:ok, _resp, chan} ->
        chan

      {:error, :socket_not_connected} ->
        Process.sleep(100)
        do_join_with_retry(socket, topic, payload, deadline)

      {:error, reason} ->
        raise "Failed to join #{topic}: #{inspect(reason)}"
    end
  end

  defp parse_scalar(value) do
    cond do
      value in ["true", "false"] -> value == "true"
      String.match?(value, ~r/^\-?\d+$/) -> String.to_integer(value)
      String.match?(value, ~r/^\-?\d+\.\d+$/) -> String.to_float(value)
      true -> value
    end
  end

  defp resolve_target(gw_chan, server_id_opt, device_id_opt, wait_ms) do
    # Trigger refresh; then wait for a server_list + device_list push.
    PhoenixClient.Channel.push_async(gw_chan, "list_servers", %{})
    PhoenixClient.Channel.push_async(gw_chan, "list_devices", %{})

    deadline = System.monotonic_time(:millisecond) + wait_ms

    loop_resolve(gw_chan, server_id_opt, device_id_opt, deadline, MapSet.new(), nil)
  end

  defp loop_resolve(gw_chan, server_id_opt, device_id_opt, deadline, online_servers, last_devices) do
    if System.monotonic_time(:millisecond) > deadline do
      raise "Timed out waiting for gateway device_list/server_list (online_servers=#{inspect(MapSet.to_list(online_servers))}, last_devices=#{inspect(last_devices)})"
    end

    receive do
      %PhoenixClient.Message{event: "server_list", payload: %{"servers" => servers}} ->
        online_servers =
          servers
          |> List.wrap()
          |> Enum.map(fn s ->
            m = Map.new(s)
            m["server_id"] || m[:server_id]
          end)
          |> Enum.reject(&is_nil/1)
          |> MapSet.new()

        # If we already have a device list, attempt selection now.
        case last_devices do
          nil ->
            loop_resolve(
              gw_chan,
              server_id_opt,
              device_id_opt,
              deadline,
              online_servers,
              last_devices
            )

          devices ->
            case pick_device(devices, online_servers, server_id_opt, device_id_opt) do
              {:ok, server_id, device_id} ->
                {server_id, device_id}

              :no_match ->
                loop_resolve(
                  gw_chan,
                  server_id_opt,
                  device_id_opt,
                  deadline,
                  online_servers,
                  last_devices
                )
            end
        end

      %PhoenixClient.Message{event: "device_list", payload: %{"devices" => devices}} ->
        last_devices = devices

        case pick_device(devices, online_servers, server_id_opt, device_id_opt) do
          {:ok, server_id, device_id} ->
            {server_id, device_id}

          :no_match ->
            loop_resolve(
              gw_chan,
              server_id_opt,
              device_id_opt,
              deadline,
              online_servers,
              last_devices
            )
        end

      _other ->
        loop_resolve(
          gw_chan,
          server_id_opt,
          device_id_opt,
          deadline,
          online_servers,
          last_devices
        )
    after
      300 ->
        # poke again
        PhoenixClient.Channel.push_async(gw_chan, "list_devices", %{})
        PhoenixClient.Channel.push_async(gw_chan, "list_servers", %{})

        loop_resolve(
          gw_chan,
          server_id_opt,
          device_id_opt,
          deadline,
          online_servers,
          last_devices
        )
    end
  end

  defp pick_device(devices, online_servers, server_id_opt, device_id_opt) when is_list(devices) do
    devices = Enum.map(devices, &Map.new/1)

    match =
      Enum.find(devices, fn d ->
        sid = d["server_id"] || d[:server_id]
        did = d["id"] || d[:id]

        # Only select devices belonging to a server that is currently connected.
        (MapSet.size(online_servers) == 0 or MapSet.member?(online_servers, sid)) and
          (is_nil(server_id_opt) or sid == server_id_opt) and
          (is_nil(device_id_opt) or did == device_id_opt)
      end)

    case match do
      nil ->
        :no_match

      d ->
        {:ok, d["server_id"] || d[:server_id], d["id"] || d[:id]}
    end
  end

  defp push_sync!(channel, event, payload, timeout_ms) do
    case PhoenixClient.Channel.push(channel, event, payload, timeout_ms) do
      {:ok, reply_payload} ->
        {:ok, reply_payload}

      {:error, reply_payload} ->
        raise "push #{event} failed: #{inspect(reply_payload)}"

      other ->
        raise "push #{event} unexpected reply: #{inspect(other)}"
    end
  end

  defp wait_for_events(auto_chan, gw_chan, automata_id, device_id, timeout_ms) do
    deadline = System.monotonic_time(:millisecond) + timeout_ms

    want = %{deployment_running?: false, state_changed?: false}

    loop_wait(auto_chan, gw_chan, automata_id, device_id, deadline, want)
  end

  defp loop_wait(auto_chan, gw_chan, automata_id, device_id, deadline, want) do
    if System.monotonic_time(:millisecond) > deadline do
      raise "Timed out waiting for events; got=#{inspect(want)}"
    end

    if want.deployment_running? and want.state_changed? do
      :ok
    else
      receive do
        %PhoenixClient.Message{event: "deployment_status", payload: payload} ->
          want =
            if payload["automata_id"] == automata_id and payload["device_id"] == device_id and
                 payload["status"] in ["running", "loading"] do
              %{
                want
                | deployment_running?: payload["status"] == "running" or want.deployment_running?
              }
            else
              want
            end

          loop_wait(auto_chan, gw_chan, automata_id, device_id, deadline, want)

        %PhoenixClient.Message{event: "state_changed", payload: payload} ->
          want =
            if payload["device_id"] == device_id do
              %{want | state_changed?: true}
            else
              want
            end

          loop_wait(auto_chan, gw_chan, automata_id, device_id, deadline, want)

        # Ignore other messages (initial state, logs, etc)
        _other ->
          loop_wait(auto_chan, gw_chan, automata_id, device_id, deadline, want)
      after
        500 ->
          # keep the socket alive / prompt updates
          PhoenixClient.Channel.push_async(gw_chan, "ping", %{})
          PhoenixClient.Channel.push_async(auto_chan, "list_deployments", %{})
          loop_wait(auto_chan, gw_chan, automata_id, device_id, deadline, want)
      end
    end
  end

  defp build_minimal_automata do
    %{
      "name" => "e2e_minimal",
      "description" => "generated by mix aetherium.e2e",
      "version" => "1.0.0",
      "states" => %{
        "s0" => %{"name" => "S0", "type" => "initial"},
        "s1" => %{"name" => "S1", "type" => "normal"}
      },
      "transitions" => %{
        # Timed transition should fire quickly and produce a state_changed event.
        "t0" => %{
          "from" => "S0",
          "to" => "S1",
          "type" => "timed",
          "timed" => %{"mode" => "after", "delay_ms" => 200}
        }
      },
      "variables" => []
    }
  end
end
