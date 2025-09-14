---
title: Architecture Overview
---

# Aetherium Automata — Architecture Overview

This document describes the high‑level system, roles, and data flows. It clarifies boundaries so each component can evolve independently.

## Components

- Engine (Device/Host): Executes automata definitions deterministically on MCU or PC. Exposes a minimal control/telemetry interface.
- Servers (Core/Edge): Manage fleets, route commands, buffer telemetry, and maintain durable state as needed.
- Controller (Gateway): The only externally reachable node. Performs discovery, provisioning, flashing, upgrades, and bridges authenticated access for tools/IDE.
- IDE (Browser): React app for authoring, simulation, deployment, and monitoring.

## Data Planes

- Control Plane: Discovery, capabilities, provisioning, lifecycle (load/start/stop/reset), configuration, health.
- Data Plane: Telemetry (metrics/logs/events), state snapshots, optional streamed diagnostics.

## Identity and Versioning

- Device ID (stable, provisioned by Controller)
- Instance ID (per engine process on a device)
- Run ID (per automata load)
- Versions: Engine ABI, YAML spec, Automata model

## Reliability & Backpressure

- Control plane: At‑least‑once with idempotent commands using version/run IDs
- Data plane: Batching with window control and retry‑after hints; local FIFO buffers when feasible on device

## Security Model

- Controller is the sole external ingress; devices initiate outbound where possible
- Pluggable transport auth: PSK (MCU), mTLS (host), token‑based (WS)
- Key rotation and time sync via Controller

## Transport Abstraction

The protocol is transport‑agnostic. Typical transports:

- Serial (CBOR/MsgPack)
- UDP (CBOR/JSON)
- WebSocket (JSON)

## Responsibilities and Boundaries

- Engine: Deterministic execution, minimal messaging, HAL abstraction. Non‑goals: discovery, orchestration, long‑term storage.
- Servers: Registry, routing, policies, durable telemetry, automation (rollouts/rollbacks).
- Controller: Discovery, provisioning, flashing, authenticated bridge to IDE. No real‑time guarantees.
- IDE: Authoring, visualization, ops workflows via Controller/Servers APIs.

See also: docs/engine/README.md, docs/protocol/overview.md, docs/controller/README.md, docs/servers/README.md.

