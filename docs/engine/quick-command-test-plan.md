# Engine Quick Command Test Plan

This is the shortest command-line pass for checking engine command handling and YAML validation.

## 1. Build

```bash
cmake -S . -B build
cmake --build build -j4
```

## 2. Command Smoke

```bash
./build/aetherium_engine_command_smoke
```

Expected output:

```text
engine_command_smoke: PASS
```

Covered behavior:

- `STATUS`
- `START` before load returns `NAK`
- `LOAD_AUTOMATA` and `LOAD_ACK`
- `START`, `PAUSE`, `RESUME`, `STOP`, `RESET`
- `INPUT` and `VARIABLE`
- `VENDOR` and `GOODBYE`
- unsupported command path returns `NAK`
- status snapshots and transition progression

## 3. Validate Curated Showcase

```bash
scripts/validate_showcase_automata.sh validate
```

This validates the curated desktop-runnable showcase list in `example/automata/showcase/CATALOG.txt`.

## 4. Validate All Example YAML

```bash
find example/automata -type f -name '*.yaml' -print0 |
  sort -z |
  xargs -0 -n1 ./build/aetherium_engine --validate
```

## 5. Stress and Edge Examples

```bash
./build/aetherium_engine --validate example/automata/showcase/15_aetherium_gem/aetherium_gem_cell.yaml
./build/aetherium_engine --validate example/automata/automata-yaml-examples/production-line-stress.yaml
./build/aetherium_engine --validate example/automata/automata-yaml-examples/high-churn-immediate.yaml
./build/aetherium_engine --validate example/automata/automata-yaml-examples/event-threshold-runtime.yaml
./build/aetherium_engine --validate example/automata/automata-yaml-examples/probabilistic-balance-loop.yaml
```

Some builds of `aetherium_engine` are validation-only because the runtime-core build may not include the file/YAML loader for `--run`. Treat `--validate` as the portable acceptance command and use Docker/server smoke tests for full deployment workflows.

## Pass Criteria

- command smoke prints `PASS`;
- curated showcase validation succeeds;
- all example YAML files validate;
- no command path crashes or hangs.
