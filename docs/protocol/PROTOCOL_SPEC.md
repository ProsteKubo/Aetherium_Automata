# Aetherium Protocol Specification v1.0

This document defines the wire protocol for communication between Aetherium components.

## Overview

The protocol is designed to be:
- **Compact**: Minimal overhead for embedded devices
- **Extensible**: Version and vendor fields for future growth
- **Transport-agnostic**: Works over Serial, MQTT, WebSocket
- **Self-describing**: Type + length prefix for easy parsing

## Wire Format

### Message Envelope

```
┌─────────┬─────────┬──────────┬─────────────┬─────────────────┐
│ Magic   │ Version │ Msg Type │ Length      │ Payload         │
│ (2B)    │ (1B)    │ (1B)     │ (2B)        │ (variable)      │
└─────────┴─────────┴──────────┴─────────────┴─────────────────┘
  0xAE01     0x01      0x01      0x0000-0xFFFF
```

| Field | Size | Description |
|-------|------|-------------|
| Magic | 2 bytes | `0xAE 0x01` - Aetherium v1 identifier |
| Version | 1 byte | Protocol version (currently `0x01`) |
| Msg Type | 1 byte | Message type identifier |
| Length | 2 bytes | Payload length (big-endian) |
| Payload | variable | Message-specific payload |

**Maximum message size**: 65535 bytes

### Common Payload Header

All message payloads start with:

```
┌───────────┬───────────┬───────────┬─────────────────┐
│ Msg ID    │ Source ID │ Target ID │ In-Reply-To     │
│ (4B)      │ (4B)      │ (4B)      │ (4B, optional)  │
└───────────┴───────────┴───────────┴─────────────────┘
```

| Field | Description |
|-------|-------------|
| Msg ID | Unique message identifier for correlation |
| Source ID | Device ID of sender |
| Target ID | Device ID of recipient (0 = broadcast) |
| In-Reply-To | Msg ID this is responding to (0 = not a response) |

---

## Message Types

### Control Plane (0x00-0x3F)

| Type | ID | Direction | Description |
|------|----|-----------|-------------|
| HELLO | 0x01 | Device→Server | Announce presence |
| HELLO_ACK | 0x02 | Server→Device | Acknowledge + assign ID |
| DISCOVER | 0x03 | Server→Broadcast | Find devices |
| PING | 0x04 | Bidirectional | Heartbeat |
| PONG | 0x05 | Bidirectional | Heartbeat response |
| PROVISION | 0x06 | Server→Device | Set device config |
| GOODBYE | 0x07 | Device→Server | Graceful disconnect |

### Automata Plane (0x40-0x7F)

| Type | ID | Direction | Description |
|------|----|-----------|-------------|
| LOAD_AUTOMATA | 0x40 | Server→Device | Deploy automata |
| LOAD_ACK | 0x41 | Device→Server | Confirm load |
| START | 0x42 | Server→Device | Start execution |
| STOP | 0x43 | Server→Device | Stop execution |
| RESET | 0x44 | Server→Device | Reset to initial state |
| STATUS | 0x45 | Device→Server | Execution status |
| PAUSE | 0x46 | Server→Device | Pause execution |
| RESUME | 0x47 | Server→Device | Resume execution |

### Data Plane (0x80-0xBF)

| Type | ID | Direction | Description |
|------|----|-----------|-------------|
| INPUT | 0x80 | Server→Device | Set input value |
| OUTPUT | 0x81 | Device→Server | Report output value |
| VARIABLE | 0x82 | Bidirectional | Variable update |
| STATE_CHANGE | 0x83 | Device→Server | State transition occurred |
| TELEMETRY | 0x84 | Device→Server | Batched metrics |
| TRANSITION_FIRED | 0x85 | Device→Server | Transition was fired |

### Extended (0xC0-0xFF)

| Type | ID | Direction | Description |
|------|----|-----------|-------------|
| VENDOR | 0xC0 | Bidirectional | Vendor-specific extension |
| DEBUG | 0xD0 | Device→Server | Debug log message |
| ERROR | 0xE0 | Bidirectional | Error report |
| ACK | 0xF0 | Bidirectional | Generic acknowledgment |
| NAK | 0xF1 | Bidirectional | Negative acknowledgment |

---

## Message Payloads

### HELLO (0x01)

Device announces its presence to the server.

```
┌──────────────┬───────────┬───────────┬────────────┬───────────┐
│ Device Type  │ Version   │ Caps      │ Name Len   │ Name      │
│ (1B)         │ (3B)      │ (2B)      │ (1B)       │ (var)     │
└──────────────┴───────────┴───────────┴────────────┴───────────┘
```

**Device Type**:
| Value | Type |
|-------|------|
| 0x01 | Desktop |
| 0x02 | ESP32 |
| 0x03 | Pico |
| 0x04 | Raspberry Pi |
| 0x05 | Arduino |
| 0x10 | Server |
| 0x11 | Gateway |

**Capabilities (bitfield)**:
| Bit | Capability |
|-----|------------|
| 0 | Supports Lua |
| 1 | Supports timed transitions |
| 2 | Supports probabilistic transitions |
| 3 | Supports fuzzy logic |
| 4 | Has persistent storage |
| 5 | Has RTC |
| 6 | Supports nested automata |
| 7 | Supports Lua bytecode |

### HELLO_ACK (0x02)

Server response to HELLO.

```
┌───────────────┬───────────────┬──────────┬────────────┬─────────────┐
│ Assigned ID   │ Server Time   │ Accepted │ Reason Len │ Reason      │
│ (4B)          │ (8B)          │ (1B)     │ (1B)       │ (var)       │
└───────────────┴───────────────┴──────────┴────────────┴─────────────┘
```

### LOAD_AUTOMATA (0x40)

Deploy an automata to a device.

```
┌──────────┬──────────┬──────────┬───────────────┬──────────────┐
│ Run ID   │ Flags    │ Format   │ Chunk Info    │ Data         │
│ (4B)     │ (1B)     │ (1B)     │ (4B)          │ (var)        │
└──────────┴──────────┴──────────┴───────────────┴──────────────┘
```

**Flags**:
| Bit | Meaning |
|-----|---------|
| 0 | Is chunked |
| 1 | Request ACK |
| 2 | Start after load |
| 3 | Replace existing |

**Format**:
| Value | Format |
|-------|--------|
| 0x01 | AetheriumBinary |
| 0x02 | YAML text |
| 0x03 | JSON text |
| 0x04 | MessagePack |

**Chunk Info** (when chunked):
| Bits | Meaning |
|------|---------|
| 0-15 | Chunk index |
| 16-31 | Total chunks |

### INPUT (0x80)

Set an input variable value.

```
┌───────────┬──────────┬───────────┬───────────────┐
│ Var ID    │ Type     │ Value Len │ Value         │
│ (2B)      │ (1B)     │ (2B)      │ (var)         │
└───────────┴──────────┴───────────┴───────────────┘
```

**Value Type**:
| Value | Type | Size |
|-------|------|------|
| 0x01 | bool | 1 byte |
| 0x02 | int8 | 1 byte |
| 0x03 | int16 | 2 bytes |
| 0x04 | int32 | 4 bytes |
| 0x05 | int64 | 8 bytes |
| 0x06 | float32 | 4 bytes |
| 0x07 | float64 | 8 bytes |
| 0x08 | string | variable (UTF-8) |
| 0x09 | binary | variable |
| 0x0A | table | variable (MessagePack) |

### STATE_CHANGE (0x83)

Report a state transition.

```
┌──────────┬───────────────┬───────────────┬─────────────────┬────────────┐
│ Run ID   │ Previous St   │ New State     │ Transition ID   │ Timestamp  │
│ (4B)     │ (2B)          │ (2B)          │ (2B)            │ (8B)       │
└──────────┴───────────────┴───────────────┴─────────────────┴────────────┘
```

### ERROR (0xE0)

Report an error.

```
┌───────────┬───────────────┬─────────────┬──────────────┐
│ Error Code│ Message Len   │ Message     │ Related Msg  │
│ (2B)      │ (2B)          │ (var)       │ (4B, opt)    │
└───────────┴───────────────┴─────────────┴──────────────┘
```

**Error Codes**:
| Code | Meaning |
|------|---------|
| 0x0001 | Unknown error |
| 0x0002 | Invalid message |
| 0x0003 | Invalid state |
| 0x0004 | Invalid transition |
| 0x0005 | Invalid variable |
| 0x0006 | Type mismatch |
| 0x0007 | Parse error |
| 0x0008 | Lua error |
| 0x0009 | Out of memory |
| 0x000A | Timeout |
| 0x000B | Not running |
| 0x000C | Already running |
| 0x000D | Not loaded |

---

## Automata Binary Format

Compact binary format for transmitting automata to embedded devices.

### Header

```
┌──────────┬──────────┬──────────┬──────────┬──────────┐
│ Magic    │ Version  │ Flags    │ Checksum │ Reserved │
│ (4B)     │ (2B)     │ (2B)     │ (4B)     │ (4B)     │
└──────────┴──────────┴──────────┴──────────┴──────────┘
```

**Magic**: `0x41455448` ("AETH")

### Sections

Each section has:
```
┌───────────┬───────────┬────────────────────────────────┐
│ Sec Type  │ Sec Len   │ Section Data                   │
│ (1B)      │ (2B)      │ (variable)                     │
└───────────┴───────────┴────────────────────────────────┘
```

**Section Types**:
| Type | ID | Description |
|------|----|-------------|
| Config | 0x01 | Automata metadata |
| Variables | 0x02 | Variable definitions |
| States | 0x03 | State definitions |
| Transitions | 0x04 | Transition definitions |
| Code | 0x05 | Lua source/bytecode |
| End | 0xFF | End marker |

### Variable Entry

```
┌──────┬──────┬───────┬──────┬───────────┬───────────────┐
│ ID   │ Dir  │ Type  │ NLen │ Name      │ Initial       │
│ (2B) │ (1B) │ (1B)  │ (1B) │ (var)     │ (var)         │
└──────┴──────┴───────┴──────┴───────────┴───────────────┘
```

**Direction**:
| Value | Direction |
|-------|-----------|
| 0x01 | Input |
| 0x02 | Output |
| 0x03 | Internal |

### State Entry

```
┌──────┬───────┬────────┬────────┬────────┬──────────────┐
│ ID   │ Flags │ NLen   │ Name   │ Var[]  │ Code[]       │
│ (2B) │ (1B)  │ (1B)   │ (var)  │ (var)  │ (var)        │
└──────┴───────┴────────┴────────┴────────┴──────────────┘
```

**State Flags**:
| Bit | Meaning |
|-----|---------|
| 0 | Is initial state |
| 1 | Has on_enter hook |
| 2 | Has on_exit hook |
| 3 | Has body code |

### Transition Entry

```
┌──────┬───────┬──────┬──────┬────────┬────────┬─────────┐
│ ID   │ Type  │ From │ To   │ Pri    │ Weight │ Config  │
│ (2B) │ (1B)  │ (2B) │ (2B) │ (1B)   │ (2B)   │ (var)   │
└──────┴───────┴──────┴──────┴────────┴────────┴─────────┘
```

**Transition Type**:
| Value | Type |
|-------|------|
| 0x01 | Classic |
| 0x02 | Timed |
| 0x03 | Event |
| 0x04 | Probabilistic |
| 0x05 | Immediate |

**Weight**: Fixed-point 0-10000 (represents 0.00% - 100.00%)

---

## Transport Bindings

### MQTT

**Topics**:
- `aeth/{server_id}/devices/{device_id}/in` - Messages to device
- `aeth/{server_id}/devices/{device_id}/out` - Messages from device
- `aeth/{server_id}/broadcast` - Broadcast messages
- `aeth/{server_id}/gateway` - Gateway control

**QoS**: 1 (at least once) for control, 0 for telemetry

### Serial

**Framing**:
```
┌──────────┬─────────┬─────────────┬──────────┐
│ SOF      │ Length  │ Message     │ CRC16    │
│ (1B=0x7E)│ (2B)    │ (var)       │ (2B)     │
└──────────┴─────────┴─────────────┴──────────┘
```

**Byte stuffing**: Use `0x7D` as escape, XOR escaped byte with `0x20`

### WebSocket

JSON encoding for gateway communication:
```json
{
  "type": "load_automata",
  "msgId": "uuid",
  "sourceId": 123,
  "targetId": 456,
  "payload": { ... }
}
```

---

## Reliability

### At-Least-Once Delivery

- All control messages should request ACK
- Use message ID for correlation
- Retry after timeout (configurable, default 5s)
- Maximum 3 retries before error

### Idempotency

- `load_automata` uses `run_id` for idempotency
- `start/stop/reset` are idempotent by nature
- Variable updates use timestamp for ordering

### Flow Control

- Server can send `PAUSE` to throttle device
- Device can include backpressure hints in telemetry
- Telemetry batching reduces message count

---

## Security

### Transport-Level

| Transport | Auth Method |
|-----------|-------------|
| MQTT | TLS + username/password or client cert |
| Serial | N/A (physical security) |
| WebSocket | TLS + token auth |

### Message-Level (Optional)

- HMAC-SHA256 signature in vendor_extensions
- Nonce for replay protection
- Clock sync via HELLO_ACK timestamp

---

## Version Compatibility

| Version | Changes |
|---------|---------|
| 0x01 | Initial version |

Future versions will maintain backward compatibility for control plane messages.
