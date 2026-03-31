defmodule AetheriumGateway.ConnectionManagerTest do
  use ExUnit.Case, async: false

  alias AetheriumGateway.ConnectionManager
  alias AetheriumGateway.AutomataRegistry
  alias AetheriumGateway.CommandDispatcher
  alias AetheriumGateway.ServerTracker

  # Use unique IDs for each test run to avoid conflicts
  # The registry and connection manager are already started by the application
  setup do
    :sys.replace_state(AetheriumGateway.AutomataRegistry, fn _state ->
      %{automata: %{}, deployments: %{}, transition_history: %{}, transition_counts: %{}}
    end)

    :sys.replace_state(AetheriumGateway.ConnectionManager, fn state ->
      %{
        state
        | connections: %{},
          by_source: %{},
          by_target: %{},
          values: %{},
          topics: %{},
          delivered_inputs: %{},
          event_routes: %{}
      }
    end)

    :sys.replace_state(AetheriumGateway.ServerTracker, fn _state ->
      %{servers: %{}, recovered: %{}}
    end)

    :sys.replace_state(AetheriumGateway.CommandDispatcher, fn _state ->
      %{outbox: %{}}
    end)

    # Generate unique prefix for this test run
    prefix = :erlang.unique_integer([:positive]) |> Integer.to_string()

    # Register test automata with unique IDs
    id_a = "#{prefix}-auto-a"
    id_b = "#{prefix}-auto-b"
    id_c = "#{prefix}-auto-c"
    server_a = "#{prefix}-srv-a"
    server_b = "#{prefix}-srv-b"

    # register_automata returns :ok, not {:ok, _}
    :ok = AutomataRegistry.register_automata(automata_with_io(id_a))
    :ok = AutomataRegistry.register_automata(automata_with_io(id_b))
    :ok = AutomataRegistry.register_automata(automata_with_io(id_c))
    :ok = ServerTracker.register(server_a, self())
    :ok = ServerTracker.register(server_b, self())

    on_exit(fn ->
      stop_deployments_for_automata([id_a, id_b, id_c])
      # Cleanup automata
      AutomataRegistry.delete_automata(id_a)
      AutomataRegistry.delete_automata(id_b)
      AutomataRegistry.delete_automata(id_c)
      ServerTracker.unregister(server_a)
      ServerTracker.unregister(server_b)
    end)

    {:ok,
     prefix: prefix,
     auto_a: id_a,
     auto_b: id_b,
     auto_c: id_c,
     server_a: server_a,
     server_b: server_b}
  end

  describe "connection CRUD" do
    test "creates connection", %{auto_a: auto_a, auto_b: auto_b} do
      {:ok, conn} =
        ConnectionManager.create_connection(%{
          source_automata: auto_a,
          source_output: "result",
          target_automata: auto_b,
          target_input: "input_val"
        })

      assert conn.source_automata == auto_a
      assert conn.target_automata == auto_b
      assert conn.enabled == true

      # Cleanup
      ConnectionManager.delete_connection(conn.id)
    end

    test "creates connection from string-key params", %{auto_a: auto_a, auto_b: auto_b} do
      {:ok, conn} =
        ConnectionManager.create_connection(%{
          "source_automata" => auto_a,
          "source_output" => "result",
          "target_automata" => auto_b,
          "target_input" => "input_val",
          "enabled" => true
        })

      assert conn.source_automata == auto_a
      assert conn.target_automata == auto_b
      assert conn.enabled == true

      ConnectionManager.delete_connection(conn.id)
    end

    test "lists connections", %{auto_a: auto_a, auto_b: auto_b} do
      {:ok, conn} =
        ConnectionManager.create_connection(%{
          source_automata: auto_a,
          source_output: "result",
          target_automata: auto_b,
          target_input: "input_val"
        })

      connections = ConnectionManager.list_connections()
      assert Enum.any?(connections, &(&1.id == conn.id))

      # Cleanup
      ConnectionManager.delete_connection(conn.id)
    end

    test "gets connection by id", %{auto_a: auto_a, auto_b: auto_b} do
      {:ok, conn} =
        ConnectionManager.create_connection(%{
          source_automata: auto_a,
          source_output: "result",
          target_automata: auto_b,
          target_input: "input_val"
        })

      {:ok, retrieved} = ConnectionManager.get_connection(conn.id)
      assert retrieved.id == conn.id

      # Cleanup
      ConnectionManager.delete_connection(conn.id)
    end

    test "deletes connection", %{auto_a: auto_a, auto_b: auto_b} do
      {:ok, conn} =
        ConnectionManager.create_connection(%{
          source_automata: auto_a,
          source_output: "result",
          target_automata: auto_b,
          target_input: "input_val"
        })

      :ok = ConnectionManager.delete_connection(conn.id)

      assert {:error, :not_found} = ConnectionManager.get_connection(conn.id)
    end
  end

  describe "connection validation" do
    test "rejects self-connection", %{auto_a: auto_a} do
      result =
        ConnectionManager.create_connection(%{
          source_automata: auto_a,
          source_output: "result",
          target_automata: auto_a,
          target_input: "input_val"
        })

      assert {:error, :self_connection} = result
    end

    test "rejects cycles", %{auto_a: auto_a, auto_b: auto_b, auto_c: auto_c} do
      # Create A -> B
      {:ok, conn1} =
        ConnectionManager.create_connection(%{
          source_automata: auto_a,
          source_output: "result",
          target_automata: auto_b,
          target_input: "input_val"
        })

      # Create B -> C
      {:ok, conn2} =
        ConnectionManager.create_connection(%{
          source_automata: auto_b,
          source_output: "result",
          target_automata: auto_c,
          target_input: "input_val"
        })

      # Try to create C -> A (would create cycle)
      result =
        ConnectionManager.create_connection(%{
          source_automata: auto_c,
          source_output: "result",
          target_automata: auto_a,
          target_input: "input_val"
        })

      assert {:error, :creates_cycle} = result

      # Cleanup
      ConnectionManager.delete_connection(conn1.id)
      ConnectionManager.delete_connection(conn2.id)
    end
  end

  describe "enable/disable" do
    test "disables connection", %{auto_a: auto_a, auto_b: auto_b} do
      {:ok, conn} =
        ConnectionManager.create_connection(%{
          source_automata: auto_a,
          source_output: "result",
          target_automata: auto_b,
          target_input: "input_val"
        })

      :ok = ConnectionManager.set_connection_enabled(conn.id, false)

      {:ok, updated} = ConnectionManager.get_connection(conn.id)
      assert updated.enabled == false

      # Cleanup
      ConnectionManager.delete_connection(conn.id)
    end
  end

  describe "runtime propagation" do
    test "tracks runtime stats and dedupes repeated propagated values", %{
      auto_a: auto_a,
      auto_b: auto_b,
      prefix: prefix,
      server_a: server_a
    } do
      source = deploy_running(auto_a, "#{prefix}-source-device", server_a)
      target = deploy_running(auto_b, "#{prefix}-target-device", server_a)

      {:ok, conn} =
        ConnectionManager.create_connection(%{
          source_automata: auto_a,
          source_output: "result",
          target_automata: auto_b,
          target_input: "input_val"
        })

      ConnectionManager.propagate_output(source, "result", 42)
      sync_managers()

      assert_receive {:dispatch_command, "set_input", %{"deployment_id" => deployment_id},
                      envelope},
                     500

      assert deployment_id == target.deployment_id
      assert get_in(envelope, [:target, "server_id"]) == server_a

      {:ok, updated_once} = ConnectionManager.get_connection(conn.id)
      assert updated_once.runtime.message_count == 1
      assert updated_once.runtime.last_value == 42

      ConnectionManager.propagate_output(source, "result", 42)
      sync_managers()
      refute_receive {:dispatch_command, "set_input", _, _}, 100

      {:ok, updated_twice} = ConnectionManager.get_connection(conn.id)
      assert updated_twice.runtime.message_count == 1
      assert updated_twice.runtime.dedupe_count >= 1

      ConnectionManager.delete_connection(conn.id)
    end

    test "propagates same-name topics globally with targeted direct dispatch", %{
      prefix: prefix,
      auto_a: auto_a,
      server_a: server_a,
      server_b: server_b
    } do
      target = "#{prefix}-topic-target"
      :ok = AutomataRegistry.register_automata(topic_automata(target, "result"))
      deployment_a = deploy_running(target, "#{prefix}-topic-device-a", server_a)
      deployment_b = deploy_running(target, "#{prefix}-topic-device-b", server_b)
      source = deploy_running(auto_a, "#{prefix}-source-topic-device", server_a)

      on_exit(fn ->
        stop_deployments_for_automata([target])
        AutomataRegistry.delete_automata(target)
      end)

      ConnectionManager.propagate_output(source, "result", 42)
      sync_managers()

      assert_receive {:dispatch_command, "set_input", payload_a, envelope_a}, 500
      assert_receive {:dispatch_command, "set_input", payload_b, envelope_b}, 500

      payloads = [payload_a, payload_b]
      envelopes = [envelope_a, envelope_b]

      assert Enum.any?(payloads, &(&1["deployment_id"] == deployment_a.deployment_id))
      assert Enum.any?(payloads, &(&1["deployment_id"] == deployment_b.deployment_id))
      assert Enum.all?(payloads, &(&1["topic"] == "result"))
      assert Enum.all?(payloads, &(&1["topic_version"] == 1))
      assert Enum.all?(payloads, &(&1["origin_deployment_id"] == source.deployment_id))
      assert Enum.any?(envelopes, &(get_in(&1, [:target, "server_id"]) == server_a))
      assert Enum.any?(envelopes, &(get_in(&1, [:target, "server_id"]) == server_b))
    end

    test "replays latest topic value for matching input names", %{
      prefix: prefix,
      auto_a: auto_a,
      server_a: server_a
    } do
      target = "#{prefix}-topic-replay"
      :ok = AutomataRegistry.register_automata(topic_automata(target, "result"))
      deployment = deploy_running(target, "#{prefix}-replay-device", server_a)
      source = deploy_running(auto_a, "#{prefix}-replay-source", server_a)

      on_exit(fn ->
        stop_deployments_for_automata([target])
        AutomataRegistry.delete_automata(target)
      end)

      ConnectionManager.propagate_output(source, "result", 77)
      sync_managers()

      assert_receive {:dispatch_command, "set_input",
                      %{"deployment_id" => deployment_id, "topic_version" => 1}, _envelope},
                     500

      assert deployment_id == deployment.deployment_id

      ConnectionManager.replay_for_automata(target)
      sync_managers()

      assert_receive {:dispatch_command, "set_input", replay_payload, _envelope}, 500
      assert replay_payload["deployment_id"] == deployment.deployment_id
      assert replay_payload["topic"] == "result"
      assert replay_payload["topic_version"] == 1
      assert replay_payload["force_replay"] == true
    end

    test "suppresses redundant topic writes until the value changes", %{
      prefix: prefix,
      auto_a: auto_a,
      server_a: server_a
    } do
      target = "#{prefix}-topic-dedupe"
      :ok = AutomataRegistry.register_automata(topic_automata(target, "result"))
      deployment = deploy_running(target, "#{prefix}-dedupe-device", server_a)
      source = deploy_running(auto_a, "#{prefix}-dedupe-source", server_a)

      on_exit(fn ->
        stop_deployments_for_automata([target])
        AutomataRegistry.delete_automata(target)
      end)

      ConnectionManager.propagate_output(source, "result", 13)
      sync_managers()

      assert_receive {:dispatch_command, "set_input",
                      %{"deployment_id" => deployment_id, "topic_version" => 1}, _},
                     500

      assert deployment_id == deployment.deployment_id

      ConnectionManager.propagate_output(source, "result", 13)
      sync_managers()
      refute_receive {:dispatch_command, "set_input", _, _}, 100

      ConnectionManager.propagate_output(source, "result", 14)
      sync_managers()

      assert_receive {:dispatch_command, "set_input",
                      %{"deployment_id" => deployment_id, "topic_version" => 2, "value" => 14},
                      _},
                     500

      assert deployment_id == deployment.deployment_id
    end

    test "does not propagate same-name topics to undeployed automata", %{
      prefix: prefix,
      auto_a: auto_a
    } do
      target = "#{prefix}-topic-idle"
      :ok = AutomataRegistry.register_automata(topic_automata(target, "result"))

      source = %{
        automata_id: auto_a,
        deployment_id: "#{auto_a}:src",
        device_id: "#{prefix}-src",
        server_id: "#{prefix}-srv-a"
      }

      on_exit(fn ->
        stop_deployments_for_automata([target])
        AutomataRegistry.delete_automata(target)
      end)

      ConnectionManager.propagate_output(source, "result", 13)
      sync_managers()
      refute_receive {:dispatch_command, "set_input", %{"automata_id" => ^target}, _}, 100
    end
  end

  # Helper to create automata with I/O variables
  defp automata_with_io(id) do
    %{
      id: id,
      name: "Automata #{id}",
      version: "1.0.0",
      states: %{
        "s1" => %{id: "s1", name: "Initial", type: :initial}
      },
      transitions: %{},
      variables: [
        %{id: "v1", name: "input_val", type: "int", direction: :input, default: 0},
        %{id: "v2", name: "result", type: "int", direction: :output, default: 0}
      ]
    }
  end

  defp topic_automata(id, input_name) do
    %{
      id: id,
      name: "Topic Automata #{id}",
      version: "1.0.0",
      states: %{
        "s1" => %{id: "s1", name: "Initial", type: :initial}
      },
      transitions: %{},
      variables: [
        %{id: "v1", name: input_name, type: "int", direction: :input, default: 0},
        %{id: "v2", name: "status", type: "bool", direction: :output, default: false}
      ]
    }
  end

  defp deploy_running(automata_id, device_id, server_id) do
    {:ok, deployment} =
      AutomataRegistry.deploy_automata(automata_id, device_id, server_id, dispatch: false)

    :ok = AutomataRegistry.update_deployment_status(automata_id, device_id, :running)
    _ = :sys.get_state(AutomataRegistry)
    deployment
  end

  defp sync_managers do
    _ = :sys.get_state(ConnectionManager)
    _ = :sys.get_state(CommandDispatcher)
    :ok
  end

  defp stop_deployments_for_automata(automata_ids) do
    active_ids = MapSet.new(List.wrap(automata_ids))

    AutomataRegistry.list_deployments()
    |> Enum.filter(fn deployment -> deployment.automata_id in active_ids end)
    |> Enum.each(fn deployment ->
      :ok =
        AutomataRegistry.update_deployment_status(
          deployment.automata_id,
          deployment.device_id,
          :stopped
        )
    end)

    _ = :sys.get_state(AutomataRegistry)
    :ok
  end
end
