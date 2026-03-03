# IoT Device Connectors and Shared Engine Direction

## Goal

Support multiple device classes (Arduino, ESP32, host/desktop) without coupling the server or IDE to one transport or one runtime implementation.

## Current Architecture (Implemented)

- `AetheriumServer.DeviceConnectorSupervisor`
  - Starts multiple connector instances in parallel from static config.
- WebSocket connector instances
  - Existing internet/network path for host devices.
- Serial connector instances
  - UART/USB path for devices without Wi-Fi (Arduino/ESP32 serial now, others later).
- ROS2 bridge connector instances
  - TCP bridge endpoint for ROS2 ecosystems (rosbridge/ROS2 adapter processes).
- `DeviceIngress`
  - Shared message routing from transport to `DeviceManager`.
- `DeviceManager`
  - Connector-agnostic orchestration, deployment state, and gateway event emission.

## Engine Direction (Chosen)

- One shared engine core codebase across desktop/ESP32/AVR, with pluggable modules/platform adapters.
- Server-side compile/validation pipeline selects a target profile (`desktop_v1`, `esp32_v1`, `avr_uno_v1`).
- UNO/AVR targets are compile-aware and will require `aeth_ir_v1` (server compiler + shared AVR runtime pending).
- Raw YAML deploy to UNO is intentionally rejected by the compile hook to avoid false compatibility.

## Why This Helps

- Adding a new connector (BLE, CAN, UART bridge, ROS2 bridge, MQTT gateway) no longer requires changing `DeviceManager`.
- The server can aggregate many connector instances into one gateway/IDE view.
- MCU support evolves through shared engine library work instead of device-specific protocol shims.
