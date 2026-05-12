---
title: Engine Overview
---

# Engine Overview

The engine executes YAML-defined EFSM automata on host and embedded targets. In the current product slice it is exercised as a local validator, a Docker desktop runtime, a Docker black-box runtime, and a shared runtime core for ESP32/FRDM-MCXN947 firmware.

## Scope

- Parse and validate automata YAML.
- Execute state hooks and transition logic with Lua support on host-class targets.
- Provide deterministic scheduling, seeded randomness, and trace-friendly execution.
- Expose lifecycle commands: load, start, pause, resume, stop, reset, status.
- Emit snapshots, transition records, telemetry, and black-box contract metadata.
- Isolate platform concerns behind clock, random source, script engine, and transport/platform adapters.

## Guarantees

- Atomic transition semantics and guarded actions.
- Deterministic probabilistic choices when seeded.
- Validation catches dangling state references and malformed core structure before deployment.
- The same automata model is used by the desktop, Docker, and embedded paths.

## Non‑Goals

- Visual editing and project management; this belongs to the IDE.
- Fleet orchestration and durable trace storage; this belongs to server/gateway services.
- Long-term analytics dashboards; this belongs to the optional InfluxDB/Grafana stack.
- Firmware flashing/provisioning policy; board Makefile targets and host connectors handle that workflow.

## Key Concepts

- Automata: states, transitions, guards, actions, timers, variables, and I/O bindings.
- Transition types: classic, timed, event, probabilistic, and immediate.
- Runtime: loader, validator, scheduler, executor, trace metadata.
- Black-box contract: public ports, observable states, emitted events, and resources.
- Transport/platform layer: host WebSocket/Docker, serial hardware paths, and embedded board adapters.

## Portability Targets

- Host desktop/Docker runtime.
- ESP32 Arduino runtime path.
- FRDM-MCXN947 serial runtime path.
- Raspberry Pi Pico remains a target direction, but the current documented hardware smoke paths are ESP32 and MCXN947.

## Observability

- Current state and variable snapshots.
- Transition-fired records.
- Deployment metadata such as placement, transport, battery, and latency annotations.
- Fault actions applied at communication boundaries.
- Black-box contract records for opaque participants.

See docs/engine/usage.md for build and runtime usage.
