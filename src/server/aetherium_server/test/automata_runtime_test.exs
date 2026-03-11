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

      {:ok, pid} =
        AutomataRuntime.start_link(
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

      {:ok, pid} =
        AutomataRuntime.start_link(
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

      {:ok, pid} =
        AutomataRuntime.start_link(
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

      {:ok, pid} =
        AutomataRuntime.start_link(
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

      {:ok, pid} =
        AutomataRuntime.start_link(
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

    test "executes code blocks on tick for host-runtime style automata", %{prefix: prefix} do
      deployment_id = "#{prefix}-deploy-code"
      automata = automata_with_code_tick()

      {:ok, pid} =
        AutomataRuntime.start_link(
          deployment_id: deployment_id,
          automata: automata,
          tick_interval: 20
        )

      AutomataRuntime.set_input(deployment_id, "esp_pot_mv", 2100)
      AutomataRuntime.set_input(deployment_id, "sw2_pressed", true)
      AutomataRuntime.set_input(deployment_id, "touch_pressed", false)
      AutomataRuntime.start_execution(deployment_id)

      Process.sleep(120)

      {:ok, state} = AutomataRuntime.get_state(deployment_id)
      assert state.running == true
      assert state.outputs["pot_band"] == 2
      assert state.outputs["allow_remote"] == true
      assert state.outputs["manual_boost"] == false
      assert state.outputs["conditioner_state"] == "armed"

      GenServer.stop(pid)
    end

    test "normalizes string-key automata payloads from the IDE", %{prefix: prefix} do
      deployment_id = "#{prefix}-deploy-string"

      {:ok, pid} =
        AutomataRuntime.start_link(
          deployment_id: deployment_id,
          automata: string_key_automata(),
          tick_interval: 20
        )

      AutomataRuntime.set_input(deployment_id, "pot_mv", 2100)
      AutomataRuntime.set_input(deployment_id, "sw2_pressed", true)
      AutomataRuntime.start_execution(deployment_id)

      Process.sleep(120)

      {:ok, state} = AutomataRuntime.get_state(deployment_id)
      assert state.current_state == "Monitor"
      assert state.outputs["pot_band"] == 2
      assert state.outputs["allow_remote"] == true
      assert state.outputs["conditioner_state"] == "armed"

      GenServer.stop(pid)
    end
  end

  describe "input handling" do
    test "sets input value", %{prefix: prefix} do
      deployment_id = "#{prefix}-deploy-6"
      automata = automata_with_variables()

      {:ok, pid} =
        AutomataRuntime.start_link(
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

      {:ok, pid} =
        AutomataRuntime.start_link(
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
      # Wait for tick to check condition
      Process.sleep(150)

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

      {:ok, pid} =
        AutomataRuntime.start_link(
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

      {:ok, pid} =
        AutomataRuntime.start_link(
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

  defp automata_with_code_tick do
    %{
      id: "code-tick",
      name: "Code Tick Automata",
      states: %{
        "monitor" => %{
          id: "monitor",
          name: "Monitor",
          type: :initial,
          code: """
          local mv = esp_pot_mv or 0
          local band = 0

          if mv >= 2600 then
            band = 3
          elseif mv >= 1800 then
            band = 2
          elseif mv >= 900 then
            band = 1
          end

          local allow = sw2_pressed == true
          local boost = touch_pressed == true
          local state_name = "standby"

          if boost then
            state_name = "boost"
          elseif allow then
            state_name = "armed"
          end

          setOutput("pot_band", band)
          setOutput("allow_remote", allow)
          setOutput("manual_boost", boost)
          setOutput("conditioner_state", state_name)
          """
        }
      },
      transitions: %{},
      variables: [
        %{id: "v1", name: "esp_pot_mv", type: "int", direction: :input, default: 0},
        %{id: "v2", name: "sw2_pressed", type: "bool", direction: :input, default: false},
        %{id: "v3", name: "touch_pressed", type: "bool", direction: :input, default: false},
        %{id: "v4", name: "pot_band", type: "int", direction: :output, default: 0},
        %{id: "v5", name: "allow_remote", type: "bool", direction: :output, default: false},
        %{id: "v6", name: "manual_boost", type: "bool", direction: :output, default: false},
        %{id: "v7", name: "conditioner_state", type: "string", direction: :output, default: "standby"}
      ]
    }
  end

  defp string_key_automata do
    %{
      "id" => "string-key-runtime",
      "name" => "String Key Runtime",
      "version" => "1.0.0",
      "initial_state" => "Monitor",
      "states" => %{
        "Monitor" => %{
          "code" => """
          local mv = pot_mv or 0
          local band = 0

          if mv >= 1800 then
            band = 2
          elseif mv >= 900 then
            band = 1
          end

          local allow = sw2_pressed == true
          local state_name = "standby"

          if allow then
            state_name = "armed"
          end

          setOutput("pot_band", band)
          setOutput("allow_remote", allow)
          setOutput("conditioner_state", state_name)
          """
        }
      },
      "transitions" => %{},
      "variables" => [
        %{"name" => "pot_mv", "type" => "int", "direction" => "input", "default" => 0},
        %{"name" => "sw2_pressed", "type" => "bool", "direction" => "input", "default" => false},
        %{"name" => "pot_band", "type" => "int", "direction" => "output", "default" => 0},
        %{"name" => "allow_remote", "type" => "bool", "direction" => "output", "default" => false},
        %{
          "name" => "conditioner_state",
          "type" => "string",
          "direction" => "output",
          "default" => "standby"
        }
      ]
    }
  end
end
