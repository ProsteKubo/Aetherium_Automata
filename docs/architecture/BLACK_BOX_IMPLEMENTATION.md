# Black Box Implementation Contract

## Purpose

A black box is a deployment-facing runtime contract. It lets developers and operators interact with an automaton as a bounded system with declared inputs, outputs, observable states, emitted events, resources, and deployment constraints.

The point is not to expose engine internals. The point is to expose a stable boundary that works the same way across host runtime, Docker black boxes, and later board-backed devices.

## Required Identity

Every black box deployment must be addressable through:

- `device_id`
- `server_id`
- `automata_id`
- `deployment_id`

These identifiers must stay stable for the lifetime of the deployment so gateway, server, IDE, trace files, and telemetry can all refer to the same runtime instance.

## Required Deployment Metadata

Every black box must carry deployment metadata with enough information for developers to reason about runtime conditions. The current baseline is:

- `placement`
  - Required.
  - Examples: `host`, `docker_black_box`, `device`, later board-specific labels.
- `transport`
  - Recommended.
  - Example: websocket, serial, local runtime, board transport.
- `control_plane_instance`
  - Recommended when multiple gateways or server instances may exist.
- `target_class`
  - Recommended.
  - Examples: `desktop`, `docker`, `board`, `simulated_device`.
- `battery`
  - Object.
  - Fields: `present`, `percent`, `low`, `external_power`.
- `latency`
  - Object.
  - Fields: `budget_ms`, `warning_ms`, `observed_ms`, `ingress_ms`, `egress_ms`, `send_timestamp`, `receive_timestamp`, `handle_timestamp`.
- `black_box`
  - Optional override for the declared contract when deployment-specific shaping is needed.

For hardware, these values should eventually be measured. For the current engine and Docker path, battery and some latency values are engine-side simulation or protocol-observed values.

## Required Black Box Contract

Every black box must expose a contract object with this shape:

```yaml
black_box:
  ports:
    - name: arm
      direction: input
      type: bool
      observable: true
      fault_injectable: true
      description: Arm command
  observable_states:
    - Idle
    - Armed
    - Faulted
  emitted_events:
    - black_box_fault
  resources:
    - name: battery
      kind: energy
      capacity: 100
      shared: false
      latency_sensitive: false
      description: Remaining battery budget
```

### `ports`

Each port must define:

- `name`
  - Required, unique within the contract.
- `direction`
  - Required.
  - Allowed values: `input`, `output`, `internal`.
- `type`
  - Required.
  - Examples: `bool`, `number`, `string`, `table`, `any`.

Optional port fields:

- `observable`
- `fault_injectable`
- `description`

Rules:

- `input` ports are writable through `black_box_set_input`.
- `output` ports are readable through snapshots and traces.
- `internal` ports are part of the declared interface but not externally writable.

### `observable_states`

This is the set of states a consumer is allowed to reason about at the black-box boundary.

Rules:

- Every state listed here must be stable enough to expose through `black_box_snapshot`.
- If `black_box_force_state` is supported, only these states are valid external force targets.

### `emitted_events`

This is the set of named events that belong to the black-box boundary.

Rules:

- Events listed here are valid for `black_box_trigger_event`.
- If the runtime does not support external event injection, the command must still validate the name and then return a deterministic `unsupported_command` NAK.

### `resources`

Resources declare budgets or shared capacities that matter to deployment-aware operation.

Recommended fields:

- `name`
- `kind`
- `capacity`
- `shared`
- `latency_sensitive`
- `description`

Typical examples:

- battery or energy budget
- network bandwidth
- actuator duty cycle
- shared bus or GPIO ownership

## Required Commands

### `black_box_describe`

Must return:

- identifiers
- deployment status when available
- `deployment_metadata`
- `black_box`
- `observable_state` when available

This is the discovery call. Everything else depends on it.

### `black_box_snapshot`

Must return:

- `current_state`
- `observable_state` when available
- `variables`
- `outputs`
- `deployment_metadata`
- `black_box` when available

This is the runtime observation call. It must be safe to call repeatedly.

### `black_box_set_input`

Must:

- validate that the named port exists
- validate that the port direction is `input`
- validate that the provided value is acceptable for the declared port type
- return `ACK` on success
- return deterministic `NAK` on contract violation

### `black_box_trigger_event`

Must:

- validate that the event is declared in `emitted_events`
- return `ACK` on success if the runtime supports external event injection
- otherwise return deterministic `NAK` with `unsupported_command`

### `black_box_force_state`

Must:

- validate that the state is declared in `observable_states`
- return `ACK` on success if the runtime supports external state forcing
- otherwise return deterministic `NAK` with `unsupported_command`

## Required Validation Behavior

The control plane must fail fast at the contract boundary.

Current expected deterministic NAK reasons include:

- `invalid_black_box_port`
- `black_box_port_not_input`
- `invalid_black_box_event`
- `invalid_black_box_state`
- `unsupported_command`

This behavior matters because IDE and automation tooling need contract-valid failure modes, not transport-specific ambiguity.

## Required Trace Behavior

A black box deployment should emit enough trace data to replay the boundary behavior. The current baseline is:

- deployment metadata on lifecycle and boundary events
- state transitions
- output changes
- runtime errors
- ingress and egress protocol boundary events
- fault injection effects where applicable

The trace is not just for debugging. It is also the ground truth for deployment-aware analysis later.

## Implementation Levels

### Level 1: Inspectable Black Box

Minimum viable black box:

- `black_box_describe`
- `black_box_snapshot`
- `black_box_set_input`
- declared ports and observable states

### Level 2: Contract-Complete Black Box

Adds:

- declared emitted events
- declared resources
- deterministic validation and NAK behavior
- optional support for `black_box_trigger_event`
- optional support for `black_box_force_state`

### Level 3: Deployment-Aware Black Box

Adds:

- real deployment metadata flow
- placement awareness
- battery data
- latency budgets and observed latency data
- trace enrichment with the same metadata

### Level 4: Hardware-Backed Black Box

Adds:

- board-measured battery and latency values
- board transport integration
- board-specific actuator and sensor bindings

This level is intentionally deferred until the board path is ready.

## Current Repository Behavior

### Host Runtime

Currently supports:

- `black_box_describe`
- `black_box_snapshot`
- `black_box_set_input`
- `black_box_trigger_event`
- `black_box_force_state`

### Remote Engine / Docker Black Box

Currently supports:

- `black_box_describe`
- `black_box_snapshot`
- `black_box_set_input`

Currently does not support remote event injection or remote force-state execution. For those commands the system validates the contract first and then returns deterministic `unsupported_command` NAKs.

### Boards

Not implemented yet.

Board-specific follow-up work should be tracked in [BOARD_IMPLEMENTATION_TODO.md](/home/jakito/dev/Aetherium_Automata/BOARD_IMPLEMENTATION_TODO.md).

## Practical Definition

A black box is ready to work with the system when all of the following are true:

1. It can describe itself through a stable contract.
2. It can report live state and outputs through `black_box_snapshot`.
3. It carries deployment metadata that tells developers where it runs and under what battery and latency conditions.
4. It rejects invalid external commands deterministically.
5. It emits trace data that matches what the control plane saw.

If one of those is missing, the box may still run, but it is not yet a reliable deployment-aware black box in this architecture.
