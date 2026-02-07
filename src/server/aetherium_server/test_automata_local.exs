# ============================================================================
# Aetherium Automata - Test Automata Runtime
# ============================================================================
#
# Run this in IEx to test an automata locally without gateway/devices:
#
#   cd src/server/aetherium_server
#   iex -S mix
#   c("test_automata_local.exs")
#
# Or run directly:
#   mix run test_automata_local.exs
#
# ============================================================================

require Logger

# Simple blinking LED automata definition
automata = %{
  id: "blinking-led-test",
  name: "Blinking LED Test",
  version: "1.0.0",
  
  states: %{
    "LED_OFF" => %{
      id: "LED_OFF",
      name: "LED Off",
      type: :initial,
      on_enter: """
      log("info", "💡 LED is now OFF - count: " .. (variables.blink_count or 0))
      """,
      on_tick: nil
    },
    "LED_ON" => %{
      id: "LED_ON", 
      name: "LED On",
      type: :normal,
      on_enter: """
      local count = (variables.blink_count or 0) + 1
      setVal("blink_count", count)
      log("info", "💡 LED is now ON - count: " .. count)
      """,
      on_tick: nil
    }
  },
  
  transitions: %{
    "turn_on" => %{
      id: "turn_on",
      from: "LED_OFF",
      to: "LED_ON",
      type: :timed,
      after: 2000,  # 2 seconds
      condition: nil
    },
    "turn_off" => %{
      id: "turn_off",
      from: "LED_ON", 
      to: "LED_OFF",
      type: :timed,
      after: 2000,  # 2 seconds
      condition: nil
    }
  },
  
  variables: [
    %{id: "v1", name: "blink_count", type: "int", direction: :output, default: 0}
  ]
}

IO.puts("""

╔═══════════════════════════════════════════════════════════════╗
║           Aetherium Automata - Local Runtime Test             ║
╚═══════════════════════════════════════════════════════════════╝

Starting Blinking LED automata...
This will toggle between LED_ON and LED_OFF every 2 seconds.

Watch for log messages like:
  [info] 💡 LED is now OFF - count: 0
  [info] 💡 LED is now ON - count: 1
  [info] 💡 LED is now OFF - count: 1
  [info] 💡 LED is now ON - count: 2
  ...

Press Ctrl+C twice to stop.

""")

# Start the runtime
{:ok, pid} = AetheriumServer.AutomataRuntime.start_link(
  deployment_id: "local-test-001",
  automata: automata,
  tick_interval: 100  # 100ms tick
)

Logger.info("AutomataRuntime started with PID: #{inspect(pid)}")

# Get initial state
{:ok, state} = AetheriumServer.AutomataRuntime.get_state("local-test-001")
Logger.info("Initial state: #{state.current_state}")

# Start execution
AetheriumServer.AutomataRuntime.start_execution("local-test-001")
Logger.info("Execution started - automata is now running!")

# Keep the script running
IO.puts("\n[Press Ctrl+C twice to stop]\n")

# Wait forever (or until interrupted)
receive do
  :never -> :ok
end
