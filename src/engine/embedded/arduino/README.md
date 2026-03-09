# Aetherium Arduino/ESP32 Scaffold

This folder contains the first embedded-platform scaffolding for Arduino-class boards:

- `AetheriumAvrPlatform.hpp`: Arduino clock/random adapters (`millis()`/`delay()`)
- `AetheriumAvrNode.hpp/.cpp`: shared runtime wrapper used by AVR and ESP32 sketches
- `AetheriumAvrSerialLink.hpp/.cpp`: serial byte-stream framing + protocol dispatch (`Hello`/`HelloAck`, command routing)
- `AetheriumEsp32Node.hpp`: ESP32 naming alias over the same engine wrapper
- `AetheriumEsp32SerialLink.hpp`: ESP32-focused serial link wrapper (sends `DeviceType::ESP32`)
- `examples/`: minimal Arduino IDE sketch skeleton

Status:

- Uses the shared engine class and bytecode artifact load path (`loadAutomataFromBytes`)
- Includes Arduino-side binary protocol framing/dispatch over `Stream` (USB serial)
- Intended for compiled `aeth_ir_v1` deploy artifacts from the server
- Not yet a complete production Arduino runtime:
  - CMake/runtime-core split is still in progress (`aetherium_runtime_core` currently aliases monolithic `aetherium_core`)
- Serial link currently implements framing + command dispatch, but not full production connection lifecycle (retries/heartbeats/backpressure/chunk reassembly)
- AVR-specific memory budgeting and persistent storage hooks are not implemented

Sketch entrypoints:

- AVR/UNO: `examples/AetheriumAvrNode/AetheriumAvrNode.ino`
- ESP32: `examples/AetheriumEsp32Node/AetheriumEsp32Node.ino`

ESP32 sketch runtime behavior:

- Sends a unique hello device name (`esp32-<mac_suffix>`) so multiple boards are distinguishable in IDE/device list.
- Drives `LED_BUILTIN` as runtime status indicator:
  - fast blink = running
  - solid on = paused
  - slow blink = loaded/not running
  - short pulse = waiting for hello ack
  - off = unloaded/stopped
- Serial protocol reliability:
  - debug text logs are disabled by default so binary protocol frames are not polluted
  - hello handshake is periodically refreshed so device reappears after server restart

ESP32 built-in components:

- `board_led`
  - Controls the same visible `LED_BUILTIN` used by the runtime heartbeat.
  - When an automata calls `component("board_led"):set(...)`, the runtime heartbeat is temporarily overridden so IDE demos can visibly drive the onboard LED.
  - Methods: `set(bool)`, `on()`, `off()`, `clear()`, `status()`

## Arduino CLI Build Notes

ESP32 (tested):

```bash
arduino-cli compile -u -p /dev/cu.usbserial-0001 \
  -b esp32:esp32:esp32 \
  --library src/engine/embedded/arduino \
  --build-property compiler.cpp.extra_flags="-std=gnu++17 -DAETHERIUM_RUNTIME_CORE_ONLY=1 -DAETHERIUM_DISABLE_LUA_SCRIPT_ENGINE=1 -I$PWD/src" \
  src/engine/embedded/arduino/examples/AetheriumEsp32Node
```

UNO/AVR status:

- Current shared runtime core uses C++17 STL headers (`<optional>`, `<variant>`, `<cstdint>`).
- `arduino:avr` toolchain in Arduino core `1.8.7` does not provide these headers, so the UNO build currently fails before link.
- ESP32 path is currently the validated real-device target for the shared engine scaffold.

This scaffold is the base for production Arduino IDE build integration using the shared runtime-core subset.
