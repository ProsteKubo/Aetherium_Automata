# Petri Net Formal Analysis — Feasibility Assessment
*Exported 2026-05-12 — do NOT change thesis chapter 9; this is the implementation roadmap*

---

## What is currently implemented

| Component | File | What it does |
|---|---|---|
| Structural layout | `petriBuilder.ts` | Maps automata states → place nodes, transitions → edge nodes, channels → arcs. Visual only. |
| Heuristic analyzer | `analyzer_projection.ex` | Counts resource contenders, checks RTT vs latency budget, detects blocked handoffs by graph topology. No formal math. |
| Type definitions | `types/petri.ts` | `PetriNode`, `PetriEdge`, `PetriGraph`, `PetriGroup` — graph is already structured. |
| Overlay metadata | `petriOverlay.ts` | Annotates nodes with runtime deployment state (current state, variable values). |

**The graph structure exists. The formal algorithms do not.**

---

## What is needed for real formal analysis

### Step 1 — Incidence matrix W
- For each Petri transition t: W[p][t] = post_arc_weight(t→p) − pre_arc_weight(p→t)
- Input: existing `PetriGraph` from `petriBuilder.ts`
- Output: 2D integer matrix (places × transitions)
- **Effort: 1 day**
- Notes: pre/post arcs are already encoded as `PetriEdge` source/target. Purely mechanical.

### Step 2 — P-invariant computation (W^T · x = 0, x ≥ 0)
- Find the integer null space of W^T using Gaussian elimination over ℤ (Farkas lemma approach)
- Each solution vector x gives a conserved token sum: Σ x_p · M(p) = const for all reachable M
- The lifting construction guarantees one P-invariant per automaton (all state places of A_i with coefficient 1)
- Finding these algorithmically verifies the lifting was correct
- **Effort: 3–4 days**
- Notes: Need integer arithmetic (no floating point), handle rank-deficient matrix. No external library required — ~200 lines of TypeScript.

### Step 3 — Bounded BFS reachability
- Start from initial marking M^0 (one token per automaton in its initial state place)
- BFS: for each marking, find all enabled transitions, fire each, add result to queue if not visited
- State space: for k automata with s states each and c channel places with capacity cap: s^k × (cap+1)^c
  - 6 automata × 8 states × 3 channel places (cap=3): 8^6 × 4^3 = 262,144 × 64 ≈ 16M markings — tractable with cap=2 (8^6 × 3^3 ≈ 7M)
  - Require a configurable depth/cap bound; default cap=2 for channel places
- **Effort: 3–4 days**
- Notes: Use a hash set for visited markings (compact bitfield key). TypeScript Map is sufficient.

### Step 4 — Deadlock detection (trivial once BFS exists)
- Any marking in the reachability graph with no enabled transition = deadlock
- Report the state tuple (which automaton is in which state) and the shortest path from M^0
- **Effort: half a day after BFS**

### Step 5 — Boundedness check (trivial once BFS exists)
- For each place: if its token count ever exceeds a fixed bound during BFS → unbounded (in practice: write to channel faster than consumed)
- **Effort: half a day after BFS**

### Step 6 — Wire into analyzer findings
- Emit deadlock markings as `AnalyzerFinding` with `kind: 'structural_deadlock'`
- Emit unbounded places as `kind: 'unbounded_channel'`
- Emit P-invariant verification failure as `kind: 'invariant_violation'`
- Integrate into `analyzer_projection.ex` or as a pure-TypeScript pre-pass before server call
- **Effort: 1–2 days**

---

## Total estimate

| Work | Days |
|---|---|
| Incidence matrix | 1 |
| P-invariants | 3–4 |
| Bounded BFS | 3–4 |
| Deadlock + boundedness | 1 |
| Integration | 1–2 |
| **Total** | **~2 weeks** |

---

## Main risks

1. **State space explosion**: channel places are the multiplier. Mitigate with configurable cap (default 2).
2. **Integer arithmetic**: Gaussian elimination over ℤ needs exact division; floating point will give wrong results. Use BigInt in TypeScript.
3. **Probabilistic transitions**: these don't have a clean Petri net semantics (weights are not standard arc weights). Either ignore weights for structural analysis, or add a stochastic extension. For thesis scope, structural analysis ignores weights — this is sound (structure ⊇ behavior).

---

## Why the thesis chapter keeps the formal description

Chapter 9 describes the *target architecture* of the analysis layer, not the current state. This is standard in Bc. theses where the formal model informs the design. The heuristic implementation is explicitly noted as approximate ("structural checks") in the Petri Net Analysis section. The formal math is the specification that a future implementer would use.

The opponent should challenge whether the analysis is complete — the answer is: no, the current implementation uses heuristics; full formal analysis is scoped as future work (as stated in the Future Work section).
