---
title: Servers
---

# Server Role

The server manages runtime devices and deployments behind the gateway. The current implementation lives in:

```text
src/server/aetherium_server/
```

## Responsibilities

- Device and connector registry.
- Deployment lifecycle and target-profile preparation.
- Host runtime, WebSocket, serial, and ROS2 connector coordination.
- Time-series event/snapshot storage for replay and time travel.
- Black-box contract loading and metadata propagation.
- Analyzer inputs from automata, deployments, bindings, resources, and trace evidence.
- Optional InfluxDB/Grafana export for long-running metrics.

## Interfaces

- Northbound: gateway-facing channels and server events.
- Southbound: device connector sessions and engine protocol messages.
- Local tasks: smoke tests and demo tasks under `lib/mix/tasks/`.

## Scaling Model

- The development stack runs one `server3` container.
- Host hardware loops can run the server directly on the host to access serial devices.
- Persistence is currently local development storage plus optional InfluxDB integration.

## Non‑Goals

- Real-time EFSM execution semantics; that remains in the engine.
- Visual editing; that belongs to the IDE.
- Gateway authentication/channel brokering; that belongs to the Phoenix gateway.

## Common Commands

```bash
cd src/server/aetherium_server
mix test
mix test test/showcase_catalog_test.exs
```

Docker smoke:

```bash
cd src
make up
make up-blackbox
make smoke-blackbox
make up-ts
make test-ts
```
