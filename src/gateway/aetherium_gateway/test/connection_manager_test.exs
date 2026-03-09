defmodule AetheriumGateway.ConnectionManagerTest do
  use ExUnit.Case, async: false

  alias AetheriumGateway.ConnectionManager
  alias AetheriumGateway.AutomataRegistry

  # Use unique IDs for each test run to avoid conflicts
  # The registry and connection manager are already started by the application
  setup do
    # Generate unique prefix for this test run
    prefix = :erlang.unique_integer([:positive]) |> Integer.to_string()

    # Register test automata with unique IDs
    id_a = "#{prefix}-auto-a"
    id_b = "#{prefix}-auto-b"
    id_c = "#{prefix}-auto-c"

    # register_automata returns :ok, not {:ok, _}
    :ok = AutomataRegistry.register_automata(automata_with_io(id_a))
    :ok = AutomataRegistry.register_automata(automata_with_io(id_b))
    :ok = AutomataRegistry.register_automata(automata_with_io(id_c))

    on_exit(fn ->
      # Cleanup automata
      AutomataRegistry.delete_automata(id_a)
      AutomataRegistry.delete_automata(id_b)
      AutomataRegistry.delete_automata(id_c)
    end)

    {:ok, prefix: prefix, auto_a: id_a, auto_b: id_b, auto_c: id_c}
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
      auto_b: auto_b
    } do
      {:ok, conn} =
        ConnectionManager.create_connection(%{
          source_automata: auto_a,
          source_output: "result",
          target_automata: auto_b,
          target_input: "input_val"
        })

      ConnectionManager.propagate_output(auto_a, "result", 42)
      :timer.sleep(10)
      {:ok, updated_once} = ConnectionManager.get_connection(conn.id)
      assert updated_once.runtime.message_count == 1
      assert updated_once.runtime.last_value == 42

      ConnectionManager.propagate_output(auto_a, "result", 42)
      :timer.sleep(10)
      {:ok, updated_twice} = ConnectionManager.get_connection(conn.id)
      assert updated_twice.runtime.message_count == 1
      assert updated_twice.runtime.dedupe_count >= 1

      ConnectionManager.delete_connection(conn.id)
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
end
