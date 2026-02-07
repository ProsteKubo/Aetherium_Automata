# Testing Guide for Aetherium Automata

This guide explains how to test each component in isolation and where features appear in the UI.

## Quick Start

```bash
# Make the test script executable
chmod +x scripts/test.sh

# Run all tests
./scripts/test.sh all

# Run specific component tests
./scripts/test.sh gateway
./scripts/test.sh server
./scripts/test.sh protocol
./scripts/test.sh ide
```

---

## 1. Gateway Testing (Elixir)

### Location
`src/gateway/aetherium_gateway/`

### Run Tests
```bash
cd src/gateway/aetherium_gateway
mix test
```

### Test Individual Modules
```bash
# Test Protocol encoding/decoding
mix test test/protocol_test.exs

# Test AutomataRegistry
mix test test/automata_registry_test.exs

# Test ConnectionManager
mix test test/connection_manager_test.exs
```

### Interactive Testing (IEx)
```bash
cd src/gateway/aetherium_gateway
iex -S mix phx.server
```

Then in IEx:
```elixir
# Test Protocol
alias AetheriumGateway.Protocol

# Encode a hello message
{:ok, encoded} = Protocol.hello("device-001", :esp32, 0x0F)

# Decode it back
{:ok, :hello, payload} = Protocol.decode(encoded)
IO.inspect(payload)

# Test AutomataRegistry
alias AetheriumGateway.AutomataRegistry

# Register an automata
automata = %{
  id: "test-1",
  name: "Test Automata",
  states: %{"s1" => %{id: "s1", type: :initial}},
  transitions: %{},
  variables: []
}
{:ok, registered} = AutomataRegistry.register_automata(automata)

# List all automata
AutomataRegistry.list_automata()

# Deploy to a device
{:ok, deployment} = AutomataRegistry.deploy_automata("test-1", "device-001", "server-001")

# Test ConnectionManager
alias AetheriumGateway.ConnectionManager

# Create a connection between automata
{:ok, conn} = ConnectionManager.create_connection(%{
  source_automata: "auto-a",
  source_output: "result",
  target_automata: "auto-b",
  target_input: "input_val"
})
```

---

## 2. Server Testing (Elixir)

### Location
`src/server/aetherium_server/`

### Run Tests
```bash
cd src/server/aetherium_server
mix test
```

### Test Individual Modules
```bash
# Test AutomataRuntime (FSM execution)
mix test test/automata_runtime_test.exs

# Test Protocol
mix test test/protocol_test.exs
```

### Interactive Testing (IEx)
```bash
cd src/server/aetherium_server
iex -S mix
```

Then in IEx:
```elixir
# Test AutomataRuntime
alias AetheriumServer.AutomataRuntime

# Create a simple automata
automata = %{
  id: "test",
  name: "Test FSM",
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

# Start a runtime
{:ok, pid} = AutomataRuntime.start_link(deployment_id: "test-deploy", automata: automata)

# Check state
{:ok, state} = AutomataRuntime.get_state("test-deploy")
IO.inspect(state)

# Start execution
AutomataRuntime.start_execution("test-deploy")

# Set input to trigger transition
AutomataRuntime.set_input("test-deploy", "enabled", true)

# Wait a moment for tick
Process.sleep(200)

# Check new state
{:ok, state} = AutomataRuntime.get_state("test-deploy")
IO.inspect(state.current_state)  # Should be "running"
```

### Test Weighted Transitions
```elixir
# Create automata with weighted transitions
automata = %{
  id: "weighted-test",
  states: %{
    "start" => %{id: "start", type: :initial},
    "a" => %{id: "a", type: :normal},
    "b" => %{id: "b", type: :normal}
  },
  transitions: %{
    "t1" => %{id: "t1", from: "start", to: "a", type: :probabilistic, condition: "go", weight: 70},
    "t2" => %{id: "t2", from: "start", to: "b", type: :probabilistic, condition: "go", weight: 30}
  },
  variables: [%{id: "v1", name: "go", direction: :input, default: false}]
}

# Run 100 times and count results
results = for i <- 1..100 do
  {:ok, pid} = AutomataRuntime.start_link(deployment_id: "w-#{i}", automata: automata)
  AutomataRuntime.start_execution("w-#{i}")
  AutomataRuntime.set_input("w-#{i}", "go", true)
  Process.sleep(100)
  {:ok, state} = AutomataRuntime.get_state("w-#{i}")
  GenServer.stop(pid)
  state.current_state
end

# Count distribution
Enum.frequencies(results)
# Expected: roughly %{"a" => 70, "b" => 30}
```

---

## 3. IDE Testing

### Location
`src/ide/`

### Run IDE
```bash
cd src/ide
npm install
npm run dev
```

### Where Features Appear in UI

#### Activity Bar (Left Side)
New icons added for:
- **Transition Groups** - Click to open TransitionGroupPanel
- **Variable Management** - Click to open VariableManagementPanel  
- **Automata Connections** - Click to open AutomataConnectionsPanel

#### Panels

1. **TransitionGroupPanel** (`transitions`)
   - Shows transitions grouped by source state
   - Displays weight visualization (bar showing relative weights)
   - "Normalize" button to make weights sum to 100%
   - Click transitions to select them

2. **VariableManagementPanel** (`variables`)
   - Unified view of all variables across automata
   - Tabs: Inputs | Outputs | Internal
   - Shows variable name, type, default value, usage count
   - Search/filter functionality
   - Edit values directly

3. **AutomataConnectionsPanel** (`connections`)
   - Shows inter-automata I/O bindings
   - Toggle between list and graph view
   - Create new connections with dropdowns
   - Enable/disable connections
   - Visual graph shows data flow between automata

#### Editor Canvas
- **WeightedTransitionGroup** - When multiple weighted transitions share source/target, displays a pie chart overlay showing weight distribution

### Test Components in Isolation
```bash
cd src/ide

# Run unit tests
npm test

# Run specific test file
npm test -- TransitionGroupPanel

# Watch mode
npm run test:watch
```

---

## 4. Protocol Testing

The protocol is tested in both gateway and server:

```bash
# Test gateway protocol
cd src/gateway/aetherium_gateway
mix test test/protocol_test.exs --trace

# Test server protocol  
cd src/server/aetherium_server
mix test test/protocol_test.exs --trace
```

### Key Protocol Tests
- **Round-trip encoding/decoding** - Encode message → Decode → Verify data matches
- **CRC validation** - Corrupted messages are detected
- **Value types** - nil, boolean, integers, floats, strings
- **Automata encoding** - Full automata with states, transitions, variables

---

## 5. Integration Testing

### Start Full Stack
```bash
# Terminal 1: Gateway
cd src/gateway/aetherium_gateway
mix phx.server

# Terminal 2: Server
cd src/server/aetherium_server  
mix run --no-halt

# Terminal 3: IDE
cd src/ide
npm run dev
```

### Test Flow
1. Open IDE at http://localhost:5173 (or Electron app)
2. Connect to gateway (Gateway panel)
3. Create an automata with weighted transitions
4. Open Transition Groups panel to see grouping
5. Add variables and see them in Variable Management
6. Create a second automata
7. Open Connections panel and link their I/O

### WebSocket Testing
Use browser DevTools or wscat to test channels:

```bash
# Install wscat
npm install -g wscat

# Connect to gateway
wscat -c "ws://localhost:4000/socket/websocket?token=test"

# Join automata channel
{"topic": "automata:control", "event": "phx_join", "payload": {}, "ref": "1"}

# Create automata
{"topic": "automata:control", "event": "create_automata", "payload": {"name": "Test", "description": "Test automata"}, "ref": "2"}
```

---

## 6. Troubleshooting

### Gateway Issues
```elixir
# Check if modules are loaded
Code.ensure_loaded?(AetheriumGateway.AutomataRegistry)

# Check supervision tree
Supervisor.which_children(AetheriumGateway.Supervisor)
```

### Server Issues
```elixir
# Check runtime registry
Registry.lookup(AetheriumServer.RuntimeRegistry, "deployment-id")

# List all running runtimes
Registry.select(AetheriumServer.RuntimeRegistry, [{{:"$1", :"$2", :"$3"}, [], [{{:"$1", :"$2"}}]}])
```

### IDE Issues
```bash
# Clear cache and reinstall
cd src/ide
rm -rf node_modules
npm install

# Check for TypeScript errors
npm run typecheck
```

---

## 7. Test Coverage

### Gateway
```bash
cd src/gateway/aetherium_gateway
mix test --cover
```

### Server
```bash
cd src/server/aetherium_server
mix test --cover
```

### IDE
```bash
cd src/ide
npm run test:coverage
```
