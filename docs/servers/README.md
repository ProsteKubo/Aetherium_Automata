---
title: Servers
---

# Servers — Fleet Management and Orchestration

Servers coordinate fleets of Engine instances, enforce policies, and provide durability for telemetry and audit.

## Responsibilities

- Device Registry: identities, capabilities, labels, versions
- Routing: fan‑out commands; fan‑in telemetry with buffering and retries
- Observability: dashboards, logs, alerts; export to external systems
- Automation: scheduled commands, staged/blue‑green deployments, rollbacks

## Interfaces

- Northbound: APIs for Controller and IDE
- Southbound: device protocol terminators/relays via supported transports

## Scaling Model

- Stateless gateways in front; durable queue+store backends
- Horizontal scale for routing; sharding by device/tenant as needed

## Non‑Goals

- Real‑time, on‑device execution semantics; that remains within the Engine

