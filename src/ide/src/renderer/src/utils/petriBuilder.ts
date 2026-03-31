import type {
  Automata,
  AutomataId,
  BlackBoxContract,
  Device,
  ExecutionSnapshot,
  Transition,
} from '../types';
import type { RuntimeDeployment } from '../types/runtimeView';
import type {
  PetriBindingDraftLike,
  PetriBuildOptions,
  PetriDeploymentContext,
  PetriEdge,
  PetriGraph,
  PetriGroup,
  PetriNode,
} from '../types/petri';
import { getAutomataPorts, deriveCompatibleBindingDrafts, bindingIdentity } from './automataBindings';
import {
  automataSlotOrigin,
  groupOrigin,
  inferAutomataSort,
  interfacePlacePosition,
  nestedSubnetPosition,
  sortNodes,
  statePlacePosition,
  transitionPosition,
} from './petriLayout';
import { createDeploymentContext, createOverlayMetadata, formatOverlayLabel } from './petriOverlay';

type ResourceRecord = {
  name: string;
  kind: string;
  shared?: boolean;
  capacity?: number;
  latencySensitive?: boolean;
  description?: string;
  ownerAutomataId: AutomataId;
};

type PortRecord = {
  name: string;
  direction: 'input' | 'output' | 'internal';
  type: string;
  description?: string;
};

type BuilderInput = {
  automataMap: Map<string, Automata>;
  explicitBindings: PetriBindingDraftLike[];
  deployments: Map<string, RuntimeDeployment>;
  devices: Map<string, Device>;
  executionSnapshots?: Map<string, ExecutionSnapshot | null>;
  options: PetriBuildOptions;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function normalizeBlackBox(automata: Automata, snapshot?: ExecutionSnapshot | null): BlackBoxContract | undefined {
  return (
    snapshot?.blackBox ??
    automata.blackBox ??
    ((asRecord(automata as unknown as Record<string, unknown>)?.black_box as BlackBoxContract | undefined) ??
      undefined)
  );
}

function getPorts(automata: Automata, snapshot?: ExecutionSnapshot | null): PortRecord[] {
  const blackBox = normalizeBlackBox(automata, snapshot);
  if (blackBox?.ports?.length) {
    return blackBox.ports.map((port) => ({
      name: port.name,
      direction: port.direction,
      type: port.type,
      description: port.description,
    }));
  }

  return [
    ...getAutomataPorts(automata, 'input').map((port) => ({
      name: port.name,
      direction: 'input' as const,
      type: port.type,
    })),
    ...getAutomataPorts(automata, 'output').map((port) => ({
      name: port.name,
      direction: 'output' as const,
      type: port.type,
    })),
  ];
}

function getResources(automata: Automata, snapshot?: ExecutionSnapshot | null): ResourceRecord[] {
  const blackBox = normalizeBlackBox(automata, snapshot);
  if (!blackBox?.resources?.length) return [];

  return blackBox.resources.map((resource) => ({
    name: resource.name,
    kind: resource.kind,
    shared: resource.shared,
    capacity: resource.capacity,
    latencySensitive: resource.latencySensitive,
    description: resource.description,
    ownerAutomataId: automata.id,
  }));
}

function getSharedResourceGroups(
  automataList: Automata[],
  snapshotMap: Map<string, ExecutionSnapshot | null>,
  options: PetriBuildOptions,
): {
  merged: Map<string, PetriGroup['sharedResources'][number]>;
  perAutomata: Map<string, ResourceRecord[]>;
  warnings: string[];
} {
  const merged = new Map<string, PetriGroup['sharedResources'][number]>();
  const perAutomata = new Map<string, ResourceRecord[]>();
  const warnings: string[] = [];

  automataList.forEach((automata) => {
    const resources = getResources(automata, snapshotMap.get(automata.id));
    perAutomata.set(automata.id, resources);

    resources.forEach((resource) => {
      if (options.hideNonSharedResources && !resource.shared) return;
      if (!resource.shared) return;

      const key = `${resource.name}::${resource.kind}`;
      const existing = merged.get(key);

      if (!existing) {
        merged.set(key, {
          name: resource.name,
          kind: resource.kind,
          latencySensitive: resource.latencySensitive,
          capacity: resource.capacity,
          declaredBy: [automata.id],
        });
        return;
      }

      existing.declaredBy.push(automata.id);
      if (existing.capacity !== resource.capacity) {
        existing.conflicts = [...(existing.conflicts ?? []), `capacity mismatch on ${resource.name}`];
      }
      if (existing.latencySensitive !== resource.latencySensitive) {
        existing.conflicts = [...(existing.conflicts ?? []), `latency-sensitive mismatch on ${resource.name}`];
      }
    });
  });

  const byName = new Map<string, Set<string>>();
  merged.forEach((resource) => {
    const existing = byName.get(resource.name) ?? new Set<string>();
    existing.add(resource.kind);
    byName.set(resource.name, existing);
  });

  byName.forEach((kinds, resourceName) => {
    if (kinds.size > 1) {
      warnings.push(`Resource "${resourceName}" has conflicting kinds and was not merged globally.`);
    }
  });

  return { merged, perAutomata, warnings };
}

function buildBindingInventory(
  automataList: Automata[],
  explicitBindings: PetriBindingDraftLike[],
  options: PetriBuildOptions,
): PetriBindingDraftLike[] {
  const explicit = explicitBindings
    .filter((binding) => binding.enabled !== false)
    .map((binding) => ({
      ...binding,
      explicit: true,
      derived: false,
    }));

  if (options.explicitBindingsOnly) {
    return explicit;
  }

  if (!options.includeDerivedBindings) {
    return explicit;
  }

  const derived = deriveCompatibleBindingDrafts(
    automataList,
    explicit.map((binding) => ({
      sourceAutomataId: binding.sourceAutomataId,
      sourceOutputName: binding.sourceOutputName,
      targetAutomataId: binding.targetAutomataId,
      targetInputName: binding.targetInputName,
    })),
  ).map((binding) => ({
    id: `derived:${bindingIdentity(binding)}`,
    sourceAutomataId: binding.sourceAutomataId,
    sourceOutputName: binding.sourceOutputName,
    targetAutomataId: binding.targetAutomataId,
    targetInputName: binding.targetInputName,
    sourceType: binding.sourceType,
    targetType: binding.targetType,
    enabled: binding.enabled,
    explicit: false,
    derived: true,
  }));

  return [...explicit, ...derived];
}

function collectConnectedComponents(
  automataList: Automata[],
  bindings: PetriBindingDraftLike[],
  sharedResources: Map<string, PetriGroup['sharedResources'][number]>,
): PetriGroup[] {
  const adjacency = new Map<string, Set<string>>();
  automataList.forEach((automata) => adjacency.set(automata.id, new Set()));

  bindings.forEach((binding) => {
    adjacency.get(binding.sourceAutomataId)?.add(binding.targetAutomataId);
    adjacency.get(binding.targetAutomataId)?.add(binding.sourceAutomataId);
  });

  sharedResources.forEach((resource) => {
    if (resource.declaredBy.length < 2) return;
    resource.declaredBy.forEach((sourceId) => {
      resource.declaredBy.forEach((targetId) => {
        if (sourceId !== targetId) {
          adjacency.get(sourceId)?.add(targetId);
        }
      });
    });
  });

  const visited = new Set<string>();
  const groups: PetriGroup[] = [];
  const sortedAutomata = inferAutomataSort(automataList);

  sortedAutomata.forEach((automata) => {
    if (visited.has(automata.id)) return;

    const queue = [automata.id];
    const members: string[] = [];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || visited.has(current)) continue;
      visited.add(current);
      members.push(current);
      adjacency.get(current)?.forEach((neighbor) => {
        if (!visited.has(neighbor)) queue.push(neighbor);
      });
    }

    const groupId = `petri_group_${groups.length + 1}`;
    const groupBindings = bindings.filter(
      (binding) =>
        members.includes(binding.sourceAutomataId) && members.includes(binding.targetAutomataId),
    );
    const groupResources = Array.from(sharedResources.values()).filter((resource) =>
      resource.declaredBy.some((id) => members.includes(id)),
    );

    groups.push({
      id: groupId,
      label: members.length === 1 ? `${members[0]}` : `Group ${groups.length + 1}`,
      automataIds: members,
      bindingIds: groupBindings.filter((binding) => binding.explicit).map((binding) => binding.id),
      derivedBindingIds: groupBindings.filter((binding) => binding.derived).map((binding) => binding.id),
      bindings: groupBindings.map((binding) => ({
        id: binding.id,
        sourceAutomataId: binding.sourceAutomataId,
        targetAutomataId: binding.targetAutomataId,
        sourceOutputName: binding.sourceOutputName,
        targetInputName: binding.targetInputName,
        explicit: binding.explicit,
        derived: binding.derived,
      })),
      sharedResources: groupResources,
      warnings: groupResources.flatMap((resource) => resource.conflicts ?? []),
    });
  });

  return groups;
}

function inferTransitionSubtitle(transition: Transition): string {
  if (transition.type === 'timed') return 'timed';
  if (transition.type === 'event') return 'event';
  if (transition.type === 'probabilistic') return `p=${transition.weight}`;
  if (transition.type === 'immediate') return 'immediate';
  return 'classic';
}

function textMentionsName(text: string | undefined, name: string): boolean {
  if (!text || !name) return false;
  return text.includes(name);
}

function pushUniqueEdge(edges: PetriEdge[], edge: PetriEdge): void {
  if (edges.some((existing) => existing.id === edge.id)) return;
  edges.push(edge);
}

export function buildPetriGraph(input: BuilderInput): PetriGraph {
  const automataList = inferAutomataSort(Array.from(input.automataMap.values()));
  const snapshotMap = new Map<string, ExecutionSnapshot | null>();
  (input.executionSnapshots ?? new Map()).forEach((snapshot, automataId) => {
    snapshotMap.set(automataId, snapshot);
  });

  const bindings = buildBindingInventory(automataList, input.explicitBindings, input.options);
  const { merged: sharedResources, perAutomata, warnings: resourceWarnings } = getSharedResourceGroups(
    automataList,
    snapshotMap,
    input.options,
  );
  const groups = collectConnectedComponents(automataList, bindings, sharedResources);

  const nodes: PetriNode[] = [];
  const edges: PetriEdge[] = [];
  const graphWarnings: string[] = [...resourceWarnings];
  const expandedSet = new Set(input.options.expandedAutomataIds ?? []);
  const automataById = new Map(automataList.map((automata) => [automata.id, automata] as const));

  const deploymentContextByAutomata = new Map<string, PetriDeploymentContext>();
  automataList.forEach((automata) => {
    const deployment = Array.from(input.deployments.values()).find((candidate) => candidate.automataId === automata.id);
    const device = deployment ? input.devices.get(deployment.deviceId) : undefined;
    const snapshot = snapshotMap.get(automata.id) ?? undefined;
    deploymentContextByAutomata.set(
      automata.id,
      createDeploymentContext({
        automataId: automata.id,
        device,
        snapshot,
      }),
    );
  });

  groups.forEach((group, groupIndex) => {
    const baseOrigin = groupOrigin(groupIndex);
    const groupAutomata = group.automataIds
      .map((id) => automataById.get(id))
      .filter(Boolean) as Automata[];
    const bindingPlaceNodeIds = new Map<string, string>();
    const interfaceNodeIds = new Map<string, string>();

    groupAutomata.forEach((automata, automataIndex) => {
      const automataBase = automataSlotOrigin(automataIndex, baseOrigin);
      const isExpanded = input.options.mode === 'expanded' && expandedSet.has(automata.id);
      const automataPorts = getPorts(automata, snapshotMap.get(automata.id));
      const inputPorts = automataPorts.filter((port) => port.direction === 'input');
      const outputPorts = automataPorts.filter((port) => port.direction === 'output');
      const localResources =
        input.options.includeResources
          ? (perAutomata.get(automata.id) ?? []).filter((resource) =>
              input.options.hideNonSharedResources ? resource.shared : true,
            )
          : [];

      const overviewContainerId = `${group.id}:subnet:${automata.id}`;
      const stateCount = Object.keys(automata.states).length;
      const transitionList = Object.values(automata.transitions);

      nodes.push({
        id: overviewContainerId,
        kind: 'subnet_container',
        label: automata.config.name,
        subtitle: isExpanded
          ? 'expanded subnet'
          : `${stateCount} states · ${transitionList.length} transitions`,
        groupId: group.id,
        source: { automataId: automata.id },
        position: isExpanded
          ? { x: automataBase.x + 120, y: automataBase.y - 92 }
          : automataBase,
        metadata: {
          automataId: automata.id,
          stateCount,
          transitionCount: transitionList.length,
          inputCount: inputPorts.length,
          outputCount: outputPorts.length,
          eventTransitions: transitionList.filter((transition) => transition.type === 'event').length,
          timedTransitions: transitionList.filter((transition) => transition.type === 'timed').length,
          probabilisticTransitions: transitionList.filter((transition) => transition.type === 'probabilistic').length,
          nestedAutomataIds: automata.nestedAutomataIds ?? [],
        },
      });

      if (input.options.mode === 'expanded') {
        inputPorts.forEach((port, index) => {
          const nodeId = `${group.id}:input:${automata.id}:${port.name}`;
          nodes.push({
            id: nodeId,
            kind: 'input_place',
            label: port.name,
            subtitle: port.type,
            groupId: group.id,
            source: { automataId: automata.id, portName: port.name },
            position: interfacePlacePosition(automataBase, 'input', index),
            metadata: { direction: 'input', type: port.type, description: port.description },
          });
          interfaceNodeIds.set(`${automata.id}:input:${port.name}`, nodeId);
          if (!isExpanded) {
            pushUniqueEdge(edges, {
              id: `${nodeId}->${overviewContainerId}`,
              source: nodeId,
              target: overviewContainerId,
              metadata: { relation: 'subnet_input' },
            });
          }
        });

        outputPorts.forEach((port, index) => {
          const nodeId = `${group.id}:output:${automata.id}:${port.name}`;
          nodes.push({
            id: nodeId,
            kind: 'output_place',
            label: port.name,
            subtitle: port.type,
            groupId: group.id,
            source: { automataId: automata.id, portName: port.name },
            position: interfacePlacePosition(automataBase, 'output', index),
            metadata: { direction: 'output', type: port.type, description: port.description },
          });
          interfaceNodeIds.set(`${automata.id}:output:${port.name}`, nodeId);
          if (!isExpanded) {
            pushUniqueEdge(edges, {
              id: `${overviewContainerId}->${nodeId}`,
              source: overviewContainerId,
              target: nodeId,
              metadata: { relation: 'subnet_output' },
            });
          }
        });

        localResources.forEach((resource, index) => {
          const nodeId = `${group.id}:resource:${automata.id}:${resource.name}`;
          nodes.push({
            id: nodeId,
            kind: 'resource_place',
            label: resource.name,
            subtitle: resource.kind,
            groupId: group.id,
            source: { automataId: automata.id, resourceName: resource.name },
            position: interfacePlacePosition(automataBase, 'resource', index),
            metadata: {
              kind: resource.kind,
              shared: resource.shared,
              capacity: resource.capacity,
              latencySensitive: resource.latencySensitive,
              description: resource.description,
            },
          });
          interfaceNodeIds.set(`${automata.id}:resource:${resource.name}`, nodeId);
          if (!isExpanded) {
            pushUniqueEdge(edges, {
              id: `${nodeId}<->${overviewContainerId}`,
              source: nodeId,
              target: overviewContainerId,
              metadata: { relation: 'resource_link' },
            });
          }
        });
      }

      if (isExpanded) {
        const stateIds = Object.keys(automata.states);
        const stateIndexMap = new Map<string, number>();
        const statePositionMap = new Map<number, { x: number; y: number }>();
        const normalizedStatePositions = new Map<string, { x: number; y: number }>();
        const rawPositions = stateIds.map((stateId, stateIndex) => {
          const state = automata.states[stateId];
          return {
            stateId,
            stateIndex,
            x: state.position?.x ?? statePlacePosition(stateIndex, { x: 0, y: 0 }).x,
            y: state.position?.y ?? statePlacePosition(stateIndex, { x: 0, y: 0 }).y,
          };
        });
        const minX = Math.min(...rawPositions.map((entry) => entry.x));
        const minY = Math.min(...rawPositions.map((entry) => entry.y));

        rawPositions.forEach((entry) => {
          normalizedStatePositions.set(entry.stateId, {
            x: automataBase.x + 180 + (entry.x - minX),
            y: automataBase.y + 40 + (entry.y - minY),
          });
        });

        stateIds.forEach((stateId, stateIndex) => {
          const state = automata.states[stateId];
          const position =
            normalizedStatePositions.get(stateId) ??
            statePlacePosition(stateIndex, { x: automataBase.x + 180, y: automataBase.y + 40 });
          stateIndexMap.set(stateId, stateIndex);
          statePositionMap.set(stateIndex, position);

          nodes.push({
            id: `${group.id}:state:${automata.id}:${stateId}`,
            kind: 'state_place',
            label: state.name,
            subtitle: automata.initialState === stateId ? 'initial' : undefined,
            groupId: group.id,
            source: { automataId: automata.id, stateId },
            position,
            metadata: {
              automataId: automata.id,
              stateId,
              isInitial: automata.initialState === stateId,
              inputs: state.inputs,
              outputs: state.outputs,
              variables: state.variables,
              nestedAutomata: state.nestedAutomata,
            },
          });

          if (state.nestedAutomata) {
            nodes.push({
              id: `${group.id}:nested:${automata.id}:${stateId}`,
              kind: 'subnet_container',
              label: state.nestedAutomata,
              subtitle: 'nested subnet',
              groupId: group.id,
              source: { automataId: state.nestedAutomata as AutomataId, stateId },
              position: nestedSubnetPosition(position, stateIndex),
              metadata: { nestedFromStateId: stateId, nestedAutomataId: state.nestedAutomata },
            });
            pushUniqueEdge(edges, {
              id: `${group.id}:state:${automata.id}:${stateId}->nested`,
              source: `${group.id}:state:${automata.id}:${stateId}`,
              target: `${group.id}:nested:${automata.id}:${stateId}`,
              metadata: { relation: 'nested_subnet' },
            });
          }
        });

        Object.values(automata.transitions).forEach((transition, transitionIndex) => {
          const fromIndex = stateIndexMap.get(transition.from);
          const toIndex = stateIndexMap.get(transition.to);
          const nodeId = `${group.id}:transition:${automata.id}:${transition.id}`;
          const position = transitionPosition(
            fromIndex ?? -1,
            toIndex ?? -1,
            statePositionMap,
            automataBase,
            transitionIndex,
          );

          nodes.push({
            id: nodeId,
            kind: 'transition_fire',
            label: transition.name || transition.id,
            subtitle: inferTransitionSubtitle(transition),
            groupId: group.id,
            source: { automataId: automata.id, transitionId: transition.id },
            position,
            metadata: {
              automataId: automata.id,
              transitionId: transition.id,
              from: transition.from,
              to: transition.to,
              type: transition.type ?? 'classic',
              weight: transition.weight,
              priority: transition.priority,
              condition: transition.condition,
              body: transition.body,
              event: transition.event,
              timed: transition.timed,
            },
          });

          if (fromIndex !== undefined) {
            pushUniqueEdge(edges, {
              id: `${group.id}:state:${automata.id}:${transition.from}->${nodeId}`,
              source: `${group.id}:state:${automata.id}:${transition.from}`,
              target: nodeId,
              sourceRef: { automataId: automata.id, stateId: transition.from, transitionId: transition.id },
            });
          }

          if (toIndex !== undefined) {
            pushUniqueEdge(edges, {
              id: `${nodeId}->${group.id}:state:${automata.id}:${transition.to}`,
              source: nodeId,
              target: `${group.id}:state:${automata.id}:${transition.to}`,
              sourceRef: { automataId: automata.id, stateId: transition.to, transitionId: transition.id },
            });
          }

          const sourceState = automata.states[transition.from];
          const targetState = automata.states[transition.to];

          inputPorts.forEach((port) => {
            const matches =
              sourceState.inputs.includes(port.name) ||
              textMentionsName(transition.condition, port.name) ||
              transition.event?.triggers?.some((trigger) => trigger.signalName === port.name);
            if (!matches) return;
            const interfaceNodeId = interfaceNodeIds.get(`${automata.id}:input:${port.name}`);
            if (!interfaceNodeId) return;
            pushUniqueEdge(edges, {
              id: `${interfaceNodeId}->${nodeId}`,
              source: interfaceNodeId,
              target: nodeId,
              sourceRef: { automataId: automata.id, portName: port.name, transitionId: transition.id },
            });
          });

          outputPorts.forEach((port) => {
            const matches =
              targetState.outputs.includes(port.name) ||
              textMentionsName(transition.body, port.name) ||
              textMentionsName(transition.triggered, port.name);
            if (!matches) return;
            const interfaceNodeId = interfaceNodeIds.get(`${automata.id}:output:${port.name}`);
            if (!interfaceNodeId) return;
            pushUniqueEdge(edges, {
              id: `${nodeId}->${interfaceNodeId}`,
              source: nodeId,
              target: interfaceNodeId,
              sourceRef: { automataId: automata.id, portName: port.name, transitionId: transition.id },
            });
          });

          localResources.forEach((resource) => {
            const resourceNodeId = interfaceNodeIds.get(`${automata.id}:resource:${resource.name}`);
            if (!resourceNodeId) return;
            const matches =
              textMentionsName(sourceState.code, resource.name) ||
              textMentionsName(targetState.code, resource.name) ||
              textMentionsName(transition.condition, resource.name) ||
              textMentionsName(transition.body, resource.name);
            if (!matches) return;

            pushUniqueEdge(edges, {
              id: `${resourceNodeId}->${nodeId}`,
              source: resourceNodeId,
              target: nodeId,
              sourceRef: { automataId: automata.id, resourceName: resource.name, transitionId: transition.id },
            });
            pushUniqueEdge(edges, {
              id: `${nodeId}->${resourceNodeId}`,
              source: nodeId,
              target: resourceNodeId,
              sourceRef: { automataId: automata.id, resourceName: resource.name, transitionId: transition.id },
            });
          });
        });
      }
    });

    if (input.options.showBindings) {
      bindings
        .filter(
          (binding) =>
            group.automataIds.includes(binding.sourceAutomataId) &&
            group.automataIds.includes(binding.targetAutomataId),
        )
        .forEach((binding, bindingIndex) => {
          const sourceNodeId =
            input.options.mode === 'overview'
              ? `${group.id}:subnet:${binding.sourceAutomataId}`
              : interfaceNodeIds.get(`${binding.sourceAutomataId}:output:${binding.sourceOutputName}`);
          const targetNodeId =
            input.options.mode === 'overview'
              ? `${group.id}:subnet:${binding.targetAutomataId}`
              : interfaceNodeIds.get(`${binding.targetAutomataId}:input:${binding.targetInputName}`);
          if (!sourceNodeId || !targetNodeId) return;

          const sourcePosition = nodes.find((node) => node.id === sourceNodeId)?.position;
          const targetPosition = nodes.find((node) => node.id === targetNodeId)?.position;
          const bindingPlaceId = `${group.id}:binding:${binding.id}`;

          if (!bindingPlaceNodeIds.has(binding.id)) {
            nodes.push({
              id: bindingPlaceId,
              kind: 'binding_place',
              label: binding.explicit ? 'binding' : 'derived',
              subtitle: `${binding.sourceOutputName} -> ${binding.targetInputName}`,
              groupId: group.id,
              source: {
                automataId: binding.sourceAutomataId,
                bindingId: binding.id,
                portName: binding.sourceOutputName,
              },
              position: {
                x: ((sourcePosition?.x ?? 0) + (targetPosition?.x ?? 0)) / 2 + 10,
                y: ((sourcePosition?.y ?? 0) + (targetPosition?.y ?? 0)) / 2 + (bindingIndex % 3) * 22,
              },
              metadata: {
                sourceAutomataId: binding.sourceAutomataId,
                targetAutomataId: binding.targetAutomataId,
                sourceOutputName: binding.sourceOutputName,
                targetInputName: binding.targetInputName,
                sourceType: binding.sourceType,
                targetType: binding.targetType,
                explicit: binding.explicit,
                derived: binding.derived,
                mode: input.options.mode,
              },
            });
            bindingPlaceNodeIds.set(binding.id, bindingPlaceId);
          }

          const sourceContext = deploymentContextByAutomata.get(binding.sourceAutomataId);
          const targetContext = deploymentContextByAutomata.get(binding.targetAutomataId);
          const overlay = createOverlayMetadata(sourceContext, targetContext, {
            explicitBinding: binding.explicit,
            derivedBinding: binding.derived,
          });
          const label = input.options.showLabels && input.options.mode === 'expanded'
            ? formatOverlayLabel(overlay, {
                showTransport: input.options.showTransport,
                showLatency: input.options.showLatency,
                hideUnknown: input.options.hideUnknownOverlayFields,
              })
            : undefined;

          pushUniqueEdge(edges, {
            id: `${sourceNodeId}->${bindingPlaceId}`,
            source: sourceNodeId,
            target: bindingPlaceId,
            label,
            overlay,
            sourceRef: {
              automataId: binding.sourceAutomataId,
              bindingId: binding.id,
              portName: binding.sourceOutputName,
            },
            metadata: { kind: 'binding_source' },
          });
          pushUniqueEdge(edges, {
            id: `${bindingPlaceId}->${targetNodeId}`,
            source: bindingPlaceId,
            target: targetNodeId,
            label,
            overlay,
            sourceRef: {
              automataId: binding.targetAutomataId,
              bindingId: binding.id,
              portName: binding.targetInputName,
            },
            metadata: { kind: 'binding_target' },
          });
        });
    }

    if (input.options.includeResources) {
      group.sharedResources.forEach((resource, index) => {
        const shouldRenderSharedResource =
          input.options.mode === 'overview' || resource.declaredBy.length > 1;
        if (!shouldRenderSharedResource) {
          return;
        }

        const resourceNodeId = `${group.id}:shared:${resource.name}:${resource.kind}`;
        nodes.push({
          id: resourceNodeId,
          kind: 'resource_place',
          label: resource.name,
          subtitle: resource.kind,
          groupId: group.id,
          source: { resourceName: resource.name },
          position: { x: baseOrigin.x + 360 + index * 130, y: baseOrigin.y - 80 },
          metadata: {
            capacity: resource.capacity,
            latencySensitive: resource.latencySensitive,
            shared: true,
            declaredBy: resource.declaredBy,
            conflicts: resource.conflicts,
          },
        });

        resource.declaredBy.forEach((automataId) => {
          const localResourceNodeId =
            input.options.mode === 'expanded'
              ? interfaceNodeIds.get(`${automataId}:resource:${resource.name}`)
              : undefined;
          const targetNodeId = localResourceNodeId ?? `${group.id}:subnet:${automataId}`;
          const overlay = createOverlayMetadata(
            deploymentContextByAutomata.get(automataId),
            undefined,
          );
          const label = input.options.showLabels && input.options.mode === 'expanded'
            ? formatOverlayLabel(overlay, {
                showTransport: input.options.showTransport,
                showLatency: input.options.showLatency,
                hideUnknown: input.options.hideUnknownOverlayFields,
              })
            : undefined;

          pushUniqueEdge(edges, {
            id: `${resourceNodeId}->${targetNodeId}`,
            source: resourceNodeId,
            target: targetNodeId,
            label,
            overlay,
            sourceRef: { automataId, resourceName: resource.name },
            metadata: { kind: 'shared_resource' },
          });
        });
      });
    }
  });

  return {
    mode: input.options.mode,
    groups,
    nodes: sortNodes(nodes),
    edges,
    warnings: graphWarnings,
  };
}
