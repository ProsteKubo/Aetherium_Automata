# IDE Demo Projects

This directory now keeps a single canonical `.aeth` project for the converged package.

Open this in the IDE:

- `backend-capabilities-tour.aeth`
  Flagship multi-network showcase covering channel-driven orchestration, black boxes, Petri-net conversion, analyzer contention, resilience faults, and replay-oriented runtime observation.

To regenerate the flagship project after updating the showcase YAML:

```bash
node scripts/generate_ide_demo_projects.cjs
```
