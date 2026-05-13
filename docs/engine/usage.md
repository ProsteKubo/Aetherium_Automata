---
title: Engine Usage
---

# Engine Usage

The C++ engine validates and executes Aetherium automata definitions. In the current repository it is used in three ways:

- as a local CLI validator;
- as a Docker-hosted runtime device (`device1`, `blackbox1`);
- as an embedded runtime library for ESP32 and FRDM-MCXN947 hardware paths.

## Build

From the repository root:

```bash
cmake -S . -B build
cmake --build build -j4
```

Main binaries:

- `build/aetherium_engine`
- `build/aetherium_engine_command_smoke`

## CLI Validation

```bash
./build/aetherium_engine --validate example/automata/showcase/15_aetherium_gem/aetherium_gem_cell.yaml
```

Curated showcase validation:

```bash
scripts/validate_showcase_automata.sh validate
```

If the engine binary lives elsewhere:

```bash
AETHERIUM_ENGINE_BIN=/abs/path/to/aetherium_engine scripts/validate_showcase_automata.sh validate
```

## CLI Options

Run:

```bash
./build/aetherium_engine --help
```

Common options:

- `--validate <file>`: parse and validate one YAML automaton.
- `--run <file|->`: run an automaton or wait for network deployment when `-` is used.
- `--mode detached|network`: select local detached execution or network mode.
- `--max-ticks <N>` and `--max-transitions <N>`: cap local execution.
- `--trace-file <path>`: write execution trace JSONL.
- `--fault-*`: configure deterministic fault profiles for local/network traces.
- `--battery-*` and `--latency-*`: annotate deployment metadata and trace records.

Some build profiles are validation-focused and may report that the runtime-core build does not include a file/YAML loader for `--run`. Use `--validate` for portable CLI checks and Docker/server workflows for end-to-end runtime demos.

## Command Smoke

```bash
./build/aetherium_engine_command_smoke
```

Expected output:

```text
engine_command_smoke: PASS
```

## Docker Runtime

From `src/`:

```bash
make up
make logs0
```

This starts `gateway + server3 + device1`. The `device1` container runs the C++ engine as the reference desktop runtime.

Black-box runtime:

```bash
make up-blackbox
make smoke-blackbox
```

The black-box smoke path uses:

```text
example/automata/showcase/12_black_box/docker_black_box_probe.yaml
```

## Embedded Targets

ESP32 and FRDM-MCXN947 builds link the runtime core into board-specific firmware and communicate through serial connectors managed by the host server.

ESP32:

```bash
cd src
make esp-deps
make esp-compile
make esp-flash ESP_PORT=/dev/cu.usbserial-...
make esp-server ESP_PORT=/dev/cu.usbserial-...
```

FRDM-MCXN947:

```bash
cd src
make mcxn947-configure
make mcxn947-build
make mcxn947-flash MCXN947_PORT=/dev/cu.usbmodem...
make mcxn947-server MCXN947_PORT=/dev/cu.usbmodem...
make mcxn947-demo
```

For live hardware demos, USB serial/debug state is part of the test environment. If ESP32 or FRDM-MCXN947 is present on USB but not visible to Aetherium, or if deploy fails before the first chunk is acknowledged, use [Hardware Live Recovery](../HARDWARE_LIVE_RECOVERY.md). The recovery path is reset/replug, confirm the serial port/probe, reflash if needed, then rerun with `AETHERIUM_SERIAL_TRACE=1` and a conservative deploy chunk size.

## Lifecycle Semantics

The engine command bus supports:

- load/start/stop/reset;
- pause/resume;
- input and variable updates;
- status snapshots;
- telemetry, transition, and state-change records;
- ACK/NAK/error reporting.

Lifecycle operations are intended to be idempotent where possible. Runtime state is exposed through snapshots and trace records so the IDE can monitor, fault, and rewind deployments.

## Safety Notes

- Keep Lua state and transition hooks short and non-blocking.
- Put control meaning in explicit states and transitions; use Lua for guards and small side effects.
- Prefer deterministic seeds for fault-injection demos.
- Validate YAML before deploying to hardware.
