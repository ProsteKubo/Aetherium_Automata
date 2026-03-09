# Showcase Automata Catalog

This catalog is a curated set of runnable automata scenarios for demos, QA runs, and regression smoke checks.

## Goals

- Provide varied behavior patterns (timed, event, threshold, probabilistic, recovery, folderized Lua).
- Keep scenarios small and focused so they are easy to explain during presentations.
- Keep maintenance predictable through one catalog file (`CATALOG.txt`) and one validator script.

## Catalog Layout

- `01_basics/` deterministic starter models
- `02_control/` classic/event control logic
- `03_probabilistic/` weighted branching and balancing
- `04_resilience/` watchdog and recovery behavior
- `05_energy/` policy/scheduling state machines
- `06_pipeline/` part-flow and dispatch coordination
- `07_folderized/` state/transition Lua split for maintainable large models
- `08_esp32/` ESP32 demos for serial + IDE imports, including rich Lua hardware showcases
- `09_mcxn947/` FRDM-MCXN947 hardware demos for serial validation and IDE-first board features

## Scenarios

1. `01_basics/blink_with_manual_override.yaml`
   - Timed blinking with input override path.
2. `02_control/tank_level_controller.yaml`
   - Tank fill/drain loop with threshold alarm events.
3. `03_probabilistic/quality_router_batch.yaml`
   - Weighted lane selection and bounded batch completion.
4. `04_resilience/sensor_watchdog_recovery.yaml`
   - Timeout watchdog, retry loop, and manual reset.
5. `05_energy/peak_shaving_scheduler.yaml`
   - Charge/discharge policy orchestration from demand/SOC.
6. `06_pipeline/line_buffer_dispatcher.yaml`
   - Buffering + dispatch gating with event triggers.
7. `07_folderized/door_safety_controller/door_safety_controller.yaml`
   - Folder-based Lua implementation split by state and transition.
8. `08_esp32/esp32_runtime_led_pulse.yaml`
   - ESP32-safe deterministic timed cycle intended for hardware serial demos.
9. `08_esp32/esp32_led_guarded_cycle.yaml`
   - Simple enable-gated LED loop with 1s dwell (safe baseline for first-board validation).
10. `08_esp32/esp32_thermostat_guard.yaml`
   - Input-driven classic/timed thermostat control with explicit fault override.
11. `08_esp32/esp32_production_line_safe.yaml`
   - Production-line style deterministic lane cycling (`A -> B -> C`) with bounded timings and external alarm gating.
12. `08_esp32/esp32_oled_pot_dashboard.yaml`
   - One-board rich Lua IDE demo using SSD1306 OLED, potentiometer ADC, button input, and PWM LED output.
13. `08_esp32/esp32_binding_leader_oled.yaml`
   - Two-board leader node for bindings, with OLED dashboard and exported output signals.
14. `08_esp32/esp32_binding_follower_pwm.yaml`
   - Two-board follower node that consumes bound inputs and mirrors them to PWM + GPIO outputs.
15. `09_mcxn947/mcxn947_gpio_buttons_leds.yaml`
   - FRDM board smoke that mirrors SW2/SW3 onto the red/green LEDs using the ESP-style GPIO Lua API.
16. `09_mcxn947/mcxn947_touch_pad_leds.yaml`
   - FRDM touch-pad press demo that lights the red LED through the built-in `touch_pad` Lua component.

## Usage

List scenarios:

```bash
scripts/validate_showcase_automata.sh list
```

Validate all scenarios (requires built engine binary):

```bash
scripts/validate_showcase_automata.sh validate
```

Validate with custom binary path:

```bash
AETHERIUM_ENGINE_BIN=/abs/path/to/aetherium_engine scripts/validate_showcase_automata.sh validate
```

For the OLED-backed IDE showcases, install the Arduino dependencies first:

```bash
cd src
make esp-deps
```
