# IDE Demo Projects

This directory keeps generated `.aeth` projects for one-click IDE imports.

Open this in the IDE:

- `backend-capabilities-tour.aeth`
  Flagship multi-network showcase. It opens with `Aetherium Gem Cell`, then includes the signal-chain, guarded-cell, power-contention, and resilience-watchdog networks.

The same generated project is copied to the repository root as `NewProject.aeth` for quick IDE opening.

Additional generated projects are available under:

- `showcase/`
  One project per showcase YAML, plus `all.aeth` collection projects for multi-automata showcase folders.
- `examples/automata-yaml-examples/`
  One project per YAML example, plus an `all.aeth` collection project.
- `examples/demos/`
  One project per demo YAML, plus collection projects for the demo root and network demo.

To regenerate the flagship project after updating the showcase YAML:

```bash
node scripts/generate_ide_demo_projects.cjs
```

Do not edit generated `.aeth` files by hand unless you intend to preserve the change in `scripts/generate_ide_demo_projects.cjs`.

Showcase projects are also mirrored next to their source YAML files under `example/automata/showcase/` for direct one-click import from the showcase tree.
