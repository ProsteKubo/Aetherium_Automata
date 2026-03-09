# Guarded Actuation Cell

## Goal

Build an IDE-first distributed demo where a local request on `MCXN947 #1` propagates through multiple host automata before driving one or more ESP32 actuators.

This demo is meant to prove:

- multi-board coordination
- multiple host automata in a visible reaction chain
- safe/inhibited behavior rather than direct button-to-output mirroring
- resilience-friendly topology that can later tolerate disconnects and degraded modes

## First milestone

The first working version uses:

- `MCXN947 #1` as operator/sensor panel
- `Host Automata A` as signal conditioner
- `Host Automata B` as safety supervisor
- `Host Automata C` as actuation controller
- `ESP32 #1` as primary actuator
- `ESP32 #2` as alarm beacon

## Topology

```text
MCXN947 leader
  -> Signal Conditioner
  -> Safety Supervisor
  -> Actuation Controller
  -> ESP32 primary actuator

Safety Supervisor
  -> ESP32 alarm beacon
```

The graph is intentionally acyclic so it works with the current binding model without introducing connection loops.

## Automata set

### Board nodes

- `mcxn947_guarded_cell_leader.yaml`
  - exports raw operator inputs
  - local red LED mirrors `request_raw`
  - local green LED mirrors `permit_raw`

- `esp32_guarded_cell_primary_actuator.yaml`
  - consumes `actuate_cmd`
  - drives the visible ESP board LED through `component("board_led")`

- `esp32_guarded_cell_alarm_beacon.yaml`
  - consumes `supervisor_alarm`
  - drives the visible ESP board LED through `component("board_led")`

### Host nodes

- `guarded_cell_signal_conditioner.yaml`
  - converts raw request into a bounded `request_ok` pulse
  - exposes normalized permit state

- `guarded_cell_safety_supervisor.yaml`
  - inhibits actuation when permit is missing
  - escalates to alarm if requests continue while the cell is not permitted

- `guarded_cell_actuation_controller.yaml`
  - emits `actuate_cmd` only when a normalized request arrives and inhibition is clear
  - falls into blocked state when requests arrive during inhibition

## Variable contract

### MCXN947 leader outputs

- `request_raw: bool`
- `permit_raw: bool`
- `leader_online: bool`

### Signal conditioner outputs

- `request_ok: bool`
- `permit_ok: bool`
- `conditioner_state: string`
- `pulse_count: int`

### Safety supervisor outputs

- `inhibit: bool`
- `supervisor_alarm: bool`
- `supervisor_state: string`
- `fault_count: int`

### Actuation controller outputs

- `actuate_cmd: bool`
- `controller_blocked: bool`
- `controller_state: string`
- `cycle_count: int`

### ESP follower outputs

- `primary_active: bool`
- `alarm_active: bool`

## Binding plan

1. bind MCXN `request_raw` -> conditioner `request_raw`
2. bind MCXN `permit_raw` -> conditioner `permit_raw`
3. bind conditioner `request_ok` -> supervisor `request_ok`
4. bind conditioner `permit_ok` -> supervisor `permit_ok`
5. bind conditioner `request_ok` -> controller `request_ok`
6. bind supervisor `inhibit` -> controller `inhibit`
7. bind controller `actuate_cmd` -> ESP primary `actuate_cmd`
8. bind supervisor `supervisor_alarm` -> ESP alarm `supervisor_alarm`

## Behavior story

- `SW2` on the FRDM requests actuation.
- `SW3` on the FRDM acts as the permit/safety interlock.
- The conditioner converts `SW2` into a bounded actuation request pulse.
- If the interlock is open, the supervisor clears inhibition and the controller actuates.
- If the interlock is closed, the supervisor inhibits the controller.
- Repeated requests while inhibited escalate to alarm.

## Hardening roadmap

### Phase 1

- save the full guarded-cell automata set
- verify imports and bindings through IDE
- verify one host server with multiple serial devices

### Phase 2

- add reconnect/replay validation after board resets
- add degraded mode when one actuator disappears
- add deployment scripts for repeatable demo startup

### Phase 3

- add `MCXN947 #2` as backup panel or recovery station
- add servo or kit sensors as richer actuation/input sources
- add watchdog automata that monitors stale values or missing heartbeats

## Immediate next work

- create the first showcase package
- validate all automata files
- deploy the first live slice:
  - FRDM leader
  - conditioner
  - supervisor
  - controller
  - one ESP actuator
