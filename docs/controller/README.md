---
title: Gateway
---

# Gateway Role

Older notes used the name "Controller" for the externally reachable component. In the current codebase that role is implemented by the Phoenix gateway in:

```text
src/gateway/aetherium_gateway/
```

## Responsibilities

- Accept IDE/operator WebSocket connections.
- Authenticate real-time channel traffic using configured development tokens.
- Broker messages between IDE clients, servers, and device-facing workflows.
- Surface deployment, device, runtime, and fault-injection events to the IDE.
- Keep the operator-facing API stable while server and device connectors evolve.

## Non-Goals

- EFSM execution belongs to the C++ engine.
- Durable trace/time-series storage belongs to the server and optional InfluxDB stack.
- Board flashing is handled by host Makefile targets and board-specific tools.
- Structural analysis is computed from IDE/server metadata, not by the gateway itself.

## Local Usage

Docker gateway:

```bash
cd src
make up
make logs0
```

Gateway-only hybrid mode for host hardware/server loops:

```bash
cd src
make up-gateway
```

See `src/Makefile` for current ports, tokens, and stack variants.
