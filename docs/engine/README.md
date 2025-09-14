---
title: Engine Overview
---

# Engine — Scope, Guarantees, and Non‑Goals

The Engine executes YAML‑defined automata deterministically on MCU‑class devices and PCs. It provides a small, portable runtime with a narrow messaging surface.

## Scope

- Parse/validate automata YAML (see docs/Automata_YAML_Spec.md)
- Deterministic scheduler (tick/step) and executor
- I/O abstraction via a HAL (time, digital/analog I/O, timers, storage)
- Minimal message pump for control/telemetry, transport‑agnostic
- Lifecycle: initialize, load, start, pause/resume, stop/reset
- Observability: state changes, metrics, logs, events

## Guarantees

- Deterministic step execution within a configurable tick budget
- Bounded memory/stack targets; static allocation mode for MCU
- Atomic transition semantics and guarded actions
- Transport‑agnostic via adapter interface (serial/UDP/WebSocket)

## Non‑Goals

- UI/IDE, network orchestration, discovery, or fleet management
- Long‑term persistence beyond optional host‑provided KV
- Security policy beyond transport‑level auth hooks
- Firmware update or provisioning workflows (hooks only)

## Key Concepts

- Automata: States, transitions, guards, actions, timers, I/O bindings
- Runtime: Loader, Validator, Scheduler, Executor
- HAL: Implementations for timebase, I/O, timers, storage, randomness
- Transport: RX/TX queues with backpressure; pluggable adapters

## Portability Targets

- Host (PC): POSIX/Windows with steady_clock timebase
- MCU: Bare‑metal/RTOS via HAL; optional static allocation profile

## Observability

- Metrics: tick duration, queue depths, transitions/s, drops, heap watermark
- Logs: leveled, structured categories
- Events: state_enter/exit, guard_fail, action_error, io_fault

See docs/engine/usage.md for build and runtime usage.

