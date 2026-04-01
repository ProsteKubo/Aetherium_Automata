# Refocus Plan for Aetherium: Tighten the Current Architecture First

## Summary

The repo already contains real execution, orchestration, and tooling value. The problem is not that nothing works. The problem is that the active story is too broad for the current phase.

The next cycle should optimize for one coherent end-to-end slice:

**black-box automata + deployable runtime + replayable traces + operator-grade validation**

This refocus explicitly does **not** require switching to a server-first architecture right now. Gateway and server both stay in the system. The immediate goal is to clarify their responsibilities, reduce stale or misleading surface area, and harden the core semantics that already exist.

## Current State Analysis

- **What is solid already**
  - Engine core is real: runtime, parser/loader, protocol handling, CLI runner, trace export, and embedded hooks exist.
  - Server is real: connectors, device sessions, deployment flow, host runtime, target profiles, local time-series storage, replay, and analyzer groundwork are implemented.
  - Gateway is real: Phoenix channels, automata registry, connection manager, persistence, and command dispatch are implemented.
  - IDE is real: a large Electron/React workbench already talks to Phoenix and exposes authoring, runtime, and deployment surfaces.

- **What is slowing the project down**
  - The active story is wider than the canonical demo slice.
  - Some docs still describe mock or placeholder architecture that no longer matches the code.
  - Some IDE panels are ahead of the guaranteed live backend semantics they should depend on.
  - Too many hardware and transport paths are treated as equally active.
  - `DeviceManager` still carries too much orchestration responsibility in one module.

- **What is not necessary right now**
  - A server-first rewrite.
  - Promoting every transport and board family to equal priority.
  - Treating ROS2 or Influx/Grafana as required for the thesis-critical loop.
  - Growing topology/analyzer UI faster than the real trace/deployment data backing it.

## Implementation Changes

### 1. Keep the current shape, but make the split explicit

- Keep **gateway** as the northbound/authenticated IDE-facing layer:
  - automata registry
  - connection/binding management
  - operator session and channel entry
  - dispatch into server-side execution/orchestration paths
- Keep **server** as the southbound execution/orchestration layer:
  - device connectors
  - deployment/runtime control
  - runtime state projection
  - time-series capture and replay
  - analyzer inputs
- Do not move functionality across the boundary unless it removes a concrete duplication or confusion.

### 2. Pick the canonical active stack

- Primary stack for the next milestone:
  - host runtime
  - ESP32
  - WebSocket and serial
  - gateway + server
  - local built-in time-series store
- Secondary paths remain in-repo but are not roadmap drivers:
  - ROS2
  - MCXN947
  - AVR beyond smoke support
  - Influx/Grafana

### 3. Treat runtime semantics as the differentiator

- Prioritize:
  - deploy/start/stop/reset correctness
  - event/timed/classic transition behavior
  - trace metadata quality
  - black-box contract visibility
  - replay correctness
- Harden semantic checks before adding more UI breadth.
- Protocol v2 should continue to be the active forward path, while legacy behavior remains compatibility scaffolding where required.

### 4. Narrow the IDE roadmap to real-data-backed workflows

- Keep active:
  - automata editor
  - deploy/start/stop controls
  - runtime monitor
  - black-box inspection
  - replay/timeline inspection
  - minimal network/deployment view
- Mark as experimental until fully backed by live data:
  - broad topology storytelling
  - advanced analyzer views
  - optional observability integrations

### 5. Refactor incrementally instead of rewriting

- Split `DeviceManager` behind the current public behavior into collaborators such as:
  - device/session registry
  - deployment coordinator
  - runtime state projection
  - trace/replay coordinator
- Keep gateway and server APIs stable while the internals are separated.

### 6. Align docs with repo reality

- Remove stale mock-first descriptions.
- Stop using placeholder links, badges, and machine-specific absolute paths.
- Reword architecture status from aspirational language to implemented-core language.

## Milestone Order

- **Milestone 1: Canonical slice cleanup**
  - clarify gateway/server split
  - choose active stack
  - update docs and workflow defaults
- **Milestone 2: Semantic hardening**
  - transition/runtime correctness
  - deploy/control reliability
  - smoke and replay reliability
- **Milestone 3: Internal decomposition**
  - split large orchestration modules without changing architecture
- **Milestone 4: UI consolidation**
  - keep only the panels needed for the canonical slice as actively developed surfaces
- **Milestone 5: Extended analysis**
  - deepen analyzer and optional observability paths after the core loop is stable

## Test Plan

- **Runtime**
  - direct engine CLI validation
  - command smoke for control-plane/runtime semantics
  - trace export verification

- **Gateway + Server path**
  - deploy/start/stop/reset through Phoenix-backed flows
  - device state updates and deployment status propagation
  - replay/time-series query on local store

- **Hardware path**
  - host runtime smoke
  - ESP32 deploy/start/stop smoke over the chosen primary transport

- **IDE acceptance**
  - active panels must read live backend data
  - experimental panels must be clearly treated as non-canonical

## Assumptions and Defaults

- No server-first rewrite in this phase.
- Gateway remains first-class for now.
- The project should optimize for **coherence over breadth**.
- ESP32 is the primary embedded target.
- ROS2, Influx/Grafana, and extra targets stay available but optional.
- The unique value remains the runtime + deployment + replay loop, not the number of subsystems exposed at once.
