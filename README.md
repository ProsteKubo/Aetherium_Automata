# Aetherium_Automata
A Visual Automata Framework for building and managing self-adaptive IoT networks. Features a visual TDD environment, a plugin ecosystem for hardware and protocols, and native ROS2 integration.

# Aetherium Automata: Visual Automata Framework for Self-Adaptive Networks
<p align="center">
  <img src="https://img.shields.io/badge/status-in%20development-blue" alt="Project Status">
</p>

Current focus:
- keep the current `gateway + server + engine + IDE` architecture
- tighten the canonical runtime/deploy/replay workflow
- prioritize host runtime and ESP32 over breadth-first platform expansion


# Autonomous IoT Engine: Visual Automata Framework for Self-Adaptive Networks

## Core Problem
IoT networks need **visual, extensible automata engines** for adaptive behavior modeling. Existing solutions lack:
1. **Real-time visual design** with TDD-driven development cycles.
2. **Plugin-based extensibility** for diverse hardware and communication protocols.
3. **Hierarchical automata composition** (automata within automata).
4. **Remote deployment pipelines** for distributed IoT ecosystems.

---

## Technical Objectives
1. Build a **visual automata engine** with real-time TDD capabilities and network visualization.
2. Develop **plugin-extensible architecture** for hardware, middleware, and communication protocols.
3. Enable **ROS2 integration** and **nested automata** for complex behavior modeling.
4. Create **remote deployment tools** for distributed IoT network management.
5. **Configurable size** for different iot devices where certain features can be turned off for space savings 
---

## Documentation
- Automata YAML format: see `docs/Automata_YAML_Spec.md` for the current spec, examples (inline and folder layouts), and validation rules.
- Lua Runtime API: see `docs/Lua_Runtime_API.md` for available helpers (`check`, `value`, `setVal`, etc.) and valid script entry points.

---

## Docker Development Workflow (Fast Iteration)

All commands below assume:

```bash
cd /Users/administratorik/dev/Aetherium_Automata/src
```

Important naming note:
- `docker compose` uses **service names** from compose file: `gateway`, `server3`, `device1`, `blackbox1`.
- `docker ps` shows **container names**: `elixir-gateway`, `elixir-server-3`, `cpp-device-1`, `cpp-blackbox-1`.
- For compose commands, use service names, not container names.

ESP32 + Docker on macOS:
- Docker Desktop on macOS does not reliably expose host USB serial devices (`/dev/cu.*`) to Linux containers.
- For real ESP32 serial testing, run the server on the host (not in Docker): `cd src && make esp-server`.
- You can still keep gateway/IDE in Docker if desired.

### Recommended (short) commands

Use the helper Makefile:

```bash
make help
make u          # up
make ug         # gateway only (hybrid mode)
make ubb        # gateway + server3 + blackbox1
make r          # restart gateway+server3+device1
make l0         # fresh logs only
make rb-device  # rebuild/recreate device only
make rbb        # rebuild/recreate blackbox1 only
make esp-flash  # compile + upload ESP32 sketch
make esp-server # run host server with ESP32 serial connector
make esp-demo   # run host ESP32 time-travel demo
```

For host-server + docker-gateway hybrid mode, `make esp-*` defaults to:
- `GATEWAY_WS_URL=ws://localhost:8080/socket/websocket`
- override if needed: `make esp-server ESP_GATEWAY_WS_URL=ws://localhost:4000/socket/websocket`

### Raw compose equivalents

First start:

```bash
docker compose up -d gateway server3 device1
docker compose logs -f --tail=100 gateway server3 device1
```

Black-box sandbox stack:

```bash
docker compose up -d gateway server3 blackbox1
docker compose logs -f --tail=100 gateway server3 blackbox1
docker compose exec -T server3 sh -lc "cd /app && mix aetherium.black_box.smoke --gateway-url ws://172.20.0.10:4000/socket/websocket --device-id black_box_01 --server-id svr_03"
```

Sample deployable contract:

`example/automata/showcase/12_black_box/docker_black_box_probe.yaml`

Fast loop by component:

1. Gateway (Elixir code changes):
```bash
docker compose restart gateway
```

2. Server (Elixir code changes):
```bash
docker compose restart server3
```

3. Device/Engine (C++ changes):
```bash
docker compose build device1
docker compose up -d --no-deps --force-recreate device1
```

Clean restart + fresh logs:

```bash
docker compose restart gateway server3 device1
docker compose logs -f --tail=0 gateway server3 device1
```

### ROS2 Connector Modes (Docker)

From `src/`:

1. Actual device mode (bridge only):
```bash
make up-ros2
make logs-ros2
```

2. Full demo mode (bridge + emulator + sensor):
```bash
make up-ros2-demo
make logs-ros2-demo
```

Reference runbook: `docs/dev/ros2_connector_demo.md`

### Time-Series Mode (Docker, InfluxDB)

From `src/`:

```bash
make up-ts
make logs-ts
make test-ts
```

This starts `gateway + server3 + device1 + influxdb` and enables server-side Influx timeline streaming (`ENABLE_TIME_SERIES_INFLUX=1`) for time-travel data export.
Grafana is also exposed on `http://localhost:3000` with the preprovisioned Aetherium dashboards.

### Showcase Automata Catalog

A curated, categorized set of demo/test automata is available in:

`example/automata/showcase`

Quick commands:

```bash
scripts/validate_showcase_automata.sh list
scripts/validate_showcase_automata.sh validate
```

Catalog docs:

`example/automata/showcase/README.md`

### When to use full reset

Use only if environment/state is broken:

```bash
docker compose down
docker compose up -d gateway server3 device1
```

Use this only when you explicitly want to wipe cached deps/build volumes (slow next start):

```bash
docker compose down -v
docker compose up -d gateway server3 device1
```

---

## Milestones

### Milestone 1: Core Automata Engine
**Goal**: Build the foundational automata execution engine with fuzzy-probabilistic transitions.  
**Technical Steps**:
- Implement hybrid state machines with fuzzy guards and probabilistic transitions.
- Support nested automata (automata-in-automata) for hierarchical behavior and black box with right inputs and outputs.
- Create YAML schema for automata serialization and versioning.  
**Outcome**: High-performance automata runtime with nested composition support.

---

### Milestone 2: Visual TDD Environment
**Goal**: Real-time visual automata designer.
**Technical Steps**:
- Build drag-and-drop automata designer with visual state flow.
- Implement **live testing** with state replay and coverage visualization.
- Add **network topology view** showing device relationships and data flows.
- Enable **time-travel debugging** with state history navigation.  
**Outcome**: Full-featured IDE for automata development with TDD workflow.

---

### Milestone 3: Plugin Extensibility Framework
**Goal**: Modular architecture for hardware, communication, and middleware extensions.  
**Technical Steps**:
- Design **plugin API** for communication protocols (MQTT, CoAP, LoRaWAN, Zigbee).
- Create **hardware abstraction layer** for sensors, actuators, and embedded systems.
- Implement **middleware plugin system** for data processing and filtering.
- Add **ROS2 communication bridge** for robotics integration.  
- Possible extension, communication between each other without server that is locally
**Outcome**: Extensible ecosystem supporting diverse IoT hardware and protocols.

---

### Milestone 4: Remote Deployment & Orchestration
**Goal**: Cloud-native deployment pipeline for distributed automata networks.  
**Technical Steps**:
- Build **containerized deployment** with orchestration support.
- Implement **over-the-air updates** for remote automata modification.
- Create **network discovery** and **auto-configuration** for new devices.
- Add **distributed monitoring** with real-time health dashboards.  
- After update automat continues from state it was in with variables, inputs and outputs **in tact**
**Outcome**: Production-ready deployment system for IoT automata networks.

---

### Milestone 5: Guardian Demonstration (Showcase)
**Goal**: Demonstrate framework capabilities with self-healing network showcase.  
**Technical Steps**:
- Implement consensus-based guardian automata using the core engine.
- Show attack detection and recovery using existing framework features.
- Simulate IoT threats with visual monitoring.  
- **Comparison** with 4diac Node Red

**Outcome**: Reference implementation showcasing framework's self-healing potential.

---

## Key Innovations
1. **Visual TDD for Automata**: Live testing with state coverage and time-travel debugging.
2. **Nested Automata Architecture**: Hierarchical composition for complex behavior modeling.
3. **Universal Plugin System**: Hardware, protocol, and middleware extensibility.
4. **ROS2 Integration**: Seamless robotics ecosystem compatibility.
5. **Remote Deployment Pipeline**: Cloud-native IoT network management.

---

## Expected Results
1. **Visual automata development** with 80% faster design cycles via TDD.
2. **Universal IoT compatibility** through plugin ecosystem.
3. **Production-ready deployment** with remote management capabilities.
4. **ROS2 ecosystem integration** for robotics applications.
5. **Open-source framework** for next-generation IoT automation.


## Possible improvements and extensions
1. Formal verification
2. Complexity index
3. Learning automata
4. Parallel execution
5. Petri net
6. WFST
