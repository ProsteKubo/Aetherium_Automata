---
title: Controller
---

# Controller — Role and Interfaces

The Controller is the only externally reachable component. It discovers devices, provisions them, deploys firmware/automata, and exposes authenticated APIs for the IDE and tools.

## Responsibilities

- Discovery: scan transports, collect `hello`, maintain a live registry
- Provisioning: assign device IDs, install keys/certs, labels, time sync
- Deployments: flash firmware, load automata, pin engine/YAML versions
- Bridge: expose HTTP/WS API for IDE and tooling; translate to device protocol
- Aggregation: collect metrics/logs/state; forward upstream to Servers if present

## Non‑Goals

- Real‑time runtime control beyond orchestrated commands
- Durable, long‑term storage beyond cache/buffer

## External APIs (to IDE/Tools)

- REST/WS: list devices, capabilities, deploy automata, observe state, inject events
- Auth: user authentication and RBAC (distinct from device auth)

## Internal Interfaces (to Devices/Servers)

- Devices: speak the Engine protocol over configured transports
- Servers: optional northbound APIs for fleet management and durability

