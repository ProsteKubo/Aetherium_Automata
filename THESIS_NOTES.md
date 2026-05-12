# Aetherium Automata — Thesis Reference Notes

---

## 1. Project Overview

Aetherium Automata is a distributed IoT orchestration platform built around **Extended Finite State Machines (EFSMs)** as the primary modeling abstraction. The system provides a complete toolchain: a visual IDE for designing state machines, a portable C++ runtime engine that runs on desktop and documented embedded targets (ESP32 and FRDM-MCXN947), a real-time gateway layer, and an observability stack with replay-capable tracing.

The core thesis: most IoT control logic is inherently stateful, and representing that logic explicitly as state machines—rather than ad-hoc scripts or workflow DAGs—improves correctness, testability, and observability. Lua acts as a guest language for guards and side-effect code, subordinate to the EFSM structure.

---

## 2. Theoretical Foundations

### 2.1 Finite State Machines (FSM)

A classical FSM is a 5-tuple (Q, Σ, δ, q₀, F):
- Q — finite set of states
- Σ — input alphabet (signals/events)
- δ : Q × Σ → Q — transition function
- q₀ ∈ Q — initial state
- F ⊆ Q — set of accepting/final states (optional for control systems)

In control applications the focus is on the transition function and state actions, not acceptance. Aetherium extends this to an EFSM.

### 2.2 Extended Finite State Machines (EFSM)

An EFSM augments the FSM with a variable store V, turning guards and actions into functions over that store:

- Q, Σ, q₀ as above
- V — finite set of typed variables (inputs, outputs, internals)
- Guard g : V → Bool — predicate evaluated before firing a transition
- Action α : V → V — side-effect executed when a transition fires
- δ : Q × Σ × V → Q × V — extended transition function

Each state additionally supports three code hooks evaluated in sequence:
- **on_enter** — runs once when the state is entered
- **body** — runs every execution tick while in the state
- **on_exit** — runs once before leaving the state

This is equivalent to a Moore/Mealy hybrid: state-dependent output (Moore) via on_enter, and input-dependent output (Mealy) via body and transition actions.

### 2.3 Petri Nets

Petri nets are a mathematical formalism for modeling concurrent, distributed, and asynchronous systems. A Petri net is a 4-tuple (P, T, F, M₀):
- P — set of places (represent states or conditions)
- T — set of transitions
- F ⊆ (P×T) ∪ (T×P) — flow relation (arcs)
- M₀ : P → ℕ — initial marking (token distribution)

A transition fires when all its input places hold enough tokens (enabled). Firing removes tokens from inputs and deposits tokens in outputs.

Aetherium uses Petri nets at the **network level**—where multiple automata interact. Each automaton's current state contributes a "token" to the shared model. This enables:
- **Deadlock detection**: states where no transition can ever fire
- **Bottleneck analysis**: places that accumulate tokens (queue buildup)
- **Contention modeling**: shared resources modeled as places with bounded capacity (semaphore-like)
- **Signal chain visualization**: token flow through a chain of cooperating automata

In the example showcase, scenarios 13 (signal chain) and 14 (contention) are direct demonstrations of Petri net semantics over automata networks.

### 2.4 Transition Types and Their Mathematical Basis

Aetherium defines five transition kinds, each with distinct semantics:

**Classic** — standard EFSM guarded transition:
- Enabled iff guard expression g(V) = true
- Deterministic; higher-priority transitions evaluated first

**Timed** — time-domain triggers:
- Modes: after delay Δt, at absolute time t, periodic interval τ, timeout (fire unless preempted), window [t_start, t_end]
- Timer state maintained per-transition; jitter ε can be added: t_fire = t_target + rand(0, ε)
- Models watchdogs, heartbeats, scheduling, deadlines

**Event** — reactive signal triggers:
- OnChange: ∃ update to variable v since last clear
- OnRise/OnFall: v transitions false→true or true→false (edge detection)
- OnThreshold: v ⊗ k where ⊗ ∈ {>, <, ≥, ≤, =, ≠} (comparator with hysteresis via one_shot)
- Debounce: filter events shorter than minimum duration δ_debounce

**Probabilistic** — stochastic selection:
- Each transition i carries weight w_i ∈ [0, 10000] (fixed-point representing 0.00%–100.00%)
- Normalized probability: P(Tᵢ) = wᵢ / Σⱼ wⱼ (over enabled transitions in the same priority group)
- Selection via weighted roulette (inverse CDF method)
- Weights can be Lua expressions recomputed each cycle, enabling dynamic distributions
- Models: load balancing, fault recovery preference, quality routing, non-deterministic testing

**Immediate (epsilon)** — unconditional:
- Always enabled; resolved before other types
- Models epsilon/spontaneous transitions in NFA theory
- Used for chaining states without observable intermediate steps

### 2.5 Transition Resolution Algorithm

Each execution tick resolves which transition fires from the current state:

```
1. Collect all outgoing transitions from current state
2. Evaluate each for enablement:
   - Classic:       condition(V) == true
   - Timed:         timer expired
   - Event:         signal condition met
   - Probabilistic: always enabled
   - Immediate:     always enabled
3. Filter to enabled set E
4. Sort E by priority (ascending integer; lower value = higher priority)
5. Partition into highest-priority group G ⊆ E
6. If |G| == 1: fire that transition
7. If |G| > 1:
   a. Compute normalized weights for members of G
   b. If all weights are zero: select first (declaration order)
   c. Else: weighted roulette selection
8. Fire selected transition:
   a. Execute transition body (Lua)
   b. Execute on_exit of current state
   c. Move to target state
   d. Execute on_enter of new state
9. If E is empty: remain in current state, execute body
```

Priority is a total order; probability is only invoked within a same-priority group. This cleanly separates deterministic control flow from intentional non-determinism.

---

## 3. System Architecture

### 3.1 Component Layers

```
┌────────────────────────────────────────────┐
│  IDE  (Electron + TypeScript/React)        │
│  Visual design, live monitoring, replay    │
└──────────────────┬─────────────────────────┘
                   │ WebSocket / Phoenix Channels
┌──────────────────▼─────────────────────────┐
│  Gateway  (Elixir / Phoenix)               │
│  Real-time bridge, device registry,        │
│  command routing, event streaming          │
└──────────────────┬─────────────────────────┘
                   │ WebSocket / connector protocol
┌──────────────────▼─────────────────────────┐
│  Server  (Elixir / OTP)                    │
│  Device management, message buffering,     │
│  state aggregation, deployment             │
└────────┬─────────┬────────────┬────────────┘
         │ WS      │ ROS2       │ Serial/USB
    ┌────▼──┐ ┌────▼──┐   ┌────▼──┐
    │Device │ │ ESP32 │   │MCXN947│
    │Engine │ │Engine │   │Engine │
    └───────┘ └───────┘   └───────┘
```

### 3.2 C++ Engine (Core Runtime)

The engine is a portable C++17 library with platform-specific backends plugged in via abstract interfaces. Key modules:

- **Runtime** — execution loop; drives the tick cycle, manages timers, dispatches state transitions
- **Model** — data types: `State`, `Transition`, `Automata`, `CodeBlock`, all transition configs
- **VariableStore** — typed variable instances with change-tracking flags; the EFSM variable context V
- **TransitionResolver** — implements the resolution algorithm above
- **LuaEngine** — embeds Lua 5.4 via Sol2; exposes API (`value()`, `setVal()`, `emit()`, `log()`, `rand()`, `now()`, `clamp()`)
- **Parser** — RapidYAML-based YAML→Model deserializer with validation
- **Transport** — abstract `ITransport` with WebSocket implementation via IXWebSocket
- **Protocol** — binary wire format (magic 0xAE01, version 0x01) for control/data messages
- **ExecutionTrace** — records every event for time-travel replay; exports JSON Lines
- **Telemetry** — structured log hub, variable-change streaming
- **Artifact** — binary container format for deployable automata (YAML or bytecode)

Platform interfaces allow the same engine core to compile for:
- Desktop (full C++17 + Lua 5.4)
- ESP32 (Arduino + FreeRTOS + lightweight Lua or simple script engine)
- MCXN947 ARM Cortex-M7

### 3.3 YAML DSL

Automata are authored in a YAML domain-specific language. Top-level sections:

- `version` — schema version
- `config` — name, description, author, tags, layout type (`inline` or `folder`)
- `automata.initial_state` — entry point
- `automata.states` — map of StateId → {on_enter, body, on_exit} Lua blocks
- `automata.transitions` — map of TransitionId → {from, to, type, priority, weight, condition, timed/event config}
- `variables` — list of {name, type, direction, default} definitions

Validation rules: identifiers match `^[A-Za-z_][A-Za-z0-9_]*$`, transition endpoints must reference valid states, variable names must be unique.

**Black-box contract extension** adds to the YAML:
- `ports` — named I/O with observability and fault-injectability flags
- `emitted_events` — event names the automata produces
- `observable_states` — states visible to external monitors
- `resources` — shared/exclusive resources with capacity and latency budgets

### 3.4 Gateway (Elixir/Phoenix)

Phoenix Channels provide persistent, bidirectional WebSocket connections with topic-based routing. The gateway:
- Maintains a channel per connected IDE client
- Manages device registry (discovery, heartbeat)
- Routes commands (deploy, start, stop, set input) to the server
- Streams events (state changes, outputs, telemetry) back to IDE
- Caches snapshots for efficient reconnection

### 3.5 IDE (Electron)

Built with Electron (main process in Node.js + renderer in React). State management via Zustand stores, each with a narrow concern:

| Store | Responsibility |
|---|---|
| `automataStore` | Editing the automata definition |
| `projectStore` | Multi-automata project management |
| `runtimeViewStore` | Live visualization (current state, variable values) |
| `gatewayStore` | Phoenix connection, device list |
| `analyzerStore` | Petri net analysis results |

Key panels: canvas editor, state/transition inspector, variables panel, gateway panel, runtime monitor, log panel, network topology, Petri net analyzer.

---

## 4. Communication Protocol

### 4.1 Binary Wire Format

Messages use a compact binary envelope: `[magic:2][version:1][type:1][length:4][payload:N]`

Message categories:
- **Control plane**: Hello, Ping/Pong, Status
- **Automata plane**: LoadAutomata, Start, Stop, Restart
- **Data plane**: Input, Output, StateChange, Telemetry
- **Chunked transfer**: for large automata artifacts that exceed MTU

### 4.2 End-to-End Flow

```
IDE ──DEPLOY(yaml)──→ Gateway ──LOAD(bytes)──→ Device
                                              [parse + load automata]
IDE ←──DEPLOY_OK────── Gateway ←──LOAD_ACK──── Device

IDE ──START(runId)──→ Gateway ──START──→ Device
                                         [begin execution loop]
IDE ←──RUNNING──────── Gateway ←──RUNNING── Device

IDE ──SET_INPUT(x=5)──→ Gateway ──INPUT──→ Device
                                            [resolve transitions]
IDE ←──OUTPUT(y=10)──── Gateway ←──OUTPUT── Device
```

---

## 5. Key Engineering Strategies

### 5.1 Fault Injection

Fault profiles can be applied per-device for reproducible testing:
- **Ingress**: fixed delay + jitter, drop probability, duplicate probability
- **Egress**: same set of perturbations on outgoing messages
- **Disconnect simulation**: periodic forced disconnection windows
- **Battery drain**: per-tick and per-message consumption model
- **Deterministic RNG**: seed in fault profile ensures reproducible scenarios across runs

### 5.2 Time-Travel Debugging

Every execution event (state transition, variable change, message send/receive) is recorded in an `ExecutionTrace`. Each record carries: sequence number, wall-clock and monotonic timestamps, latency measurements, which fault actions were applied. The trace exports to JSON Lines for post-mortem tooling. The IDE can replay the trace and step forward/backward through execution history.

### 5.3 Variable Change Detection

Each variable instance maintains a `changed()` flag alongside its value. The flag is set on any write and cleared explicitly or on state transition. Event-type transitions poll this flag rather than diffing values, enabling O(1) reactive detection without observer lists or pub/sub overhead.

### 5.4 Petri Net Analysis (Structural)

The analyzer lifts the automata network into a Petri net representation and applies reachability analysis:
- **Deadlock detection**: search for markings where no transition is enabled
- **Unbounded places**: detect places that can accumulate arbitrarily many tokens (liveness violation)
- **Bottleneck identification**: places that are persistently marked across reachability graph
- **Contention analysis**: bounded-capacity places modeling shared resources (semaphore semantics); detect mutual exclusion violations or priority inversions

### 5.5 Portability Strategy

The engine uses three abstract interfaces to isolate platform concerns:
- `IClock` — monotonic time (std::chrono on desktop, hardware timer on embedded)
- `IRandomSource` — PRNG (mt19937_64 on desktop, hardware RNG on embedded)
- `IScriptEngine` — Lua execution (full Sol2/Lua 5.4 on desktop, simple evaluator or no-op on constrained targets)

CMake selects implementations at build time per target. The YAML parser and model types are shared across all targets unchanged.

---

## 6. Technologies Stack

| Layer | Technology | Role |
|---|---|---|
| Engine | C++17 | Core runtime, portable |
| Scripting | Lua 5.4 (via Sol2) | Guards, state code, transition actions |
| YAML parsing | RapidYAML (ryml) | Automata definition parsing |
| WebSocket client | IXWebSocket | Engine↔Server transport |
| Gateway | Elixir + Phoenix | Real-time channel broker |
| Server | Elixir + OTP | Device management, connectors, deployment state, replay |
| IDE shell | Electron | Desktop application wrapper |
| IDE UI | TypeScript + React | Visual editor and monitoring |
| State management | Zustand | Frontend store architecture |
| Build system | CMake 3.18+ | Multi-target C++ builds |
| Container orchestration | Docker Compose | Multi-service local deployment |
| Metrics (optional) | InfluxDB + Grafana | Time-series dashboards |
| Target platforms | ESP32, MCXN947; Pico as target direction | Embedded deployment |

---

## 7. Showcase Catalog Summary

The showcase set contains 39 YAML automata across 15 categories. The curated validation catalog contains 16 desktop-runnable files:

| # | Category | Key Concepts Demonstrated |
|---|---|---|
| 01 | Basics | Timed + classic transitions, manual override input |
| 02 | Control | Event threshold triggers, pump state control |
| 03 | Probabilistic | Weighted 3-lane quality routing |
| 04 | Resilience | Watchdog timer, fault detection, retry with backoff |
| 05 | Energy | Load prediction, peak shaving scheduler |
| 06 | Pipeline | Multi-stage line buffer dispatcher |
| 07 | Folderized | Folder-based code layout, door safety controller |
| 08 | ESP32 | Platform-specific: PWM, LED, OLED, thermostat, production line |
| 09 | MCXN947 | ARM Cortex-M7: GPIO, buttons, touch, temperature |
| 10 | Guarded Cell | 6-automata safety supervision network |
| 11 | Bidirectional Loop | 4 automata with bidirectional signal wiring |
| 12 | Black Box | Docker-sandboxed probe, external system wrapping |
| 13 | Petri Signal Chain | 4-automata chain: command router → safety gate → drive → telemetry |
| 14 | Petri Contention | 3-automata resource contention: charger, motion axis, power allocator |
| 15 | Aetherium Gem | TDD checkpoints, high state churn, fault injection, replay markers, black-box contract, Petri-liftable resource demand |

---

## 8. Thesis Positioning

The project's academic contribution can be framed around several angles:

**EFSM as primary IoT abstraction** — contrasted with script-first (Node-RED, Lua automations) and workflow-DAG approaches. The claim is that explicit state structure improves fault isolation, testability, and formal analysis.

**Unified toolchain** — design, deploy, observe, debug, and analyze within one coherent product. Most existing tools address only one of these concerns.

**Formal analysis integration** — Petri net structural analysis applied to a running automata network, not just statically to a model. Deadlock and bottleneck detection as first-class IDE features.

**Portable EFSM runtime** — same C++17 model description compiles to desktop (full Lua, WebSocket) and constrained embedded (minimal scripting, serial). Platform abstraction via three interfaces rather than conditional compilation.

**Reproducible testing via fault injection + time-travel** — deterministic fault profiles combined with full execution traces enable repeatable debugging of distributed, timing-sensitive behavior—a known hard problem in IoT systems.
