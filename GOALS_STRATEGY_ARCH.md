# Aetherium Automata: Goals, Strategies, Architecture & Validation

**Document Version**: 2.0 (Extended)  
**Date**: December 2025  
**Status**: Implementation Planning Phase

---

## Table of Contents

1. [Project Goals & Constraints](#project-goals--constraints)
2. [Speed-Focused Development Strategy](#speed-focused-development-strategy)
3. [Technology Selection Criteria & Decisions](#technology-selection-criteria--decisions)
4. [Architecture Tiers & Trade-offs](#architecture-tiers--trade-offs)
5. [Validation & Verification Framework](#validation--verification-framework)
6. [UI/UX Requirements & Specifications](#uiux-requirements--specifications)
7. [Risk & Mitigation Planning](#risk--mitigation-planning)
8. [Success Metrics & KPIs](#success-metrics--kpis)

---

## Project Goals & Constraints

### Primary Goals (Thesis Objectives)

| Goal | Priority | Delivery Timeline | Success Criteria |
|------|----------|-------------------|------------------|
| **DEVS + Fuzzy + Probabilistic Runtime** | P0 | Month 2 | Lua interpreter, state machine, fuzzy logic working on single device |
| **Visual Automata Designer** | P0 | Month 2 | Draw states, define transitions, edit Lua, local simulation |
| **Multi-device Communication** | P0 | Month 3 | 3+ ESP32/Pico devices communicating via MQTT, state synchronization |
| **Time-Travel Debugging** | P1 | Month 4 | Record traces, replay forward/backward, inspect state at any point |
| **ROS2 Integration** | P1 | Month 5 | Aetherium automata publishes/subscribes to ROS2 topics via DDS-XRCE |
| **Guardian Demo** | P1 | Month 5 | Self-healing network with 5-10 nodes, visual monitoring, TTD demo |
| **Formal Verification** | P2 | Month 6+ | UPPAAL/Spin integration, safety property proving |

### Hard Constraints

```
Development Timeline:    6-7 months (academic semester)
Team Size:              1 person (you) + advisors
Target Platforms:       ESP32, Raspberry Pi Pico, Linux (RPi 4 / x86)
Performance Target:     Real-time state transitions (<10ms on microcontroller)
Memory Budget:          Pico: 68KB RTE | ESP32: 150KB RTE | RPi: unbounded
Code Quality:           Production-ready, well-documented, open-source
Thesis Novelty:         DEVS + Fuzzy + TTD = unique combination
```

### Soft Constraints

```
Learning Curve:         Pragmatic (don't over-engineer)
Security:               TLS for MQTT, Lua sandbox, no injection vulnerabilities
Testing Coverage:       Unit tests for core engine, integration tests for distributed
Documentation:          Comprehensive README, API docs, tutorials
Community:              GitHub with issues, wiki, examples
```

---

## Speed-Focused Development Strategy

### The 80/20 Principle Applied to Aetherium

**Spend 80% effort on 20% of features that deliver 90% of value:**

| Phase | Duration | Core Features | Secondary Features | Deferred |
|-------|----------|---------------|-------------------|----------|
| **Phase 1** | Weeks 1-4 | Lua interpreter, FSM engine, local I/O | Documentation | Network, verification |
| **Phase 2** | Weeks 5-8 | MQTT comms, deployment pipeline, web UI | Coverage analysis | DDS, fuzzy learning |
| **Phase 3** | Weeks 9-12 | TTD recording/replay, topology view, simulation | Distributed TTD | Formal proofs |
| **Phase 4** | Weeks 13-16 | Fuzzy/probabilistic transitions, ROS2 bridge | Petri nets | Learning automata |
| **Phase 5** | Weeks 17-20 | Guardian demo, performance testing, hardening | Scaling to 1000s | Hybrid automata |
| **Phase 6** | Weeks 21-24 | Publication, thesis writing, code cleanup | Security hardening | Extended verification |

### MVP-First Approach

**Week 1 Deliverable**: Single Pico runs LED blinker automaton
```yaml
# minimal.yaml - 10 lines
automata:
  name: blinker
  states:
    ON: {}
    OFF: {}
  transitions:
    ON_to_OFF:
      from: ON
      to: OFF
      trigger: timeout
      guard: "return true"
```

**Week 2 Deliverable**: Visual designer (drag-drop states only)
**Week 3 Deliverable**: 2 Picos sending events via serial + MQTT
**Week 4 Deliverable**: Guardian anomaly detection + recovery

### Rapid Iteration Cycle

```
1. Code (4-6 hours)
   ├─ Write minimal implementation
   ├─ No over-engineering
   └─ Use existing libraries (Lua, MQTT, etc.)

2. Test (1-2 hours)
   ├─ Deploy to hardware
   ├─ Manual validation
   └─ Record working/failing

3. Learn (0.5 hours)
   ├─ What worked? What blocked?
   ├─ Adjust plan for next cycle
   └─ Update issues/notes

4. Commit (0.5 hours)
   ├─ Push to GitHub
   ├─ Document changes
   └─ Create next issue

Cycle time: ~6-8 hours (repeat 3x/week = 18-24 hours/week dev)
```

### Decision-Making Heuristics for Speed

| Situation | Fast Decision | Rationale |
|-----------|---------------|-----------|
| **Framework choice** | Use existing (Lua, Qt, React) | Don't invent; proven, documented |
| **Platform selection** | Pick 1 primary (ESP32) | Test once, generalize later |
| **Architecture questions** | Prototype 2 options, pick winner | Code > design docs |
| **Bug vs feature** | Always fix bug first | Broken core > missing feature |
| **Testing depth** | Happy path + 1 edge case | 80% coverage in 20% time |
| **Documentation** | Readme > wiki | Readme keeps you moving |
| **Perfection** | Good enough beats perfect | Ship fast, iterate faster |

---

## Technology Selection Criteria & Decisions

### Selection Criteria Framework

Each technology choice evaluated on:

```
1. Time-to-Integration (TTI):    Days to get working demo
2. Learning Curve (LC):           Days for team to be productive
3. Community Size (CS):           Stack Overflow questions, GitHub stars
4. Maintenance Burden (MB):       Lines of code you own / dependencies
5. Performance (PERF):            Can it hit target metrics?
6. Portability (PORT):            Works on Pico, ESP32, RPi, Linux?
7. Cost (COST):                   $ to buy/license (all MIT/Apache)
8. Risk (RISK):                   What if it fails mid-project?
```

### Architecture Decision Records (ADRs)

#### ADR-001: Lua for Automata Logic Scripting

**Status**: Accepted

**Context**:
- Automata need per-device scripting for guards, actions, fuzzy logic
- Alternatives: C++, Python, JavaScript, Lua

**Decision**: Use Lua embedded VM

**Rationale**:

| Criteria | Lua | C++ | Python | JavaScript |
|----------|-----|-----|--------|------------|
| TTI | ★★★★★ | ★★ | ★★★ | ★★★★ |
| LC | ★★★★★ | ★★ | ★★★★ | ★★★★ |
| PERF | ★★★★ | ★★★★★ | ★★ | ★★★ |
| PORT | ★★★★★ | ★★★★ | ★★★ | ★★★ |
| MB | ★★★★★ | ★★ | ★★★ | ★★ |
| CS | ★★★ | ★★★★★ | ★★★★★ | ★★★★★ |

**Consequences**:
- ✓ Fast embedding in C++ RTE (10KB overhead)
- ✓ Deterministic execution (no GC surprises)
- ✓ Tiny binary (<50KB full Lua 5.4)
- ✗ Smaller community vs Python/JavaScript
- ✗ Limited built-in libraries (mitigate with C bindings)

**Mitigation**:
- Provide standard library of helpers (fuzzyMembership, check, value, setVal)
- Document with examples
- Build templates for common patterns

---

#### ADR-002: MQTT for Edge Device Communication

**Status**: Accepted

**Context**:
- Distributed automata on 3-10 heterogeneous devices
- Alternatives: DDS, UDP, CoAP, gRPC

**Decision**: MQTT (Eclipse Mosquitto broker) + UDP mesh for local

**Rationale**:

| Criteria | MQTT | DDS | UDP | CoAP | gRPC |
|----------|------|-----|-----|------|------|
| TTI | ★★★★★ | ★★★ | ★★★★ | ★★★★ | ★★ |
| LC | ★★★★ | ★★ | ★★★ | ★★★ | ★★ |
| PERF | ★★★ | ★★★★ | ★★★★★ | ★★★★ | ★★★ |
| PORT | ★★★★★ | ★★★ | ★★★★★ | ★★★ | ★★★ |
| MB | ★★★★ | ★★ | ★★★★★ | ★★★★ | ★★ |
| CS | ★★★★★ | ★★★ | ★★★★★ | ★★★ | ★★★★ |

**Consequences**:
- ✓ Mature, proven, well-documented
- ✓ Runs on all platforms (ESP32 library: 60KB)
- ✓ Simple pub-sub semantics (easy to debug)
- ✓ QoS levels (at-most-once, at-least-once, exactly-once)
- ✗ Broker is single point of failure (mitigate: local mesh for critical devices)
- ✗ Not real-time (10-100ms latency acceptable for thesis)

**Complementary Choice**: UDP for local zero-latency control
- Devices on same WiFi: UDP multicast for events (<1ms)
- Devices over internet: MQTT to broker

---

#### ADR-003: React + Reactflow for Visual Designer

**Status**: Accepted

**Context**:
- Build web-based visual state machine editor
- Alternatives: d3.js, Cytoscape, custom Canvas, Excalidraw

**Decision**: React + Reactflow (state/transition graphs)

**Rationale**:

| Criteria | Reactflow | d3.js | Cytoscape | Canvas | Excalidraw |
|----------|-----------|-------|-----------|--------|-----------|
| TTI | ★★★★★ | ★★★ | ★★★★ | ★★ | ★★★★ |
| LC | ★★★★★ | ★★ | ★★★★ | ★★ | ★★★★ |
| PERF | ★★★★ | ★★★★ | ★★★ | ★★★★★ | ★★★★ |
| FEATURES | ★★★★★ | ★★★★★ | ★★★★ | ★★ | ★★★ |
| CS | ★★★★★ | ★★★★★ | ★★★★ | N/A | ★★★★ |

**Consequences**:
- ✓ Pre-built node/edge components (saves weeks)
- ✓ Snap-to-grid, dragging, zoom (works out of box)
- ✓ React state management (easier to extend)
- ✓ Excellent documentation and examples
- ✗ Overkill for very simple editors (ok, need features anyway)
- ✗ Bundle size: 800KB gzipped (acceptable for web app)

---

#### ADR-004: C++ RTE Core (Not Python/Go)

**Status**: Accepted

**Context**:
- Runtime must run on Pico (264KB RAM), ESP32 (520KB RAM), and Linux
- Need real-time event loop, deterministic execution
- Alternatives: C++, C, Rust, Go, Python

**Decision**: C++17 with POSIX abstraction layer

**Rationale**:

| Criteria | C++ | C | Rust | Go | Python |
|----------|-----|---|------|----|----|
| PERF | ★★★★★ | ★★★★★ | ★★★★★ | ★★★★ | ★★ |
| EMBED | ★★★★★ | ★★★★★ | ★★★★ | ★★ | ★ |
| TTI | ★★★★ | ★★★★ | ★★★ | ★★★★ | ★★★★ |
| LC | ★★★ | ★★★ | ★★ | ★★★★ | ★★★★★ |
| CS | ★★★★★ | ★★★★★ | ★★★★ | ★★★★ | ★★★★★ |

**Consequences**:
- ✓ Best performance and footprint
- ✓ Direct access to hardware (GPIO, SPI, I2C)
- ✓ No runtime overhead (no GC, no VM)
- ✓ Portable to all targets (with HAL)
- ✗ Longer development time than Python (mitigate: use modern C++, libraries)
- ✗ Memory management (mitigate: use RAII, smart pointers)

**Abstraction Strategy**:
```cpp
// Platform-independent RTE
class AutomataRuntime {
  EventQueue events;
  LuaVM lua;
  IOAbstractionLayer io;
  CommunicationLayer comm;
};

// Platform-specific implementations
#ifdef PLATFORM_PICO
  class IOAbstractionLayer_Pico { /* GPIO via Pico SDK */ };
  class CommunicationLayer_Pico { /* Serial + optional BLE */ };
#elif PLATFORM_ESP32
  class IOAbstractionLayer_ESP32 { /* GPIO via ESP-IDF */ };
  class CommunicationLayer_ESP32 { /* MQTT + I2C + SPI */ };
#elif PLATFORM_LINUX
  class IOAbstractionLayer_Linux { /* /dev/gpio + /sys/class */ };
  class CommunicationLayer_Linux { /* MQTT + ZMQ + UDP */ };
#endif
```

---

#### ADR-005: SQLite for Trace Storage (Not MongoDB/PostgreSQL)

**Status**: Accepted

**Context**:
- IDE backend needs to store automata traces, device states, test results
- Alternatives: SQLite, PostgreSQL, MongoDB, Redis

**Decision**: SQLite for single-machine, PostgreSQL for cloud (future)

**Rationale**:

| Criteria | SQLite | PostgreSQL | MongoDB | Redis |
|----------|--------|-----------|---------|-------|
| TTI | ★★★★★ | ★★★★ | ★★★★ | ★★★★★ |
| DEPLOY | ★★★★★ | ★★★ | ★★★ | ★★★★ |
| PERF | ★★★★ | ★★★★★ | ★★★ | ★★★★★ |
| QUERY | ★★★★★ | ★★★★★ | ★★★ | ★ |
| SCALE | ★★★ | ★★★★★ | ★★★★ | ★★★ |

**Consequences**:
- ✓ Zero setup (file-based database)
- ✓ Full SQL support (complex queries for traces)
- ✓ Portable (file shipped with project)
- ✗ Single-writer limit (mitigate: WAL mode, readonly replicas)
- ✗ Won't scale to 1000s of devices (Phase 5: migrate to PostgreSQL)

**Current Plan**: SQLite → PostgreSQL migration at 100 devices

---

#### ADR-006: WebSocket for IDE ↔ Backend Communication

**Status**: Accepted

**Context**:
- IDE needs real-time device state updates, trace streaming
- Alternatives: HTTP polling, WebSocket, gRPC-web, Server-Sent Events

**Decision**: WebSocket (bidirectional, real-time, simple)

**Rationale**:
- TTI: ★★★★★ (built into all browsers)
- Real-time: ✓ (true bidirectional)
- Debugging: ✓ (visible in browser devtools)
- Fallback: SSE for read-only traces (if WebSocket blocked)

---

### Tech Stack Summary

```
┌─────────────────────────────────────────────────────┐
│ Frontend (IDE): React 18 + TypeScript               │
│ • State: Zustand (lightweight Redux alternative)   │
│ • Graphs: Reactflow (state machine designer)        │
│ • Comms: WebSocket client library                   │
│ • Styling: Tailwind CSS (utility-first)             │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ Backend (IDE Server): Node.js + Express             │
│ • Language: TypeScript                              │
│ • DB: SQLite (local) / PostgreSQL (cloud)           │
│ • Process Mgmt: PM2 (keep server running)           │
│ • Compilation: Automata YAML → Binary               │
│ • Verification: Shell out to UPPAAL (Phase 6)       │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ Runtime (RTE): C++17 + Lua 5.4                      │
│ • Core: Event-driven state machine interpreter      │
│ • Scripting: Lua for guards, actions, fuzzy logic   │
│ • Communication: MQTT (PahoC), UDP, Serial          │
│ • Hardware: GPIO, I2C, SPI abstraction layer        │
│ • Platforms: Pico (FreeRTOS), ESP32 (FreeRTOS),     │
│              Linux (raw or systemd)                 │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ Testing: Python + pytest + Coverage                 │
│ • Unit: RTE core functions                          │
│ • Integration: Multi-device simulation              │
│ • End-to-End: Guardian demo on physical hardware    │
└─────────────────────────────────────────────────────┘
```

---

## Architecture Tiers & Trade-offs

### Tier 0: Core Runtime Engine (All Platforms)

```cpp
// Minimal, portable automata runtime
class AutomataEngine {
  // YAML parser → FSM model
  FSM loadAutomata(const string& yaml_spec);
  
  // Event-driven execution
  void onEvent(const Event& e);
  void processInternalTransitions();
  
  // Lua scripting for guards, actions
  LuaVM lua;
  
  // State history for time-travel
  CircularBuffer<StateSnapshot> trace_buffer;
};

// Footprint: ~60KB (Pico), ~100KB (ESP32)
// Dependencies: Lua 5.4 (~30KB), YAML parser (~15KB)
```

**Must-Have Features**:
- ✓ Parse YAML automata specification
- ✓ Execute state transitions with Lua guards
- ✓ Handle fuzzy membership evaluation
- ✓ Manage probabilistic branching
- ✓ Queue and dispatch events deterministically
- ✓ Record state snapshots (circular buffer)

**Non-Goals**:
- ✗ GUI (that's Tier 3)
- ✗ Networking (that's Tier 1)
- ✗ Formal verification (that's Tier 2)

---

### Tier 1: Communication & Deployment (Edge Devices)

```
Device: ESP32 or Raspberry Pi Pico W

Components:
├─ Tier 0: AutomataEngine (60-100KB)
├─ MQTT Client (60KB, Eclipse Paho)
├─ Serial/I2C/SPI Drivers (20KB, platform SDK)
└─ OTA Update Handler (15KB, custom)

Total: ~155-195KB available on Pico (264KB total)

Capabilities:
✓ Deploy automata from IDE
✓ Execute locally with MQTT publish/subscribe
✓ Send state updates + trace segments to broker
✓ Receive commands from IDE or other devices
✓ Recover state after restart (stateful OTA)
```

**Workflow**:
```
1. IDE compiles automata.yaml → automata.bin (40KB)
2. IDE sends MQTT "deploy" message with binary
3. Device receives, flashes to SPIFFS/LittleFS
4. Device reboots, loads automata from flash
5. Automata starts executing, publishes events
6. IDE receives events, updates visualization
```

---

### Tier 2: IDE Backend & Orchestration (Linux/Docker)

```
Server: Raspberry Pi 4 or Linux PC

Components:
├─ Express.js HTTP server (20MB Node.js)
├─ WebSocket handler (real-time updates)
├─ MQTT broker (Mosquitto, 10MB)
├─ SQLite database (trace storage)
├─ Device registry (devices/automata mapping)
├─ Automata compiler (YAML → binary)
├─ Trace aggregator (gather traces from devices)
└─ Formal verification interface (UPPAAL integration)

Total: ~100MB disk, 500MB RAM typical

Capabilities:
✓ Project management UI backend
✓ Compile automata YAML
✓ Deploy to multiple devices
✓ Receive and store traces
✓ Reconstruct time-travel state
✓ Validate properties (later)
```

---

### Tier 3: Visual IDE (Web Browser)

```
Client: Any web browser (Chrome, Firefox, Safari)

Components:
├─ React 18 application (800KB gzipped)
├─ Reactflow state machine designer
├─ Real-time trace player (time-travel UI)
├─ Device topology visualization
├─ Lua code editor (Monaco)
├─ Coverage analysis view
└─ System monitoring dashboard

Capabilities:
✓ Visual automata design (drag-drop states)
✓ Edit Lua code for guards/actions
✓ Deploy to devices
✓ Live monitoring (real-time state updates)
✓ Time-travel debugging (scrub through trace)
✓ View device network topology
✓ Inspect variable values at any point in time
```

---

### Trade-off Matrix: Feature Completeness vs Development Time

| Feature | Tier 0 | Tier 1 | Tier 2 | Tier 3 | Dev Time |
|---------|--------|--------|--------|--------|----------|
| **Parse YAML** | ✓ | - | - | - | 4 days |
| **Execute FSM** | ✓ | - | - | - | 3 days |
| **Fuzzy Logic** | ✓ | - | - | - | 2 days |
| **GPIO I/O** | ✓ | ✓ | - | - | 3 days |
| **MQTT Comms** | ✓ | ✓ | ✓ | - | 5 days |
| **State History** | ✓ | ✓ | ✓ | - | 3 days |
| **Web UI** | - | - | ✓ | ✓ | 10 days |
| **Time-Travel** | - | - | ✓ | ✓ | 8 days |
| **ROS2 Bridge** | - | - | ✓ | - | 5 days |
| **Formal Verify** | - | - | ✓ | - | 10 days |

**Total MVP (Tiers 0-2 + basic Tier 3)**: ~50-60 days (2 months)

---

## Validation & Verification Framework

### Level 1: Unit Tests (RTE Core)

**Target**: 80% code coverage on AutomataEngine

```cpp
// test_automata_engine.cpp
#include <gtest/gtest.h>

TEST(AutomataEngine, ParseBasicYAML) {
  string yaml = R"(
    automata:
      name: test
      states:
        IDLE: {}
        ACTIVE: {}
  )";
  
  FSM fsm = AutomataEngine::parseYAML(yaml);
  EXPECT_EQ(fsm.states.size(), 2);
  EXPECT_TRUE(fsm.hasState("IDLE"));
}

TEST(AutomataEngine, ExecuteTransition) {
  FSM fsm = buildTestFSM();
  fsm.setCurrentState("IDLE");
  
  Event ev = Event("trigger", {});
  fsm.onEvent(ev);
  
  EXPECT_EQ(fsm.getCurrentState(), "ACTIVE");
}

TEST(AutomataEngine, FuzzyMembership) {
  double val = 85.0;
  double doa = fuzzyMembership(val, "HIGH", {80, 100});
  EXPECT_NEAR(doa, 0.25, 0.01);  // (85-80)/(100-80) = 0.25
}

TEST(AutomataEngine, CircularTraceBuffer) {
  CircularBuffer<StateSnapshot> buf(100);
  for (int i = 0; i < 150; i++) {
    buf.push(StateSnapshot{i, "STATE_" + to_string(i%5)});
  }
  EXPECT_EQ(buf.size(), 100);  // Only last 100
}
```

**Tool**: Google Test (gtest)  
**Execution**: `make test`  
**Frequency**: On every commit (CI/CD)

---

### Level 2: Integration Tests (Single Device)

**Target**: Core workflows on actual hardware

```python
# test_integration_pico.py (with hardware connected via serial)
import serial
import time
import json

def test_pico_blinker_automaton():
    """Deploy blinker automaton to Pico, verify LED state"""
    device = PicoDevice("/dev/ttyACM0", 115200)
    
    # 1. Upload automata.bin
    automata = load_yaml("examples/blinker.yaml")
    device.upload_firmware(automata)
    
    # 2. Query current state
    state = device.get_state()
    assert state == "OFF" or state == "ON"
    
    # 3. Monitor LED for 5 seconds
    led_states = device.monitor_gpio(pin=25, duration=5)
    
    # Should toggle every 1 second
    toggles = count_transitions(led_states)
    assert 4 <= toggles <= 6, f"Expected ~5 toggles, got {toggles}"
    
    print("✓ Pico blinker test passed")

def test_esp32_mqtt_publish():
    """Deploy MQTT-publishing automaton to ESP32"""
    device = ESP32Device("192.168.1.100", password="admin")
    broker = MQTTBroker("localhost", 1883)
    
    # Deploy automaton that publishes temp event every 2 seconds
    device.upload_firmware("examples/temp_sensor.yaml")
    
    # Listen for messages
    messages = broker.subscribe("test/temperature", timeout=10)
    
    # Should receive ~5 messages in 10 seconds
    assert len(messages) >= 4, f"Expected ~5 msgs, got {len(messages)}"
    
    print("✓ ESP32 MQTT test passed")
```

**Tool**: pytest + custom device drivers  
**Hardware**: Pico, ESP32, Serial/WiFi connectivity  
**Execution**: `pytest tests/integration/`  
**Frequency**: Before major release (weekly)

---

### Level 3: Multi-Device Validation

**Target**: Distributed system correctness

```python
# test_distributed_control.py
def test_guardian_3device_system():
    """Test: Detect anomaly on Device A, trigger recovery on Device B"""
    
    # Setup
    mqtt_broker = start_mosquitto()
    device_a = PicoDevice()  # Sensor node
    device_b = ESP32Device()  # Processing node
    device_c = RPiDevice()    # Actuator node
    
    # Deploy automata
    device_a.deploy("examples/guardian/sensor.yaml")
    device_b.deploy("examples/guardian/detector.yaml")
    device_c.deploy("examples/guardian/recovery.yaml")
    
    # Simulate anomaly: inject high temperature spike
    device_a.simulate_sensor_reading(45.0)  # Spike!
    
    # Wait for event propagation
    time.sleep(2)
    
    # Verify
    assert device_b.state == "ANOMALY_DETECTED"
    assert device_c.state == "RECOVERY"
    assert device_a.gpio(LED) == HIGH  # Status LED on
    
    # Verify trace chain
    trace_a = device_a.get_trace()
    trace_b = device_b.get_trace()
    
    # B's anomaly detection should follow A's sensor read
    assert trace_b[0].timestamp > trace_a[-1].timestamp
    assert trace_b[0].message == "ANOMALY_DETECTED"
    
    print("✓ Guardian 3-device test passed")
```

**Scenarios to Validate**:
1. **Happy Path**: Automata deploy, execute, communicate correctly
2. **Fault Injection**: Device offline → system handles gracefully
3. **Packet Loss**: 10% MQTT packet loss → system recovers
4. **Timing**: Events delivered in correct causality order
5. **State Consistency**: Device state matches expected after N transitions

---

### Level 4: Performance Benchmarks

**Target**: Meet real-time requirements

```cpp
// bench_automata.cpp (using Google Benchmark)
#include <benchmark/benchmark.h>

static void BM_StateTransition(benchmark::State& state) {
  FSM fsm = createLargeAutomata(100);  // 100 states
  Event ev = Event("trigger", {});
  
  for (auto _ : state) {
    fsm.onEvent(ev);
  }
}
BENCHMARK(BM_StateTransition)
  ->Unit(benchmark::kMillisecond)
  ->Iterations(1000);

// Expected output:
// BM_StateTransition        1234 us  (1.2 ms per transition)
```

**Targets**:
- **State Transition**: <5ms (includes Lua guard evaluation)
- **MQTT Publish**: <50ms (network included)
- **Trace Recording**: <1ms (append to circular buffer)
- **Memory per Automaton**: <15KB (including Lua state)

**Tool**: Google Benchmark + custom harness  
**Execution**: `make bench`

---

### Level 5: Time-Travel Debugging Validation

**Target**: Verify trace reconstruction correctness

```python
# test_ttd_reconstruction.py
def test_trace_replay_accuracy():
    """Record trace, replay from multiple points, verify state consistency"""
    
    device = ESP32Device()
    device.deploy("examples/temperature_control.yaml")
    
    # Run system for 1 minute, capture trace
    device.start_recording()
    time.sleep(60)
    trace = device.stop_recording()
    
    # Trace has ~100 events (varies by system activity)
    assert len(trace) > 50
    
    # Try replaying from midpoint (event 50)
    device.replay_from_point(trace[50])
    time.sleep(5)
    
    # Verify state matches expected
    expected_state = trace[55].state
    actual_state = device.get_state()
    
    assert expected_state == actual_state, \
        f"Replay diverged: expected {expected_state}, got {actual_state}"
    
    print("✓ TTD replay accuracy test passed")

def test_distributed_ttd():
    """Test: Replay causally-ordered events across 3 devices"""
    
    device_a = PicoDevice()
    device_b = ESP32Device()
    device_c = RPiDevice()
    
    # ... deploy automata ...
    
    # Collect traces from all
    traces = [
        device_a.get_trace(),
        device_b.get_trace(),
        device_c.get_trace(),
    ]
    
    # Merge traces using vector clocks (Lamport timestamps)
    merged = MergeTraces(traces)
    
    # Verify causality: if event B depends on event A,
    # then A.timestamp < B.timestamp in merged trace
    for i, event in enumerate(merged):
        for dep in event.causality_deps:
            dep_idx = find_event(merged, dep)
            assert dep_idx < i, "Causality violated!"
    
    print("✓ Distributed TTD causality test passed")
```

---

### Level 6: Formal Verification (Phase 6)

**Target**: Prove safety properties (selected automata)

```
Property 1 (Safety): "System never enters ERROR state from NORMAL without transitioning through ANOMALY_DETECTED"

Verified Using: UPPAAL model checker
Input: Guardian automata + property file
Output: Safe ✓ or Counterexample trace

YAML → UPPAAL XML → verifyta → Result

Expected Timeline: Week 23-24 (after core system stable)
```

---

## UI/UX Requirements & Specifications

### Use Cases & User Personas

#### Persona 1: Thesis Advisor (Academic)

**Goals**:
- Understand architecture and design decisions
- Verify DEVS formalism correctness
- Review code quality

**UI Needs**:
- Architecture diagrams (in docs/markdown)
- YAML specification examples
- Formal property definitions
- GitHub README with clear navigation

---

#### Persona 2: IoT Developer (Building Systems)

**Goals**:
- Quickly design and deploy automata
- Debug distributed systems
- Monitor live device state

**UI Needs**:
- Visual state machine editor
- Drag-drop node creation
- Code editor for Lua
- Real-time device monitoring
- Time-travel debugger
- Deployment wizard

---

#### Persona 3: Embedded Engineer (Firmware)

**Goals**:
- Understand RTE internals
- Optimize for target platform
- Test on hardware

**UI Needs** (not web-based):
- C++ API documentation
- Build system (CMake with platform targets)
- Serial console / UART debugging
- Platform-specific examples (Pico, ESP32)

---

### UI Specifications

### Component 1: Visual Automata Designer

```
┌────────────────────────────────────────────────────────────────┐
│ Aetherium IDE - Automata Designer                              │
├────────────────────────────────────────────────────────────────┤
│ File: demo.yaml    │ Project │ Devices │ Monitor │ Help       │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  [Draw Canvas Area]                                             │
│                                                                 │
│    ┌─────────────┐                ┌─────────────┐              │
│    │   IDLE      │───trigger───>  │   HEATING   │              │
│    │             │                 │             │              │
│    │ Entry:/     │                 │ Entry:      │              │
│    │ setVal(...) │                 │ ctrl_heat() │              │
│    └─────────────┘                 └─────────────┘              │
│         ▲                                 │                     │
│         │                                 │                     │
│         └─────────timeout ─────────────────┘                    │
│                [timeout: 5000ms]                                │
│                                                                 │
│  [Inspector Panel Right]                                        │
│  ┌─────────────────────────────────────────┐                   │
│  │ Properties: IDLE State                  │                   │
│  │ ─────────────────────────────────────── │                   │
│  │ Name: IDLE                              │                   │
│  │ Type: [Atomic ▼]                        │                   │
│  │ Timeout: [None ▼]                       │                   │
│  │ Entry Script:                           │                   │
│  │ ┌─────────────────────────────────────┐ │                   │
│  │ │ setVal("status", "idle")            │ │                   │
│  │ │ publish("status/idle")              │ │                   │
│  │ └─────────────────────────────────────┘ │                   │
│  │                                         │                   │
│  │ [Add Guard ▼] [Add Action ▼]           │                   │
│  └─────────────────────────────────────────┘                   │
│                                                                 │
│  [Palette Left]    [Console Bottom]                             │
│  ├─ Circle (State)  │ 15:34:21 INFO Automata loaded           │
│  ├─ Arrow (Trans.)  │ 15:34:22 Compiling YAML                │
│  ├─ Diamond (Cond.) │ 15:34:23 ✓ Syntax valid                │
│  └─ Group (Comp.)   │ Ready to deploy                          │
│                                                                 │
├────────────────────────────────────────────────────────────────┤
│ [◀ Back] [Save] [Compile] [Simulate] [Deploy ▼]               │
└────────────────────────────────────────────────────────────────┘
```

**Key Features**:

1. **Canvas Panel (center)**:
   - Drag-drop to create states (rectangles)
   - Drag between states to create transitions (arrows)
   - Double-click state to edit properties
   - Zoom, pan, auto-layout (Ctrl+Shift+L)
   - Show/hide grid, snap-to-grid toggle

2. **Inspector Panel (right)**:
   - Edit selected state/transition properties
   - Code editor for Lua guards/actions
   - Inline validation (syntax highlighting)
   - Fuzzy function picker (autocomplete)

3. **Palette (left)**:
   - Drag nodes onto canvas
   - State, Transition, Composite, Comment blocks

4. **Console (bottom)**:
   - Compiler output
   - Simulation warnings
   - Deployment status

5. **Top Menu**:
   - File: New, Open, Save, Export
   - Project: Settings, Dependencies
   - Devices: List connected devices, deploy targets
   - Monitor: Real-time state viewer
   - Help: API docs, tutorials

---

### Component 2: Time-Travel Debugger

```
┌────────────────────────────────────────────────────────────────┐
│ Time-Travel Debugger - Trace Playback                          │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Trace: guardian_anomaly_2025-12-02_154320.bin                │
│  Device: ESP32-Gateway                                         │
│  Duration: 47 seconds                                          │
│  Events: 234                                                   │
│                                                                 │
│  [◀◀ Step Back] [◀ Play] [■ Pause] [▶ Play] [▶▶ Step Fwd]    │
│  Speed: [1x ▼]  Timeline: [|████████░░░░░░░░░░░░░░] 15:32:45 │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Current State: ANOMALY_DETECTED                          │  │
│  │ Timestamp: 15:34:23.456                                 │  │
│  │ Event: anomaly_score_changed                            │  │
│  │ Data: {anomaly_score: 0.87, threshold: 0.7}            │  │
│  │                                                         │  │
│  │ Previous State: NORMAL                                  │  │
│  │ Transition Guard:                                       │  │
│  │   local score = getValue("anomaly_score")              │  │
│  │   return fuzzyMembership(score, "HIGH") > 0.7           │  │
│  │ Result: true ✓                                          │  │
│  │                                                         │  │
│  │ Action (executed on enter):                             │  │
│  │   publish("alert/anomaly", {type="intrusion"})          │  │
│  │   setVal("status", "anomaly")                           │  │
│  │                                                         │  │
│  │ Variables at this point:                                │  │
│  │   • anomaly_score = 0.87 (float)                        │  │
│  │   • sensor_count = 5 (int)                              │  │
│  │   • recovery_attempts = 0 (int)                         │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  [Set Breakpoint ✓] [Copy Trace] [Export CSV] [Graph Timeline]│
│                                                                 │
├────────────────────────────────────────────────────────────────┤
│  ◀ Back to Monitor                                    [Close]   │
└────────────────────────────────────────────────────────────────┘
```

**Key Features**:

1. **Playback Controls**:
   - Step through transitions one at a time
   - Play at 1x, 2x, 5x, 10x speed
   - Jump to specific timestamp (click timeline)
   - Breakpoints (pause when property changes)

2. **State Inspector**:
   - Show state before/after transition
   - Display guard condition + evaluation result
   - Show action code executed
   - List all variables at current point

3. **Timeline Visualization**:
   - Scrubber bar (seek position)
   - Event markers (color-coded by type)
   - Zoom into time range

4. **Export**:
   - CSV trace (for analysis in Excel/Python)
   - JSON export (for programmatic use)
   - PNG screenshot of current frame

---

### Component 3: Device Monitoring Dashboard

```
┌────────────────────────────────────────────────────────────────┐
│ Aetherium IDE - Monitoring                                     │
├────────────────────────────────────────────────────────────────┤
│ [Project: Guardian] [Auto-Refresh: ON] [Refresh] [Settings] [?]
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Network Topology                                               │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                                                          │  │
│  │        [MQTT Broker] (192.168.1.100)                    │  │
│  │             ▲    ▼                                       │  │
│  │        ┌────┴────┴────┐                                 │  │
│  │        │               │                                 │  │
│  │    [ESP32-A]      [ESP32-B]      [RPi-Gateway]         │  │
│  │   Sensor/Temp   Processing        Orchestrator         │  │
│  │   ✓ Connected   ✓ Connected      ✓ Connected          │  │
│  │   Last: 2s ago  Last: 1s ago     Last: 0s ago          │  │
│  │                                                          │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Device Details                                                 │
│                                                                 │
│  ESP32-A: Sensor Node                                          │
│  ├─ Status: [●] HEATING (5s)                                  │
│  ├─ Automata: temp_sensor.yaml v1.0                           │
│  ├─ Uptime: 2h 34m                                             │
│  ├─ Memory: 128KB / 520KB (24.6%)                             │
│  ├─ Last Event: sensor_value = 42.3°C [15:34:22]             │
│  ├─ MQTT:                                                      │
│  │   ├─ pub/s: 1  pub/min: 60                                │
│  │   └─ sub: [sensor/config, system/commands]                │
│  ├─ GPIO:                                                      │
│  │   ├─ Pin 5: OUTPUT (LED status) = HIGH [●]                │
│  │   ├─ Pin 34: INPUT (Temp sensor, ADC)                     │
│  │   └─ Pin 27: OUTPUT (Pump relay) = LOW                    │
│  └─ Actions: [Stop] [Restart] [Download Trace] [Debug ▼]     │
│                                                                 │
│  ESP32-B: Processing Node                                      │
│  ├─ Status: [●] ANOMALY_DETECTED (23s)                        │
│  ├─ Automata: detector.yaml v1.0                              │
│  ├─ ...                                                         │
│                                                                 │
├────────────────────────────────────────────────────────────────┤
│  Trace Storage: 12.4MB (34 hours of data)  [Clear Old] [Export]│
│  Last Update: 15:34:23                     [Auto Refresh: 1s ▼]│
└────────────────────────────────────────────────────────────────┘
```

**Key Features**:

1. **Network Topology**:
   - Visual graph of devices + broker
   - Connection status (✓ connected, ✗ offline, ⏳ connecting)
   - Click device to drill down

2. **Device Details**:
   - Current state + time in state
   - Automata version deployed
   - System resources (uptime, memory)
   - Last received event + timestamp
   - I/O status (GPIO pins, ADC values)
   - Network metrics (messages/sec)

3. **Live Updates**:
   - Auto-refresh every 1s (configurable)
   - Real-time state changes highlighted
   - Event log (newest first)
   - Trace download (for TTD analysis)

4. **Actions**:
   - Stop/restart device
   - Download full trace
   - Trigger breakpoint in debugger
   - View detailed I/O state

---

### Component 4: Deployment Wizard

```
┌────────────────────────────────────────────────────────────────┐
│ Deploy Automata to Devices                                     │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│ Step 1: Select Targets                                         │
│ ─────────────────────────────────────                          │
│                                                                 │
│ [✓] ESP32-A (192.168.1.10)     ✓ Connected     [Online]       │
│ [✓] ESP32-B (192.168.1.11)     ✗ Last: 5m ago [Offline]       │
│ [ ] RPi-Gateway (192.168.1.100) ✓ Connected    [Online]        │
│                                                                 │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ [Validate Network] Checking connectivity...                │ │
│ │ ✓ ESP32-A: reachable (latency: 15ms)                       │ │
│ │ ✗ ESP32-B: unreachable (last contact 5m ago)               │ │
│ │ ✓ RPi-Gateway: reachable (latency: 8ms)                    │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│ [< Back] [Next >] [Skip Offline Devices]                       │
│                                                                 │
├─────────────────────────────────────────────────────────────┤ │
│                                                                 │
│ Step 2: Compilation & Verification                             │
│ ─────────────────────────────────────────                       │
│                                                                 │
│ Automata: demo.yaml                                            │
│ Target Binary Size: 47KB                                       │
│                                                                 │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ [Compile] Compiling YAML to binary...                      │ │
│ │ ✓ Parse YAML                                               │ │
│ │ ✓ Validate FSM (no dead states)                            │ │
│ │ ✓ Check Lua syntax                                         │ │
│ │ ✓ Compile to binary (47KB)                                 │ │
│ │ ✓ Generate property file                                   │ │
│ │                                                             │ │
│ │ Properties Verified:                                        │ │
│ │ ✓ No simultaneous state entry (DEVS select())              │ │
│ │ ✓ Probabilistic transitions sum to ≤1.0                    │ │
│ │ ⚠ 2 unreachable states (WARNING - acceptable)              │ │
│ │                                                             │ │
│ │ Ready to deploy: demo.yaml.bin (47KB)                      │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│ [< Back] [Next >]                                              │
│                                                                 │
├─────────────────────────────────────────────────────────────┤ │
│                                                                 │
│ Step 3: Deploy                                                  │
│ ───────────────                                                 │
│                                                                 │
│ [Deploying to 2 devices...]                                    │
│                                                                 │
│ ✓ ESP32-A: Uploading demo.yaml.bin                            │
│   Progress: [████████████████░░░░░░░░░░░░░░░░░] 63%           │
│   Speed: 120KB/s, ETA: 12s                                     │
│                                                                 │
│ ✓ ESP32-B: Waiting (device offline, skip)                     │
│                                                                 │
│ ✓ RPi-Gateway: Uploading demo.yaml.bin                        │
│   Progress: [████████████████████████████░░░░] 89%            │
│   Speed: 250KB/s, ETA: 3s                                      │
│                                                                 │
│ [< Back] [Finish] [View Logs]                                  │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

**Key Features**:

1. **Device Selection**:
   - Multi-select with status indicator
   - Network validation (ping all)
   - Option to skip offline devices (retry later)

2. **Compilation**:
   - Real-time compilation output
   - DEVS property validation
   - Warning for unreachable states
   - Binary size estimation

3. **Deployment Progress**:
   - Per-device upload progress
   - Speed + ETA estimation
   - Error handling (retry, skip)
   - Post-deployment verification

4. **Post-Deployment**:
   - Device restarts automatically
   - Verify automata loaded correctly
   - Show first state + ready message

---

### Component 5: Code Editor (Lua Guards & Actions)

```
┌────────────────────────────────────────────────────────────────┐
│ Lua Script Editor - Transition Guard                           │
├────────────────────────────────────────────────────────────────┤
│ Transition: HEATING → COOLING                                  │
│ Trigger: timeout                                               │
│                                                                 │
│  [✓ Valid Syntax]  [Issues: 0]  [Helpers ▼]  [Format] [Clear]│
│                                                                 │
│ ┌────────────────────────────────────────────────────────────┐ │
│ │  1  | local temp = getValue("current_temp")              │ │
│ │  2  | local setpoint = value("setpoint", 25.0)           │ │
│ │  3  | -- Check if we've exceeded the threshold           │ │
│ │  4  | if temp > setpoint + 2 then                        │ │
│ │  5  |   return true                                      │ │
│ │  6  | else                                               │ │
│ │  7  |   return false                                     │ │
│ │  8  | end                                                │ │
│ │     |                                                    │ │
│ └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│ Helpers Available (Autocomplete: Ctrl+Space)                   │
│ ├─ getValue(key) → Get value from automata state              │
│ ├─ value(key, default) → Get or default                       │
│ ├─ setVal(key, val) → Set value                               │
│ ├─ check(condition) → Boolean check                           │
│ ├─ fuzzyMembership(val, func, params) → DoA [0,1]            │
│ ├─ randomChance(probability) → Boolean                        │
│ └─ publish(topic, data) → Send MQTT event                     │
│                                                                 │
│ Linting Results:                                               │
│ │ ✓ No undefined variables                                    │
│ │ ✓ No unreachable code                                       │
│ │ ⚠ Line 2: value() has default, always returns 25.0         │
│ │                                                              │
│ [Test Guard] [Insert Template ▼] [API Docs]                  │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

**Key Features**:

1. **Syntax Highlighting**:
   - Lua keywords (local, if, end, etc.)
   - Numbers, strings, comments
   - Autocomplete for built-in functions

2. **Validation**:
   - Real-time syntax checking
   - Type inference (getValue returns any type)
   - Linting warnings (unused variables, etc.)
   - Hover hints for functions

3. **Testing**:
   - Test guard with simulated values
   - Show return value + evaluation time
   - Set breakpoints in Lua (if attached to device)

4. **Helpers**:
   - Function picker (click to insert)
   - Inline documentation
   - Common templates (if/else, fuzzy conditions, etc.)

---

### UI Design System

#### Colors & Palette
```
Primary: #208080 (teal)
Secondary: #5E5240 (brown)
Success: #208080 (green-teal)
Error: #C0152F (red)
Warning: #A84B2F (orange)
Text: #1F2121 (dark charcoal)
BG Light: #FCFCF9 (cream)
BG Dark: #1F2121 (charcoal)
```

#### Typography
```
Headings: Inter / Segoe UI (sans-serif)
Code: Fira Code / Monaco (monospace)
Body: -apple-system, BlinkMacSystemFont, Segoe UI

Font Sizes:
  H1: 24px, bold
  H2: 20px, semibold
  Body: 14px, regular
  Small: 12px, regular
  Code: 12px, monospace
```

#### Component Spacing
```
Padding (buttons, cards): 8px, 12px, 16px, 24px
Margin (sections): 16px, 24px, 32px
Border Radius: 6px (small), 8px (medium), 12px (large)
Border Width: 1px
Shadows: Drop shadow 2-4px offset, 10% black
```

---

### Accessibility Requirements

1. **Keyboard Navigation**:
   - All UI elements accessible via Tab
   - Escape to close modals
   - Enter to confirm actions
   - Ctrl+S for save

2. **Screen Reader Support**:
   - ARIA labels on all interactive elements
   - Descriptive alt text for diagrams
   - Semantic HTML structure

3. **Color Contrast**:
   - WCAG AA compliance (4.5:1 text contrast)
   - Don't rely on color alone (use icons + text)
   - Colorblind-friendly palette options

4. **Responsive Design**:
   - Works on 1920x1080 (primary)
   - Fallback for 1024x768 (secondary)
   - Mobile: Show warning ("Use desktop for full IDE")

---

## Risk & Mitigation Planning

### Risk Matrix

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|-----------|
| **Lua interpreter instability** | High | Low | Use proven Lua 5.4, extensive unit tests |
| **MQTT broker bottleneck** | Medium | Medium | Local UDP mesh for latency-critical paths |
| **Distributed TTD too complex** | High | Medium | Start with single-device TTD (Phase 3), defer distributed (Phase 4) |
| **ROS2 integration underestimated** | Medium | Medium | Research DDS-XRCE early, plan 2-week buffer |
| **Time management (schedule slip)** | High | Medium | Strict weekly milestones, drop P2 features if needed |
| **Hardware not available** | Medium | Low | Buy boards in Week 1, have backups |
| **Security vulnerabilities** | Medium | Low | Code review, no eval(), TLS mandatory |

### Contingency Plans

**If Lua is unstable**:
- Fallback: Lightweight C++ DSL instead of Lua scripting
- Timeline impact: +2 weeks

**If ROS2 integration too complex**:
- Fallback: Support ROS2 as external integration (Phase 6+)
- Deliver core Aetherium without ROS2 first
- Timeline impact: 0 weeks (deferred to future)

**If time slips**:
- Drop priority order: Formal Verification → Distributed TTD → Fuzzy Learning → ROS2
- Focus on Guardian demo (mandatory for thesis)
- Timeline impact: Flexible based on what's cut

---

## Success Metrics & KPIs

### Thesis Evaluation Criteria

| Criterion | Target | Measurement | Status |
|-----------|--------|-------------|--------|
| **DEVS Formalism Implemented** | ✓ | Coupled/atomic models, select() function | Phase 1 |
| **Multi-device Distributed** | ✓ | 3+ devices communicating, state sync | Phase 2 |
| **Time-Travel Debugging** | ✓ | Record/replay traces, inspect vars | Phase 3 |
| **Fuzzy + Probabilistic** | ✓ | Membership functions, transition weights | Phase 4 |
| **Guardian Demo** | ✓ | Self-healing network, visual monitoring | Phase 5 |
| **Comparative Analysis** | ✓ | Aetherium vs 4diac vs Node-RED | Phase 6 |
| **Code Quality** | >80% | Unit test coverage, no major security issues | Ongoing |
| **Documentation** | Complete | README, API docs, tutorial, thesis write-up | Ongoing |

### Performance Metrics

| Metric | Target | Current | Status |
|--------|--------|---------|--------|
| **RTE Footprint (Pico)** | <100KB | TBD | Phase 1 |
| **State Transition Latency** | <5ms | TBD | Phase 1 |
| **Automata Binary Size** | <50KB | TBD | Phase 1 |
| **MQTT Message Throughput** | >100 msgs/s | TBD | Phase 2 |
| **TTD Trace Overhead** | <10% CPU | TBD | Phase 3 |
| **Distributed Trace Causality** | 100% correct | TBD | Phase 4 |

### Community & Adoption

| Metric | Year 1 | Year 2+ |
|--------|--------|---------|
| GitHub Stars | 20-50 | 100+ |
| Monthly Active Users | 5-10 | 50+ |
| Academic Citations | 2-5 papers | 10+ |
| Commercial Deployments | 1-2 | 10+ |
| Plugin Contributions | 0 | 5+ |

---

## Implementation Timeline (6-Month Schedule)

```
WEEK  1-4   (Phase 1: Core RTE)
├─ W1:  Lua interpreter + basic YAML parser
├─ W2:  State machine execution + Lua guards
├─ W3:  Circular trace buffer + local I/O
├─ W4:  Initial Guardian demo (Pico standalone)
└─ MVP: Single device running automata

WEEK  5-8   (Phase 2: Communication)
├─ W5:  MQTT client integration
├─ W6:  Multi-device deployment + OTA updates
├─ W7:  Web UI scaffolding
├─ W8:  3-device Guardian test
└─ MVP: Distributed automata running

WEEK  9-12  (Phase 3: Time-Travel Debugging)
├─ W9:  Trace recording + compression
├─ W10: TTD UI (playback, timeline)
├─ W11: Inspector (variable inspection)
├─ W12: Coverage analysis
└─ MVP: Single-device TTD working

WEEK  13-16 (Phase 4: Fuzzy & ROS2)
├─ W13: Fuzzy logic integration
├─ W14: Probabilistic transitions
├─ W15: DDS-XRCE bridge
├─ W16: ROS2 integration test
└─ MVP: Fuzzy automata + ROS2 comms

WEEK  17-20 (Phase 5: Guardian Demo)
├─ W17: Enhanced monitoring UI
├─ W18: Distributed TTD (causality)
├─ W19: Guardian scenario scripting
├─ W20: Performance tuning + hardening
└─ MVP: Full Guardian demo with all features

WEEK  21-24 (Phase 6: Verification & Thesis)
├─ W21: UPPAAL integration
├─ W22: Comparison study + benchmarks
├─ W23: Thesis writing
├─ W24: Final polish + submission
└─ FINAL: Thesis + code ready for defense
```

---

## Next Steps (Immediate Action Items)

### This Week
- [ ] Set up GitHub repository with CI/CD
- [ ] Create board (Kanban with issues)
- [ ] Order hardware (2x Pico, 2x ESP32, RPi 4)
- [ ] Install development environment (VSCode, CMake, platformio)

### Next Week (Week 1 Sprint)
- [ ] Implement Lua interpreter embedding
- [ ] Parse basic YAML automata spec
- [ ] Create first test: LED blinker on Pico

### Architecture Decisions to Make NOW
- [ ] Confirm Lua version (5.4 vs 5.3)
- [ ] Choose MQTT library (Paho C)
- [ ] Decide on YAML parser (nlohmann/json + custom, or existing C++ lib)
- [ ] Select build system (CMake + PlatformIO or CMake + direct SDK)

---

**Document Version**: 2.0  
**Status**: Ready for Implementation  
**Last Updated**: December 2025  
**Next Review**: End of Week 1
