---
title: Dev Workflow
---

# Development Workflow

This guide documents the current local development loop across host, Docker, and board targets.

## Build

- Host engine: `cmake -S . -B build && cmake --build build -j4`
- Docker stack: `cd src && make up`
- IDE: `cd src/ide && npm run dev`
- ESP32/MCXN947: use the board targets in `src/Makefile`

## Test

- Validate curated showcase YAML: `scripts/validate_showcase_automata.sh validate`
- Python CLI checks: `pytest`
- Gateway/server suites: `mix test`
- IDE tests: `npm test`
- Hardware-in-the-loop smoke: `make esp-smoke`, `make mcxn947-smoke`, or `make serial-smoke`

## CI

- Build host engine.
- Run Python, Elixir, and IDE test suites.
- Validate curated showcase YAML and representative full example YAML.
- Regenerate IDE demo projects after showcase structure changes.

## Release

- Keep `README.md`, `docs/TESTING_GUIDE.md`, and showcase docs aligned with current commands.
- Regenerate `example/ide_demo_projects/backend-capabilities-tour.aeth` with `node scripts/generate_ide_demo_projects.cjs`.
- Rebuild thesis PDF when thesis text or figures change.

## Local Dev Loop

1. Edit YAML.
2. Validate with `scripts/validate_showcase_automata.sh validate` or `./build/aetherium_engine --validate <file>`.
3. Regenerate the IDE project if the flagship showcase changed.
4. Start `cd src && make up`.
5. Open the IDE and load `example/ide_demo_projects/backend-capabilities-tour.aeth`.
6. Deploy, observe, inject faults, rewind, and analyze.
