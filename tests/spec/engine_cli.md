---
title: Engine CLI Spec (Initial)
---

# Engine CLI — Initial Spec

This spec defines the minimal CLI behavior targeted for the first milestone to support local runs and CI.

## Commands / Options

- `--help`
  - Exit code: 0
  - Output: Usage synopsis and available options, including `--validate` and `--version`.

- `--version`
  - Exit code: 0
  - Output: `Aetherium Engine <semver> (YAML spec <ver>)` or similar string containing a version number.

- `--validate <path/to/automata.yaml>`
  - Exit code: 0 if the YAML is syntactically valid and conforms to the Automata spec; non‑zero otherwise.
  - Output (success): Short confirmation (e.g., `valid`), optional warnings.
  - Output (failure): A helpful error message describing the first error found (schema/semantic), with a non‑zero exit code.

- `--run <path/to/automata.yaml> --trace-file <path>`
  - Exit code: 0 when the engine run completes and the trace file is written.
  - Output: Execution summary plus the trace file path.
  - Trace file:
    - JSONL
    - Contains deployment metadata (`instance_id`, `placement`, `transport` via per-record fields)
    - Contains black-box contract records and black-box port/state annotations when declared
    - Carries simulated deployment health metadata such as battery level and latency budget
    - Contains runtime and protocol-boundary events
    - Contains fault annotations when a validation profile injects delay/drop/duplicate behavior

- Deployment and validation flags
  - `--instance-id`, `--placement`, `--transport`, `--control-plane-instance`
  - `--fault-*` flags for local validation profiles
  - `--battery-*` flags for deployment-energy simulation
  - `--latency-*` flags for deployment latency budgets/warnings

## Notes

- No execution occurs in `--validate` mode; only parsing/validation.
- Initial deployment/fault/battery/latency flags are local-engine metadata and simulation controls, not full board orchestration.
