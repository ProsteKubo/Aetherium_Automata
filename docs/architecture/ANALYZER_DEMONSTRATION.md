# Analyzer Demonstration

## Purpose

The analyzer is a read-only workspace that explains where automata or deployments compete for the same resource or handoff path. It is not a simulator and it does not mutate runtime state.

## Fast Demo Paths

### 1. Offline Structural Demo

Use this when you want to demonstrate the analyzer without any running stack.

1. Open the IDE.
2. Open the `Analyzer` workspace.
3. Click `Import Demo` on `Contention Demo`.

Expected outcome:
- three automata are imported into the current project
- the analyzer shows `dc_bus` as a shared resource
- you should see `shared_resource_contention`
- you should also see `unknown_evidence`, because there is no replay timeline yet

This is the cleanest demo for structural contention.

### 2. Multi-Actor Network + Black Box Demo

Use this when you want to show how analyzer topology includes black-box participants.

1. Open the IDE.
2. Open the `Analyzer` workspace.
3. Click `Import Demo` on `Signal Chain Demo`.

Expected outcome:
- four automata are imported into the project
- the group includes a black-box drive unit
- the analyzer should show shared `field_bus` participation
- this is the best demo for explaining that black boxes are visible as contract participants, not gateway-owned internals

### 3. Structural To Findings Workflow

Use this when you want to show how Petri and Analyzer work together.

1. Import one of the demo sets above.
2. Open `Petri`.
3. Select a merged group, subnet, or arc.
4. Click `Open In Analyzer`.

Expected outcome:
- the analyzer opens with the relevant automata scope preselected
- findings and graph focus on the same structural area you were inspecting in Petri

## Live Demonstration Path

For observed evidence instead of structural-only fallback:

1. Start the Docker stack with a running black box.
2. Deploy the sample black-box automaton.
3. Open `Runtime` and verify live deployments exist.
4. Return to `Analyzer`.
5. Refresh with `Scope = deployment` or `Scope = group`.

Expected outcome:
- evidence mode upgrades from `structural_only` to `hybrid` or `observed`
- blocked handoff, queue backlog, or starvation findings may appear if matching timeline evidence exists

## What Each Demo Is Good For

- `Contention Demo`
  - simplest explanation of shared-resource rivalry
  - best offline screenshot/demo

- `Signal Chain Demo`
  - better explanation of derived bindings, field-bus participation, and black-box actors
  - best for showing analyzer + Petri + black-box workflow together

## Current Limits

- offline demos are structural-first and will not fabricate replay evidence
- per-binding RTT is not inferred if only endpoint metadata exists
- black boxes appear through their declared public contract and resources, not through internal implementation detail
