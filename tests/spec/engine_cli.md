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

## Notes

- No execution occurs in `--validate` mode; only parsing/validation.
- Future: add `run <yaml>` with `--transport` flags, but not required for this milestone.

