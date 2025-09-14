# Aetherium Automata Lua Runtime API (Draft)

This document defines the minimal Lua API exposed to state and transition scripts when `config.language: lua` is used. It complements the YAML spec in `docs/Automata_YAML_Spec.md`.

Status: draft 0.1 — matches examples and proposes a small, stable core you can implement.

---

## Entry Points (per file)

State file `<StateId>.lua` may define:
- `function body()` — executed while the state is active (each tick/step or on demand, depending on engine).
- `function on_enter()` — optional; runs when entering the state.
- `function on_exit()` — optional; runs when leaving the state.

Transition file `<TransitionId>.lua` may define:
- `function condition()` — returns boolean; if true, transition can fire.
- `function body()` — side-effects when the transition fires.
- `function triggered()` — optional; callback after the transition completes.

Notes:
- Functions take no required parameters; the engine injects globals (see below). An engine may pass a context table, but scripts must not rely on it.
- If a function is absent (e.g., no `condition`), treat as a sensible default (`condition` => true, `body` => no-op).

---

## Provided Globals

These functions are available to scripts at runtime:

- `check(name: string) -> boolean`
  - True if the named input/output/variable changed since the last evaluation (tick) or since state entry (engine-defined). Alias: `changed(name)`.

- `value(name: string) -> any`
  - Returns current value of an input/output/variable.

- `setVal(name: string, val: any) -> nil`
  - Sets the value of an output or variable. Setting inputs is invalid and should error.

- `emit(name: string, val: any) -> nil`
  - Convenience alias of `setVal` typically used for outputs.

- `now() -> number`
  - Engine time in milliseconds (monotonic).

- `rand() -> number`
  - Pseudorandom float in [0, 1).

- `log(level: string, msg: string) -> nil`
  - Logging helper. Levels: `"debug"|"info"|"warn"|"error"`. `print` also works for quick output.

- `clamp(x: number, lo: number, hi: number) -> number`
  - Utility helper; returns `min(max(x, lo), hi)`.

Implementation guidance:
- Keep `check`, `value`, and `setVal` fast and side-effect free (except `setVal`).
- Treat unknown names as errors to surface misconfigurations early.

---

## Examples

State with simple output write and change detection:

```lua
function on_enter()
  log("info", "Entering State1")
  setVal("out1", 0)
end

function body()
  if check("in1") then
    local v = value("in1")
    setVal("out1", clamp(v * 2, 0, 100))
  end
end

function on_exit()
  log("info", "Leaving State1")
end
```

Transition with boolean condition and side-effect:

```lua
function condition()
  return check("out1") and value("out1") > 10
end

function body()
  print("Transition fired; out1=", value("out1"))
end

function triggered()
  log("debug", "Transition1 triggered callback")
end
```

---

## Error Handling

- Accessing unknown names in `check/value/setVal` should raise a runtime error (or be reported via `log("error", ...)`).
- Attempts to `setVal` an input should be rejected.
- Exceptions thrown by script functions should be surfaced to the engine with file and function context.

---

## Backward Compatibility

- `changed(name)` is an alias to `check(name)` for compatibility with existing examples.
- Scripts using only `print` will continue to work; `log` is optional.

---

## Future Extensions (Non-breaking)

- Timers: `after(ms, fn)` / `every(ms, fnId)` scheduling.
- Message bus: `send(topic, payload)` / `recv(topic)`.
- Math helpers: interpolation, PID, filtering.

These can be added without breaking the core API above.

