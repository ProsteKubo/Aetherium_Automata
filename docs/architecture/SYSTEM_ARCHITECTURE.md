# Aetherium Automata - System Architecture

**Version**: 1.0  
**Date**: January 2026  
**Status**: Implementation Ready

---

## Table of Contents

1. [Overview](#overview)
2. [Automata Model](#automata-model)
3. [Protocol Design](#protocol-design)
4. [Engine Architecture](#engine-architecture)
5. [IDE Design](#ide-design)
6. [Communication Flow](#communication-flow)

---

## Overview

Aetherium is a distributed automata execution platform consisting of:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              GATEWAY                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                   │
│  │   IDE/UI     │  │  Monitoring  │  │   Control    │                   │
│  └──────────────┘  └──────────────┘  └──────────────┘                   │
└─────────────────────────────────────────────────────────────────────────┘
                              │
                              │ WebSocket/HTTP
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                              SERVER                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                   │
│  │ Device Mgmt  │  │   Routing    │  │    State     │                   │
│  └──────────────┘  └──────────────┘  └──────────────┘                   │
└─────────────────────────────────────────────────────────────────────────┘
                              │
           ┌──────────────────┼──────────────────┐
           │ MQTT/Serial      │                  │
           ▼                  ▼                  ▼
    ┌──────────┐       ┌──────────┐       ┌──────────┐
    │ Device A │       │ Device B │       │ Device C │
    │ (Desktop)│◄─────►│  (ESP32) │◄─────►│  (Pico)  │
    │  Engine  │       │  Engine  │       │  Engine  │
    └──────────┘       └──────────┘       └──────────┘
```

### Key Components

| Component | Role | Transport |
|-----------|------|-----------|
| **Engine** | Executes automata on devices | MQTT, Serial, Console |
| **Server** | Routes messages, manages devices | MQTT, WebSocket |
| **Gateway** | User interface to the system | WebSocket to Server |
| **IDE** | Visual automata design | Local + Gateway connection |

---

## Automata Model

### Core Concepts

```
Automata
├── Config (name, version, type)
├── Variables (typed: inputs, outputs, internal)
├── States
│   ├── State ID
│   ├── Local inputs/outputs/variables
│   ├── Code (on_enter, body, on_exit)
│   └── Position (visual)
└── Transitions
    ├── Transition ID
    ├── From → To
    ├── Type (classic, timed, event, probabilistic, immediate)
    ├── Condition
    ├── Weight (for probabilistic)
    ├── Priority (for conflict resolution)
    └── Body (code on fire)
```

### Variable Types

Variables are categorized by direction and type:

| Category | Direction | Description |
|----------|-----------|-------------|
| **Input** | Read-only | External values fed to automata |
| **Output** | Write-only | Values produced by automata for others |
| **Internal** | Read-Write | Local state variables |

**Data Types**: `bool`, `int`, `float`, `string`, `table`

### Transition Types

#### 1. Classic (Condition-based)
```yaml
T1:
  from: S1
  to: S2
  type: classic
  condition: "a > 5"
```

#### 2. Weighted (Probabilistic)
When multiple transitions share the same condition, weights determine selection:

```yaml
# Both fire when a > 5, selected probabilistically
T1:
  from: S1
  to: S2
  type: classic
  condition: "a > 5"
  weight: 0.7  # 70% chance

T2:
  from: S1
  to: S3
  type: classic
  condition: "a > 5"
  weight: 0.3  # 30% chance
```

Weight normalization: `P(Ti) = weight(Ti) / sum(weights of enabled transitions)`

#### 3. Timed
```yaml
T1:
  from: S1
  to: S2
  type: timed
  timed:
    mode: after    # after, at, every, timeout, window
    delay_ms: 1000
    jitter_ms: 50  # optional randomization
```

#### 4. Event-triggered
```yaml
T1:
  from: S1
  to: S2
  type: event
  event:
    signal: temperature
    trigger: on_threshold
    threshold:
      operator: ">"
      value: 30
```

#### 5. Immediate (Epsilon)
```yaml
T1:
  from: S1
  to: S2
  type: immediate
  priority: 1
```

### Transition Selection Algorithm

```
1. Get all transitions from current_state
2. Filter by type:
   - TIMED: check if timer expired
   - EVENT: check if signal changed appropriately  
   - CLASSIC: evaluate condition
   - IMMEDIATE: always enabled
3. Group by priority (lower = higher priority)
4. Take highest priority group
5. If multiple enabled:
   - If any has weight > 0: probabilistic selection
   - Else: select first (deterministic)
6. Fire selected transition
```

---

## Protocol Design

### Design Principles

1. **Compact**: Minimize bytes for MCU constraints
2. **Extensible**: Version and vendor fields
3. **Transport-agnostic**: Works over Serial, MQTT, WebSocket
4. **Self-describing**: Type + length prefix

### Binary Wire Format (CBOR-inspired)

```
┌─────────┬─────────┬──────────┬─────────────┬─────────────────┐
│ Magic   │ Version │ Msg Type │ Length      │ Payload         │
│ (2B)    │ (1B)    │ (1B)     │ (2B)        │ (variable)      │
└─────────┴─────────┴──────────┴─────────────┴─────────────────┘
  0xAE01     0x01      0x01      0x0000-0xFFFF
```

**Magic**: `0xAE 0x01` (Aetherium v1)  
**Max message size**: 65535 bytes (can be chunked for larger automata)

### Message Types

#### Control Plane (0x00-0x3F)

| Type | ID | Direction | Description |
|------|----|-----------|-------------|
| HELLO | 0x01 | Device→Server | Announce presence |
| HELLO_ACK | 0x02 | Server→Device | Acknowledge + assign ID |
| DISCOVER | 0x03 | Server→Broadcast | Find devices |
| PING | 0x04 | Bidirectional | Heartbeat |
| PONG | 0x05 | Bidirectional | Heartbeat response |
| PROVISION | 0x06 | Server→Device | Set device config |

#### Automata Plane (0x40-0x7F)

| Type | ID | Direction | Description |
|------|----|-----------|-------------|
| LOAD_AUTOMATA | 0x40 | Server→Device | Deploy automata |
| LOAD_ACK | 0x41 | Device→Server | Confirm load |
| START | 0x42 | Server→Device | Start execution |
| STOP | 0x43 | Server→Device | Stop execution |
| RESET | 0x44 | Server→Device | Reset to initial state |
| STATUS | 0x45 | Device→Server | Execution status |

#### Data Plane (0x80-0xBF)

| Type | ID | Direction | Description |
|------|----|-----------|-------------|
| INPUT | 0x80 | Server→Device | Set input value |
| OUTPUT | 0x81 | Device→Server | Report output value |
| VARIABLE | 0x82 | Bidirectional | Variable update |
| STATE_CHANGE | 0x83 | Device→Server | State transition occurred |
| TELEMETRY | 0x84 | Device→Server | Batched metrics |

#### Extended (0xC0-0xFF)

| Type | ID | Direction | Description |
|------|----|-----------|-------------|
| VENDOR | 0xC0 | Bidirectional | Vendor-specific |
| DEBUG | 0xD0 | Device→Server | Debug message |
| ERROR | 0xE0 | Bidirectional | Error report |

### Message Payloads

#### HELLO (0x01)
```
┌──────────────┬───────────┬───────────┬────────────┬───────────┐
│ Device Type  │ Version   │ Caps      │ Name Len   │ Name      │
│ (1B)         │ (3B)      │ (2B)      │ (1B)       │ (var)     │
└──────────────┴───────────┴───────────┴────────────┴───────────┘

Device Type:
  0x01 = Desktop
  0x02 = ESP32
  0x03 = Pico
  0x04 = RaspberryPi
  
Caps (bitfield):
  bit 0: Supports Lua
  bit 1: Supports timed transitions
  bit 2: Supports probabilistic
  bit 3: Supports fuzzy logic
  bit 4: Has persistent storage
  bit 5: Has RTC
  bit 6-15: Reserved
```

#### LOAD_AUTOMATA (0x40)
```
┌──────────┬──────────┬──────────┬───────────────┬──────────────┐
│ Run ID   │ Flags    │ Format   │ Chunk Info    │ Data         │
│ (4B)     │ (1B)     │ (1B)     │ (4B)          │ (var)        │
└──────────┴──────────┴──────────┴───────────────┴──────────────┘

Flags:
  bit 0: Is chunked
  bit 1: Request ACK
  bit 2: Start after load
  bit 3: Replace existing
  
Format:
  0x01 = Binary (AetheriumBinary)
  0x02 = YAML text
  0x03 = JSON text
  0x04 = MessagePack
  
Chunk Info (if chunked):
  Bits 0-15:  Chunk index
  Bits 16-31: Total chunks
```

#### INPUT (0x80)
```
┌───────────┬──────────┬───────────┬───────────────┐
│ Var ID    │ Type     │ Value Len │ Value         │
│ (2B)      │ (1B)     │ (2B)      │ (var)         │
└───────────┴──────────┴───────────┴───────────────┘

Type:
  0x01 = bool (1 byte: 0 or 1)
  0x02 = int8
  0x03 = int16
  0x04 = int32
  0x05 = int64
  0x06 = float32
  0x07 = float64
  0x08 = string (UTF-8)
  0x09 = binary
  0x0A = table (MessagePack)
```

### Automata Binary Format

For efficient transmission to constrained devices:

```
AUTOMATA_BINARY:
┌─────────────────────────────────────────────────────────────┐
│ Header                                                       │
│ ┌──────────┬──────────┬──────────┬──────────┬──────────┐   │
│ │ Magic    │ Version  │ Flags    │ Checksum │ Reserved │   │
│ │ (4B)     │ (2B)     │ (2B)     │ (4B)     │ (4B)     │   │
│ └──────────┴──────────┴──────────┴──────────┴──────────┘   │
├─────────────────────────────────────────────────────────────┤
│ Section: Config (type=0x01)                                  │
│ ┌───────────┬───────────┬────────────────────────────────┐ │
│ │ Sec Type  │ Sec Len   │ Name + Metadata (MessagePack)  │ │
│ │ (1B)      │ (2B)      │ (var)                          │ │
│ └───────────┴───────────┴────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│ Section: Variables (type=0x02)                               │
│ ┌───────────┬───────────┬────────────────────────────────┐ │
│ │ Sec Type  │ Sec Len   │ Variable Table                 │ │
│ │ (1B)      │ (2B)      │ (var)                          │ │
│ └───────────┴───────────┴────────────────────────────────┘ │
│                                                              │
│ Variable Entry:                                              │
│ ┌──────┬──────┬───────┬──────┬───────────┬───────────────┐ │
│ │ ID   │ Dir  │ Type  │ NLen │ Name      │ Initial       │ │
│ │ (2B) │ (1B) │ (1B)  │ (1B) │ (var)     │ (var)         │ │
│ └──────┴──────┴───────┴──────┴───────────┴───────────────┘ │
│                                                              │
│ Dir: 0x01=Input, 0x02=Output, 0x03=Internal                 │
├─────────────────────────────────────────────────────────────┤
│ Section: States (type=0x03)                                  │
│ ┌───────────┬───────────┬────────────────────────────────┐ │
│ │ Sec Type  │ Sec Len   │ State Table                    │ │
│ │ (1B)      │ (2B)      │ (var)                          │ │
│ └───────────┴───────────┴────────────────────────────────┘ │
│                                                              │
│ State Entry:                                                 │
│ ┌──────┬───────┬────────┬────────┬────────┬──────────────┐ │
│ │ ID   │ Flags │ NLen   │ Name   │ Var[]  │ Code[]       │ │
│ │ (2B) │ (1B)  │ (1B)   │ (var)  │ (var)  │ (var)        │ │
│ └──────┴───────┴────────┴────────┴────────┴──────────────┘ │
│                                                              │
│ Flags: bit0=initial, bit1=has_enter, bit2=has_exit          │
├─────────────────────────────────────────────────────────────┤
│ Section: Transitions (type=0x04)                             │
│ ┌───────────┬───────────┬────────────────────────────────┐ │
│ │ Sec Type  │ Sec Len   │ Transition Table               │ │
│ │ (1B)      │ (2B)      │ (var)                          │ │
│ └───────────┴───────────┴────────────────────────────────┘ │
│                                                              │
│ Transition Entry:                                            │
│ ┌──────┬───────┬──────┬──────┬────────┬────────┬─────────┐ │
│ │ ID   │ Type  │ From │ To   │ Pri    │ Weight │ Config  │ │
│ │ (2B) │ (1B)  │ (2B) │ (2B) │ (1B)   │ (2B)   │ (var)   │ │
│ └──────┴───────┴──────┴──────┴────────┴────────┴─────────┘ │
│                                                              │
│ Type: 0x01=Classic, 0x02=Timed, 0x03=Event, 0x04=Prob      │
│ Weight: Fixed-point 0-10000 (0.00-100.00%)                  │
├─────────────────────────────────────────────────────────────┤
│ Section: Code (type=0x05)                                    │
│ ┌───────────┬───────────┬────────────────────────────────┐ │
│ │ Sec Type  │ Sec Len   │ Bytecode or Source             │ │
│ │ (1B)      │ (2B)      │ (var)                          │ │
│ └───────────┴───────────┴────────────────────────────────┘ │
│                                                              │
│ Code Entry:                                                  │
│ ┌──────────┬────────────┬──────────┬────────────────────┐  │
│ │ Code ID  │ Code Type  │ Len      │ Data               │  │
│ │ (2B)     │ (1B)       │ (2B)     │ (var)              │  │
│ └──────────┴────────────┴──────────┴────────────────────┘  │
│                                                              │
│ Code Type: 0x01=Lua source, 0x02=Lua bytecode               │
├─────────────────────────────────────────────────────────────┤
│ Section: End (type=0xFF)                                     │
│ ┌───────────┬───────────┐                                   │
│ │ Sec Type  │ Sec Len=0 │                                   │
│ │ (1B)      │ (2B)      │                                   │
│ └───────────┴───────────┘                                   │
└─────────────────────────────────────────────────────────────┘
```

---

## Engine Architecture

### Design Goals

1. **Modular**: Clean separation of concerns
2. **Portable**: Same core for desktop/ESP/Pico
3. **Lightweight**: Minimal dependencies for embedded
4. **Extensible**: Easy to add transition types, transports

### Component Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         Engine                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                     Runtime                                │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐   │  │
│  │  │ Scheduler   │  │ Executor    │  │ TransitionEval  │   │  │
│  │  │ (tick loop) │  │ (run states)│  │ (eval guards)   │   │  │
│  │  └─────────────┘  └─────────────┘  └─────────────────┘   │  │
│  │         │                │                   │            │  │
│  │         └────────────────┴───────────────────┘            │  │
│  │                          │                                 │  │
│  │  ┌───────────────────────┴───────────────────────────┐   │  │
│  │  │                 ExecutionContext                   │   │  │
│  │  │  ┌─────────┐  ┌──────────┐  ┌──────────────────┐  │   │  │
│  │  │  │ Automata│  │Variables │  │ Timers/Clocks    │  │   │  │
│  │  │  └─────────┘  └──────────┘  └──────────────────┘  │   │  │
│  │  └────────────────────────────────────────────────────┘   │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                   │
│  ┌───────────────────────────┴───────────────────────────────┐  │
│  │                     Scripting                              │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐   │  │
│  │  │  LuaVM      │  │  Bindings   │  │  Sandbox        │   │  │
│  │  │  (embedded) │  │  (API)      │  │  (security)     │   │  │
│  │  └─────────────┘  └─────────────┘  └─────────────────┘   │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                   │
│  ┌───────────────────────────┴───────────────────────────────┐  │
│  │                     Transport                              │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐   │  │
│  │  │  ITransport │  │ Console     │  │ MQTT            │   │  │
│  │  │  (interface)│  │ Transport   │  │ Transport       │   │  │
│  │  └─────────────┘  └─────────────┘  └─────────────────┘   │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                   │
│  ┌───────────────────────────┴───────────────────────────────┐  │
│  │                     Platform                               │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐   │  │
│  │  │  Clock      │  │  Random     │  │  I/O            │   │  │
│  │  │  (abstract) │  │  (abstract) │  │  (abstract)     │   │  │
│  │  └─────────────┘  └─────────────┘  └─────────────────┘   │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Class Hierarchy

```cpp
// Core (no inheritance, composition-based)
Value           // Type-safe variant for variables
Variable        // Named, typed, directional value
Condition       // Evaluable guard expression
CodeBlock       // Executable code (Lua)

// Model
State           // FSM state with code hooks
Transition      // Edge with type, condition, weight
Automata        // Complete automata definition

// Runtime
ExecutionContext    // Current execution state
TransitionResolver  // Selects next transition
Executor           // Runs state code, fires transitions

// Scripting
IScriptEngine      // Abstract scripting interface
LuaEngine         // Lua implementation
  
// Transport
ITransport         // Abstract message transport
ConsoleTransport   // Stdin/stdout for testing
MqttTransport     // MQTT for network
SerialTransport   // Serial for embedded (future)

// Platform abstraction
IClock            // Time source
IRandomSource     // Random number generator
IPlatformIO       // Platform-specific I/O
```

### Transition Resolution

```cpp
class TransitionResolver {
public:
    // Returns the transition to fire, or nullptr if none
    Transition* resolve(
        const State& current,
        const std::vector<Transition*>& transitions,
        ExecutionContext& ctx
    );
    
private:
    // Evaluate all transitions, group by priority
    std::vector<Transition*> evaluateEnabled(
        const std::vector<Transition*>& transitions,
        ExecutionContext& ctx
    );
    
    // Select from weighted transitions
    Transition* selectWeighted(
        const std::vector<Transition*>& enabled,
        IRandomSource& rng
    );
};
```

### Execution Loop

```cpp
void Engine::run() {
    while (running_) {
        // 1. Read inputs from transport
        processIncomingMessages();
        
        // 2. Update timers
        ctx_.updateTimers(clock_.now());
        
        // 3. Resolve enabled transitions
        auto* transition = resolver_.resolve(
            *ctx_.currentState(), 
            getTransitionsFrom(ctx_.currentState()),
            ctx_
        );
        
        // 4. Fire transition if any
        if (transition) {
            fireTransition(*transition);
        }
        
        // 5. Execute current state body
        executeStateBody();
        
        // 6. Send outputs via transport
        sendOutputs();
        
        // 7. Yield (platform-specific)
        platform_.yield();
    }
}
```

---

## IDE Design

### Current Pain Points

1. Transitions with same conditions not visually linked
2. No view of automata connections (input↔output bindings)
3. Variable management is per-state, not unified

### Proposed Improvements

#### 1. Transition Groups

Group transitions with identical conditions:

```
┌──────────────────────────────────────────────────────┐
│  Transition Group: "a > 5"                           │
│  ┌────────────────────────────────────────────────┐  │
│  │ S1 → S2  [weight: 0.7] [70%]                  │  │
│  │ S1 → S3  [weight: 0.3] [30%]                  │  │
│  └────────────────────────────────────────────────┘  │
│  [+ Add to group]                                    │
└──────────────────────────────────────────────────────┘
```

Visual representation on canvas:
- Single edge from S1 splits into weighted branches
- Condition label appears once at the split point
- Weight percentages shown on each branch

#### 2. Automata Connections Panel

```
┌─────────────────────────────────────────────────────────────────┐
│ Automata Connections                                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐         ┌──────────────┐                     │
│  │ Thermostat   │         │ HVAC Control │                     │
│  │              │ temp ──►│              │                     │
│  │              │◄── mode │              │                     │
│  └──────────────┘         └──────────────┘                     │
│                                  │                              │
│                             power│                              │
│                                  ▼                              │
│                          ┌──────────────┐                      │
│                          │ Power Meter  │                      │
│                          └──────────────┘                      │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│ Bindings:                                                        │
│  • Thermostat.temp → HVAC.temperature_in                        │
│  • HVAC.mode → Thermostat.mode_feedback                         │
│  • HVAC.power_usage → PowerMeter.power_in                       │
└─────────────────────────────────────────────────────────────────┘
```

#### 3. Unified Variable Management

```
┌─────────────────────────────────────────────────────────────────┐
│ Variables                                          [+ Add]       │
├─────────────────────────────────────────────────────────────────┤
│ INPUTS (readonly)                                               │
│ ┌───────────┬────────┬─────────┬────────────────────────────┐  │
│ │ Name      │ Type   │ Value   │ Used In                    │  │
│ ├───────────┼────────┼─────────┼────────────────────────────┤  │
│ │ temp      │ float  │ 22.5    │ S1, S2, T1                 │  │
│ │ humidity  │ float  │ 45.0    │ S1, T2                     │  │
│ │ mode      │ string │ "auto"  │ S1, S2, S3, T1, T2, T3     │  │
│ └───────────┴────────┴─────────┴────────────────────────────┘  │
│                                                                  │
│ OUTPUTS (write-only)                                            │
│ ┌───────────┬────────┬─────────┬────────────────────────────┐  │
│ │ Name      │ Type   │ Value   │ Written In                 │  │
│ ├───────────┼────────┼─────────┼────────────────────────────┤  │
│ │ fan_speed │ int    │ 3       │ S2.on_enter                │  │
│ │ heating   │ bool   │ true    │ S2.body, T2.body           │  │
│ └───────────┴────────┴─────────┴────────────────────────────┘  │
│                                                                  │
│ INTERNAL                                                         │
│ ┌───────────┬────────┬─────────┬────────────────────────────┐  │
│ │ counter   │ int    │ 0       │ S1.body, T1.body           │  │
│ │ last_temp │ float  │ 21.0    │ T1.condition               │  │
│ └───────────┴────────┴─────────┴────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

#### 4. Transition Editor Enhancements

```
┌─────────────────────────────────────────────────────────────────┐
│ Transition: T1                                                   │
├─────────────────────────────────────────────────────────────────┤
│ From: [S1 ▼]  To: [S2 ▼]                                        │
│                                                                  │
│ Type: [● Classic] [○ Timed] [○ Event] [○ Immediate]             │
│                                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Condition (Lua):                                             │ │
│ │ ┌─────────────────────────────────────────────────────────┐ │ │
│ │ │ a > 5                                                   │ │ │
│ │ └─────────────────────────────────────────────────────────┘ │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Probabilistic Settings                          [Enabled ✓] │ │
│ │                                                              │ │
│ │ Weight: [0.7____] ← slider →                                │ │
│ │                                                              │ │
│ │ Same condition transitions:                                  │ │
│ │   • T2: S1→S3 (weight: 0.3)                                 │ │
│ │                                                              │ │
│ │ [Normalize Weights] [Make Equal]                            │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ Priority: [0____]  (lower = evaluated first)                    │
│                                                                  │
│ [Save] [Cancel]                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Communication Flow

### Device → Server → Other Device

```sequence
Device A          Server           Device B
   |                |                  |
   |--OUTPUT(x=5)-->|                  |
   |                |                  |
   |                |---INPUT(x=5)---->|
   |                |                  |
   |                |<---OUTPUT_ACK----|
   |                |                  |
   |<---RELAY_ACK---|                  |
```

### Gateway Monitoring

```sequence
Gateway          Server           Device
   |                |                |
   |--SUBSCRIBE---->|                |
   |                |                |
   |                |<--STATE_CHANGE-|
   |<--STATE_CHANGE-|                |
   |                |                |
   |                |<--TELEMETRY----|
   |<--TELEMETRY----|                |
```

### Automata Deployment

```sequence
IDE             Gateway          Server           Device
 |                 |                |                |
 |--DEPLOY-------->|                |                |
 |                 |--LOAD_AUTOMATA>|                |
 |                 |                |--LOAD_AUTOMATA>|
 |                 |                |<--LOAD_ACK-----|
 |                 |<--LOAD_ACK-----|                |
 |<--DEPLOY_OK-----|                |                |
 |                 |                |                |
 |--START--------->|                |                |
 |                 |--START-------->|                |
 |                 |                |----START------>|
 |                 |                |<---STATUS------|
 |                 |<---STATUS------|                |
 |<--RUNNING-------|                |                |
```

---

## Next Steps

1. **Protocol**: Implement C++ header with message types and serialization
2. **Engine**: Refactor core with new transition model
3. **IDE**: Add transition grouping and variable panel
4. **Testing**: Unit tests for transition resolution, integration for communication
