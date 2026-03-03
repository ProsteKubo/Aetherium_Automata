# Engine Quick Command Test Plan

This is the shortest path to verify command handling before moving on.

## 1) Build

```bash
cmake -S /Users/administratorik/dev/Aetherium_Automata -B /Users/administratorik/dev/Aetherium_Automata/build
cmake --build /Users/administratorik/dev/Aetherium_Automata/build -j4
```

## 2) Run command smoke (single command)

```bash
/Users/administratorik/dev/Aetherium_Automata/build/aetherium_engine_command_smoke
```

Expected output:
- `engine_command_smoke: PASS`

What it covers:
- `STATUS`, `START` (NAK before load)
- `LOAD_AUTOMATA` + `LOAD_ACK`
- `START`, `PAUSE`, `RESUME`, `STOP`, `RESET`
- `INPUT`, `VARIABLE`
- `VENDOR`, `GOODBYE`
- unsupported command path -> `NAK`
- status snapshots and transition progression

## 3) Validate all example automata

```bash
for f in $(find /Users/administratorik/dev/Aetherium_Automata/example/automata -type f | grep -E '\\.ya?ml$' | sort); do
  /Users/administratorik/dev/Aetherium_Automata/build/aetherium_engine --validate "$f" || exit 1
done
```

### Optional: validate curated showcase suite only

```bash
/Users/administratorik/dev/Aetherium_Automata/scripts/validate_showcase_automata.sh validate
```

## 4) Run the harder stress automata

```bash
/Users/administratorik/dev/Aetherium_Automata/build/aetherium_engine \
  --run /Users/administratorik/dev/Aetherium_Automata/example/automata/automata-yaml-examples/production-line-stress.yaml \
  --max-transitions 20 --max-ticks 5000 --verbose

/Users/administratorik/dev/Aetherium_Automata/build/aetherium_engine \
  --run /Users/administratorik/dev/Aetherium_Automata/example/automata/automata-yaml-examples/production-line-stress-seconds.yaml \
  --max-ticks 120 --verbose

/Users/administratorik/dev/Aetherium_Automata/build/aetherium_engine \
  --run /Users/administratorik/dev/Aetherium_Automata/example/automata/automata-yaml-examples/command-event-gate.yaml \
  --max-ticks 200 --verbose

/Users/administratorik/dev/Aetherium_Automata/build/aetherium_engine \
  --run /Users/administratorik/dev/Aetherium_Automata/example/automata/automata-yaml-examples/reactor-folder/reactor.yaml \
  --max-transitions 12 --max-ticks 5000 --verbose
```

## 5) Run edge-case pack

```bash
/Users/administratorik/dev/Aetherium_Automata/build/aetherium_engine \
  --run /Users/administratorik/dev/Aetherium_Automata/example/automata/automata-yaml-examples/timed-seconds-modes.yaml \
  --max-ticks 120 --verbose

/Users/administratorik/dev/Aetherium_Automata/build/aetherium_engine \
  --run /Users/administratorik/dev/Aetherium_Automata/example/automata/automata-yaml-examples/timeout-vs-classic.yaml \
  --max-ticks 80 --verbose

/Users/administratorik/dev/Aetherium_Automata/build/aetherium_engine \
  --run /Users/administratorik/dev/Aetherium_Automata/example/automata/automata-yaml-examples/high-churn-immediate.yaml \
  --max-ticks 30 --verbose

/Users/administratorik/dev/Aetherium_Automata/build/aetherium_engine \
  --run /Users/administratorik/dev/Aetherium_Automata/example/automata/automata-yaml-examples/event-threshold-runtime.yaml \
  --max-ticks 120 --verbose

/Users/administratorik/dev/Aetherium_Automata/build/aetherium_engine \
  --run /Users/administratorik/dev/Aetherium_Automata/example/automata/automata-yaml-examples/probabilistic-balance-loop.yaml \
  --max-ticks 200 --verbose
```

## 6) Pass criteria

- command smoke returns `PASS`
- all YAML files validate
- each stress run exits without runtime errors
- transition count is non-zero for `production-line-stress` and `reactor-folder`
- edge-case pack runs without parser/runtime errors
