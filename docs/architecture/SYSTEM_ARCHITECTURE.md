# System Architecture

**Status**: current implementation overview  
**Updated**: May 2026

## Product Shape

Aetherium Automata is a distributed EFSM orchestration platform. The architecture is intentionally layered so the same automata model can be designed in the IDE, deployed through gateway/server services, executed by host or embedded engines, traced for replay, and lifted into analyzer/Petri views.

```text
Electron IDE
    |
    | Phoenix/WebSocket
    v
Gateway (Elixir/Phoenix)
    |
    | authenticated channels
    v
Server (Elixir/OTP)
    |
    | WebSocket / serial / ROS2 bridge / host runtime
    v
C++ Engine instances, board runtimes, and black-box participants
```

## Core Components

| Component | Implementation | Responsibility |
|---|---|---|
| IDE | Electron, React, TypeScript, Zustand | Visual authoring, project loading, runtime monitor, fault controls, replay timeline, Petri and analyzer panels. |
| Gateway | Elixir/Phoenix | Real-time broker and authenticated channel surface for IDE/operator traffic. |
| Server | Elixir/OTP | Device management, deployment lifecycle, connectors, target profiles, traces, replay, and analyzer input data. |
| Engine | C++17 | YAML validation, EFSM execution, Lua hooks, lifecycle commands, snapshots, transitions, and trace metadata. |
| Embedded runtimes | ESP32, FRDM-MCXN947 paths | Board-specific platform adapters and serial connector workflows. |
| Optional observability | InfluxDB, Grafana | Long-running time-series export and dashboards. |

## Automata Model

Automata are YAML documents containing:

- metadata in `config`;
- typed variables with `input`, `output`, or `internal` direction;
- named states with optional Lua hooks;
- transitions with one of five types: `classic`, `timed`, `event`, `probabilistic`, or `immediate`;
- optional `black_box` contracts declaring observable ports, states, emitted events, and resources.

Lua is a supporting language. The intended style is to keep control meaning in states/transitions and use Lua for short guards and side effects.

## Deployment Flow

1. The IDE opens a `.aeth` project or imports YAML.
2. The operator selects a target device/deployment.
3. The IDE sends a deploy request through the gateway.
4. The server validates and prepares the automaton for the target profile.
5. The engine loads the model and acknowledges.
6. Runtime snapshots and transition records flow back through server and gateway to the IDE.

## Replay and Fault Flow

- Fault profiles perturb ingress/egress boundaries using deterministic seeds.
- Trace records include state changes, variable updates, message metadata, fault actions, latency, and deployment metadata.
- Time-travel replay reconstructs prior state from stored records and can issue restore/resume commands to a runtime device.

## Analyzer and Petri Flow

The analyzer consumes:

- automata structure,
- black-box contracts,
- resource declarations,
- channel/binding metadata,
- observed runtime traces when available.

The Petri view lifts automata and resource contracts into a structural model for contention, bottleneck, and deadlock-style inspection.

## Current Canonical Demo

The canonical IDE project is:

```text
example/ide_demo_projects/backend-capabilities-tour.aeth
```

Its first network, `Aetherium Gem Cell`, is the compact all-capabilities demonstration. It is followed by multi-automata signal-chain, guarded-cell, power-contention, and watchdog networks.

## Operational Entry Points

```bash
cmake -S . -B build
cmake --build build -j4
scripts/validate_showcase_automata.sh validate

cd src
make up
make up-blackbox
make up-ts
make up-ros2-demo
```

See `README.md`, `docs/TESTING_GUIDE.md`, and `docs/engine/usage.md` for command details.
