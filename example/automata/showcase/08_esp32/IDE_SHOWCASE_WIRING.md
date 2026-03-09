# ESP32 IDE Showcase Wiring

These examples are intended for the IDE import path and the existing Aetherium ESP32 node firmware, not a custom sketch.

## One ESP32: `esp32_oled_pot_dashboard.yaml`

- OLED `VCC -> 3V3`
- OLED `GND -> GND`
- OLED `SDA -> GPIO21`
- OLED `SCL -> GPIO22`
- Potentiometer outer pin `-> 3V3`
- Potentiometer other outer pin `-> GND`
- Potentiometer wiper `-> GPIO34`
- Button one side `-> GPIO18`
- Button other side `-> GND`
- LED control `GPIO19 -> 220 ohm resistor -> LED anode`
- LED cathode `-> GND`

Notes:
- The button is configured as `INPUT_PULLUP`, so pressed means the input reads low.
- `GPIO34` is input-only and is used only for ADC.
- The OLED examples assume the common SSD1306 I2C address `0x3C` (`60` in the YAML/Lua examples).

## Two ESP32s: leader + follower

Leader board:
- same wiring as the one-board dashboard above
- import `esp32_binding_leader_oled.yaml`

Follower board:
- PWM LED `GPIO23 -> 220 ohm resistor -> LED anode`
- LED cathode `-> GND`
- Optional status LED `GPIO2 -> 220 ohm resistor -> LED anode`
- LED cathode `-> GND`
- import `esp32_binding_follower_pwm.yaml`

Gateway binding intent:
- bind leader output `leader_duty` to follower input `leader_duty`
- bind leader output `leader_button` to follower input `leader_button`

That yields a simple mirrored demo where the potentiometer drives the follower LED brightness and the leader button forces a full-bright output on both sides.
