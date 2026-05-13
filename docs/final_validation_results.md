# Final Validation Results

Date: 2026-05-13

This note records what was actually exercised for the final thesis evidence pass. It avoids load-test or performance claims: no sustained load test, latency benchmark, or statistical hardware measurement was performed.

## Environment

- Core stack: `gateway`, `server3`, `device1`
- Gateway URL for operator clients: `ws://localhost:8080/socket/websocket`
- Server/device network URL inside compose: `ws://172.20.0.23:4000/socket/device/websocket`
- Desktop devices used:
  - `device_cpp_01` via compose service `device1`
  - `device_cpp_02` via one-off container `cpp-device-2`
- Extra black-box device used:
  - `black_box_01` via compose service `blackbox1`

## Reproducible Commands

Start the core stack and a second C++ desktop device:

```bash
cd src
make up

podman rm -f cpp-device-2 >/dev/null 2>&1 || true
podman run -d \
  --name cpp-device-2 \
  --network src_elixir-net \
  -e DEVICE_ID=device_cpp_02 \
  localhost/src_device1:latest \
  --verbose --run - \
  --mode network \
  --server ws://172.20.0.23:4000/socket/device/websocket
```

Run the corrected desktop bytecode E2E smoke against both C++ devices:

```bash
cd src
docker compose exec -T server3 sh -lc \
  'cd /app && mix aetherium.e2e --gateway-url ws://172.20.0.10:4000/socket/websocket --token dev_secret_token --server-id svr_03 --device-id device_cpp_01 --bytecode-smoke --timeout-ms 30000 --wait-ms 15000 --set-input enabled=true'

docker compose exec -T server3 sh -lc \
  'cd /app && mix aetherium.e2e --gateway-url ws://172.20.0.10:4000/socket/websocket --token dev_secret_token --server-id svr_03 --device-id device_cpp_02 --bytecode-smoke --timeout-ms 30000 --wait-ms 15000 --set-input enabled=true'
```

Run supporting checks:

```bash
scripts/validate_showcase_automata.sh validate

cd src/gateway/aetherium_gateway
mix test test/protocol_test.exs

cd ../../ide
npm run typecheck
```

Attempt hardware discovery:

```bash
lsusb
ls -l /dev/serial/by-id /dev/ttyUSB* /dev/ttyACM* 2>/dev/null
arduino-cli board list
pyocd list
```

## Results Table

| Area | Result | Evidence | Thesis-safe claim |
|---|---:|---|---|
| Desktop C++ device 1 | PASS | `device_cpp_01`, `mix aetherium.e2e --bytecode-smoke`, output: `E2E OK` | Gateway/server can deploy an `aeth_ir_v1` bytecode-safe EFSM to a desktop C++ device, start it, set an input, and observe a state change. |
| Desktop C++ device 2 | PASS | `device_cpp_02`, same E2E command, output: `E2E OK` | The same gateway/server path can address more than one desktop C++ device concurrently. |
| Showcase YAML validation | PASS | `Validated 16 showcase automata file(s).` | The curated showcase catalog is syntactically/structurally valid for the repository validator. |
| Gateway protocol tests | PASS | `15 tests, 0 failures` | Gateway protocol encoding/channel behavior has automated unit coverage. |
| IDE static validation | PASS | `npm run typecheck` completed | The current Electron/React TypeScript surface typechecks. |
| Black-box runtime behavior | PARTIAL PASS | Smoke reached snapshots: `Idle -> Armed -> Faulted -> Idle`; final task failed waiting for trace file. | Black-box commands and observable state snapshots work; trace-file export path was not proven in this run. |
| Server target-profile tests | FAILING TEST EXPECTATIONS | `27 tests, 2 failures`; failures expect desktop YAML format, current implementation emits `aeth_ir_v1`. | Tests need updating to the current IR-first desktop deployment behavior before claiming full green server validation. |
| C++ CLI/trace pytest | FAIL | `2 passed, 1 failed`; failure: runtime-core build lacks file/YAML loader. | Do not claim standalone CLI YAML execution/trace export is validated by the current default CMake build. |
| Engine command smoke | FAIL | `runtime_core build does not include YAML loader` | In-process command smoke currently targets a path that expects YAML loading not present in the runtime-core build. |
| ESP/NXP hardware discovery | BLOCKED | USB sees CP210x, CH910x, and NXP MCU-LINK, but no `/dev/ttyUSB*`/`/dev/ttyACM*`; `arduino-cli board list` found none; `pyocd list` found none. | Hardware is physically visible on USB, but the current user session cannot access serial/debug device nodes yet. |

## Hardware Notes

`lsusb` saw:

- `10c4:ea60 Silicon Labs CP210x UART Bridge`
- `1a86:55d4 QinHeng Electronics USB Single Serial`
- `1fc9:0143 NXP Semiconductors MCU-LINK FRDM-MCXN947 CMSIS-DAP`

However:

- no `/dev/ttyUSB*` or `/dev/ttyACM*` nodes were visible;
- `arduino-cli board list` returned `No boards found`;
- `pyocd list` returned `No available debug probes are connected`;
- `/dev/hidraw*` nodes are root-only;
- loading serial drivers with `sudo modprobe cp210x ch341 cdc_acm usbserial` was blocked because this session has no sudo password/TTY.

Before final hardware screenshots, fix host access:

```bash
sudo modprobe cp210x ch341 cdc_acm usbserial
sudo usermod -aG uucp,lock,dialout "$USER" 2>/dev/null || true
```

Then unplug/replug the ESP32 boards and FRDM board, log out/in, and rerun:

```bash
ls -l /dev/serial/by-id /dev/ttyUSB* /dev/ttyACM*
arduino-cli board list
pyocd list
```

## Screenshot Checklist

Capture these for the thesis/demo:

1. Docker/Podman process list showing `elixir-gateway`, `elixir-server-3`, `cpp-device-1`, and `cpp-device-2`.
2. Terminal output for both `mix aetherium.e2e --bytecode-smoke` runs, each ending in `E2E OK`.
3. IDE Network/Topology panel showing gateway, server, and both C++ devices online.
4. IDE Runtime Monitor focused on `device_cpp_01` after bytecode smoke deployment.
5. IDE Runtime Monitor focused on `device_cpp_02` after bytecode smoke deployment.
6. Showcase validator output showing `Validated 16 showcase automata file(s).`
7. Hardware discovery terminal after access is fixed, showing ESP/NXP ports.
8. For each hardware board, a short photo/screenshot pair: board connected, serial smoke command output.

## Bottom Line

The project is useful as a demonstrable design/deploy/observe toolchain, but the final thesis must be careful:

- claim demonstrated multi-device desktop deployment with `aeth_ir_v1`;
- claim validated showcase definitions, gateway protocol tests, and IDE typechecking;
- claim hardware support as implemented but mark final board smoke as pending until host serial/debug access is fixed;
- do not claim load testing, measured latency, throughput, reliability percentages, or quantified scalability;
- do not claim all tests are green until the stale desktop YAML expectations and runtime-core YAML-loader smoke are resolved.
