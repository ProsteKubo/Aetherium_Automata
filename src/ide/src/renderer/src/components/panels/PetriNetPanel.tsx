import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  Edge,
  Handle,
  MarkerType,
  MiniMap,
  Node,
  NodeProps,
  Position,
  ReactFlowInstance,
} from 'reactflow';
import 'reactflow/dist/style.css';
import {
  useAnalyzerStore,
  useAutomataStore,
  useExecutionStore,
  useGatewayStore,
  useProjectStore,
  useRuntimeViewStore,
  useUIStore,
} from '../../stores';
import type {
  Automata,
  AutomataBinding,
  ExecutionSnapshot,
  PetriBuildOptions,
  PetriEdge,
  PetriNode,
  PetriSelection,
  PetriViewMode,
} from '../../types';
import { bindingIdentity } from '../../utils/automataBindings';
import { normalizeImportedAutomata } from '../../utils/importedAutomata';
import { buildPetriGraph } from '../../utils/petriBuilder';
import {
  IconAutomata,
  IconChevronRight,
  IconDevice,
  IconNetwork,
  IconRefresh,
} from '../common/Icons';

type PetriCanvasNodeData = {
  petriNode: PetriNode;
};

type GroupFilter = 'all' | string;

const PETRI_DEMO_SETS = [
  {
    id: 'signal_chain',
    title: 'Signal Chain Demo',
    description:
      'Four connected automata with derived bindings, a shared field bus, and one black-box drive unit.',
    relativePaths: [
      'example/automata/showcase/13_petri_signal_chain/petri_command_router.yaml',
      'example/automata/showcase/13_petri_signal_chain/petri_safety_gate.yaml',
      'example/automata/showcase/13_petri_signal_chain/petri_drive_unit_black_box.yaml',
      'example/automata/showcase/13_petri_signal_chain/petri_telemetry_observer.yaml',
    ],
  },
  {
    id: 'contention',
    title: 'Contention Demo',
    description:
      'Three automata linked by a shared dc_bus resource so you can show contention hotspots without transport.',
    relativePaths: [
      'example/automata/showcase/14_petri_contention/petri_power_allocator.yaml',
      'example/automata/showcase/14_petri_contention/petri_charger_node.yaml',
      'example/automata/showcase/14_petri_contention/petri_motion_axis.yaml',
    ],
  },
] as const;

const HIDDEN_HANDLE_STYLE = {
  width: 10,
  height: 10,
  opacity: 0,
  border: 'none',
  background: 'transparent',
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';

  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable]';
  }
}

function normalizeBinding(input: unknown): AutomataBinding | null {
  const record = asRecord(input);
  if (!record) return null;

  const sourceAutomataId = String(record.sourceAutomataId ?? record.source_automata_id ?? '');
  const sourceOutputName = String(record.sourceOutputName ?? record.source_output_name ?? '');
  const targetAutomataId = String(record.targetAutomataId ?? record.target_automata_id ?? '');
  const targetInputName = String(record.targetInputName ?? record.target_input_name ?? '');

  if (!sourceAutomataId || !sourceOutputName || !targetAutomataId || !targetInputName) {
    return null;
  }

  return {
    id:
      String(record.id ?? '').trim() ||
      bindingIdentity({
        sourceAutomataId,
        sourceOutputName,
        targetAutomataId,
        targetInputName,
      }),
    sourceAutomataId,
    sourceOutputId: String(record.sourceOutputId ?? record.source_output_id ?? sourceOutputName),
    sourceOutputName,
    targetAutomataId,
    targetInputId: String(record.targetInputId ?? record.target_input_id ?? targetInputName),
    targetInputName,
    sourceType: String(record.sourceType ?? record.source_type ?? 'any') as AutomataBinding['sourceType'],
    targetType: String(record.targetType ?? record.target_type ?? 'any') as AutomataBinding['targetType'],
    enabled: record.enabled !== false,
    description:
      typeof record.description === 'string' && record.description.trim() !== ''
        ? record.description
        : undefined,
    createdAt: Number(record.createdAt ?? record.created_at ?? Date.now()),
    modifiedAt: Number(record.modifiedAt ?? record.modified_at ?? Date.now()),
  };
}

function buildSearchHaystack(node: PetriNode): string {
  return [
    node.label,
    node.subtitle,
    node.source.automataId,
    node.source.stateId,
    node.source.transitionId,
    node.source.portName,
    node.source.resourceName,
    node.source.bindingId,
    ...Object.entries(node.metadata ?? {}).flatMap(([key, value]) => [key, formatValue(value)]),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function buildEdgeHaystack(edge: PetriEdge): string {
  return [
    edge.label,
    edge.sourceRef?.automataId,
    edge.sourceRef?.stateId,
    edge.sourceRef?.transitionId,
    edge.sourceRef?.portName,
    edge.sourceRef?.resourceName,
    edge.sourceRef?.bindingId,
    ...Object.entries(edge.metadata ?? {}).flatMap(([key, value]) => [key, formatValue(value)]),
    ...Object.entries(edge.overlay ?? {}).flatMap(([key, value]) => [key, formatValue(value)]),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function nodeColor(kind: PetriNode['kind']): string {
  switch (kind) {
    case 'resource_place':
      return '#f59e0b';
    case 'binding_place':
      return '#14b8a6';
    case 'transition_fire':
    case 'transition_guard':
      return '#f87171';
    case 'input_place':
      return '#60a5fa';
    case 'output_place':
      return '#34d399';
    case 'subnet_container':
      return '#94a3b8';
    case 'state_place':
    default:
      return '#7dd3fc';
  }
}

function edgeColor(edge: PetriEdge): string {
  if (edge.metadata?.kind === 'shared_resource' || edge.metadata?.relation === 'resource_link') {
    return '#f59e0b';
  }

  if (edge.metadata?.kind === 'binding_source' || edge.metadata?.kind === 'binding_target') {
    return edge.overlay?.derivedBinding ? '#67e8f9' : '#2dd4bf';
  }

  if (edge.metadata?.relation === 'nested_subnet') {
    return '#c084fc';
  }

  return '#7c8aa5';
}

const PetriCanvasNodeComponent: React.FC<NodeProps<PetriCanvasNodeData>> = ({ data, selected }) => {
  const node = data.petriNode;
  const metadata = node.metadata ?? {};
  const conflictCount = Array.isArray(metadata.conflicts) ? metadata.conflicts.length : 0;
  const nestedCount = Array.isArray(metadata.nestedAutomataIds) ? metadata.nestedAutomataIds.length : 0;
  const inputCount = typeof metadata.inputCount === 'number' ? metadata.inputCount : null;
  const outputCount = typeof metadata.outputCount === 'number' ? metadata.outputCount : null;
  const stateCount = typeof metadata.stateCount === 'number' ? metadata.stateCount : null;
  const transitionCount = typeof metadata.transitionCount === 'number' ? metadata.transitionCount : null;

  return (
    <div className={`petri-node kind-${node.kind} ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Left} style={HIDDEN_HANDLE_STYLE} />
      <div className="petri-node-body">
        <div className="petri-node-title">{node.label}</div>
        {node.subtitle && <div className="petri-node-subtitle">{node.subtitle}</div>}
        <div className="petri-node-badges">
          {metadata.isInitial === true && <span className="petri-chip">initial</span>}
          {metadata.shared === true && <span className="petri-chip">shared</span>}
          {metadata.latencySensitive === true && <span className="petri-chip accent">latency</span>}
          {nestedCount > 0 && <span className="petri-chip">nested {nestedCount}</span>}
          {conflictCount > 0 && <span className="petri-chip warning">{conflictCount} warnings</span>}
          {node.kind === 'subnet_container' && stateCount !== null && (
            <span className="petri-chip">{stateCount} states</span>
          )}
          {node.kind === 'subnet_container' && transitionCount !== null && (
            <span className="petri-chip">{transitionCount} transitions</span>
          )}
          {node.kind === 'subnet_container' && inputCount !== null && (
            <span className="petri-chip">{inputCount} in</span>
          )}
          {node.kind === 'subnet_container' && outputCount !== null && (
            <span className="petri-chip">{outputCount} out</span>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={HIDDEN_HANDLE_STYLE} />
    </div>
  );
};

const petriNodeTypes = {
  petriNode: PetriCanvasNodeComponent,
};

export const PetriNetPanel: React.FC = () => {
  const [viewMode, setViewMode] = useState<PetriViewMode>('overview');
  const [selectedGroupId, setSelectedGroupId] = useState<GroupFilter>('all');
  const [expandedAutomataIds, setExpandedAutomataIds] = useState<string[]>([]);
  const [includeDerivedBindings, setIncludeDerivedBindings] = useState(true);
  const [explicitBindingsOnly, setExplicitBindingsOnly] = useState(false);
  const [includeResources, setIncludeResources] = useState(true);
  const [hideNonSharedResources, setHideNonSharedResources] = useState(false);
  const [showBindings, setShowBindings] = useState(true);
  const [showTransport, setShowTransport] = useState(true);
  const [showLatency, setShowLatency] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [hideUnknownOverlayFields, setHideUnknownOverlayFields] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [selection, setSelection] = useState<PetriSelection | null>(null);
  const [explicitBindings, setExplicitBindings] = useState<AutomataBinding[]>([]);
  const [bindingLoadError, setBindingLoadError] = useState<string | null>(null);
  const [loadingBindings, setLoadingBindings] = useState(false);
  const [importingDemoId, setImportingDemoId] = useState<string | null>(null);
  const [focusAutomataId, setFocusAutomataId] = useState<string | null>(null);
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance | null>(null);

  const automataMap = useAutomataStore((state) => state.automata);
  const setAutomataMap = useAutomataStore((state) => state.setAutomataMap);
  const setActiveAutomata = useAutomataStore((state) => state.setActiveAutomata);
  const updateAnalyzerQuery = useAnalyzerStore((state) => state.updateQuery);
  const refreshAnalyzer = useAnalyzerStore((state) => state.refresh);
  const deviceExecutions = useExecutionStore((state) => state.deviceExecutions);
  const devices = useGatewayStore((state) => state.devices);
  const gatewayStatus = useGatewayStore((state) => state.status);
  const gatewayService = useGatewayStore((state) => state.service);
  const createNetwork = useProjectStore((state) => state.createNetwork);
  const addAutomataToNetwork = useProjectStore((state) => state.addAutomataToNetwork);
  const ensureLocalProject = useProjectStore((state) => state.ensureLocalProject);
  const markProjectDirty = useProjectStore((state) => state.markDirty);
  const deployments = useRuntimeViewStore((state) => state.deployments);
  const layout = useUIStore((state) => state.layout);
  const togglePanel = useUIStore((state) => state.togglePanel);
  const openTab = useUIStore((state) => state.openTab);
  const addNotification = useUIStore((state) => state.addNotification);

  const activatePanel = useCallback(
    (panelId: 'automata' | 'connections') => {
      if (!layout.panels[panelId]?.isVisible) {
        togglePanel(panelId);
      }
    },
    [layout.panels, togglePanel],
  );

  const openAutomata = useCallback(
    (automataId: string | undefined) => {
      if (!automataId) return;
      const automata = automataMap.get(automataId);
      if (!automata) return;

      setActiveAutomata(automata.id);
      openTab({
        type: 'automata',
        targetId: automata.id,
        name: automata.config.name,
        isDirty: Boolean(automata.isDirty),
      });
      activatePanel('automata');
    },
    [activatePanel, automataMap, openTab, setActiveAutomata],
  );

  const openState = useCallback(
    (automataId: string | undefined, stateId: string | undefined) => {
      if (!automataId || !stateId) return;
      const automata = automataMap.get(automataId);
      const state = automata?.states[stateId];
      if (!automata || !state) return;

      setActiveAutomata(automata.id);
      openTab({
        type: 'code',
        targetId: stateId,
        name: state.name,
        isDirty: Boolean(automata.isDirty),
      });
      activatePanel('automata');
    },
    [activatePanel, automataMap, openTab, setActiveAutomata],
  );

  const openConnectionsPanel = useCallback(() => {
    activatePanel('automata');
    activatePanel('connections');
  }, [activatePanel]);

  const openAnalyzer = useCallback(
    async (automataIds: string[]) => {
      const scopedAutomataIds = Array.from(new Set(automataIds.filter(Boolean)));
      if (scopedAutomataIds.length === 0) {
        return;
      }

      const ui = useUIStore.getState();
      if (!ui.layout.panels.analyzer?.isVisible) {
        ui.togglePanel('analyzer');
      }
      updateAnalyzerQuery({
        scope: 'group',
        automataIds: scopedAutomataIds,
        deploymentIds: undefined,
      });
      await refreshAnalyzer();
    },
    [refreshAnalyzer, updateAnalyzerQuery],
  );

  const executionSnapshots = useMemo(() => {
    const snapshots = new Map<string, ExecutionSnapshot | null>();

    deviceExecutions.forEach((execution) => {
      const snapshot = execution.currentSnapshot;
      if (!snapshot?.automataId) return;

      const existing = snapshots.get(snapshot.automataId);
      if (!existing || snapshot.timestamp > existing.timestamp) {
        snapshots.set(snapshot.automataId, snapshot);
      }
    });

    return snapshots;
  }, [deviceExecutions]);

  const attachImportedAutomata = useCallback(
    (
      importedData: Partial<Automata> | Record<string, unknown>,
      filePath?: string,
    ): { id: string; name: string; skipped: boolean } | null => {
      const normalizedPath = String(filePath || '').replace(/\\/g, '/');
      const currentAutomataMap = useAutomataStore.getState().automata;
      const existing = normalizedPath
        ? Array.from(currentAutomataMap.values()).find(
            (automata) => String(automata.filePath || '').replace(/\\/g, '/') === normalizedPath,
          )
        : undefined;

      if (existing) {
        return { id: existing.id, name: existing.config.name, skipped: true };
      }

      const normalizedAutomata = normalizeImportedAutomata(importedData as Record<string, unknown>, {
        filePath,
        keepDirty: true,
      });

      const nextMap = new Map(useAutomataStore.getState().automata);
      nextMap.set(normalizedAutomata.id, normalizedAutomata);
      setAutomataMap(nextMap);

      let activeProject = useProjectStore.getState().project;
      if (!activeProject) {
        ensureLocalProject('Petri Demo Project');
        activeProject = useProjectStore.getState().project;
      }

      if (activeProject) {
        let networkId = activeProject.networks[0]?.id;
        if (!networkId) {
          networkId = createNetwork('Default Network');
        }
        addAutomataToNetwork(networkId, normalizedAutomata);
        markProjectDirty();
      }

      return { id: normalizedAutomata.id, name: normalizedAutomata.config.name, skipped: false };
    },
    [
      addAutomataToNetwork,
      createNetwork,
      ensureLocalProject,
      markProjectDirty,
      setAutomataMap,
    ],
  );

  const importShowcaseAutomata = useCallback(
    async (target: string): Promise<{ id: string; name: string; skipped: boolean } | null> => {
      const result = await window.api.automata.loadShowcase(target);
      if (!result.success || !result.data) {
        addNotification('error', 'Petri Demo', result.error || `Failed to load ${target}`);
        return null;
      }

      return attachImportedAutomata(result.data as Record<string, unknown>, result.filePath);
    },
    [addNotification, attachImportedAutomata],
  );

  const importDemoSet = useCallback(
    async (demoId: string) => {
      const demo = PETRI_DEMO_SETS.find((entry) => entry.id === demoId);
      if (!demo) return;

      setImportingDemoId(demoId);
      try {
        const loaded: Array<{ id: string; name: string; skipped: boolean }> = [];
        for (const relativePath of demo.relativePaths) {
          const imported = await importShowcaseAutomata(relativePath);
          if (imported) {
            loaded.push(imported);
          }
        }

        if (loaded.length === 0) {
          return;
        }

        const first = loaded[0];
        loaded.forEach((entry) => {
          const automata = useAutomataStore.getState().automata.get(entry.id);
          if (!automata) return;
          openTab({
            type: 'automata',
            targetId: automata.id,
            name: automata.config.name,
            isDirty: Boolean(automata.isDirty),
          });
        });
        setActiveAutomata(first.id);
        setViewMode('overview');
        setSelectedGroupId('all');
        setExpandedAutomataIds([]);
        setSelection(null);
        setSearchText('');
        setFocusAutomataId(first.id);

        const importedCount = loaded.filter((entry) => !entry.skipped).length;
        const skippedCount = loaded.filter((entry) => entry.skipped).length;
        const summary =
          skippedCount > 0
            ? `Loaded ${importedCount} new automata and reused ${skippedCount} existing automata.`
            : `Loaded ${importedCount} automata into the editor.`;
        addNotification('success', demo.title, summary);
      } finally {
        setImportingDemoId(null);
      }
    },
    [addNotification, flowInstance, importShowcaseAutomata, openTab, setActiveAutomata],
  );

  const refreshBindings = useCallback(async () => {
    if (gatewayStatus !== 'connected') {
      setExplicitBindings([]);
      setBindingLoadError(null);
      setLoadingBindings(false);
      return;
    }

    setLoadingBindings(true);
    try {
      const next = await gatewayService.listConnections();
      setExplicitBindings(next);
      setBindingLoadError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load connections';
      setBindingLoadError(message);
      setExplicitBindings([]);
    } finally {
      setLoadingBindings(false);
    }
  }, [gatewayService, gatewayStatus]);

  useEffect(() => {
    void refreshBindings();
  }, [refreshBindings]);

  useEffect(() => {
    const unsubscribe = gatewayService.on('onConnectionList', (event) => {
      const next = (event.connections ?? [])
        .map((binding) => normalizeBinding(binding))
        .filter(Boolean) as AutomataBinding[];
      setExplicitBindings(next);
      setBindingLoadError(null);
      setLoadingBindings(false);
    });

    return unsubscribe;
  }, [gatewayService]);

  const options = useMemo<PetriBuildOptions>(
    () => ({
      mode: viewMode,
      selectedGroupId: selectedGroupId === 'all' ? undefined : selectedGroupId,
      expandedAutomataIds,
      includeDerivedBindings,
      explicitBindingsOnly,
      includeResources,
      hideNonSharedResources,
      showBindings,
      showTransport,
      showLatency,
      showLabels,
      hideUnknownOverlayFields,
    }),
    [
      expandedAutomataIds,
      explicitBindingsOnly,
      hideNonSharedResources,
      hideUnknownOverlayFields,
      includeDerivedBindings,
      includeResources,
      selectedGroupId,
      showBindings,
      showLabels,
      showLatency,
      showTransport,
      viewMode,
    ],
  );

  const graph = useMemo(
    () =>
      buildPetriGraph({
        automataMap,
        explicitBindings,
        deployments,
        devices,
        executionSnapshots,
        options,
      }),
    [automataMap, deployments, devices, executionSnapshots, explicitBindings, options],
  );

  useEffect(() => {
    if (selectedGroupId !== 'all' && !graph.groups.some((group) => group.id === selectedGroupId)) {
      setSelectedGroupId('all');
    }
  }, [graph.groups, selectedGroupId]);

  useEffect(() => {
    if (viewMode === 'expanded' && selectedGroupId === 'all' && graph.groups[0]) {
      setSelectedGroupId(graph.groups[0].id);
    }
  }, [graph.groups, selectedGroupId, viewMode]);

  useEffect(() => {
    if (!focusAutomataId) return;
    const targetGroup = graph.groups.find((group) => group.automataIds.includes(focusAutomataId));
    if (!targetGroup) return;
    setSelectedGroupId(targetGroup.id);
    setTimeout(() => {
      flowInstance?.fitView({ padding: 0.22, duration: 180 });
    }, 40);
    setFocusAutomataId(null);
  }, [focusAutomataId, flowInstance, graph.groups]);

  useEffect(() => {
    if (
      viewMode === 'expanded' &&
      expandedAutomataIds.length === 0 &&
      selectedGroupId !== 'all'
    ) {
      const group = graph.groups.find((entry) => entry.id === selectedGroupId);
      if (group?.automataIds[0]) {
        setExpandedAutomataIds([group.automataIds[0]]);
      }
    }
  }, [expandedAutomataIds.length, graph.groups, selectedGroupId, viewMode]);

  const scopedGroups = useMemo(
    () =>
      selectedGroupId === 'all'
        ? graph.groups
        : graph.groups.filter((group) => group.id === selectedGroupId),
    [graph.groups, selectedGroupId],
  );

  const scopedNodeIds = useMemo(() => {
    const allowedGroupIds = new Set(scopedGroups.map((group) => group.id));
    return new Set(
      graph.nodes.filter((node) => allowedGroupIds.has(node.groupId)).map((node) => node.id),
    );
  }, [graph.nodes, scopedGroups]);

  const scopedNodes = useMemo(
    () => graph.nodes.filter((node) => scopedNodeIds.has(node.id)),
    [graph.nodes, scopedNodeIds],
  );

  const scopedEdges = useMemo(
    () =>
      graph.edges.filter((edge) => scopedNodeIds.has(edge.source) && scopedNodeIds.has(edge.target)),
    [graph.edges, scopedNodeIds],
  );

  const filteredGraph = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) {
      return { nodes: scopedNodes, edges: scopedEdges };
    }

    const matchingNodeIds = new Set(
      scopedNodes.filter((node) => buildSearchHaystack(node).includes(query)).map((node) => node.id),
    );
    const matchingEdgeIds = new Set(
      scopedEdges.filter((edge) => buildEdgeHaystack(edge).includes(query)).map((edge) => edge.id),
    );

    const retainedNodeIds = new Set(matchingNodeIds);
    scopedEdges.forEach((edge) => {
      if (!matchingEdgeIds.has(edge.id)) return;
      retainedNodeIds.add(edge.source);
      retainedNodeIds.add(edge.target);
    });

    const nodes = scopedNodes.filter((node) => retainedNodeIds.has(node.id));
    const nodeIds = new Set(nodes.map((node) => node.id));
    const edges = scopedEdges.filter(
      (edge) =>
        nodeIds.has(edge.source) &&
        nodeIds.has(edge.target) &&
        (matchingEdgeIds.has(edge.id) ||
          matchingNodeIds.has(edge.source) ||
          matchingNodeIds.has(edge.target)),
    );

    return { nodes, edges };
  }, [scopedEdges, scopedNodes, searchText]);

  useEffect(() => {
    if (!selection) return;
    const nodes = new Set(filteredGraph.nodes.map((node) => node.id));
    const edges = new Set(filteredGraph.edges.map((edge) => edge.id));
    if (
      (selection.kind === 'node' && !nodes.has(selection.id)) ||
      (selection.kind === 'edge' && !edges.has(selection.id))
    ) {
      setSelection(null);
    }
  }, [filteredGraph.edges, filteredGraph.nodes, selection]);

  const selectedNode =
    selection?.kind === 'node'
      ? filteredGraph.nodes.find((node) => node.id === selection.id) ?? null
      : null;
  const selectedEdge =
    selection?.kind === 'edge'
      ? filteredGraph.edges.find((edge) => edge.id === selection.id) ?? null
      : null;

  const flowNodes = useMemo<Node<PetriCanvasNodeData>[]>(
    () =>
      filteredGraph.nodes.map((node) => ({
        id: node.id,
        type: 'petriNode',
        position: node.position,
        data: { petriNode: node },
        draggable: false,
        selectable: true,
      })),
    [filteredGraph.nodes],
  );

  const flowEdges = useMemo<Edge[]>(
    () =>
      filteredGraph.edges.map((edge) => {
        const color = edgeColor(edge);
        const dashed =
          edge.overlay?.overlayConfidence === 'unknown' ||
          edge.overlay?.derivedBinding === true ||
          edge.metadata?.relation === 'nested_subnet';

        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          type: 'smoothstep',
          label: edge.label,
          animated:
            edge.metadata?.kind === 'binding_source' || edge.metadata?.kind === 'binding_target',
          markerEnd: { type: MarkerType.ArrowClosed, color },
          style: {
            stroke: color,
            strokeWidth:
              edge.metadata?.kind === 'binding_source' || edge.metadata?.kind === 'binding_target'
                ? 2.3
                : 1.7,
            strokeDasharray: dashed ? '7 5' : undefined,
          },
          labelStyle: {
            fill: '#dbe7ff',
            fontSize: 11,
            fontWeight: 600,
          },
          labelBgStyle: {
            fill: 'rgba(7, 12, 22, 0.9)',
            stroke: 'rgba(125, 211, 252, 0.18)',
          },
          labelBgPadding: [6, 3],
          data: edge,
        };
      }),
    [filteredGraph.edges],
  );

  const summary = useMemo(() => {
    const groupIds = new Set(filteredGraph.nodes.map((node) => node.groupId));
    const automataIds = new Set(
      filteredGraph.nodes
        .map((node) => node.source.automataId)
        .filter((automataId): automataId is string => Boolean(automataId)),
    );
    const places = filteredGraph.nodes.filter(
      (node) => node.kind !== 'transition_fire' && node.kind !== 'transition_guard',
    ).length;
    const transitions = filteredGraph.nodes.filter(
      (node) => node.kind === 'transition_fire' || node.kind === 'transition_guard',
    ).length;
    const unknownLatencyEdges = filteredGraph.edges.filter(
      (edge) => edge.overlay && !edge.overlay.latencyKnown,
    ).length;
    const sharedResources = scopedGroups.reduce(
      (count, group) => count + group.sharedResources.length,
      0,
    );

    return {
      groups: groupIds.size,
      automata: automataIds.size,
      places,
      transitions,
      arcs: filteredGraph.edges.length,
      sharedResources,
      unknownLatencyEdges,
    };
  }, [filteredGraph.edges, filteredGraph.nodes, scopedGroups]);

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node<PetriCanvasNodeData>) => {
      setSelection({ kind: 'node', id: node.id });

      const petriNode = node.data.petriNode;
      const automataId = petriNode.source.automataId;

      if (petriNode.kind === 'subnet_container' && automataId) {
        setSelectedGroupId(petriNode.groupId);
        if (viewMode === 'overview') {
          setViewMode('expanded');
        }
        setExpandedAutomataIds((current) =>
          current.includes(automataId) ? current : [...current, automataId],
        );
      }
    },
    [viewMode],
  );

  const handleNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: Node<PetriCanvasNodeData>) => {
      const petriNode = node.data.petriNode;
      if (petriNode.source.stateId) {
        openState(petriNode.source.automataId, petriNode.source.stateId);
        return;
      }
      openAutomata(petriNode.source.automataId);
    },
    [openAutomata, openState],
  );

  const handleEdgeClick = useCallback((_event: React.MouseEvent, edge: Edge) => {
    setSelection({ kind: 'edge', id: edge.id });
  }, []);

  const selectedNodeMetadataEntries = useMemo(
    () =>
      Object.entries(selectedNode?.metadata ?? {}).filter(([, value]) => value !== undefined),
    [selectedNode],
  );

  const selectedEdgeOverlayEntries = useMemo(
    () =>
      Object.entries(selectedEdge?.overlay ?? {}).filter(([, value]) => value !== undefined),
    [selectedEdge],
  );

  const selectedEdgeMetadataEntries = useMemo(
    () =>
      Object.entries(selectedEdge?.metadata ?? {}).filter(([, value]) => value !== undefined),
    [selectedEdge],
  );

  const selectedGroupAutomata = useMemo(
    () =>
      selectedGroupId === 'all'
        ? []
        : graph.groups.find((group) => group.id === selectedGroupId)?.automataIds ?? [],
    [graph.groups, selectedGroupId],
  );

  const mergeGroup = useMemo(() => {
    if (selectedGroupId !== 'all') {
      return graph.groups.find((group) => group.id === selectedGroupId) ?? null;
    }
    return graph.groups.length === 1 ? graph.groups[0] : null;
  }, [graph.groups, selectedGroupId]);

  const isSingleAutomatonView = useMemo(
    () => scopedGroups.length === 1 && scopedGroups[0]?.automataIds.length === 1,
    [scopedGroups],
  );

  const hasGraphContent = graph.nodes.length > 0;

  const emptyMessage =
    automataMap.size === 0
      ? 'No automata available to compose into a Petri graph.'
      : searchText.trim()
        ? 'No Petri entities matched the current filters.'
        : 'No Petri entities are visible with the current filters.';

  return (
    <div className="petri-panel">
      <div className="petri-toolbar">
        <div className="petri-toolbar-group">
          <span className="petri-toolbar-label">Group</span>
          <select
            className="petri-select"
            value={selectedGroupId}
            onChange={(event) => setSelectedGroupId(event.target.value)}
          >
            <option value="all">All groups</option>
            {graph.groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.label} ({group.automataIds.length})
              </option>
            ))}
          </select>
        </div>

        <div className="petri-toolbar-group">
          <button
            type="button"
            className={`btn btn-sm ${viewMode === 'overview' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setViewMode('overview')}
          >
            Overview
          </button>
          <button
            type="button"
            className={`btn btn-sm ${viewMode === 'expanded' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setViewMode('expanded')}
          >
            Expanded
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setExpandedAutomataIds([])}
            disabled={expandedAutomataIds.length === 0}
          >
            Collapse
          </button>
        </div>

        <div className="petri-toolbar-group petri-toolbar-group-grow">
          <input
            className="petri-search"
            type="search"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Search automata, states, transitions, ports, resources"
          />
        </div>

        <div className="petri-toolbar-group">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => flowInstance?.zoomIn()}>
            +
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => flowInstance?.zoomOut()}>
            -
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => flowInstance?.fitView({ padding: 0.18, duration: 150 })}
          >
            Fit
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => void refreshBindings()}
            disabled={loadingBindings}
            title="Refresh explicit connection inventory"
          >
            <IconRefresh size={14} />
          </button>
        </div>
      </div>

      <div className="petri-filter-grid">
        <label className="petri-toggle">
          <input
            type="checkbox"
            checked={includeDerivedBindings}
            onChange={(event) => setIncludeDerivedBindings(event.target.checked)}
            disabled={explicitBindingsOnly}
          />
          <span>Derived bindings</span>
        </label>
        <label className="petri-toggle">
          <input
            type="checkbox"
            checked={explicitBindingsOnly}
            onChange={(event) => setExplicitBindingsOnly(event.target.checked)}
          />
          <span>Explicit only</span>
        </label>
        <label className="petri-toggle">
          <input
            type="checkbox"
            checked={showBindings}
            onChange={(event) => setShowBindings(event.target.checked)}
          />
          <span>Bindings</span>
        </label>
        <label className="petri-toggle">
          <input
            type="checkbox"
            checked={includeResources}
            onChange={(event) => setIncludeResources(event.target.checked)}
          />
          <span>Resources</span>
        </label>
        <label className="petri-toggle">
          <input
            type="checkbox"
            checked={hideNonSharedResources}
            onChange={(event) => setHideNonSharedResources(event.target.checked)}
            disabled={!includeResources}
          />
          <span>Shared only</span>
        </label>
        <label className="petri-toggle">
          <input
            type="checkbox"
            checked={showTransport}
            onChange={(event) => setShowTransport(event.target.checked)}
          />
          <span>Transport</span>
        </label>
        <label className="petri-toggle">
          <input
            type="checkbox"
            checked={showLatency}
            onChange={(event) => setShowLatency(event.target.checked)}
          />
          <span>Latency</span>
        </label>
        <label className="petri-toggle">
          <input
            type="checkbox"
            checked={showLabels}
            onChange={(event) => setShowLabels(event.target.checked)}
          />
          <span>Labels</span>
        </label>
        <label className="petri-toggle">
          <input
            type="checkbox"
            checked={hideUnknownOverlayFields}
            onChange={(event) => setHideUnknownOverlayFields(event.target.checked)}
          />
          <span>Hide unknown overlay</span>
        </label>
      </div>

      {hasGraphContent ? (
        <div className="petri-demo-actions">
          <div className="petri-demo-actions-copy">Quick demos for actual multi-automata composition:</div>
          <div className="petri-inline-list">
            {PETRI_DEMO_SETS.map((demo) => (
              <button
                key={demo.id}
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => void importDemoSet(demo.id)}
                disabled={importingDemoId !== null}
              >
                {importingDemoId === demo.id ? `Importing ${demo.title}…` : demo.title}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="petri-demo-strip">
          {PETRI_DEMO_SETS.map((demo) => (
            <div key={demo.id} className="petri-demo-card">
              <div className="petri-demo-card-header">
                <div>
                  <div className="petri-demo-title">{demo.title}</div>
                  <div className="petri-demo-count">{demo.relativePaths.length} automata</div>
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => void importDemoSet(demo.id)}
                  disabled={importingDemoId !== null}
                >
                  {importingDemoId === demo.id ? 'Importing…' : 'Import Demo'}
                </button>
              </div>
              <div className="petri-demo-description">{demo.description}</div>
              <div className="petri-inline-list">
                {demo.relativePaths.map((relativePath) => (
                  <span key={relativePath} className="petri-chip">
                    {relativePath.split('/').pop()?.replace(/\.ya?ml$/, '')}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="petri-body">
        <div className="petri-canvas-shell">
          <div className="petri-panel-meta">
            <div className="petri-meta-left">
              <span className="petri-chip">
                <IconNetwork size={12} />
                {graph.groups.length} groups
              </span>
              <span className="petri-chip">
                <IconAutomata size={12} />
                {Array.from(automataMap.values()).length} automata
              </span>
              <span className="petri-chip">
                <IconDevice size={12} />
                {devices.size} devices
              </span>
            </div>
            <div className="petri-meta-right">
              {loadingBindings && <span className="petri-status">Refreshing bindings…</span>}
              {!loadingBindings && bindingLoadError && (
                <span className="petri-status warning">Bindings unavailable: {bindingLoadError}</span>
              )}
              {!loadingBindings && !bindingLoadError && gatewayStatus !== 'connected' && (
                <span className="petri-status">Offline: explicit bindings unavailable, derived view still works.</span>
              )}
            </div>
          </div>

          {filteredGraph.nodes.length === 0 ? (
            <div className="petri-empty">
              <div className="empty-state">
                <div className="empty-state-title">Petri View</div>
                <div className="empty-state-description">{emptyMessage}</div>
              </div>
            </div>
          ) : (
            <div className="petri-canvas">
              <ReactFlow
                nodes={flowNodes}
                edges={flowEdges}
                nodeTypes={petriNodeTypes}
                onInit={setFlowInstance}
                onNodeClick={handleNodeClick}
                onNodeDoubleClick={handleNodeDoubleClick}
                onEdgeClick={handleEdgeClick}
                onPaneClick={() => setSelection(null)}
                fitView
                nodesDraggable={false}
                nodesConnectable={false}
                proOptions={{ hideAttribution: true }}
              >
                <Controls showInteractive={false} />
                <MiniMap
                  pannable
                  zoomable
                  nodeColor={(node) => nodeColor((node.data as PetriCanvasNodeData).petriNode.kind)}
                  maskColor="rgba(3, 8, 18, 0.68)"
                />
                <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
              </ReactFlow>
            </div>
          )}
        </div>

        <aside className="petri-inspector">
          <div className="petri-inspector-header">
            <div>
              <h3>Inspector</h3>
              <p>Selection details, source mapping, and overlay metadata.</p>
            </div>
          </div>

          {!selectedNode && !selectedEdge ? (
            <>
              {mergeGroup && (
                <div className="petri-inspector-section">
                  <div className="petri-block-title">Why This Is One Petri Net</div>
                  <div className="petri-inspector-subtitle">
                    {mergeGroup.automataIds.length} automata are merged into {mergeGroup.label.toLowerCase()}
                    {' '}because they share bindings and/or resources.
                  </div>
                  <div className="petri-inline-list">
                    {mergeGroup.automataIds.map((automataId) => (
                      <button
                        key={automataId}
                        type="button"
                        className="petri-inline-link"
                        onClick={() => openAutomata(automataId)}
                      >
                        {automataMap.get(automataId)?.config.name ?? automataId}
                      </button>
                    ))}
                  </div>
                  <div className="petri-inspector-actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => void openAnalyzer(mergeGroup.automataIds)}
                    >
                      Open In Analyzer
                    </button>
                  </div>

                  <div className="petri-inspector-block">
                    <div className="petri-block-title">Bindings</div>
                    {mergeGroup.bindings.length > 0 ? (
                      <div className="petri-warning-list">
                        {mergeGroup.bindings.map((binding) => (
                          <div key={binding.id} className="petri-merge-item">
                            <span className={`petri-chip ${binding.derived ? '' : 'accent'}`}>
                              {binding.derived ? 'derived' : 'explicit'}
                            </span>
                            <span>
                              {automataMap.get(binding.sourceAutomataId)?.config.name ?? binding.sourceAutomataId}
                              {'.'}
                              {binding.sourceOutputName}
                              {' -> '}
                              {automataMap.get(binding.targetAutomataId)?.config.name ?? binding.targetAutomataId}
                              {'.'}
                              {binding.targetInputName}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="petri-inspector-empty">No inter-automata bindings in this group.</div>
                    )}
                  </div>

                  <div className="petri-inspector-block">
                    <div className="petri-block-title">Shared Resources</div>
                    {mergeGroup.sharedResources.length > 0 ? (
                      <div className="petri-warning-list">
                        {mergeGroup.sharedResources.map((resource) => (
                          <div key={`${resource.name}:${resource.kind}`} className="petri-merge-item">
                            <span className="petri-chip accent">{resource.name}</span>
                            <span>
                              {resource.kind}
                              {' · used by '}
                              {resource.declaredBy
                                .map((automataId) => automataMap.get(automataId)?.config.name ?? automataId)
                                .join(', ')}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="petri-inspector-empty">No shared resources in this group.</div>
                    )}
                  </div>
                </div>
              )}

              {isSingleAutomatonView && (
                <div className="petri-inspector-section">
                  <div className="petri-block-title">Single Automaton View</div>
                  <div className="petri-inspector-subtitle">
                    This scope contains one automaton only. Import a demo set or switch to a multi-automata
                    group to see an actual merged net.
                  </div>
                  {scopedGroups[0]?.automataIds[0] && (
                    <div className="petri-inspector-actions">
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => void openAnalyzer(scopedGroups[0].automataIds)}
                      >
                        Analyze This Automata
                      </button>
                    </div>
                  )}
                </div>
              )}

              {!mergeGroup && !isSingleAutomatonView && (
                <div className="petri-inspector-empty">
                  Select a place, transition, or arc to inspect it.
                </div>
              )}
            </>
          ) : (
            <>
              {selectedNode && (
                <div className="petri-inspector-section">
                  <div className="petri-inspector-title">
                    <span>{selectedNode.label}</span>
                    <span className="petri-chip">{selectedNode.kind}</span>
                  </div>
                  {selectedNode.subtitle && (
                    <div className="petri-inspector-subtitle">{selectedNode.subtitle}</div>
                  )}
                  <div className="petri-inspector-actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => openAutomata(selectedNode.source.automataId)}
                      disabled={!selectedNode.source.automataId}
                    >
                      Open Automata
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() =>
                        openState(selectedNode.source.automataId, selectedNode.source.stateId)
                      }
                      disabled={!selectedNode.source.stateId}
                    >
                      Open State
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={openConnectionsPanel}
                    >
                      Open Connections
                    </button>
                    {selectedNode.source.automataId && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => void openAnalyzer([selectedNode.source.automataId!])}
                      >
                        Open In Analyzer
                      </button>
                    )}
                  </div>
                  {selectedNode.source.automataId && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        setViewMode('expanded');
                        setSelectedGroupId(selectedNode.groupId);
                        setExpandedAutomataIds((current) =>
                          current.includes(selectedNode.source.automataId!)
                            ? current.filter((id) => id !== selectedNode.source.automataId)
                            : [...current, selectedNode.source.automataId!],
                        );
                      }}
                    >
                      {expandedAutomataIds.includes(selectedNode.source.automataId)
                        ? 'Collapse subnet'
                        : 'Expand subnet'}
                    </button>
                  )}

                  <div className="petri-inspector-grid">
                    <div>
                      <span className="petri-kv-label">Automata</span>
                      <span>{selectedNode.source.automataId ?? 'n/a'}</span>
                    </div>
                    <div>
                      <span className="petri-kv-label">State</span>
                      <span>{selectedNode.source.stateId ?? 'n/a'}</span>
                    </div>
                    <div>
                      <span className="petri-kv-label">Transition</span>
                      <span>{selectedNode.source.transitionId ?? 'n/a'}</span>
                    </div>
                    <div>
                      <span className="petri-kv-label">Port</span>
                      <span>{selectedNode.source.portName ?? 'n/a'}</span>
                    </div>
                    <div>
                      <span className="petri-kv-label">Resource</span>
                      <span>{selectedNode.source.resourceName ?? 'n/a'}</span>
                    </div>
                    <div>
                      <span className="petri-kv-label">Binding</span>
                      <span>{selectedNode.source.bindingId ?? 'n/a'}</span>
                    </div>
                  </div>

                  {selectedNodeMetadataEntries.length > 0 && (
                    <div className="petri-inspector-block">
                      <div className="petri-block-title">Metadata</div>
                      <div className="petri-code-block">
                        {selectedNodeMetadataEntries.map(([key, value]) => (
                          <div key={key} className="petri-code-line">
                            <span className="petri-code-key">{key}</span>
                            <span className="petri-code-value">{formatValue(value)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {selectedEdge && (
                <div className="petri-inspector-section">
                  <div className="petri-inspector-title">
                    <span>{selectedEdge.label || selectedEdge.id}</span>
                    <span className="petri-chip">arc</span>
                  </div>
                  {selectedGroupAutomata.length > 0 && (
                    <div className="petri-inspector-actions">
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => void openAnalyzer(selectedGroupAutomata)}
                      >
                        Open In Analyzer
                      </button>
                    </div>
                  )}
                  <div className="petri-inspector-grid">
                    <div>
                      <span className="petri-kv-label">From</span>
                      <span>{selectedEdge.source}</span>
                    </div>
                    <div>
                      <span className="petri-kv-label">To</span>
                      <span>{selectedEdge.target}</span>
                    </div>
                    <div>
                      <span className="petri-kv-label">Binding</span>
                      <span>{selectedEdge.sourceRef?.bindingId ?? 'n/a'}</span>
                    </div>
                    <div>
                      <span className="petri-kv-label">Port</span>
                      <span>{selectedEdge.sourceRef?.portName ?? 'n/a'}</span>
                    </div>
                  </div>

                  {selectedEdgeOverlayEntries.length > 0 && (
                    <div className="petri-inspector-block">
                      <div className="petri-block-title">Overlay</div>
                      <div className="petri-code-block">
                        {selectedEdgeOverlayEntries.map(([key, value]) => (
                          <div key={key} className="petri-code-line">
                            <span className="petri-code-key">{key}</span>
                            <span className="petri-code-value">{formatValue(value)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedEdgeMetadataEntries.length > 0 && (
                    <div className="petri-inspector-block">
                      <div className="petri-block-title">Relation</div>
                      <div className="petri-code-block">
                        {selectedEdgeMetadataEntries.map(([key, value]) => (
                          <div key={key} className="petri-code-line">
                            <span className="petri-code-key">{key}</span>
                            <span className="petri-code-value">{formatValue(value)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {scopedGroups.some((group) => group.warnings.length > 0) && (
                <div className="petri-inspector-section">
                  <div className="petri-block-title">Group warnings</div>
                  <div className="petri-warning-list">
                    {scopedGroups.flatMap((group) =>
                      group.warnings.map((warning, index) => (
                        <div key={`${group.id}:${index}`} className="petri-warning-item">
                          <IconChevronRight size={12} />
                          <span>{warning}</span>
                        </div>
                      )),
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {selectedGroupAutomata.length > 0 && (
            <div className="petri-inspector-section">
              <div className="petri-block-title">Selected group automata</div>
              <div className="petri-inline-list">
                {selectedGroupAutomata.map((automataId) => (
                  <button
                    key={automataId}
                    type="button"
                    className="petri-inline-link"
                    onClick={() => openAutomata(automataId)}
                  >
                    {automataMap.get(automataId)?.config.name ?? automataId}
                  </button>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>

      <div className="petri-summary-strip">
        <div className="petri-summary-stat">
          <span className="petri-summary-label">Groups</span>
          <strong>{summary.groups}</strong>
        </div>
        <div className="petri-summary-stat">
          <span className="petri-summary-label">Automata</span>
          <strong>{summary.automata}</strong>
        </div>
        <div className="petri-summary-stat">
          <span className="petri-summary-label">Places</span>
          <strong>{summary.places}</strong>
        </div>
        <div className="petri-summary-stat">
          <span className="petri-summary-label">Transitions</span>
          <strong>{summary.transitions}</strong>
        </div>
        <div className="petri-summary-stat">
          <span className="petri-summary-label">Arcs</span>
          <strong>{summary.arcs}</strong>
        </div>
        <div className="petri-summary-stat">
          <span className="petri-summary-label">Shared resources</span>
          <strong>{summary.sharedResources}</strong>
        </div>
        <div className="petri-summary-stat">
          <span className="petri-summary-label">Unknown RTT</span>
          <strong>{summary.unknownLatencyEdges}</strong>
        </div>
      </div>
    </div>
  );
};
