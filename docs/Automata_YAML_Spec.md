# Aetherium Automata YAML Format

Purpose: define a clear, minimal, and extensible YAML format for authoring automata, supporting both inline code and folder-based code layouts.

Status: draft 0.1 (matches current examples; adds a few optional fields for clarity and future features).

---

## Top-Level Structure

The document is a sequence of sections. Current examples use a list-of-singletons style; a canonical mapping form is also shown for readability. Parsers should accept both.

Required sections:
- `version`: semantic version of the spec used by this file.
- `config`: metadata and layout settings.
- `automata`: the states and transitions.

YAML (current list-of-singletons style):

```
- version: 0.0.1

- config:
  - name: <string>
  - type: inline|folder
  - location: <string>            # required for type=folder, relative path
  - language: lua                 # optional; defaults to lua
  - description: <string>         # optional
  - tags:                         # optional
    - tag1
    - tag2

- automata:
  - initial_state: <StateId>      # optional but recommended
  - states:
    <StateId>:
      - inputs:
        - <InputId>
      - outputs:
        - <OutputId>
      - variables:
        - <VarId>
      - code: <inline code>       # only for type=inline
      - on_enter: <inline code>   # optional (inline only)
      - on_exit: <inline code>    # optional (inline only)
    <StateId>: { ... }

  - transitions:
    <TransitionId>:
      - from: <StateId>
      - to: <StateId>
      - condition: <inline code>  # inline only; folder uses function in file
      - body: <inline code>       # inline only; folder uses function in file
      - triggered: <inline code>  # optional callback (inline only)
      - priority: <int>           # optional; lower runs first (default 0)
      - weight: <float>           # optional; for probabilistic selection
```

Canonical mapping form (equivalent, easier to read/edit):

```
version: 0.0.1
config:
  name: one state automata
  type: inline
  language: lua
automata:
  initial_state: State1
  states:
    State1:
      inputs: [in1, in2]
      outputs: [out1, out2]
      variables: [var1, var2]
      code: |
        print("hello world")
    State2:
      inputs: [in1, in3]
      outputs: [out2, out3]
  transitions:
    Transition1:
      from: State1
      to: State2
      condition: check("out1")
      body: print("transitioned")
```

Notes:
- `<StateId>`, `<TransitionId>`, `<InputId>`, `<OutputId>`, `<VarId>`: use `^[A-Za-z_][A-Za-z0-9_]*$`.
- `initial_state` is optional for now; engines may default to the first declared state if absent.
- `language` defaults to `lua` and should match the code/runtime you embed. Lua scripts have access to helpers: `check(name)`, `value(name)`, `setVal(name, v)`, `emit(name, v)`, `now()`, `rand()`, `log(level,msg)`, `clamp(x,lo,hi)`. See `docs/Lua_Runtime_API.md`. For compatibility, `changed(name)` is an alias of `check(name)`.

---

## Inline vs Folder Layouts

Two layouts are supported via `config.type`:

1) `inline`: code snippets live in the YAML under `code`, `on_enter`, `on_exit`, `condition`, `body`, and `triggered` fields.

2) `folder`: code lives alongside the YAML on disk. Use `config.location` to set the relative base folder containing code files.

Folder layout conventions (Lua by default):
- State code: one file per state at `<location>/<StateId>.lua` implementing:
  - `function body() ... end`
  - Optional: `function on_enter() ... end`
  - Optional: `function on_exit() ... end`
- Transition code: one file per transition at `<location>/<TransitionId>.lua` implementing:
  - `function condition() return true end`
  - `function body() ... end`
  - Optional: `function triggered() ... end`

Example (folder):

```
- version: 0.0.1
- config:
  - name: one state automata
  - type: folder
  - location: "."
- automata:
  - states: { ... }
  - transitions: { ... }
```

And files:
- `State1.lua`
- `State2.lua`
- `Transition1.lua`

---

## Fields and Semantics

- version: semantic version string; use `0.x` while iterating.
- config.name: human-readable name.
- config.type: `inline` or `folder`.
- config.location: required for `folder`; relative to the YAML file.
- config.language: optional; defaults to `lua`.
- automata.initial_state: starting state ID; recommended to set.

State spec:
- inputs: list of input signal IDs available in the state.
- outputs: list of output signal IDs driven in the state.
- variables: list of local variable IDs. Future extension allows structured declarations:
  - short: `variables: [var1, var2]`
  - extended (optional):
    ```
    variables:
      - name: var1
        type: number|string|bool|any
        initial: 0
    ```
- code / on_enter / on_exit (inline): code blocks executed in that state.
- State file (folder): define `body`, optionally `on_enter`, `on_exit`.

Transition spec:
- from: source state ID.
- to: destination state ID.
- condition: predicate returning boolean (inline) or `condition` function (folder). If absent, treated as `true`.
- body: code executed when transition fires (inline) or `body` function (folder).
- triggered: optional callback after transition executes.
- priority: integer for tie-breaking when multiple transitions are valid; lower values win.
- weight: optional probability weight among same-priority transitions with `true` conditions.

Execution model (baseline):
1) Engine evaluates outgoing transitions from the current state.
2) Filters transitions where `condition == true` (or no condition).
3) Chooses transition by lowest `priority`; ties broken by `weight` (roulette) or declaration order.
4) Runs `body`, then moves to `to` state, then runs destination `on_enter` if present.

Note: Future versions may add fuzzy guards and probabilistic transitions; `weight` is reserved to support this.

---

## Validation Rules

Required:
- Top-level keys: `version`, `config`, `automata`.
- `config.name`, `config.type`.
- `automata.states` mapping with at least one state.

Recommended:
- `automata.initial_state` is one of the declared states.
- All `transitions[*].from` and `to` reference valid states.

Identifiers:
- Must match `^[A-Za-z_][A-Za-z0-9_]*$`.
- Be unique within their namespace (state IDs, transition IDs, inputs, outputs, variables).

Folder layout:
- Files must exist for any state/transition lacking inline code.
- Filenames must match IDs exactly with `.lua` extension by default.

---

## End-to-End Examples

Inline example (adapted from repo):

```
- version: 0.0.1
- config:
  - name: one state automata
  - type: inline
- automata:
  - states:
    State1:
      - inputs: [in1, in2]
      - outputs: [out1, out2]
      - variables: [var1, var2]
      - code: |
          print("hello world")
    State2:
      - inputs: [in1, in3]
      - outputs: [out2, out3]
  - transitions:
    Transition1:
      - from: State1
      - to: State2
      - condition: check("out1")
      - body: print("transitioned")
```

Folder example (adapted from repo):

```
- version: 0.0.1
- config:
  - name: one state automata
  - type: folder
  - location: "."
- automata:
  - states:
    State1:
      - inputs: [in1, in2]
      - outputs: [out1, out2]
      - variables: [var1, var2]
    State2:
      - inputs: [in1, in3]
      - outputs: [out2, out3]
  - transitions:
    Transition1:
      - from: State1
      - to: State2
```

Expected files in the same folder:
- `State1.lua`, `State2.lua`
- `Transition1.lua`

---

### Inline example: Two states with `check`

```
version: 0.0.1
config:
  name: two states inline
  type: inline
automata:
  initial_state: S1
  states:
    S1:
      inputs: [in1]
      outputs: [out1]
      code: |
        if check("in1") then
          setVal("out1", value("in1"))
        end
    S2:
      inputs: [in2]
      outputs: [out2]
      code: |
        if check("in2") then
          setVal("out2", value("in2") * 2)
        end
  transitions:
    Go:
      from: S1
      to: S2
      condition: check("out1")
      body: print("Go: out1 changed")
```

### Inline example: Priorities and weights

```
version: 0.0.1
config:
  name: weighted choice inline
  type: inline
automata:
  initial_state: Idle
  states:
    Idle:
      inputs: [trigger]
      outputs: [sel]
    A: { outputs: [sel] }
    B: { outputs: [sel] }
  transitions:
    PickA:
      from: Idle
      to: A
      priority: 0
      weight: 0.7
      condition: check("trigger")
      body: setVal("sel", "A")
    PickB:
      from: Idle
      to: B
      priority: 0
      weight: 0.3
      condition: check("trigger")
      body: setVal("sel", "B")
```

### Folder example: Minimal thermostat

```
- version: 0.0.1
- config:
  - name: thermostat automata
  - type: folder
  - location: "."
- automata:
  - initial_state: Idle
  - states:
    Idle:
      - inputs: [temp]
      - outputs: [cooler_on]
    Cooling:
      - inputs: [temp]
      - outputs: [cooler_on]
  - transitions:
    StartCooling:
      - from: Idle
      - to: Cooling
    StopCooling:
      - from: Cooling
      - to: Idle
```

Expected files:
- `Idle.lua`, `Cooling.lua`, `StartCooling.lua`, `StopCooling.lua`

---

## Compatibility and Evolution

- The current examples use list-of-singletons YAML. This spec documents both that form and a canonical mapping form. Future tooling can emit the canonical form while remaining backward-compatible with existing files.
- Additional optional fields (`initial_state`, `on_enter`, `on_exit`, `priority`, `weight`, `language`) are forward-looking and can be ignored by engines that don’t support them yet.

---

## Multi-Automata Composition (System Files)

Goal: allow multiple automata to communicate. Inputs of one automaton can be driven by outputs of another via explicit wiring.

System file structure (proposed):

```
version: 0.0.1
system:
  automata:
    A:
      source: ./two-states-inline.yaml     # or path to folder YAML
    B:
      source: ./thermostat-folder/thermostat.yaml
  wiring:
    - from: A.out.out1   # output channel name from A
      to:   B.in.temp    # input channel name of B
    - from: B.out.cooler_on
      to:   A.in.in2
```

Notes:
- Each automaton’s IO names are global within that automaton. Wiring refers to `AutomatonId.(in|out).<Name>`.
- Engines should validate that names exist and types are compatible.
- Transport/plugins can map these wires to actual middleware (MQTT, ROS2) when distributed.
