# Testing Guide

This guide lists the checks that are currently useful for validating Aetherium Automata. Commands assume the repository root unless noted.

## Fast Smoke Pass

```bash
cmake -S . -B build
cmake --build build -j4

scripts/validate_showcase_automata.sh validate
pytest
```

The showcase validator reads `example/automata/showcase/CATALOG.txt` and validates the curated desktop-runnable showcase set, including `15_aetherium_gem/aetherium_gem_cell.yaml`.

## Component Tests

Gateway:

```bash
cd src/gateway/aetherium_gateway
mix test
```

Server:

```bash
cd src/server/aetherium_server
mix test
```

IDE:

```bash
cd src/ide
npm install
npm test
```

Python/CLI tests:

```bash
pytest
```

## Targeted Checks

Showcase catalog bundle:

```bash
cd src/server/aetherium_server
mix test test/showcase_catalog_test.exs
```

Protocol tests:

```bash
cd src/gateway/aetherium_gateway
mix test test/protocol_test.exs

cd ../../server/aetherium_server
mix test test/protocol_test.exs
```

Engine command smoke:

```bash
cmake --build build --target aetherium_engine_command_smoke
./build/aetherium_engine_command_smoke
```

Expected output:

```text
engine_command_smoke: PASS
```

## Runtime Stack Checks

Core Docker stack:

```bash
cd src
make up
make ps
make logs0
```

Black-box smoke:

```bash
cd src
make up-blackbox
make smoke-blackbox
```

Influx/Grafana time-series integration:

```bash
cd src
make up-ts
make test-ts
```

ROS2 bridge modes:

```bash
cd src
make up-ros2
make up-ros2-demo
```

## Hardware Smoke

ESP32:

```bash
cd src
make esp-deps
make esp-flash ESP_PORT=/dev/cu.usbserial-...
make esp-server ESP_PORT=/dev/cu.usbserial-...
make esp-smoke
```

FRDM-MCXN947:

```bash
cd src
make mcxn947-build
make mcxn947-flash MCXN947_PORT=/dev/cu.usbmodem...
make mcxn947-server MCXN947_PORT=/dev/cu.usbmodem...
make mcxn947-smoke
```

## Helper Script

The legacy helper is still useful for quick component runs:

```bash
./scripts/test.sh gateway
./scripts/test.sh server
./scripts/test.sh protocol
./scripts/test.sh ide
./scripts/test.sh all
```

`./scripts/test.sh all` runs gateway, server, and IDE tests. It does not replace the CMake build, Python tests, or showcase validator.

## Pass Criteria

- CMake builds `aetherium_engine`.
- Curated showcase YAML validates.
- Python CLI tests pass.
- Gateway and server `mix test` suites pass.
- IDE tests pass or are explicitly skipped because the test target is not configured in the local environment.
- Docker smoke checks complete without failed service health or deployment errors.
