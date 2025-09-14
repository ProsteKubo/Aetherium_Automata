# Aetherium_Automata
A Visual Automata Framework for building and managing self-adaptive IoT networks. Features a visual TDD environment, a plugin ecosystem for hardware and protocols, and native ROS2 integration.

# Aetherium Automata: Visual Automata Framework for Self-Adaptive Networks
<p align="center">
  <img src="https://your-logo-url-here.com/logo.svg" alt="Aetherium Automata Logo" width="150"/>
</p>

<p align="center">
  <a href="https://github.com/your-username/Aetherium-Automata/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="#"><img src="https://img.shields.io/badge/status-in%20development-blue" alt="Project Status"></a>
  <a href="#"><img src="https://img.shields.io/github/actions/workflow/status/your-username/Aetherium-Automata/ci.yml?branch=main" alt="Build Status"></a>
</p>


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
