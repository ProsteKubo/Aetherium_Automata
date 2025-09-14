---
title: Protocol Overview
---

# Engine Protocol Overview

The protocol defines a minimal, transport‑agnostic control/telemetry interface for Engine instances. It is predictable on MCUs and extensible on hosts.

## Transports

- Serial: CBOR/MsgPack framing
- UDP: CBOR or JSON
- WebSocket: JSON

## Envelope

Each message carries an envelope to support correlation and routing:

```
{
  "msg_id": "uuid-or-counter",
  "type": "hello|discover|provision|load_automata|start|stop|reset|config_set|get|ping|health|telemetry|state_snapshot|event_inject|command",
  "source": { "device_id": "...", "instance_id": "..." },
  "target": { "device_id": "..." },
  "ts": 0, // monotonic or synchronized time
  "in_reply_to": "optional-msg-id",
  "payload": { /* type-specific */ },
  "vendor_extensions": { /* optional */ }
}
```

## Control Plane Types

- hello: announce presence, versions, capabilities, limits
- discover: controller/servers request presence
- provision: set identity, keys, labels, time sync
- load_automata: push model blob or reference; returns run_id
- start/stop/reset: lifecycle control
- config_set/get: runtime parameters
- ping/health: liveness, metrics snapshot

## Data Plane Types

- telemetry: metrics/logs/events (batched)
- state_snapshot: current state(s), timers, variables
- event_inject: external event injection
- command: device I/O command requests/responses

## Reliability & Flow Control

- At‑least‑once delivery with idempotent operations using run_id and versions
- Windowing and retry‑after hints for backpressure
- Local FIFO buffers on device where feasible

## Security

- Transport‑level auth: PSK (MCU), mTLS (host), token‑based (WS)
- Optional message signatures/MACs; nonce/clock sync support

## Extensibility

- `vendor_extensions` with namespaced keys to avoid collisions

