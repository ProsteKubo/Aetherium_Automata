---
title: Protocol Overview
---

# Protocol Overview

Aetherium uses protocol messages to connect the IDE, gateway, server, engines, serial devices, and black-box participants. The implementation has both gateway/server channel payloads and C++ engine protocol codecs; this page is the practical orientation, not a byte-level replacement for `PROTOCOL_SPEC.md`.

## Message Families

- **Identity/liveness**: hello, hello acknowledgement, ping/pong, goodbye.
- **Lifecycle**: load automata, load acknowledgement, start, stop, pause, resume, reset, status.
- **Runtime data**: input updates, output updates, variable updates, state changes, telemetry, transition-fired records.
- **Deployment/replay**: deployment metadata, trace records, restore state, rewind requests.
- **Diagnostics**: ACK, NAK, error, debug/vendor messages.

## Current Transports

- Phoenix/WebSocket channels between IDE, gateway, and server.
- WebSocket between host/docker engine runtimes and server-facing services.
- Serial for ESP32 and FRDM-MCXN947 host hardware loops.
- TCP bridge for the ROS2 connector demo.

## Engine Protocol

The C++ engine command bus is exercised by:

```bash
./build/aetherium_engine_command_smoke
```

The command smoke covers the main lifecycle and data commands and should print:

```text
engine_command_smoke: PASS
```

## Trace Metadata

Trace records may include:

- deployment instance and placement;
- transport;
- control-plane peer;
- fault profile and applied fault actions;
- battery metadata;
- latency metadata;
- black-box contract and observable state annotations.

This metadata is what enables the IDE runtime monitor, time-travel view, and analyzer to reason about deployed behavior rather than raw logs only.

## Byte-Level Reference

See `docs/protocol/PROTOCOL_SPEC.md` for the binary frame reference and message ID tables.
