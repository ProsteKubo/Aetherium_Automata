# ONE-PACKAGE CONVERGENCE PLAN


## Objective

Refocus the repo into one opinionated product: a coherent IoT IDE orchestrator where EFSM automata, Lua, named channels, deployment-aware runtime, black boxes, fault injection, time-travel replay, Petri-net conversion, and analyzer views all reinforce the same end-to-end story.

Your updated steering implies three hard decisions:

• The repo should optimize for coherence over breadth.
• Purging is preferred over preserving if something does not support the product story.
• Backward compatibility is not a goal at this stage.

That direction fits the current codebase: the backbone already exists across gateway + server + engine + IDE, plus runtime snapshotting, rewind, analyzer, and black-box flows, but the repo still carries parallel paths, small fragmented demos, and some obviously transitional or simulated behavior. README.md:9-12, src/ide/src/renderer/src/App.tsx:23-37, src/server/aetherium_server/lib/aetherium_server/device_manager.ex:225-252, CMakeLists.txt:89-166, src/gateway/aetherium_gateway/lib/aetherium_gateway_web/channels/gateway_channel.ex:29-38


## Current State That Matters for This Cleanup

### What is already worth keeping

• The runtime model already supports meaningful EFSM behavior: states with hooks, timed/event/classic/probabilistic transitions, and Lua-backed execution.
  src/engine/core/model.hpp:51-138, src/engine/core/runtime.cpp:74-147, src/engine/core/lua_engine.cpp:130-224
• The server already has the right “deep product” features: runtime snapshot requests, black-box description, rewind, and analyzer queries.
  src/server/aetherium_server/lib/aetherium_server/device_manager.ex:225-252
• The IDE already has the right major surfaces: runtime monitor, network view, Petri-net view, analyzer, black boxes, devices, and gateway panels.
  src/ide/src/renderer/src/App.tsx:23-37, src/ide/src/renderer/src/App.tsx:255-309
• Desktop-only multi-server demonstration is already feasible through the current compose stack with three servers, device runners, and a black-box runner.
  src/docker-compose.yaml:27-107, src/docker-compose.yaml:151-197

### What is currently making the repo feel broad and messy

• The engine build still carries both the split architecture and a legacy monolithic target kept during the transition. CMakeLists.txt:89-166
• The repo’s showcase strategy is intentionally made of many small focused scenarios, which is useful for validation but works against your desired “one strong package” effect.
  example/automata/showcase/README.md:5-9, example/automata/showcase/README.md:25-87
• The Petri-net and analyzer panels currently import small demo sets instead of a single flagship scenario. src/ide/src/renderer/src/components/panels/PetriNetPanel.tsx:52-76,
  src/ide/src/renderer/src/components/panels/AnalyzerPanel.tsx:16-42
• The checked-in sample project is still a tiny single-network, simple-loop example, which visually undersells the platform. NewProject.aeth:12-24, NewProject.aeth:25-120
• There are still simulated/operator-demo style paths in the gateway, such as the restart flow that fakes a device restart with a delayed local message instead of driving a real
  orchestration path. src/gateway/aetherium_gateway/lib/aetherium_gateway_web/channels/gateway_channel.ex:29-38

### Biggest structural mismatch to fix

The project model already supports multiple networks inside one project, but the runtime view is still mainly deployment-centric rather than explicitly “networks communicating with networks.” src/ide/src/renderer/src/types/project.ts:24-77, src/ide/src/renderer/src/types/runtimeView.ts:3-22

That mismatch is the most important product-design gap, because your vision is not just “many devices deployed,” but “many networks working together as one analyzable system.”


## Steering Rules for the Purge

1. Keep only what strengthens the flagship workflow: design → bind → deploy → observe → fault → rewind → analyze.
2. Delete parallel ways of doing the same thing unless one is clearly canonical.
3. Prefer real orchestration paths over simulated/demo control paths in user-facing flows.
4. Desktop/docker runners become the canonical acceptance environment until hardware is actually part of the daily loop. src/docker-compose.yaml:27-197
5. Anything outside the product story is either removed or explicitly demoted from the main package, including old breadth-first ambitions that do not serve the flagship
   experience. README.md:26-31, src/docker-compose.yaml:199-257


## Implementation Plan
## Implementation Plan

- [x] 1. Freeze the canonical product definition and apply it as a deletion filter. Formally define the package as “distributed EFSM orchestration with bindings,
   black boxes, deployment observability, fault injection, replay, and analyzer insight,” and treat anything outside that flow as removable; this is necessary because the repo
   still mixes a focused current architecture with older expansion-era scope. README.md:9-12, README.md:26-31

- [~] 2. Perform a hard keep/cut/rework audit across build targets, runtime paths, UI panels, demos, and control APIs. Use three buckets only: canonical,
   salvageable after rewrite, or purge; this is necessary because the current repo already shows transitional duplication rather than a single chosen path. CMakeLists.txt:89-166,
   example/automata/showcase/README.md:5-9

- [ ] 3. Remove transitional engine/runtime duplication and promote one canonical runtime stack. The split runtime/frontend/transport architecture should become
   the only supported path if it remains the cleanest fit, and the legacy monolithic target should be removed rather than carried for compatibility; this is necessary because
   duplicate execution/build paths are one of the clearest sources of dead code and maintenance drag. CMakeLists.txt:89-166

- [ ] 4. Purge mock-style or simulated user-facing orchestration behavior from the core product path. Any operator or gateway action that exists mainly as a
   placeholder should either be replaced with a real end-to-end control-plane action or removed from the polished package; this is necessary because simulated actions break the
   “one real package” feel. src/gateway/aetherium_gateway/lib/aetherium_gateway_web/channels/gateway_channel.ex:29-38

- [ ] 5. Replace scattered small demos with one flagship multi-network project that becomes the default story of the repo. Build a single .aeth project
   containing several logical networks, multiple servers, many desktop-runner devices, and a few black boxes so the whole platform reads as one system rather than a catalog of
   fragments; this is necessary because the current showcase structure is intentionally fragmented and the checked-in sample project is far too small.
   example/automata/showcase/README.md:25-87, NewProject.aeth:12-24, NewProject.aeth:25-120

- [ ] 6. Redesign the flagship automata so states do the heavy lifting and Lua stays supportive. Make the main automata explicitly rich in state structure,
   recovery paths, supervisory behavior, shared-resource contention, and deployment-visible behavior instead of depending on script-heavy logic; this is necessary because the
   runtime can already support this style, and it aligns directly with your vision. src/engine/core/model.hpp:51-138, src/engine/core/runtime.cpp:149-247

- [ ] 7. Make channels/bindings the central organizing abstraction across networks, devices, and servers. Named output/input matching should drive logical
   connectivity, but the UI and orchestration model should present those bindings as first-class system channels rather than just local pairings; this is necessary because the repo
   already has useful binding derivation and connection management, but not yet one unified channel-centric product story.
   src/ide/src/renderer/src/utils/automataBindings.ts:89-150, src/gateway/aetherium_gateway/lib/aetherium_gateway/connection_manager.ex:68-157

- [ ] 8. Elevate “network-of-networks” into the runtime and analyzer domain model. Project networks should not remain only editor containers; they should shape
   deployment grouping, runtime dashboards, Petri overlays, and analyzer scope so cross-network coordination becomes visible and meaningful; this is necessary because the current
   project model is richer than the runtime model. src/ide/src/renderer/src/types/project.ts:24-77, src/ide/src/renderer/src/types/runtimeView.ts:3-22

- [ ] 9. Turn observability, fault injection, rewind, and replay into the default operational workflow of the flagship package. The main demo should
   intentionally collect traces, accept injected faults, rewind to arbitrary points, and replay state evolution as a normal part of use, not as an advanced side panel; this is
   necessary because these are already among the strongest implemented differentiators in the stack. src/engine/core/execution_trace.hpp:38-89,
   src/server/aetherium_server/lib/aetherium_server/time_series_replay.ex:6-63, src/ide/src/renderer/src/services/gateway/PhoenixGatewayService.ts:2570-2675,
   src/ide/src/renderer/src/services/gateway/PhoenixGatewayService.ts:2750-2875

- [ ] 10. Rebuild the analyzer and Petri-net experience around intentional bottlenecks and partial opacity. The flagship scenario should include shared
   resources, latency-sensitive paths, blocked handoffs, and black-box participants specifically so Petri-net conversion and analyzer findings look powerful rather than ornamental;
   this is necessary because the backend already projects these kinds of findings, but the current demo content is too small to make them compelling.
   src/server/aetherium_server/lib/aetherium_server/analyzer_projection.ex:29-122, src/server/aetherium_server/lib/aetherium_server/analyzer_projection.ex:125-255,
   src/ide/src/renderer/src/components/panels/PetriNetPanel.tsx:52-76, src/ide/src/renderer/src/components/panels/AnalyzerPanel.tsx:16-42

- [ ] 11. Simplify the UI so all major panels participate in one coherent story instead of feeling like adjacent tools. Network, runtime, black-box, Petri, and
   analyzer panels should share selection, context, and navigation defaults so the user sees one package unfolding through different lenses; this is necessary because the panel
   surface is already broad enough, and coherence now matters more than more features. src/ide/src/renderer/src/App.tsx:23-37,
   src/ide/src/renderer/src/components/panels/NetworkPanel.tsx:183-291, src/ide/src/renderer/src/components/panels/RuntimeMonitorPanel.tsx:242-319

- [ ] 12. Collapse tooling, launch flows, and smoke coverage around the flagship package only. Keep one main desktop-runner launch path, one showcase deployment
   path, and one meaningful smoke/E2E path centered on the canonical scenario; this is necessary because a polished package cannot be maintained through scattered validation entry
   points. src/server/aetherium_server/lib/mix/tasks/aetherium.showcase.deploy.ex:24-87, src/server/aetherium_server/lib/mix/tasks/aetherium.e2e.ex:52-100,
   src/server/aetherium_server/lib/mix/tasks/aetherium.black_box.smoke.ex:57-140

- [ ] 13. Aggressively delete or demote peripheral scope that does not strengthen the flagship package. Optional branches such as expansion-era platform
   ambitions, unused demo artifacts, and side capability paths should be removed from the main repo experience unless they actively support the core product story; this is
   necessary because your requested outcome is not a broad lab, but one distilled package. README.md:26-31, src/docker-compose.yaml:199-257

- [ ] 14. Finish with a visual and naming polish pass that makes the repo look intentional from the first launch. The final package should open into a meaningful
   multi-network project, show active distributed behavior, and make the analyzer/replay payoff obvious without hunting through demo fragments; this is necessary because the
   current default sample content underrepresents the platform. NewProject.aeth:12-24, NewProject.aeth:25-120



•  A fresh desktop/docker run starts one canonical multi-server showcase using the existing host/device/black-box runner model, with no dependence on attached boards.
    src/docker-compose.yaml:27-197
•  The default project demonstrates multiple logical networks working together inside one package, rather than one small single-network sample.
    src/ide/src/renderer/src/types/project.ts:24-77, NewProject.aeth:12-24
•  The main showcase automata are clearly state-heavy and nontrivial, with runtime value visible through transitions, supervisory states, and contention behavior rather than
    script-heavy shortcuts. src/engine/core/model.hpp:51-138
•  Fault injection and rewind are part of the normal demo path, and replay produces useful state reconstruction rather than only raw logs.
    src/server/aetherium_server/lib/aetherium_server/time_series_replay.ex:6-63, src/ide/src/renderer/src/services/gateway/PhoenixGatewayService.ts:2811-2875
•  Analyzer and Petri-net views expose meaningful bottlenecks, contention, latency, or black-box-driven unknowns in the flagship scenario.
    src/server/aetherium_server/lib/aetherium_server/analyzer_projection.ex:29-122, src/server/aetherium_server/lib/aetherium_server/analyzer_projection.ex:203-255
•  Transitional and duplicate paths are visibly reduced, with the legacy runtime/build overlap eliminated or removed from the main product path. CMakeLists.txt:89-166
•  Simulated/mock control behavior is no longer part of the polished primary workflow. src/gateway/aetherium_gateway/lib/aetherium_gateway_web/channels/gateway_channel.ex:29-38


## Potential Risks and Mitigations

1. Over-purging something that later turns out to be strategically useful
   Mitigation: apply the keep/cut/rework audit before deletion and only preserve items that clearly reinforce the flagship package.

1. Ending up with a visually bigger demo but still a conceptually fragmented product
   Mitigation: unify the domain model first—especially network-of-networks, bindings, and runtime grouping—before doing final UI polish. src/ide/src/renderer/src/types/project.ts:24-77, src/ide/src/renderer/src/types/runtimeView.ts:3-22

1. Analyzer and Petri views feeling forced rather than necessary
   Mitigation: design the flagship scenario to contain real shared resources, latency pressure, black-box opacity, and blocked handoffs on purpose. src/server/aetherium_server/lib/aetherium_server/analyzer_projection.ex:125-255

1. Desktop-only polish hiding future hardware realities
   Mitigation: explicitly treat desktop/docker as the acceptance environment for now, while still modeling transport, placement, latency, battery, and fault behavior so the system remains deployment-aware. src/engine/core/execution_trace.hpp:14-35, src/docker-compose.yaml:27-197

My recommendation is Hard-convergence with simulation-first acceptance: aggressively purge, stop honoring backward compatibility, and shape the whole repo around one desktop-run