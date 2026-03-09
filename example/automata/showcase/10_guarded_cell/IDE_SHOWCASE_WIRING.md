# Guarded Actuation Cell Wiring

These examples are intended for the IDE import path and the existing Aetherium node firmware.

## Boards

### MCXN947 leader

- use on-board `SW2` as `request_raw`
- use on-board `SW3` as `permit_raw`
- red LED mirrors request
- green LED mirrors permit
- import `mcxn947_guarded_cell_leader.yaml`

### ESP32 primary actuator

- uses the visible built-in board LED through `component("board_led")`
- import `esp32_guarded_cell_primary_actuator.yaml`

### ESP32 alarm beacon

- uses the visible built-in board LED through `component("board_led")`
- import `esp32_guarded_cell_alarm_beacon.yaml`

## Host automata

Import these into the IDE or host runtime:

- `guarded_cell_signal_conditioner.yaml`
- `guarded_cell_safety_supervisor.yaml`
- `guarded_cell_actuation_controller.yaml`

## Binding intent

1. `mcxn947_guarded_cell_leader.request_raw` -> `guarded_cell_signal_conditioner.request_raw`
2. `mcxn947_guarded_cell_leader.permit_raw` -> `guarded_cell_signal_conditioner.permit_raw`
3. `guarded_cell_signal_conditioner.request_ok` -> `guarded_cell_safety_supervisor.request_ok`
4. `guarded_cell_signal_conditioner.permit_ok` -> `guarded_cell_safety_supervisor.permit_ok`
5. `guarded_cell_signal_conditioner.request_ok` -> `guarded_cell_actuation_controller.request_ok`
6. `guarded_cell_safety_supervisor.inhibit` -> `guarded_cell_actuation_controller.inhibit`
7. `guarded_cell_actuation_controller.actuate_cmd` -> `esp32_guarded_cell_primary_actuator.actuate_cmd`
8. `guarded_cell_safety_supervisor.supervisor_alarm` -> `esp32_guarded_cell_alarm_beacon.supervisor_alarm`

## Demo story

- hold `SW3` to permit the cell
- tap `SW2` to request a cycle
- the request is normalized by the host conditioner
- the supervisor either clears or inhibits the request
- the controller actuates only when inhibition is clear
- repeated requests without permit escalate the alarm node
