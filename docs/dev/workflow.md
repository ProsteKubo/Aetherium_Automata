---
title: Dev Workflow
---

# Development Workflow

This guide documents build, test, simulation, CI, and release practices across host and MCU targets.

## Build

- Host: standard builds for development and simulation
- MCU: board/RTOS profiles with HAL and optional static allocation

## Test

- Unit tests: loader, validator, scheduler, transport adapters
- Simulation: deterministic seeds, time scaling, golden traces
- HIL: run on dev boards; record/compare state/telemetry traces

## CI

- Lint, format, unit tests
- Validate sample YAMLs against docs/Automata_YAML_Spec.md
- Package host artifacts for quick local runs

## Release

- Semantic versions per component (engine, controller, servers, protocol)
- Compatibility matrix: engine × YAML spec × protocol
- Artifacts: host binaries, MCU libs, protocol schema/IDL

## Local Dev Loop

1) Edit YAML → validate
2) Simulate on host → inspect logs/state
3) Deploy to device via Controller
4) Observe telemetry → iterate

