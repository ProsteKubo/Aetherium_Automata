# IDE Demo Projects

These `.aeth` files are lightweight presentation projects built from the curated showcase automata already in the repo.

Open these in the IDE:

- `petri-signal-chain-demo.aeth`
  Petri converter story. Best for showing the signal-chain topology, shared field-bus grouping, and the sealed drive unit.
- `analyzer-contention-demo.aeth`
  Analyzer story. Best for quickly surfacing resource-contention findings around the shared `dc_bus`.
- `black-box-contract-tour.aeth`
  Black-box story. Best for observable ports, emitted events, fault-injectable outputs, and resource contracts.
- `backend-capabilities-tour.aeth`
  Combined presentation project with one network per story if you want a single file for the whole backend tour.

To regenerate these files after updating the showcase YAML:

```bash
node scripts/generate_ide_demo_projects.cjs
```
