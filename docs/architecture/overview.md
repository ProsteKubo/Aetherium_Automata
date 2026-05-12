---
title: Architecture Overview
---

# Architecture Overview

Aetherium Automata is organized around one workflow:

```text
design EFSM -> bind channels -> deploy -> observe -> inject faults -> rewind -> analyze
```

## Components

| Component | Path | Responsibility |
|---|---|---|
| Engine | `src/engine/` | Validate and execute EFSM automata; emit snapshots, transitions, traces, and black-box metadata. |
| Server | `src/server/aetherium_server/` | Manage devices, deployments, connectors, target profiles, time-series data, replay, and analyzer inputs. |
| Gateway | `src/gateway/aetherium_gateway/` | Phoenix channel broker between IDE/operators and servers/devices. Handles authenticated real-time messaging. |
| IDE | `src/ide/` | Electron/React application for authoring, project loading, runtime monitoring, fault injection, time travel, Petri view, and analyzer view. |
| Showcase | `example/automata/showcase/` | YAML automata used for demos, validation, and thesis figures. |

## Runtime Topology

```text
IDE (Electron)
    |
    | Phoenix/WebSocket
    v
Gateway
    |
    | server/device channels
    v
Server
    |
    | WebSocket, serial, ROS2 bridge, host runtime
    v
Engine instances / black boxes / board devices
```

The default Docker stack starts:

```text
gateway + server3 + device1
```

The black-box stack starts:

```text
gateway + server3 + blackbox1
```

## Data Flow

- **Deployment flow**: IDE sends deploy request through the gateway; server validates/compiles/loads the automaton; the engine acknowledges and begins execution.
- **Runtime flow**: engine emits state snapshots, variable values, transition events, and deployment metadata; server stores/forwards these records; IDE renders them live.
- **Fault flow**: gateway/server apply deterministic fault profiles at communication boundaries, not inside arbitrary implementation code.
- **Replay flow**: time-series records reconstruct a past state; server dispatches restore/resume commands so a device can continue from that point.
- **Analyzer/Petri flow**: automata definitions and contracts are lifted into structural models for resource contention, bottlenecks, and deadlock-style findings.

## Identity

Common identifiers:

- `device_id`: runtime device or black-box participant.
- `server_id`: server instance managing the deployment.
- `automata_id`: automaton definition identity.
- `deployment_id`: loaded runtime instance.
- `instance_id`: trace/deployment label used in local runs and metadata.

## Current Transport Set

- WebSocket for host/docker devices.
- Serial for ESP32 and FRDM-MCXN947 hardware loops.
- ROS2 bridge through the connector demo stack.
- Local host runtime for smoke/demo flows.

## Source of Truth

- Automata model: YAML files under `example/automata/` and project-loaded IDE automata.
- IDE project: `example/ide_demo_projects/backend-capabilities-tour.aeth`.
- Curated validation catalog: `example/automata/showcase/CATALOG.txt`.
- Runtime commands: `src/Makefile`.

## Related Docs

- `docs/engine/README.md`
- `docs/engine/usage.md`
- `docs/protocol/PROTOCOL_SPEC.md`
- `docs/architecture/BLACK_BOX_IMPLEMENTATION.md`
- `docs/architecture/ANALYZER_DEMONSTRATION.md`
