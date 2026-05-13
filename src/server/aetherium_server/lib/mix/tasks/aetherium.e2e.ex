defmodule Mix.Tasks.Aetherium.E2e do
  use Mix.Task

  @shortdoc "Flagship E2E smoke test: gateway -> server -> flagship runtime path"

  require Logger

  alias AetheriumServer.ShowcaseCatalog

  @default_gateway_ws_url "ws://localhost:8080/socket/websocket"
  @default_ui_token "dev_secret_token"
  @default_bundle "flagship_desktop"
  @default_flagship_target "example/automata/showcase/13_petri_signal_chain/petri_command_router.yaml"

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
    target = load_target!(opts)

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

    Logger.info(
      "Flagship E2E target #{target.bundle_id || "single_showcase"} :: #{target.network || "single_network"} :: #{target.entry.name}"
    )

    automata_id = "e2e-#{target.entry.id}-#{System.system_time(:millisecond)}"

    automata =
      target.automata
      |> Map.put("id", automata_id)
      |> Map.put("name", "#{target.automata["name"] || target.entry.name} E2E")

    {:ok, deploy_reply} =
      push_sync!(
        auto_chan,
        "deploy",
        %{
          "automata_id" => automata_id,
          "device_id" => device_id,
          "server_id" => server_id,
          "automata" => automata
        },
        Keyword.fetch!(opts, :timeout_ms)
      )

    deployment_id = deployment_id_from_reply(deploy_reply, automata_id, device_id)

    {:ok, _start_reply} =
      push_sync!(
        auto_chan,
        "start_execution",
        %{
          "device_id" => device_id,
          "deployment_id" => deployment_id
        },
        Keyword.fetch!(opts, :timeout_ms)
      )

    wait_for_running(
      auto_chan,
      gw_chan,
      automata_id,
      device_id,
      Keyword.fetch!(opts, :timeout_ms)
    )

    default_stimulus_sequence(target)
    |> maybe_append_manual_input(Keyword.get(opts, :set_input))
    |> send_stimulus_sequence(
      auto_chan,
      device_id,
      automata_id,
      Keyword.fetch!(opts, :timeout_ms)
    )

    wait_for_state_change(auto_chan, gw_chan, device_id, Keyword.fetch!(opts, :timeout_ms))

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
          bundle: :string,
          showcase: :string,
          bytecode_smoke: :boolean,
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
      bytecode_smoke: Keyword.get(opts, :bytecode_smoke, false),
      bundle: Keyword.get(opts, :bundle, @default_bundle),
      showcase: Keyword.get(opts, :showcase),
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

  defp load_target!(opts) do
    cond do
      opts[:bytecode_smoke] ->
        %{
          bundle_id: nil,
          network: "bytecode_smoke",
          entry: %{id: "bytecode_smoke", name: "Bytecode Smoke", relative_path: "inline"},
          automata: bytecode_smoke_automata()
        }

      present?(opts[:showcase]) ->
        case ShowcaseCatalog.load_automata(opts[:showcase]) do
          {:ok, %{entry: entry, automata: automata}} ->
            %{bundle_id: nil, network: nil, entry: entry, automata: automata}

          {:error, reason} ->
            raise "Failed to load showcase target #{opts[:showcase]}: #{inspect(reason)}"
        end

      true ->
        bundle_id = opts[:bundle] || @default_bundle

        case ShowcaseCatalog.load_bundle(bundle_id) do
          {:ok, bundle} ->
            member =
              Enum.find(bundle.members, &(&1.entry.relative_path == @default_flagship_target)) ||
                Enum.find(bundle.members, &(&1.device_role == "host")) ||
                raise("Bundle #{bundle_id} does not contain a host-run E2E target")

            %{
              bundle_id: bundle.id,
              network: member.network,
              entry: member.entry,
              automata: member.automata
            }

          {:error, reason} ->
            raise "Failed to load flagship bundle #{bundle_id}: #{inspect(reason)}"
        end
    end
  end

  defp bytecode_smoke_automata do
    %{
      "id" => "bytecode_smoke",
      "name" => "Bytecode Smoke",
      "version" => "1.0.0",
      "initial_state" => "idle",
      "states" => %{
        "idle" => %{"id" => "idle", "name" => "Idle", "type" => "initial"},
        "running" => %{"id" => "running", "name" => "Running", "type" => "normal"},
        "done" => %{"id" => "done", "name" => "Done", "type" => "normal"}
      },
      "transitions" => %{
        "t_gate" => %{
          "id" => "t_gate",
          "from" => "idle",
          "to" => "running",
          "type" => "classic",
          "condition" => "enabled == true"
        },
        "t_immediate" => %{
          "id" => "t_immediate",
          "from" => "running",
          "to" => "done",
          "type" => "immediate"
        },
        "t_done" => %{
          "id" => "t_done",
          "from" => "done",
          "to" => "idle",
          "type" => "timed",
          "after" => 25
        }
      },
      "variables" => [
        %{
          "id" => "v1",
          "name" => "enabled",
          "type" => "bool",
          "direction" => "input",
          "default" => false
        }
      ]
    }
  end

  defp default_stimulus_sequence(target) do
    case target.entry.relative_path do
      @default_flagship_target ->
        [
          {"operator_enable", true},
          {"watchdog_ok", true},
          {"permit_ok", true},
          {"module_status", "ready"}
        ]

      "example/automata/showcase/04_resilience/sensor_watchdog_recovery.yaml" ->
        [{"heartbeat", true}, {"heartbeat", false}]

      _ ->
        []
    end
  end

  defp maybe_append_manual_input(sequence, nil), do: sequence
  defp maybe_append_manual_input(sequence, input), do: sequence ++ [input]

  defp deployment_id_from_reply(reply, automata_id, device_id) when is_map(reply) do
    reply
    |> get_in(["response", "result", "deployment"])
    |> case do
      %{} = deployment ->
        deployment["deployment_id"] || deployment["id"] || "#{automata_id}:#{device_id}"

      _ ->
        get_in(reply, ["result", "deployment", "deployment_id"]) ||
          get_in(reply, ["result", "deployment", "id"]) ||
          "#{automata_id}:#{device_id}"
    end
  end

  defp send_stimulus_sequence(sequence, auto_chan, device_id, automata_id, timeout_ms) do
    Enum.each(sequence, fn {name, value} ->
      Logger.info("Sending set_variable #{name}=#{inspect(value)}")

      _ =
        push_sync!(
          auto_chan,
          "set_variable",
          %{
            "device_id" => device_id,
            "automata_id" => automata_id,
            "name" => name,
            "value" => value
          },
          timeout_ms
        )

      Process.sleep(80)
    end)

    :ok
  end

  defp present?(value) when is_binary(value), do: String.trim(value) != ""
  defp present?(_value), do: false

  defp resolve_target(gw_chan, server_id_opt, device_id_opt, wait_ms) do
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

  defp wait_for_running(auto_chan, gw_chan, automata_id, device_id, timeout_ms) do
    deadline = System.monotonic_time(:millisecond) + timeout_ms
    loop_wait_for_running(auto_chan, gw_chan, automata_id, device_id, deadline)
  end

  defp loop_wait_for_running(auto_chan, gw_chan, automata_id, device_id, deadline) do
    if System.monotonic_time(:millisecond) > deadline do
      raise "Timed out waiting for deployment to reach running for #{automata_id} on #{device_id}"
    end

    receive do
      %PhoenixClient.Message{event: "deployment_status", payload: payload} ->
        if payload["automata_id"] == automata_id and payload["device_id"] == device_id and
             payload["status"] == "running" do
          :ok
        else
          loop_wait_for_running(auto_chan, gw_chan, automata_id, device_id, deadline)
        end

      _other ->
        loop_wait_for_running(auto_chan, gw_chan, automata_id, device_id, deadline)
    after
      500 ->
        PhoenixClient.Channel.push_async(gw_chan, "ping", %{})
        PhoenixClient.Channel.push_async(auto_chan, "list_deployments", %{})
        loop_wait_for_running(auto_chan, gw_chan, automata_id, device_id, deadline)
    end
  end

  defp wait_for_state_change(auto_chan, gw_chan, device_id, timeout_ms) do
    deadline = System.monotonic_time(:millisecond) + timeout_ms
    loop_wait_for_state_change(auto_chan, gw_chan, device_id, deadline)
  end

  defp loop_wait_for_state_change(auto_chan, gw_chan, device_id, deadline) do
    if System.monotonic_time(:millisecond) > deadline do
      raise "Timed out waiting for state_changed event on #{device_id}"
    end

    receive do
      %PhoenixClient.Message{event: "state_changed", payload: payload} ->
        if payload["device_id"] == device_id do
          :ok
        else
          loop_wait_for_state_change(auto_chan, gw_chan, device_id, deadline)
        end

      _other ->
        loop_wait_for_state_change(auto_chan, gw_chan, device_id, deadline)
    after
      500 ->
        PhoenixClient.Channel.push_async(gw_chan, "ping", %{})
        loop_wait_for_state_change(auto_chan, gw_chan, device_id, deadline)
    end
  end
end
