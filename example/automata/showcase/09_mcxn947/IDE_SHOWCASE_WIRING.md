# MCXN947 IDE Showcase Wiring

These examples are intended for the IDE import path and the existing Aetherium MCXN947 + ESP32 node firmware, not custom sketches.

## FRDM-MCXN947 + ESP32: button-to-LED binding

FRDM-MCXN947 leader board:
- use the on-board `SW2` button
- use the on-board red LED
- import `mcxn947_binding_leader_button.yaml`

ESP32 follower board:
- use the on-board status LED on `GPIO2`
- import `esp32_binding_follower_status_led.yaml`

Gateway binding intent:
- bind leader output `leader_button` to follower input `leader_button`

Expected behavior:
- press `SW2` on the FRDM board
- the FRDM red LED turns on locally
- the ESP32 status LED turns on through the binding path

Recommended host run command:

```bash
make -C src ssrv SERIAL_PORTS="/dev/cu.usbmodem23G2JL343RO3G3,/dev/cu.usbserial-0001"
```

Notes:
- `SW2` is active-low on the FRDM board, so pressed means the input reads `0`.
- the FRDM blue LED is still reserved for node heartbeat/status.
- `GPIO2` is the common built-in status LED pin on many ESP32 dev boards; if your board differs, adjust the follower automata pin before importing.
