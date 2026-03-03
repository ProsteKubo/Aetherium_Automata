# AetheriumServer

Server-side device orchestration service for Aetherium Automata.

## Device Connectors (Multi-Connector Host)

The server now starts device connectors through a connector supervisor and can run multiple connectors in parallel (static config):

- WebSocket listener connector(s)
- Serial/UART connector(s)
- ROS2 bridge connector(s)

All connectors feed the same `DeviceManager`/gateway path, so the IDE sees one aggregated device list.

## Quick Start (WS + Serial + ROS2 Bridge Connectors)

Start the server with the legacy env-compatible connector config:

```bash
cd src/server/aetherium_server
ENABLE_SERIAL_DEVICE_TRANSPORT=1 \
SERIAL_PORTS=/dev/cu.usbserial-11340 \
ENABLE_ROS2_DEVICE_TRANSPORT=1 \
ROS2_PORT=5501 \
mix run --no-halt
```

Notes:

- Default baud rate is `115200` (`SERIAL_BAUD_RATE` to override).
- `SERIAL_PORTS=auto` scans common macOS/Linux USB serial device names at startup.
- macOS Docker Desktop note: USB serial devices are not reliably available inside containers; run server on host for real ESP32 serial tests.
- ROS2 bridge connector listens on TCP (`ROS2_BIND_IP`, `ROS2_PORT`) and accepts newline-delimited JSON frames with base64 payloads:
  - inbound: `{"frame_b64":"<base64_engine_frame>"}`
  - outbound: `{"frame_b64":"<base64_engine_frame>"}`
- Preferred config path is `:device_connectors` (static list of connector instances with `id/type/enabled/options`).
- UNO/AVR and ESP32 deploys go through target-profile compile/validation and are transmitted as `aeth_ir_v1` artifacts.
- Deploy transport uses chunked `LoadAutomata` (YAML + `aeth_ir_v1`) with ACK-gated progression and timeout/retry.
- Chunking runtime knobs: `AETHERIUM_DEPLOY_CHUNK_SIZE`, `AETHERIUM_DEPLOY_CHUNK_ACK_TIMEOUT_MS`, `AETHERIUM_DEPLOY_CHUNK_ACK_RETRIES`, `AETHERIUM_DEPLOY_FINAL_LOAD_ACK_TIMEOUT_MS`.
- Time-travel groundwork is enabled by default via `AetheriumServer.TimeSeriesStore`:
  - `ENABLE_TIME_SERIES_STORE=1`
  - `TIME_SERIES_DATA_DIR=var/server_time_series`
  - `TIME_SERIES_EVENT_CAPACITY=20000`
  - `TIME_SERIES_SNAPSHOT_CAPACITY=2000`
  - Commands exposed through automata control path: `time_travel_query`, `rewind_deployment`.
- Optional InfluxDB streaming sink (`AetheriumServer.TimeSeriesInfluxSink`) can be enabled:
  - `ENABLE_TIME_SERIES_INFLUX=1`
  - `INFLUXDB_URL=http://influxdb:8086`
  - `INFLUXDB_ORG=aetherium`
  - `INFLUXDB_BUCKET=aetherium_ts`
  - `INFLUXDB_TOKEN=<token>`
  - `INFLUXDB_BATCH_SIZE=200`
  - `INFLUXDB_FLUSH_MS=1000`
- Timeline query backend selection (`AetheriumServer.TimeSeriesQuery`):
  - `TIME_SERIES_QUERY_BACKEND=auto` (`local`, `influx`, `auto`)
  - `TIME_SERIES_REPLAY_LIMIT=50000` (max event rows loaded for `rewind_deployment` replay)
  - `TIME_SERIES_QUERY_FALLBACK_TO_LOCAL=1` (fallback when Influx query fails)
- Real Influx integration test:
  - `RUN_INFLUX_INTEGRATION_TESTS=1 mix test test/time_series_influx_integration_test.exs`

## ROS2 Bridge Notes

- The connector is transport-level and keeps the same engine protocol/ingress path as WS/serial.
- A ROS2-side bridge process can map ROS2 topics to this TCP JSON-line framing.
- Devices connected via ROS2 bridge are reported with connector metadata (`connector_type=ros2`, `transport=ros2_bridge`) and appear in the unified device list.
- Docker demo/ops runbook: `docs/dev/ros2_connector_demo.md`.

## Serial Hardware Smoke

With the server running and an Arduino serial device connected:

```bash
cd src/server/aetherium_server
mix aetherium.serial.smoke --wait-ms 30000 --timeout-ms 20000
```

This smoke task validates deploy -> start -> stop on a connected serial Arduino device.

Options:

- `--device-id <id>` target a specific already-registered device.
- `--wait-ms <ms>` wait time for a serial Arduino to appear.
- `--timeout-ms <ms>` per-stage deploy/start timeout.

## ESP32 Time-Travel Demo (Real Device)

With an ESP32 serial node flashed and connected:

```bash
cd src/server/aetherium_server
ENABLE_SERIAL_DEVICE_TRANSPORT=1 \
SERIAL_PORTS=/dev/cu.usbserial-0001 \
mix aetherium.esp32.timetravel.demo --wait-ms 45000 --run-ms 3000
```

This demo performs deploy -> start -> stop, reads timeline events/snapshots, then executes `rewind_deployment` to a recorded timestamp.

## Showcase CLI Deploy

Use curated examples from `example/automata/showcase/CATALOG.txt` without IDE:

```bash
cd src/server/aetherium_server
mix aetherium.showcase.deploy --list
mix aetherium.showcase.deploy --showcase showcase_01 --start true
```

Options:

- `--showcase <id-or-relative-path>` target showcase entry (`showcase_01`, etc.).
- `--device-id <id>` deploy to a specific connected device (default: first connected).
- `--connector-type <type>` optional filter when auto-selecting device (`serial`, `websocket`, `ros2`, ...).
- `--start <true|false>` auto-start deployment after transfer (default: `true`).
- `--wait-ms <ms>`, `--poll-ms <ms>`, `--timeout-ms <ms>` timing controls.
