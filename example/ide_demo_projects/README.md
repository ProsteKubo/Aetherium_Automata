# IDE Demo Projects

This directory keeps the canonical `.aeth` project for the current product slice.

Open this in the IDE:

- `backend-capabilities-tour.aeth`
  Flagship multi-network showcase. It opens with `Aetherium Gem Cell`, then includes the signal-chain, guarded-cell, power-contention, and resilience-watchdog networks.

The same generated project is copied to the repository root as `NewProject.aeth` for quick IDE opening.

To regenerate the flagship project after updating the showcase YAML:

```bash
node scripts/generate_ide_demo_projects.cjs
```

Do not edit generated `.aeth` files by hand unless you intend to preserve the change in `scripts/generate_ide_demo_projects.cjs`.
