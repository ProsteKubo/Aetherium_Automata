# Showcase Automata Catalog

This directory contains the demo and regression automata used by the IDE, server bundle loader, thesis, and command-line validator.

There are two useful views of the showcase set:

- **All showcase files**: every YAML under `example/automata/showcase/` (currently 43 files).
- **Curated validation catalog**: the desktop-runnable subset listed in `CATALOG.txt` (currently 16 files).

Use the curated catalog for fast regression checks. Use the full directory when browsing hardware-specific and exploratory demos.

## Flagship Demo

The main demo is:

```text
15_aetherium_gem/aetherium_gem_cell.yaml
```

It is intentionally state-heavy and code-light. It exposes:

- TDD-style arrange/act/assert checkpoints;
- frequent state switching;
- fault injection inputs for drop and delay paths;
- replay markers for time-travel debugging;
- a black-box contract with observable ports/events;
- `gem_workcell_bus`, a shared resource for Petri lifting and analyzer findings.

The IDE project that presents it first is:

```text
example/ide_demo_projects/backend-capabilities-tour.aeth
```

Every showcase YAML also has a generated one-click project under:

```text
example/ide_demo_projects/showcase/
```

Every showcase YAML also has a generated `.aeth` project next to the YAML itself, so the showcase tree can be imported directly from `example/automata/showcase/`. Folders with multiple cooperating automata include an `all.aeth` collection project in both locations.

## Category Layout

| Category | Purpose |
|---|---|
| `01_basics/` | deterministic starter models |
| `02_control/` | classic/event control logic |
| `03_probabilistic/` | weighted branching and balancing |
| `04_resilience/` | watchdog and recovery behavior |
| `05_energy/` | policy/scheduling state machines |
| `06_pipeline/` | part-flow and dispatch coordination |
| `07_folderized/` | state/transition Lua split for maintainable large models |
| `08_esp32/` | ESP32 serial and IDE imports, including OLED/PWM/LED demos |
| `09_mcxn947/` | FRDM-MCXN947 GPIO, touch, temperature, and binding demos |
| `10_guarded_cell/` | multi-board guarded actuation chain |
| `11_bidirectional_loop/` | cross-device ESP32/MCXN947/host feedback loop |
| `12_black_box/` | Docker black-box probe and contract smoke |
| `13_petri_signal_chain/` | Petri-liftable command/safety/drive/telemetry pipeline |
| `14_petri_contention/` | shared-resource contention network |
| `15_aetherium_gem/` | flagship all-capabilities single-cell scenario |
| `16_host_ping_pong/` | host-to-host signal routing smoke |
| `17_host_nxp/` | host stochastic beacon routed to FRDM-MCXN947 LEDs |

## Curated Validation Catalog

List the catalog:

```bash
scripts/validate_showcase_automata.sh list
```

Validate the catalog:

```bash
scripts/validate_showcase_automata.sh validate
```

Use a non-default engine binary:

```bash
AETHERIUM_ENGINE_BIN=/abs/path/to/aetherium_engine scripts/validate_showcase_automata.sh validate
```

The catalog intentionally focuses on scenarios that should validate in the desktop CLI. Hardware-specific showcase files can require board libraries, serial devices, or IDE context.

## IDE Project Regeneration

After editing showcase YAML that is part of the flagship IDE project:

```bash
node scripts/generate_ide_demo_projects.cjs
```

This rewrites:

- `example/ide_demo_projects/backend-capabilities-tour.aeth`
- `example/ide_demo_projects/showcase/**/*.aeth`
- `example/ide_demo_projects/examples/**/*.aeth`
- `example/automata/showcase/**/*.aeth`
- `NewProject.aeth`

## Hardware Notes

For OLED-backed ESP32 showcases, install Arduino dependencies first:

```bash
cd src
make esp-deps
```

For FRDM-MCXN947 serial demos:

```bash
cd src
make mcxn947-build
make mcxn947-flash MCXN947_PORT=/dev/cu.usbmodem...
make mcxn947-server MCXN947_PORT=/dev/cu.usbmodem...
```
