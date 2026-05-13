defmodule Mix.Tasks.Aetherium.E2e.TwoAutomata do
  use Mix.Task

  @shortdoc "E2E: two desktop automata on separate C++ devices communicating through a gateway connection"

  require Logger

  @default_gateway_ws_url "ws://localhost:8080/socket/websocket"
  @default_ui_token "dev_secret_token"

  @impl true
  def run(args) do
    Mix.Task.run("app.start", ["--no-start"])
    ensure_deps_started!()

    opts = parse_args(args)
    gateway_url = Keyword.fetch!(opts, :gateway_url)
    ui_token = Keyword.fetch!(opts, :token)
    timeout_ms = Keyword.fetch!(opts, :timeout_ms)
    wait_ms = Keyword.fetch!(opts, :wait_ms)
    device1_id = Keyword.fetch!(opts, :device1_id)
    device2_id = Keyword.fetch!(opts, :device2_id)

    Logger.info("=== Two-Automata Desktop Network E2E ===")
    Logger.info("device1=#{device1_id} (leader) device2=#{device2_id} (follower)")

    {:ok, socket} =
      PhoenixClient.Socket.start_link(
        url: gateway_url,
        params: %{"token" => ui_token}
      )

    wait_for_socket!(socket, timeout_ms)

    gw_chan =
      join_with_retry!(socket, "gateway:control", %{"token" => ui_token}, timeout_ms)

    auto_chan =
      join_with_retry!(socket, "automata:control", %{"token" => ui_token}, timeout_ms)

    {server_id, _} = resolve_devices(gw_chan, device1_id, device2_id, wait_ms)
    Logger.info("Using server_id=#{server_id}")

    ts = System.system_time(:millisecond)
    leader_id = "leader-#{ts}"
    follower_id = "follower-#{ts}"

    leader_automata = leader_automata(leader_id)
    follower_automata = follower_automata(follower_id)

    Logger.info("Deploying leader on #{device1_id}...")
    {:ok, leader_deploy_reply} = push_sync!(auto_chan, "deploy", %{
      "automata_id" => leader_id,
      "device_id" => device1_id,
      "server_id" => server_id,
      "automata" => leader_automata
    }, timeout_ms)
    leader_deployment_id = deployment_id_from_reply(leader_deploy_reply, leader_id, device1_id)

    Logger.info("Deploying follower on #{device2_id}...")
    {:ok, follower_deploy_reply} = push_sync!(auto_chan, "deploy", %{
      "automata_id" => follower_id,
      "device_id" => device2_id,
      "server_id" => server_id,
      "automata" => follower_automata
    }, timeout_ms)
    follower_deployment_id = deployment_id_from_reply(follower_deploy_reply, follower_id, device2_id)

    Logger.info("Connecting leader.go_signal → follower.go_signal ...")
    {:ok, conn_reply} = push_sync!(auto_chan, "create_connection", %{
      "source_automata_id" => leader_id,
      "source_output" => "go_signal",
      "target_automata_id" => follower_id,
      "target_input" => "go_signal",
      "enabled" => true
    }, timeout_ms)
    connection_id = conn_reply["connection_id"] || get_in(conn_reply, ["response", "connection_id"]) || "created"
    Logger.info("Connection created: #{connection_id}")

    Logger.info("Starting both automata...")
    {:ok, _} = push_sync!(auto_chan, "start_execution", %{
      "device_id" => device1_id,
      "deployment_id" => leader_deployment_id
    }, timeout_ms)

    {:ok, _} = push_sync!(auto_chan, "start_execution", %{
      "device_id" => device2_id,
      "deployment_id" => follower_deployment_id
    }, timeout_ms)

    wait_for_both_running(
      auto_chan,
      gw_chan,
      leader_deployment_id,
      leader_id,
      device1_id,
      follower_deployment_id,
      follower_id,
      device2_id,
      timeout_ms
    )

    Logger.info("Sending armed=true to leader (device1)...")
    {:ok, _} = push_sync!(auto_chan, "set_variable", %{
      "device_id" => device1_id,
      "automata_id" => leader_id,
      "deployment_id" => leader_deployment_id,
      "name" => "armed",
      "value" => true
    }, timeout_ms)

    Logger.info("Waiting for follower to receive go_signal through gateway propagation...")
    wait_for_follower_activation(
      auto_chan,
      gw_chan,
      follower_deployment_id,
      follower_id,
      device2_id,
      timeout_ms
    )

    stop_deployment(auto_chan, device1_id, leader_deployment_id, timeout_ms)
    stop_deployment(auto_chan, device2_id, follower_deployment_id, timeout_ms)

    Logger.info("=== Two-Automata Desktop Network E2E PASS ===")
    Logger.info("Demonstrated: leader on #{device1_id} → go_signal propagated → follower on #{device2_id}")
  end

  defp leader_automata(automata_id) do
    %{
      "id" => automata_id,
      "name" => "Desktop Signal Leader E2E",
      "config" => %{"name" => "Desktop Signal Leader E2E", "type" => "inline", "language" => "lua"},
      "variables" => [
        %{"name" => "armed", "type" => "bool", "direction" => "input", "default" => false},
        %{"name" => "go_signal", "type" => "bool", "direction" => "output", "default" => false},
        %{"name" => "leader_state", "type" => "string", "direction" => "output", "default" => "idle"}
      ],
      "initial_state" => "Idle",
      "states" => %{
        "Idle" => %{
          "on_enter" => "setVal(\"go_signal\", false)\nsetVal(\"leader_state\", \"idle\")\n",
          "outputs" => ["go_signal", "leader_state"]
        },
        "Broadcasting" => %{
          "on_enter" => "setVal(\"go_signal\", true)\nsetVal(\"leader_state\", \"broadcasting\")\n",
          "outputs" => ["go_signal", "leader_state"]
        }
      },
      "transitions" => %{
        "arm" => %{
          "from" => "Idle",
          "to" => "Broadcasting",
          "type" => "classic",
          "condition" => "value(\"armed\") == true"
        },
        "disarm" => %{
          "from" => "Broadcasting",
          "to" => "Idle",
          "type" => "classic",
          "condition" => "value(\"armed\") == false"
        }
      }
    }
  end

  defp follower_automata(automata_id) do
    %{
      "id" => automata_id,
      "name" => "Desktop Signal Follower E2E",
      "config" => %{"name" => "Desktop Signal Follower E2E", "type" => "inline", "language" => "lua"},
      "variables" => [
        %{"name" => "go_signal", "type" => "bool", "direction" => "input", "default" => false},
        %{"name" => "ack_signal", "type" => "bool", "direction" => "output", "default" => false},
        %{"name" => "follower_state", "type" => "string", "direction" => "output", "default" => "waiting"}
      ],
      "initial_state" => "Waiting",
      "states" => %{
        "Waiting" => %{
          "on_enter" => "setVal(\"ack_signal\", false)\nsetVal(\"follower_state\", \"waiting\")\n",
          "outputs" => ["ack_signal", "follower_state"]
        },
        "Received" => %{
          "on_enter" => "setVal(\"ack_signal\", true)\nsetVal(\"follower_state\", \"received\")\n",
          "outputs" => ["ack_signal", "follower_state"]
        }
      },
      "transitions" => %{
        "receive_go" => %{
          "from" => "Waiting",
          "to" => "Received",
          "type" => "classic",
          "condition" => "value(\"go_signal\") == true"
        },
        "clear_go" => %{
          "from" => "Received",
          "to" => "Waiting",
          "type" => "classic",
          "condition" => "value(\"go_signal\") == false"
        }
      }
    }
  end

  defp resolve_devices(gw_chan, device1_id, device2_id, wait_ms) do
    PhoenixClient.Channel.push_async(gw_chan, "list_servers", %{})
    PhoenixClient.Channel.push_async(gw_chan, "list_devices", %{})
    deadline = System.monotonic_time(:millisecond) + wait_ms
    loop_resolve_devices(gw_chan, device1_id, device2_id, deadline, MapSet.new(), nil)
  end

  defp loop_resolve_devices(gw_chan, device1_id, device2_id, deadline, online_servers, last_devices) do
    if System.monotonic_time(:millisecond) > deadline do
      raise "Timed out waiting for both #{device1_id} and #{device2_id} to be listed"
    end

    receive do
      %PhoenixClient.Message{event: "server_list", payload: %{"servers" => servers}} ->
        online_servers =
          servers
          |> List.wrap()
          |> Enum.map(&(Map.new(&1)["server_id"] || Map.new(&1)[:server_id]))
          |> Enum.reject(&is_nil/1)
          |> MapSet.new()

        loop_resolve_devices(gw_chan, device1_id, device2_id, deadline, online_servers, last_devices)

      %PhoenixClient.Message{event: "device_list", payload: %{"devices" => devices}} ->
        devices = Enum.map(devices, &Map.new/1)
        d1 = Enum.find(devices, &(((&1["id"] || &1[:id]) == device1_id)))
        d2 = Enum.find(devices, &(((&1["id"] || &1[:id]) == device2_id)))

        if d1 && d2 do
          server_id =
            Enum.find_value([d1, d2], fn d ->
              sid = d["server_id"] || d[:server_id]
              if MapSet.size(online_servers) == 0 or MapSet.member?(online_servers, sid), do: sid
            end)

          if server_id do
            {server_id, {device1_id, device2_id}}
          else
            loop_resolve_devices(gw_chan, device1_id, device2_id, deadline, online_servers, devices)
          end
        else
          loop_resolve_devices(gw_chan, device1_id, device2_id, deadline, online_servers, devices)
        end

      _other ->
        loop_resolve_devices(gw_chan, device1_id, device2_id, deadline, online_servers, last_devices)
    after
      400 ->
        PhoenixClient.Channel.push_async(gw_chan, "list_devices", %{})
        PhoenixClient.Channel.push_async(gw_chan, "list_servers", %{})
        loop_resolve_devices(gw_chan, device1_id, device2_id, deadline, online_servers, last_devices)
    end
  end

  defp wait_for_both_running(
         auto_chan,
         gw_chan,
         leader_deployment_id,
         leader_id,
         device1_id,
         follower_deployment_id,
         follower_id,
         device2_id,
         timeout_ms
       ) do
    deadline = System.monotonic_time(:millisecond) + timeout_ms
    loop_wait_both(
      auto_chan,
      gw_chan,
      leader_deployment_id,
      leader_id,
      device1_id,
      follower_deployment_id,
      follower_id,
      device2_id,
      false,
      false,
      deadline
    )
  end

  defp loop_wait_both(
         auto_chan,
         gw_chan,
         leader_deployment_id,
         leader_id,
         d1,
         follower_deployment_id,
         follower_id,
         d2,
         leader_ok,
         follower_ok,
         deadline
       ) do
    if leader_ok and follower_ok do
      Logger.info("Both automata running.")
      :ok
    else
      if System.monotonic_time(:millisecond) > deadline do
        raise "Timed out waiting for both automata to reach running"
      end

      receive do
        %PhoenixClient.Message{event: "deployment_status", payload: payload} ->
          new_leader =
            leader_ok or
              running_deployment?(payload, leader_deployment_id, leader_id, d1)

          new_follower =
            follower_ok or
              running_deployment?(payload, follower_deployment_id, follower_id, d2)

          if new_leader != leader_ok do
            Logger.info("Leader running on #{d1}")
          end
          if new_follower != follower_ok do
            Logger.info("Follower running on #{d2}")
          end

          loop_wait_both(
            auto_chan,
            gw_chan,
            leader_deployment_id,
            leader_id,
            d1,
            follower_deployment_id,
            follower_id,
            d2,
            new_leader,
            new_follower,
            deadline
          )

        _other ->
          loop_wait_both(
            auto_chan,
            gw_chan,
            leader_deployment_id,
            leader_id,
            d1,
            follower_deployment_id,
            follower_id,
            d2,
            leader_ok,
            follower_ok,
            deadline
          )
      after
        600 ->
          PhoenixClient.Channel.push_async(gw_chan, "ping", %{})
          PhoenixClient.Channel.push_async(auto_chan, "list_deployments", %{})
          loop_wait_both(
            auto_chan,
            gw_chan,
            leader_deployment_id,
            leader_id,
            d1,
            follower_deployment_id,
            follower_id,
            d2,
            leader_ok,
            follower_ok,
            deadline
          )
      end
    end
  end

  defp wait_for_follower_activation(auto_chan, gw_chan, follower_deployment_id, follower_id, device2_id, timeout_ms) do
    deadline = System.monotonic_time(:millisecond) + timeout_ms
    loop_wait_follower(auto_chan, gw_chan, follower_deployment_id, follower_id, device2_id, deadline)
  end

  defp loop_wait_follower(auto_chan, gw_chan, follower_deployment_id, follower_id, device2_id, deadline) do
    if System.monotonic_time(:millisecond) > deadline do
      raise "Timed out waiting for follower #{follower_deployment_id} to receive propagated input"
    else
      receive do
        %PhoenixClient.Message{event: "state_changed", payload: payload} ->
          if payload["deployment_id"] == follower_deployment_id or
               (payload["automata_id"] == follower_id and payload["device_id"] == device2_id) do
            state = payload["to_state"] || payload["new_state"] || "?"
            Logger.info("Follower activated: #{state} on #{device2_id}")
            :ok
          else
            loop_wait_follower(auto_chan, gw_chan, follower_deployment_id, follower_id, device2_id, deadline)
          end

        %PhoenixClient.Message{event: "variable_updated", payload: payload} ->
          if (payload["deployment_id"] == follower_deployment_id or
                (payload["automata_id"] == follower_id and payload["device_id"] == device2_id)) and
               payload["name"] == "ack_signal" and payload["value"] == true do
            Logger.info("Follower ack_signal=true on #{device2_id}")
            :ok
          else
            loop_wait_follower(auto_chan, gw_chan, follower_deployment_id, follower_id, device2_id, deadline)
          end

        %PhoenixClient.Message{event: "command_outcome", payload: %{"command_type" => "request_state"} = payload} ->
          state = get_in(payload, ["data", "state"]) || %{}

          if state["current_state"] == "Received" or get_in(state, ["variables", "ack_signal"]) == true do
            Logger.info("Follower snapshot confirms activation on #{device2_id}")
            :ok
          else
            loop_wait_follower(auto_chan, gw_chan, follower_deployment_id, follower_id, device2_id, deadline)
          end

        _other ->
          loop_wait_follower(auto_chan, gw_chan, follower_deployment_id, follower_id, device2_id, deadline)
      after
        600 ->
          PhoenixClient.Channel.push_async(gw_chan, "ping", %{})
          PhoenixClient.Channel.push_async(auto_chan, "request_state", %{
            "device_id" => device2_id,
            "deployment_id" => follower_deployment_id
          })

          loop_wait_follower(auto_chan, gw_chan, follower_deployment_id, follower_id, device2_id, deadline)
      end
    end
  end

  defp running_deployment?(payload, deployment_id, automata_id, device_id) do
    payload["status"] == "running" and
      (payload["deployment_id"] == deployment_id or
         (payload["automata_id"] == automata_id and payload["device_id"] == device_id))
  end

  defp deployment_id_from_reply(reply, automata_id, device_id) when is_map(reply) do
    get_in(reply, ["response", "result", "deployment", "deployment_id"]) ||
      get_in(reply, ["response", "result", "deployment", "id"]) ||
      get_in(reply, ["result", "deployment", "deployment_id"]) ||
      get_in(reply, ["result", "deployment", "id"]) ||
      "#{automata_id}:#{device_id}"
  end

  defp stop_deployment(auto_chan, device_id, deployment_id, timeout_ms) do
    _ =
      push_sync!(auto_chan, "stop_execution", %{
        "device_id" => device_id,
        "deployment_id" => deployment_id
      }, timeout_ms)

    :ok
  rescue
    error ->
      Logger.warning("Failed to stop #{deployment_id}: #{Exception.message(error)}")
      :ok
  end

  defp ensure_deps_started! do
    for app <- [:logger, :crypto, :ssl, :websocket_client, :phoenix_client, :jason, :yaml_elixir] do
      case Application.ensure_all_started(app) do
        {:ok, _} -> :ok
        {:error, {:already_started, _}} -> :ok
        {:error, reason} -> raise "Failed to start #{app}: #{inspect(reason)}"
      end
    end
  end

  defp parse_args(args) do
    {opts, _rest, _invalid} =
      OptionParser.parse(args,
        strict: [
          gateway_url: :string,
          token: :string,
          device1_id: :string,
          device2_id: :string,
          timeout_ms: :integer,
          wait_ms: :integer
        ]
      )

    [
      gateway_url: Keyword.get(opts, :gateway_url, @default_gateway_ws_url),
      token: Keyword.get(opts, :token, @default_ui_token),
      device1_id: Keyword.get(opts, :device1_id, "device_cpp_01"),
      device2_id: Keyword.get(opts, :device2_id, "device_cpp_02"),
      timeout_ms: Keyword.get(opts, :timeout_ms, 25_000),
      wait_ms: Keyword.get(opts, :wait_ms, 15_000)
    ]
  end

  defp wait_for_socket!(socket, timeout_ms) do
    deadline = System.monotonic_time(:millisecond) + timeout_ms

    Stream.repeatedly(fn -> PhoenixClient.Socket.connected?(socket) end)
    |> Enum.find(fn
      true -> true
      false ->
        if System.monotonic_time(:millisecond) > deadline do
          raise "Timed out waiting for gateway connection"
        end
        Process.sleep(100)
        false
    end)
  end

  defp join_with_retry!(socket, topic, payload, timeout_ms) do
    deadline = System.monotonic_time(:millisecond) + timeout_ms
    do_join(socket, topic, payload, deadline)
  end

  defp do_join(socket, topic, payload, deadline) do
    if System.monotonic_time(:millisecond) > deadline do
      raise "Timed out joining #{topic}"
    end

    case PhoenixClient.Channel.join(socket, topic, payload) do
      {:ok, _resp, chan} -> chan
      {:error, :socket_not_connected} -> Process.sleep(100); do_join(socket, topic, payload, deadline)
      {:error, reason} -> raise "Failed to join #{topic}: #{inspect(reason)}"
    end
  end

  defp push_sync!(channel, event, payload, timeout_ms) do
    case PhoenixClient.Channel.push(channel, event, payload, timeout_ms) do
      {:ok, reply} -> {:ok, reply}
      {:error, reply} -> raise "push #{event} failed: #{inspect(reply)}"
      other -> raise "push #{event} unexpected: #{inspect(other)}"
    end
  end
end
