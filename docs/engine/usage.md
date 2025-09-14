---
title: Engine Usage
---

# Engine Usage

This guide covers building and running the Engine on host and MCU targets, runtime configuration, lifecycle, and error handling.

## Build Targets

- Host (PC): Build a CLI runner that loads a YAML automata file and executes it locally. Useful for simulation, testing, and integration with the IDE.
- MCU: Link the Engine library into firmware. Provide HAL and transport implementations appropriate for the target board/RTOS.

## Configuration

- Tick Rate: 1–1000 Hz depending on workload and timing requirements
- Resource Limits: max states, transitions, timers, message size and queues
- Logging: off/minimal/verbose; category filters
- Transports: select and configure (serial baud, UDP ports, WS URL)

## Lifecycle

1) Initialize: Create an Engine instance with HAL, transport(s), and limits
2) Load: Supply validated YAML or a precompiled model; receive a run_id
3) Start: Begin execution; scheduler activates initial state(s)
4) Control: pause/resume, inject events, set variables, request snapshot
5) Stop/Reset: Graceful stop; optional wipe for re‑provisioning

## Using on PC

- Provide the path to an automata YAML file (see docs/Automata_YAML_Spec.md)
- Optionally enable a local WebSocket or UDP transport for control/telemetry
- Observe logs/metrics/state in the console or via tools/IDE

## Using on MCU

- Implement HAL for time, I/O, storage, and chosen transport
- Provide automata model as an embedded blob or stream from Controller
- Configure minimal logging and telemetry sampling to meet real‑time constraints

## Error Handling

- Loader/Validator errors: schema violations, dangling states, resource limits, missing I/O bindings
- Runtime errors: fatal vs recoverable with structured codes and context
- Telemetry includes error events; controller and servers can aggregate

## Versioning

- Engine ABI version, YAML spec version, automata model version
- Compatibility is checked during load and at handshake on the control plane

## Safety Notes

- Keep actions short and non‑blocking; use timeouts
- Use guards to validate inputs before side effects
- Prefer periodic telemetry snapshots to verbose logging on MCU

