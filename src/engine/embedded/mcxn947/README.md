## FRDM-MCXN947 target

This target runs the shared Aetherium runtime on `MCXN947 core0` over the on-board MCU-Link virtual COM port.

### Build and flash

From [`/Users/administratorik/dev/Aetherium_Automata/src`](/Users/administratorik/dev/Aetherium_Automata/src):

```bash
make mbuild
make mflash MCXN947_PROBE_UID=23G2JL343RO3G
make msrv
make msmoke
```

Default serial transport is the MCU-Link VCOM device, typically `/dev/cu.usbmodem...` on macOS.

### GPIO API

The Lua GPIO API matches ESP:

```lua
gpio.mode(pin, "output")
gpio.write(pin, 1)
local value = gpio.read(pin)
```

Pin numbers are encoded as:

```text
encoded_pin = port * 32 + bit
```

Examples:

- `P0_10` -> `10`
- `P0_23` -> `23`
- `P1_2` -> `34`

### Verified FRDM board pins

These mappings come from the FRDM-MCXN947 MCUX board files bundled in the firmware build:

- `10` -> `P0_10` -> on-board red LED
- `27` -> `P0_27` -> on-board green LED
- `34` -> `P1_2` -> on-board blue LED
- `23` -> `P0_23` -> `SW2`
- `6` -> `P0_6` -> `SW3`

### Status LED note

The node firmware currently uses the blue LED (`34`) as its own heartbeat/status indicator. For user GPIO tests, start with:

- red LED: `10`
- green LED: `27`
- button input: `23` or `6`

### Touch component

The FRDM board touch pad is exposed as a built-in Lua component:

```lua
local touch = component("touch_pad")
touch:init()           -- optional explicit calibration
local raw = touch:raw()
local delta = touch:delta()
local pressed = touch:pressed()
```

Available methods:

- `init([threshold])`
- `raw()`
- `baseline()`
- `delta()`
- `pressed([threshold])`
- `threshold()`
- `set_threshold(value)`

The stable IDE-first path today is the simple press detector used by [`mcxn947_touch_pad_leds.yaml`](/Users/administratorik/dev/Aetherium_Automata/example/automata/showcase/09_mcxn947/mcxn947_touch_pad_leds.yaml): call `init()` once, then `pressed()` from state code. The extra telemetry methods (`raw`, `baseline`, `delta`, `threshold`) are available for deeper tuning, but only the press demo is currently promoted as a verified showcase.

### Minimal Lua smoke

```lua
gpio.mode(10, "output")
gpio.write(10, 1)
gpio.mode(23, "input_pullup")
local pressed = gpio.read(23) == 0
log("info", "sw2=" .. tostring(pressed))
```
