# Aetherium Automata

Aetherium Automata is a state-centric toolchain for designing, deploying, observing, fault-testing, replaying, and analyzing distributed IoT control systems modeled as Extended Finite State Machines (EFSMs).

The current canonical product slice is:

- a portable C++17 automata engine,
- an Elixir/Phoenix gateway and server path,
- an Electron/React IDE,
- YAML-authored automata with Lua guards/actions,
- black-box contracts for external or opaque devices,
- deterministic fault injection and execution traces,
- Petri-net and analyzer views for contention, bottlenecks, and structural insight,
- one flagship IDE project that demonstrates the full workflow.

## Quick Start

From the repository root:

```bash
cmake -S . -B build
cmake --build build -j4

scripts/validate_showcase_automata.sh list
scripts/validate_showcase_automata.sh validate
```

The validator uses `build/aetherium_engine` by default. Override it with:

```bash
AETHERIUM_ENGINE_BIN=/abs/path/to/aetherium_engine scripts/validate_showcase_automata.sh validate
```

## Flagship Showcase

Open this project in the IDE:

```text
example/ide_demo_projects/backend-capabilities-tour.aeth
```

The same project is also copied to:

```text
NewProject.aeth
```

It contains the current canonical demo networks:

- `Aetherium Gem Cell`: the thesis/demo gem. A single state-heavy automaton covering TDD checkpoints, high state churn, fault injection controls, replay markers, a black-box contract, and Petri-liftable shared-resource demand.
- `Signal Chain Backbone`: command router, safety gate, black-box drive unit, and telemetry observer.
- `Guarded Cell Cluster`: host and embedded-style guarded actuation flow.
- `Power Contention Ring`: charger, motion axis, and allocator competing for a shared bus.
- `Resilience Watchdog`: heartbeat loss, retries, backoff, failure, and reset.

Regenerate the IDE project after changing showcase YAML:

```bash
node scripts/generate_ide_demo_projects.cjs
```

## Local Docker Workflow

Most runtime demos start from `src/`:

```bash
cd src
make help
make up      # gateway + server3 + device1
make logs0   # fresh logs for the core stack
```

Useful stack variants:

```bash
make up-blackbox
make smoke-blackbox

make up-ts
make test-ts

make up-ros2
make up-ros2-demo
```

Compose service names are `gateway`, `server3`, `device1`, and `blackbox1`. Container names shown by Docker may differ.

## IDE

Run the Electron IDE:

```bash
cd src/ide
npm install
npm run dev
```

Use the Gateway settings in the IDE to connect to the running gateway. The development Docker stack exposes the gateway through the compose configuration; host hardware loops use `ws://localhost:8080/socket/websocket` by default in the Makefile helpers.

## Hardware Loops

For real USB serial hardware on macOS, run the server on the host instead of inside Docker because Docker Desktop does not reliably expose `/dev/cu.*` devices to Linux containers.

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
make mcxn947-configure
make mcxn947-build
make mcxn947-flash MCXN947_PORT=/dev/cu.usbmodem...
make mcxn947-server MCXN947_PORT=/dev/cu.usbmodem...
make mcxn947-smoke
make mcxn947-demo
```

Generic serial host:

```bash
cd src
make ports
make serial-server SERIAL_PORTS=/dev/cu.foo,/dev/cu.bar
make serial-smoke
```

If an ESP32 or FRDM-MCXN947 is visible on USB but does not appear in the IDE/server, or deploy fails with a first-chunk ACK timeout, follow [Hardware Live Recovery](docs/HARDWARE_LIVE_RECOVERY.md). This is an expected live-demo failure mode of USB serial/debug probes: reset or replug the board, ensure the host owns the serial port, then rerun the smoke/demo command with `AETHERIUM_SERIAL_TRACE=1` if needed.

## Testing

Core checks:

```bash
scripts/validate_showcase_automata.sh validate
pytest

cd src/gateway/aetherium_gateway && mix test
cd src/server/aetherium_server && mix test
cd src/ide && npm test
```

Targeted checks:

```bash
cd src/server/aetherium_server
mix test test/showcase_catalog_test.exs

cd ../aetherium_gateway
mix test test/protocol_test.exs
```

The helper script still exists for component-level runs:

```bash
./scripts/test.sh gateway
./scripts/test.sh server
./scripts/test.sh protocol
./scripts/test.sh ide
```

## Documentation Map

- YAML DSL: `docs/Automata_YAML_Spec.md`
- Lua runtime helpers: `docs/Lua_Runtime_API.md`
- Testing guide: `docs/TESTING_GUIDE.md`
- Engine usage: `docs/engine/usage.md`
- Engine command test plan: `docs/engine/quick-command-test-plan.md`
- Architecture overview: `docs/architecture/overview.md`
- System architecture details: `docs/architecture/SYSTEM_ARCHITECTURE.md`
- Black-box contract: `docs/architecture/BLACK_BOX_IMPLEMENTATION.md`
- Analyzer demo: `docs/architecture/ANALYZER_DEMONSTRATION.md`
- ROS2 demo: `docs/dev/ros2_connector_demo.md`
- Showcase catalog: `example/automata/showcase/README.md`
- IDE demo project: `example/ide_demo_projects/README.md`

## Repository Layout

```text
src/engine/                  C++17 runtime and embedded platform code
src/gateway/aetherium_gateway Elixir/Phoenix gateway
src/server/aetherium_server   Elixir server, deployment, connectors, traces
src/ide/                      Electron/React IDE
example/automata/showcase/    curated showcase automata
example/ide_demo_projects/    canonical IDE project file
docs/                         technical documentation
theisis/sablona2025/          thesis LaTeX source and compiled PDF
```

## Current Direction

The project is intentionally converging on a single product story: design an explicit state model, bind it into a distributed deployment, run it through the gateway/server/engine stack, observe live state, inject faults, rewind execution, and inspect analyzer/Petri findings. New demos and docs should reinforce that path unless they are clearly marked as experimental.
