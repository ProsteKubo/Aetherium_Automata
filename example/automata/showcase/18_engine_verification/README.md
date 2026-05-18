# Engine Verification Automata

Small fixtures for checking one engine behavior at a time.

- `01_lua_hooks_outputs.yaml` exercises Lua `on_enter`, state `code`, internal variables, output writes, and classic conditions.
- `02_timed_priority_timeout.yaml` exercises transition priority and timeout suppression.
- `03_event_edges_threshold.yaml` exercises `on_rise`, `on_fall`, and threshold event triggers.
- `04_weighted_probabilistic.yaml` exercises weighted probabilistic transition selection.
- `05_bytecode_subset_ir.yaml` exercises bytecode-compatible timed, classic, and shorthand event transitions without Lua hooks.

