# Phoenix Channel Protocol — IDE ↔ Gateway ↔ Server

This document describes the WebSocket/Phoenix channel message protocol used between the IDE frontend, the gateway (`aetherium_gateway`), and the execution server (`aetherium_server`).

---

## Channel Topology

```
IDE (FE)
  ├── gateway:control       ← main channel; lifecycle, state_changed, deployment_status
  └── automata:control      ← automata channel; deployment events, transition_fired, snapshots

Gateway (Phoenix server)
  └── server:gateway        ← internal channel; receives server→gateway pushes

Server
  └── PhoenixClient         ← connects to gateway server:gateway channel
```

The IDE joins two channels simultaneously:
- **`gateway:control`** — general lifecycle and state_changed events.
- **`automata:control`** — deployment-specific events (deployment_status, deployment_list, transition_fired, state_changed, snapshots).

---

## Command Envelope

Every command sent from the IDE embeds a command envelope in the payload:

```json
{
  "command_id": "<uuid>",
  "correlation_id": "<uuid>",
  "idempotency_key": "<uuid>",
  "deadline_ms": 5000,
  "command_type": "<command_name>",
  "device_id": "<device_id>",
  "automata_id": "<automata_id>",
  "deployment_id": "<automata_id>:<device_id>",
  ...
}
```

The gateway separates the envelope from the payload using `split_envelope/1` before forwarding to the server.

### Deferred Command Outcome

Most commands use `awaitDeferredOutcome: true`:
1. IDE sends the command via Phoenix channel push → receives immediate channel `{:ok}` or `{:error}` ack.
2. IDE waits for a `command_outcome` event on `automata:control` (or `gateway:control`) that carries `command_id` matching the sent command.
3. The `command_outcome` event carries `:ack/:nak/:error` and a result payload.

```json
{
  "command_id": "<uuid>",
  "outcome": "ack",
  "reason": "ok",
  "data": { "deployment_id": "..." }
}
```

---

## Deployment ID Format

```
deployment_id = "<automata_id>:<device_id>"
```

This is the canonical key for all deployment-scoped events throughout the system.

---

## IDE → Gateway Commands (on `automata:control`)

| Event | Required fields | Description |
|---|---|---|
| `deploy_automata` | `automata_id`, `device_id`, `automata` (map) | Deploy automata to a device |
| `start_execution` | `device_id`, `automata_id`, `deployment_id` | Start the deployed automata |
| `stop_execution` | `device_id`, `automata_id`, `deployment_id` | Stop execution |
| `pause_automata` | `device_id`, `automata_id`, `deployment_id` | Pause execution |
| `resume_automata` | `device_id`, `automata_id`, `deployment_id` | Resume paused execution |
| `reset_automata` | `device_id`, `automata_id`, `deployment_id` | Reset to initial state |
| `force_state` | `device_id`, `automata_id`, `deployment_id`, `state_id` | Force transition to a state |
| `request_state` | `device_id`, `automata_id`, `deployment_id` | Request current execution snapshot |
| `set_input` | `device_id`, `automata_id`, `name`, `value` | Set an automata input |
| `time_travel_query` | `device_id`, `deployment_id`, `timestamp_ms` | Query historical snapshot |

The gateway resolves `device_id` to a deployment via `resolve_device_deployment/2`, then adds:
- `deployment_id` = `"#{automata_id}:#{device_id}"`
- `automata_id` from the deployment record
- `device_id` from the request

The enriched payload is then forwarded to the server via `dispatch_server_command/4`.

---

## Gateway → Server Commands (on `server:gateway`)

Same event names as above. Envelope is re-attached as a nested `__envelope__` key. The server's `GatewayConnection` GenServer receives these as `%PhoenixClient.Message{}` events.

---

## Server → Gateway Events (via `server:gateway` channel)

### `deployment_status`

Sent by the server whenever deployment status changes.

```json
{
  "deployment_id": "automata_a:device_b",
  "automata_id": "automata_a",
  "device_id": "device_b",
  "status": "running | stopped | paused | loading | error",
  "current_state": "<state_name>",
  "variables": { "name": "value" },
  "deployment_metadata": { ... }
}
```

**IMPORTANT**: `automata_id` and `device_id` must be present — the FE's `ingestDeploymentStatus` silently drops events where either field is empty.

### `state_changed`

Sent when an automata transitions between states.

```json
{
  "deployment_id": "...",
  "automata_id": "...",
  "device_id": "...",
  "from_state": "<state>",
  "to_state": "<state>",
  "transition_id": "<id>",
  "variables": { ... },
  "weight_used": null
}
```

Broadcast to **both** `gateway:control` (with `server_id` added) and `automata:control`.

### `transition_fired`

Sent by `AutomataRuntime` for every FSM transition. Note the different field names from `state_changed` — uses `from`/`to` instead of `from_state`/`to_state`.

```json
{
  "deployment_id": "...",
  "automata_id": "...",
  "device_id": "...",
  "from": "<state>",
  "to": "<state>",
  "transition_id": "<id>",
  "weight_used": null,
  "timestamp": 1234567890
}
```

Broadcast to `automata:control` only.

### `command_outcome`

Server's response to a command. Broadcast to **both** `gateway:control` and `automata:control`.

```json
{
  "command_id": "<uuid>",
  "outcome": "ack | nak | error",
  "reason": "<atom>",
  "data": { ... }
}
```

### `deployment_list`

Sent on server reconnect with the full list of known deployments.

```json
{
  "deployments": [
    {
      "automata_id": "...",
      "device_id": "...",
      "server_id": "...",
      "status": "...",
      "current_state": "...",
      "variables": { ... },
      "deployment_metadata": { ... }
    }
  ]
}
```

Note: individual deployments in this list do not include `deployment_id` — the FE derives it as `"#{automata_id}:#{device_id}"`.

---

## FE Event Flow: Start Execution

```
IDE                          Gateway                  Server
 |                              |                        |
 |-- start_execution ---------->|                        |
 |   {device_id, automata_id,   |                        |
 |    deployment_id, envelope}  |                        |
 |                              |-- start_automata ------>|
 |                              |   {deployment_id,       |
 |                              |    automata_id,         |
 |                              |    device_id, envelope} |
 |                              |                        |-- DeviceManager.start_automata()
 |                              |                        |   AutomataRuntime.start_execution()
 |                              |                        |   AutomataRuntime.get_state()
 |                              |                        |   DeploymentLifecycle.running_command_applied()
 |                              |<-- deployment_status --|  (via GatewayConnection.push cast)
 |                              |    {status: running,   |
 |                              |     automata_id,        |
 |                              |     device_id,          |
 |                              |     current_state}      |
 |<-- deployment_status --------|                        |
 |<-- command_outcome ----------|                        |  (sent inline, before cast is processed)
 |                              |                        |
 |-- request_state ------------>|                        |
 |   {device_id, automata_id,   |                        |
 |    deployment_id}            |                        |
 |                              |-- request_state ------->|
 |<-- deployment_status --------|<-- deployment_status --|
 |<-- command_outcome ----------|<-- command_outcome ----|
```

Note on ordering: the server's `GatewayConnection` handler sends an initial `deployment_status` directly (synchronous), then the `command_outcome`. The richer `deployment_status` from `DeploymentLifecycle.running_command_applied` is queued via `GenServer.cast` and arrives after `command_outcome`.

---

## FE Event Flow: State Transitions (Host Runtime)

```
AutomataRuntime (FSM)
  |
  |-- DeviceManager.update_deployment_state()  →  state_changed + deployment_status  → automata:control + gateway:control
  |-- broadcast_transition()                   →  transition_fired                   → automata:control only
```

The IDE listens for both `state_changed` and `transition_fired` on `automata:control` to update `runtimeViewStore`.

---

## Host Runtime (desktop_v1)

When a deployment targets the host device, execution runs inside the Elixir server as an `AutomataRuntime` GenServer. No physical device connection is required.

- Profile: `compiled_ir` (not `legacy_yaml`)
- The deployment_id key in DeviceManager is `"#{automata_id}:#{device_id}"` where `device_id` is the virtual host device ID.
