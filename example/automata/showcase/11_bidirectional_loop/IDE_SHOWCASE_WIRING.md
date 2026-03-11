# Bidirectional Loop Wiring

These examples are intended for the IDE import path and the existing Aetherium node firmware.

## ESP32 node

- LED control: `GPIO18 -> 220 ohm resistor -> LED anode`
- LED cathode `-> GND`
- Potentiometer outer pin `-> 3V3`
- Potentiometer other outer pin `-> GND`
- Potentiometer wiper `-> GPIO34`
- import `esp32_bidirectional_loop_node.yaml`

## MCXN947 node

- use on-board `SW2`
- use on-board touch pad
- use on-board red and green LEDs
- import `mcxn947_bidirectional_loop_node.yaml`

## Host automata

- import `bidirectional_signal_conditioner.yaml`
- import `bidirectional_demo_controller.yaml`
- start the host server with `ENABLE_HOST_RUNTIME_DEVICE=1` so the computer appears as a deployable IDE device
- example: `make -C src ssrv ENABLE_HOST_RUNTIME_DEVICE=1 SERIAL_PORTS="/dev/cu.usbserial-539E0114501,/dev/cu.usbmodem23G2JL343RO3G3"`

## Binding intent

1. `esp32_bidirectional_loop_node.pot_mv` -> `bidirectional_signal_conditioner.pot_mv`
2. `mcxn947_bidirectional_loop_node.sw2_pressed` -> `bidirectional_signal_conditioner.sw2_pressed`
3. `mcxn947_bidirectional_loop_node.touch_pressed` -> `bidirectional_signal_conditioner.touch_pressed`
4. `bidirectional_signal_conditioner.pot_band` -> `bidirectional_demo_controller.pot_band`
5. `bidirectional_signal_conditioner.allow_remote` -> `bidirectional_demo_controller.allow_remote`
6. `bidirectional_signal_conditioner.manual_boost` -> `bidirectional_demo_controller.manual_boost`
7. `bidirectional_demo_controller.remote_duty` -> `esp32_bidirectional_loop_node.remote_duty`
8. `bidirectional_demo_controller.remote_red` -> `mcxn947_bidirectional_loop_node.remote_red`
9. `bidirectional_demo_controller.remote_green` -> `mcxn947_bidirectional_loop_node.remote_green`

## Demo story

- turning the ESP potentiometer changes the host-derived band
- that band drives the FRDM red LED state
- pressing `SW2` on the FRDM arms the remote LED path on the ESP
- touching the FRDM touch pad boosts the ESP LED to full brightness
- the host chain is visible in the middle through its own state/output variables
