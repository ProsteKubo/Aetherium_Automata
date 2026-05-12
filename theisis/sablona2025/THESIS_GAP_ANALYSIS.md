# Thesis Normostrana Gap Analysis
*Generated 2026-05-12 — target: excellent Bc. thesis (~55–58 np)*

## What is a normostrana (np)?
1 np = 1 800 characters including spaces (Czech academic standard).

---

## Chapter-by-chapter estimate (current)

| Chapter | Est. np | Notes |
|---|---|---|
| 1 – Introduction | 3.2 | Solid; philosophy section adds weight |
| 2 – Background | 4.5 | FSM/EFSM/Petri/R&R — well covered |
| 3 – Analysis of Existing Solutions | 5.8 | Node-RED + 4diac comparison + requirements table |
| 4 – System Architecture | **1.6** | **Under-developed — major gap** |
| 5 – Automata Model and DSL | 5.5 | Black-box, YAML spec, transition types |
| 6 – Runtime Engine | 4.8 | Tick cycle, fault injection, time-travel |
| 7 – Gateway and Protocol | 2.1 | Wire protocol + Phoenix channels |
| 8 – IDE | **1.2** | **Thin for a core contribution** |
| 9 – Petri Net Analysis | **1.3** | **Formal content missing** |
| 10 – Showcase Catalog | 2.4 | Table + two selected showcases |
| 11 – End-to-End Demonstration | 6.1 | Verbose walkthrough (could trim later) |
| 12 – Conclusion | 1.4 | Rewritten to frame RitL + DAD |
| **Total** | **~37.1** | **Target: 55–58 np** |

---

## Gap summary

| Gap | Size | Priority |
|---|---|---|
| System Architecture (ch. 4) | +3.5 np needed | **High** — architectural decisions need justification |
| Petri Net Analysis (ch. 9) | +2.7 np needed | **High** — formal content absent; committee will probe |
| IDE (ch. 8) | +1.5 np needed | Medium — panels deserve UX rationale |
| Gateway (ch. 7) | +0.9 np needed | Medium — protocol spec thin |
| Showcase (ch. 10) | +1.0 np needed | Low — add 2–3 more selected analyses |

---

## Recommended expansion plan

### Priority 1: System Architecture (ch. 4)
Target: ~5.1 np (+3.5)

**Elixir server — WHY:**
- BEAM VM = process-per-device, ~2 KB per process, no shared heap → O(N) device connections without GC pause
- OTP supervision trees → any crashed device process is restarted in isolation; the rest of the fleet continues
- let-it-crash philosophy: no defensive `try/catch` around device handlers; crash → restart is the recovery path
- GenServer behavioral pattern: each connected device is a GenServer holding its state; the pattern enforces a clean message-passing contract
- Hot code reloading: gateway code can be updated without dropping WebSocket connections — critical in a live fleet scenario
- Throughput: BEAM scheduler is preemptive with reduction counting; one misbehaving handler cannot starve others

**C++ engine — WHY:**
- Embedded targets (ESP32, RP2040) have no OS, no heap-safe STL, no exceptions; C++17 with careful allocator discipline is the lingua franca
- The engine is a **library**, not a process: it exposes `AetheriumEngine::Engine` and `AetheriumEngine::DeviceConfig`; the platform provides `main()` and the hardware init
- `IClock`, `IRandomSource`, `IScriptEngine` are pure-virtual interfaces; swapping the desktop Lua interpreter for a no-op stub produces a 64 KB binary suitable for microcontrollers
- CMake `target_link_libraries` selects implementation files at configure time: `aetherium_engine_desktop` vs `aetherium_engine_embedded`

### Priority 2: Petri Net Analysis (ch. 9)
Target: ~4.0 np (+2.7)

**Formal lifting algorithm:**
- Define automaton A_i = (S_i, s^0_i, T_i, V_i, G_i, Act_i)
- Lifted P/T net N_i: places P_i = S_i, initial marking M^0(s^0_i) = 1, others 0
- Each transition t ∈ T_i → Petri transition with pre-arc from source state, post-arc to target state
- Signal output on transition t_j of A_i: add an output arc to a shared place ch_ij
- Signal input guard on A_k: add a pre-arc from ch_ij to the Petri transition consuming it

**Composition:**
- Full network net N = (⋃P_i ∪ ⋃ch_ij, ⋃T_i, F, M^0)
- Shared channel places ch_ij are the only connections between subnets

**Analysis operations (formal):**
- Boundedness: BFS/DFS over reachability graph; flag any place where token count grows unbounded
- Deadlock: marking M is deadlock iff ∄ enabled transition; report automata state tuple
- P-invariants: solve W·x = 0 (x ≥ 0) to find conserved token sets
- T-invariants: solve W^T·y = 0 (y ≥ 0) to find firing sequences returning to M^0

### Priority 3: IDE (ch. 8)
Target: ~2.7 np (+1.5)

- Explain the Electron main/renderer split and why IPC is needed for file system access
- Panel architecture: each panel is an independent React component subscribing to a slice of Zustand store
- Live reconnection logic in PhoenixGatewayService
- NetworkPanel topology algorithm (force-directed layout)
- PetriNetPanel rendering pipeline (YAML → IR → SVG/Canvas)

---

## Do NOT trim yet
- Chapter 11 (Demonstration) is long but that is intentional for reproducibility
- All showcase entries — table is a deliverable

---

## Timeline estimate
At ~1 000 words/hour of focused writing:
- Architecture expansion: ~2 hours
- Petri Net expansion: ~1.5 hours
- IDE expansion: ~1 hour
- Total gap: ~4.5 hours of prose work
