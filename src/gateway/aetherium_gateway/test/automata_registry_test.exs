defmodule AetheriumGateway.AutomataRegistryTest do
  use ExUnit.Case, async: false
  
  alias AetheriumGateway.AutomataRegistry

  # Use unique IDs for each test run to avoid conflicts
  # The registry is already started by the application
  setup do
    # Generate unique prefix for this test run
    prefix = :erlang.unique_integer([:positive]) |> Integer.to_string()
    {:ok, prefix: prefix}
  end

  describe "automata CRUD" do
    test "registers new automata", %{prefix: prefix} do
      id = "#{prefix}-test-1"
      automata = sample_automata(id)
      
      assert :ok = AutomataRegistry.register_automata(automata)
      
      # Verify it was registered
      {:ok, retrieved} = AutomataRegistry.get_automata(id)
      assert retrieved.id == id
      assert retrieved.name == "Test Automata"
      
      # Cleanup
      AutomataRegistry.delete_automata(id)
    end

    test "retrieves registered automata", %{prefix: prefix} do
      id = "#{prefix}-test-2"
      automata = sample_automata(id)
      :ok = AutomataRegistry.register_automata(automata)
      
      {:ok, retrieved} = AutomataRegistry.get_automata(id)
      
      assert retrieved.id == id
      
      # Cleanup
      AutomataRegistry.delete_automata(id)
    end

    test "returns error for unknown automata" do
      assert {:error, :not_found} = AutomataRegistry.get_automata("nonexistent-unknown-id")
    end

    test "lists all automata", %{prefix: prefix} do
      id1 = "#{prefix}-a1"
      id2 = "#{prefix}-a2"
      
      :ok = AutomataRegistry.register_automata(sample_automata(id1))
      :ok = AutomataRegistry.register_automata(sample_automata(id2))
      
      list = AutomataRegistry.list_automata()
      
      # Check our test automata are in the list
      assert Enum.any?(list, &(&1.id == id1))
      assert Enum.any?(list, &(&1.id == id2))
      
      # Cleanup
      AutomataRegistry.delete_automata(id1)
      AutomataRegistry.delete_automata(id2)
    end

    test "updates automata", %{prefix: prefix} do
      id = "#{prefix}-test-3"
      :ok = AutomataRegistry.register_automata(sample_automata(id))
      
      :ok = AutomataRegistry.update_automata(id, %{name: "Updated Name"})
      
      {:ok, updated} = AutomataRegistry.get_automata(id)
      assert updated.name == "Updated Name"
      
      # Cleanup
      AutomataRegistry.delete_automata(id)
    end

    test "deletes automata", %{prefix: prefix} do
      id = "#{prefix}-test-4"
      :ok = AutomataRegistry.register_automata(sample_automata(id))
      
      :ok = AutomataRegistry.delete_automata(id)
      
      assert {:error, :not_found} = AutomataRegistry.get_automata(id)
    end
  end

  describe "deployments" do
    test "deploys automata to device", %{prefix: prefix} do
      auto_id = "#{prefix}-auto-1"
      device_id = "#{prefix}-device-1"
      server_id = "#{prefix}-server-1"
      
      :ok = AutomataRegistry.register_automata(sample_automata(auto_id))
      
      {:ok, deployment} = AutomataRegistry.deploy_automata(auto_id, device_id, server_id)
      
      assert deployment.automata_id == auto_id
      assert deployment.device_id == device_id
      assert deployment.server_id == server_id
      assert deployment.status == :pending
      
      # Cleanup
      AutomataRegistry.delete_automata(auto_id)
    end

    test "lists deployments", %{prefix: prefix} do
      auto_id = "#{prefix}-auto-2"
      
      :ok = AutomataRegistry.register_automata(sample_automata(auto_id))
      {:ok, d1} = AutomataRegistry.deploy_automata(auto_id, "#{prefix}-dev-1", "#{prefix}-srv-1")
      {:ok, d2} = AutomataRegistry.deploy_automata(auto_id, "#{prefix}-dev-2", "#{prefix}-srv-1")
      
      deployments = AutomataRegistry.list_deployments()
      
      # Check our test deployments are present by device_id
      assert Enum.any?(deployments, &(&1.device_id == d1.device_id))
      assert Enum.any?(deployments, &(&1.device_id == d2.device_id))
      
      # Cleanup
      AutomataRegistry.delete_automata(auto_id)
    end

    test "updates deployment status", %{prefix: prefix} do
      auto_id = "#{prefix}-auto-3"
      device_id = "#{prefix}-dev-3"
      
      :ok = AutomataRegistry.register_automata(sample_automata(auto_id))
      {:ok, deployment} = AutomataRegistry.deploy_automata(auto_id, device_id, "#{prefix}-srv-1")
      
      # Use cast (returns :ok immediately)
      :ok = AutomataRegistry.update_deployment_status(deployment.automata_id, device_id, :running)
      
      # Small delay to allow cast to process
      Process.sleep(10)
      
      {:ok, updated} = AutomataRegistry.get_device_deployment(device_id)
      assert updated.status == :running
      
      # Cleanup
      AutomataRegistry.delete_automata(auto_id)
    end

    test "reconciles live server inventory and clears stale deployments", %{prefix: prefix} do
      auto_a = "#{prefix}-auto-a"
      auto_b = "#{prefix}-auto-b"
      device_a = "#{prefix}-device-a"
      device_b = "#{prefix}-device-b"
      server_id = "#{prefix}-server"

      :ok = AutomataRegistry.register_automata(sample_automata(auto_a))
      :ok = AutomataRegistry.register_automata(sample_automata(auto_b))
      {:ok, _} = AutomataRegistry.deploy_automata(auto_a, device_a, server_id)
      {:ok, _} = AutomataRegistry.deploy_automata(auto_b, device_b, server_id)
      :ok = AutomataRegistry.update_deployment_status(auto_a, device_a, :running)
      :ok = AutomataRegistry.update_deployment_status(auto_b, device_b, :running)
      Process.sleep(20)

      deployments =
        AutomataRegistry.reconcile_server_deployments(server_id, [
          %{
            "automata_id" => auto_a,
            "device_id" => device_a,
            "status" => "running",
            "current_state" => "s2",
            "variables" => %{"result" => 42}
          }
        ])

      dep_a = Enum.find(deployments, &(&1.automata_id == auto_a and &1.device_id == device_a))
      dep_b = Enum.find(deployments, &(&1.automata_id == auto_b and &1.device_id == device_b))

      assert dep_a.status == :running
      assert dep_a.current_state == "s2"
      assert dep_a.variables["result"] == 42
      assert dep_b.status == :stopped
      assert dep_b.current_state == nil

      AutomataRegistry.delete_automata(auto_a)
      AutomataRegistry.delete_automata(auto_b)
    end
  end

  describe "transition tracking" do
    test "records transitions", %{prefix: prefix} do
      auto_id = "#{prefix}-auto-4"
      device_id = "#{prefix}-dev-4"
      
      :ok = AutomataRegistry.register_automata(sample_automata(auto_id))
      {:ok, _deployment} = AutomataRegistry.deploy_automata(auto_id, device_id, "#{prefix}-srv-1")
      
      # record_transition is a cast, takes 5 args: device_id, from_state, to_state, transition_id, metadata
      :ok = AutomataRegistry.record_transition(device_id, "s1", "s2", "t1", %{weight: 50})
      :ok = AutomataRegistry.record_transition(device_id, "s1", "s2", "t1", %{weight: 50})
      :ok = AutomataRegistry.record_transition(device_id, "s1", "s3", "t2", %{weight: 50})
      
      # Small delay to allow casts to process
      Process.sleep(10)
      
      # Get transition history instead of stats
      history = AutomataRegistry.get_transition_history(device_id)
      
      assert length(history) == 3
      
      # Cleanup
      AutomataRegistry.delete_automata(auto_id)
    end
  end

  # Helper to create sample automata
  defp sample_automata(id) do
    %{
      id: id,
      name: "Test Automata",
      version: "1.0.0",
      states: %{
        "s1" => %{id: "s1", name: "Initial", type: :initial},
        "s2" => %{id: "s2", name: "Running", type: :normal}
      },
      transitions: %{
        "t1" => %{id: "t1", from: "s1", to: "s2", type: :classic}
      },
      variables: []
    }
  end
end
