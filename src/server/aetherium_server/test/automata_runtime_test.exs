defmodule AetheriumServer.AutomataRuntimeTest do
  use ExUnit.Case, async: false
  
  alias AetheriumServer.AutomataRuntime

  # Registry is already started by the application
  # Use unique deployment IDs to avoid conflicts
  setup do
    prefix = :erlang.unique_integer([:positive]) |> Integer.to_string()
    {:ok, prefix: prefix}
  end

  describe "initialization" do
    test "starts with initial state", %{prefix: prefix} do
      deployment_id = "#{prefix}-deploy-1"
      automata = simple_automata()
      
      {:ok, pid} = AutomataRuntime.start_link(
        deployment_id: deployment_id,
        automata: automata
      )
      
      {:ok, state} = AutomataRuntime.get_state(deployment_id)
      
      assert state.current_state == "idle"
      assert state.running == false
      
      GenServer.stop(pid)
    end

    test "initializes variables with defaults", %{prefix: prefix} do
      deployment_id = "#{prefix}-deploy-2"
      automata = automata_with_variables()
      
      {:ok, pid} = AutomataRuntime.start_link(
        deployment_id: deployment_id,
        automata: automata
      )
      
      {:ok, state} = AutomataRuntime.get_state(deployment_id)
      
      assert state.variables["counter"] == 0
      assert state.variables["enabled"] == false
      
      GenServer.stop(pid)
    end
  end

  describe "execution" do
    test "starts and runs on_enter", %{prefix: prefix} do
      deployment_id = "#{prefix}-deploy-3"
      automata = simple_automata()
      
      {:ok, pid} = AutomataRuntime.start_link(
        deployment_id: deployment_id,
        automata: automata
      )
      
      AutomataRuntime.start_execution(deployment_id)
      
      # Give it time to start
      Process.sleep(50)
      
      {:ok, state} = AutomataRuntime.get_state(deployment_id)
      assert state.running == true
      
      GenServer.stop(pid)
    end

    test "stops execution", %{prefix: prefix} do
      deployment_id = "#{prefix}-deploy-4"
      automata = simple_automata()
      
      {:ok, pid} = AutomataRuntime.start_link(
        deployment_id: deployment_id,
        automata: automata
      )
      
      AutomataRuntime.start_execution(deployment_id)
      Process.sleep(50)
      
      AutomataRuntime.stop_execution(deployment_id)
      Process.sleep(50)
      
      {:ok, state} = AutomataRuntime.get_state(deployment_id)
      assert state.running == false
      
      GenServer.stop(pid)
    end

    test "resets to initial state", %{prefix: prefix} do
      deployment_id = "#{prefix}-deploy-5"
      automata = simple_automata()
      
      {:ok, pid} = AutomataRuntime.start_link(
        deployment_id: deployment_id,
        automata: automata
      )
      
      # Force to different state
      AutomataRuntime.force_state(deployment_id, "running")
      Process.sleep(50)
      
      {:ok, state} = AutomataRuntime.get_state(deployment_id)
      assert state.current_state == "running"
      
      # Reset
      AutomataRuntime.reset(deployment_id)
      Process.sleep(50)
      
      {:ok, state} = AutomataRuntime.get_state(deployment_id)
      assert state.current_state == "idle"
      
      GenServer.stop(pid)
    end
  end

  describe "input handling" do
    test "sets input value", %{prefix: prefix} do
      deployment_id = "#{prefix}-deploy-6"
      automata = automata_with_variables()
      
      {:ok, pid} = AutomataRuntime.start_link(
        deployment_id: deployment_id,
        automata: automata
      )
      
      AutomataRuntime.set_input(deployment_id, "enabled", true)
      Process.sleep(50)
      
      {:ok, state} = AutomataRuntime.get_state(deployment_id)
      assert state.inputs["enabled"] == true
      
      GenServer.stop(pid)
    end
  end

  describe "condition-based transitions" do
    test "fires transition when condition becomes true", %{prefix: prefix} do
      deployment_id = "#{prefix}-deploy-7"
      automata = automata_with_condition_transition()
      
      {:ok, pid} = AutomataRuntime.start_link(
        deployment_id: deployment_id,
        automata: automata,
        tick_interval: 50
      )
      
      AutomataRuntime.start_execution(deployment_id)
      Process.sleep(100)
      
      # Should still be in idle (enabled is false)
      {:ok, state} = AutomataRuntime.get_state(deployment_id)
      assert state.current_state == "idle"
      
      # Set enabled to true
      AutomataRuntime.set_input(deployment_id, "enabled", true)
      Process.sleep(150)  # Wait for tick to check condition
      
      {:ok, state} = AutomataRuntime.get_state(deployment_id)
      assert state.current_state == "running"
      
      GenServer.stop(pid)
    end
  end

  describe "weighted transitions" do
    test "handles weighted transition automata", %{prefix: prefix} do
      # Simpler test - just verify weighted automata can be loaded and run
      deployment_id = "#{prefix}-weight-test"
      automata = automata_with_weighted_transitions()
      
      {:ok, pid} = AutomataRuntime.start_link(
        deployment_id: deployment_id,
        automata: automata,
        tick_interval: 20
      )
      
      {:ok, state} = AutomataRuntime.get_state(deployment_id)
      assert state.current_state == "start"
      
      AutomataRuntime.start_execution(deployment_id)
      Process.sleep(50)
      
      {:ok, state} = AutomataRuntime.get_state(deployment_id)
      assert state.running == true
      
      GenServer.stop(pid)
    end
  end

  describe "event handling" do
    test "triggers event transition", %{prefix: prefix} do
      deployment_id = "#{prefix}-deploy-event"
      automata = automata_with_event_transition()
      
      {:ok, pid} = AutomataRuntime.start_link(
        deployment_id: deployment_id,
        automata: automata
      )
      
      AutomataRuntime.start_execution(deployment_id)
      Process.sleep(50)
      
      # Should be in idle
      {:ok, state} = AutomataRuntime.get_state(deployment_id)
      assert state.current_state == "idle"
      
      # Trigger event
      AutomataRuntime.trigger_event(deployment_id, "button_pressed", nil)
      Process.sleep(50)
      
      {:ok, state} = AutomataRuntime.get_state(deployment_id)
      assert state.current_state == "running"
      
      GenServer.stop(pid)
    end
  end

  # ============================================================================
  # Test Automata Fixtures
  # ============================================================================

  defp simple_automata do
    %{
      id: "simple",
      name: "Simple Automata",
      states: %{
        "idle" => %{id: "idle", name: "Idle", type: :initial},
        "running" => %{id: "running", name: "Running", type: :normal}
      },
      transitions: %{},
      variables: []
    }
  end

  defp automata_with_variables do
    %{
      id: "with-vars",
      name: "Automata With Variables",
      states: %{
        "idle" => %{id: "idle", name: "Idle", type: :initial}
      },
      transitions: %{},
      variables: [
        %{id: "v1", name: "counter", type: "int", direction: :internal, default: 0},
        %{id: "v2", name: "enabled", type: "bool", direction: :input, default: false}
      ]
    }
  end

  defp automata_with_condition_transition do
    %{
      id: "condition",
      name: "Condition Automata",
      states: %{
        "idle" => %{id: "idle", name: "Idle", type: :initial},
        "running" => %{id: "running", name: "Running", type: :normal}
      },
      transitions: %{
        "t1" => %{
          id: "t1",
          from: "idle",
          to: "running",
          type: :classic,
          condition: "enabled == true"
        }
      },
      variables: [
        %{id: "v1", name: "enabled", type: "bool", direction: :input, default: false}
      ]
    }
  end

  defp automata_with_weighted_transitions do
    %{
      id: "weighted",
      name: "Weighted Automata",
      states: %{
        "start" => %{id: "start", name: "Start", type: :initial},
        "state_a" => %{id: "state_a", name: "State A", type: :normal},
        "state_b" => %{id: "state_b", name: "State B", type: :normal}
      },
      transitions: %{
        "t1" => %{
          id: "t1",
          from: "start",
          to: "state_a",
          type: :probabilistic,
          condition: "trigger == true",
          weight: 70
        },
        "t2" => %{
          id: "t2",
          from: "start",
          to: "state_b",
          type: :probabilistic,
          condition: "trigger == true",
          weight: 30
        }
      },
      variables: [
        %{id: "v1", name: "trigger", type: "bool", direction: :input, default: false}
      ]
    }
  end

  defp automata_with_event_transition do
    %{
      id: "event",
      name: "Event Automata",
      states: %{
        "idle" => %{id: "idle", name: "Idle", type: :initial},
        "running" => %{id: "running", name: "Running", type: :normal}
      },
      transitions: %{
        "t1" => %{
          id: "t1",
          from: "idle",
          to: "running",
          type: :event,
          event: "button_pressed"
        }
      },
      variables: []
    }
  end
end
