# NXP Engine Capability Tests

Systematic per-capability test automata for the FRDM-MCXN947 board.
Each file is a standalone deployable that gives visual LED pass/fail feedback.

## Hardware

- **GPIO 10** = red LED (active-low: `gpio.write(10, true)` turns ON)
- **GPIO 27** = green LED (active-low: `gpio.write(27, true)` turns ON)
- **Touch pad** = onboard capacitive pad (`component("touch_pad"):pressed()`)

## Test files

| File | Capability tested | Host required |
|------|------------------|---------------|
| `01_gpio_leds.yaml` | GPIO write, active-low LEDs, timed sequencing | No |
| `02_touch_detection.yaml` | `touch_pad` component, classic condition polling | No |
| `03_event_on_change.yaml` | `on_change` event + additional condition | Yes (`command` string input) |
| `04_event_rise_fall.yaml` | `on_rise` / `on_fall` edge detection | Yes (`trigger` bool input) |
| `05_event_on_threshold.yaml` | `on_threshold` including state-entry level check | Yes (`level` int input) |
| `06_timed_transitions.yaml` | `after` sequencing, `timeout` vs `after` priority race | No |
| `07_classic_conditions.yaml` | Classic level-sensitive conditions, touch + numeric | Yes (`level` int input) |
| `08_signal_roundtrip.yaml` | Full host↔NXP gateway roundtrip | Yes (use `08_signal_roundtrip_host.yaml`) |
| `08_signal_roundtrip_host.yaml` | Host driver for test 08 | — |

## Deployment

Deploy each NXP file to `mcxn947-core0` with profile `mcxn947_lua_v1`.
For tests that need a host counterpart, also deploy the host YAML to `host_cpp_01`.
The gateway auto-routes variables by matching names across automata.

## Visual pass criteria

| Test | Pass condition |
|------|---------------|
| 01 | LEDs cycle: red→green→both→off |
| 02 | Both LEDs on while touch held, green when released |
| 03 | LEDs match command value: red=A, green=B, off=done |
| 04 | After rise: both on 1s; after fall: red on 1s; loops |
| 05 | off→green→red as level crosses 50/90; back to off below 50 |
| 06 | LEDs count binary 00→01→10→11→off then green on (after wins race) |
| 07 | LEDs reflect level zone in real-time; both on during touch override |
| 08 | Progresses through four LED states and ends with both off |

## IR bugs fixed (runtime.cpp)

These tests were designed around two engine fixes:

1. **Stale `hasChanged` after state transition** — `clearAllChanged()` is now called
   after every `fireTransition()` so the new state starts with clean change flags.

2. **`OnThreshold` state-entry miss** — `evaluateEvent()` now checks the threshold
   on the first tick after entering a state even if the value did not change that tick
   (`isEntryTick = tickCount == stateEntryTickCount + 1`). Test 05 exercises this path.
