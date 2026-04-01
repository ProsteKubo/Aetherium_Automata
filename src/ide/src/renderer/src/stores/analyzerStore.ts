import { create } from 'zustand';
import type {
  AnalyzerBundle,
  AnalyzerConfidence,
  AnalyzerFinding,
  AnalyzerQuery,
  AnalyzerSeverity,
  Automata,
  AutomataBinding,
  AutomataId,
} from '../types';
import { useAutomataStore } from './automataStore';
import { useGatewayStore } from './gatewayStore';
import { useRuntimeViewStore } from './runtimeViewStore';

type AnalyzerFilterSeverity = AnalyzerSeverity | 'all';
type AnalyzerFilterConfidence = AnalyzerConfidence | 'all';

interface AnalyzerState {
  bundle: AnalyzerBundle | null;
  loading: boolean;
  error: string | null;
  query: AnalyzerQuery;
  search: string;
  severityFilter: AnalyzerFilterSeverity;
  confidenceFilter: AnalyzerFilterConfidence;
  observedOnly: boolean;
  selectedFindingId: string | null;
}

interface AnalyzerActions {
  updateQuery: (updates: Partial<AnalyzerQuery>) => void;
  refresh: () => Promise<void>;
  setSearch: (search: string) => void;
  setSeverityFilter: (severity: AnalyzerFilterSeverity) => void;
  setConfidenceFilter: (confidence: AnalyzerFilterConfidence) => void;
  setObservedOnly: (enabled: boolean) => void;
  selectFinding: (findingId: string | null) => void;
  reset: () => void;
}

type AnalyzerStore = AnalyzerState & AnalyzerActions;

const initialQuery: AnalyzerQuery = {
  scope: 'project',
  includeStructural: true,
  includeTimeline: true,
  limit: 5000,
};

function deriveBlackBoxResources(automata: Automata): AnalyzerBundle['resources'][number][] {
  const contract = automata.blackBox;
  if (!contract?.resources?.length) {
    return [];
  }

  return contract.resources.map((resource) => ({
    name: resource.name,
    kind: resource.kind,
    capacity: resource.capacity,
    shared: resource.shared,
    latencySensitive: resource.latencySensitive,
    description: resource.description,
    participants: {
      automataIds: [automata.id],
      deploymentIds: [],
    },
  }));
}

function buildLocalStructuralBundle(
  query: AnalyzerQuery,
  automataEntries: Automata[],
  deployments: AnalyzerBundle['deployments'],
  connections: AutomataBinding[],
  warnings: string[],
): AnalyzerBundle {
  const deploymentIdsFilter = new Set(query.deploymentIds ?? []);
  const automataIdsFilter = new Set(query.automataIds ?? []);

  const filteredDeployments =
    deploymentIdsFilter.size > 0
      ? deployments.filter((deployment) => deploymentIdsFilter.has(deployment.deploymentId))
      : automataIdsFilter.size > 0
        ? deployments.filter((deployment) => automataIdsFilter.has(deployment.automataId))
        : deployments;

  const filteredAutomata =
    automataIdsFilter.size > 0
      ? automataEntries.filter((automata) => automataIdsFilter.has(automata.id))
      : automataEntries;

  const resourceMap = new Map<string, AnalyzerBundle['resources'][number]>();

  filteredAutomata.forEach((automata) => {
    deriveBlackBoxResources(automata).forEach((resource) => {
      const existing = resourceMap.get(resource.name);
      if (existing) {
        existing.participants.automataIds = Array.from(
          new Set([...existing.participants.automataIds, automata.id]),
        );
      } else {
        resourceMap.set(resource.name, resource);
      }
    });
  });

  filteredDeployments.forEach((deployment) => {
    resourceMap.forEach((resource) => {
      if (resource.participants.automataIds.includes(deployment.automataId)) {
        resource.participants.deploymentIds = Array.from(
          new Set([...resource.participants.deploymentIds, deployment.deploymentId]),
        );
      }
    });
  });

  const resources = Array.from(resourceMap.values());
  const analyzerConnections = connections
    .filter((binding) => {
      if (automataIdsFilter.size === 0) return true;
      return (
        automataIdsFilter.has(binding.sourceAutomataId) ||
        automataIdsFilter.has(binding.targetAutomataId)
      );
    })
    .map((binding) => ({
      id: binding.id,
      sourceAutomata: binding.sourceAutomataId,
      sourceOutput: binding.sourceOutputName,
      targetAutomata: binding.targetAutomataId,
      targetInput: binding.targetInputName,
      enabled: binding.enabled,
      bindingType: 'direct',
    }));

  const findings: AnalyzerFinding[] = resources.flatMap((resource) => {
    const contenders = new Set([
      ...resource.participants.automataIds,
      ...resource.participants.deploymentIds,
    ]).size;

    if (!resource.shared || contenders < 2) {
      return [];
    }

    const refs = {
      automataIds: resource.participants.automataIds,
      deploymentIds: resource.participants.deploymentIds,
      connectionIds: [],
      resourceNames: [resource.name],
    };

    return [
      {
        id: `resource:${resource.name}`,
        kind: 'shared_resource_contention',
        severity: contenders >= 3 ? 'critical' : 'warning',
        confidence: 'declared',
        title: `${resource.name} contention`,
        summary: `${contenders} actors reference shared resource ${resource.name}.`,
        resource,
        sourceRefs: refs,
        metrics: { contenderCount: contenders },
        evidence: [],
      },
      {
        id: `unknown:resource:${resource.name}`,
        kind: 'unknown_evidence',
        severity: 'info',
        confidence: 'inferred',
        title: `${resource.name} lacks observed evidence`,
        summary: `The resource is declared as shared, but no replay timeline is available in this fallback view.`,
        resource,
        sourceRefs: refs,
        evidence: [],
      },
    ];
  });

  const graphNodes = [
    ...filteredDeployments.map((deployment) => ({
      id: `deployment:${deployment.deploymentId}`,
      kind: 'deployment' as const,
      label: deployment.automataId,
      subtitle: deployment.deviceId,
      sourceRef: { deploymentId: deployment.deploymentId, automataId: deployment.automataId },
      metadata: { status: deployment.status },
    })),
    ...filteredAutomata
      .filter(
        (automata) =>
          !filteredDeployments.some((deployment) => deployment.automataId === automata.id),
      )
      .map((automata) => ({
        id: `automata:${automata.id}`,
        kind: 'automata' as const,
        label: automata.config.name,
        subtitle: 'undeployed',
        sourceRef: { automataId: automata.id },
        metadata: {},
      })),
    ...resources.map((resource) => ({
      id: `resource:${resource.name}`,
      kind: 'resource' as const,
      label: resource.name,
      subtitle: resource.kind ?? 'resource',
      sourceRef: { resourceName: resource.name },
      metadata: { shared: resource.shared },
    })),
    ...analyzerConnections.map((connection) => ({
      id: `binding:${connection.id}`,
      kind: 'binding' as const,
      label: `${connection.sourceOutput} -> ${connection.targetInput}`,
      subtitle: connection.bindingType ?? 'direct',
      sourceRef: { connectionId: connection.id },
      metadata: {},
    })),
  ];

  const resourceEdges = resources.flatMap((resource) => {
    const hasCriticalFinding = findings.some(
      (finding) => finding.resource?.name === resource.name && finding.severity === 'critical',
    );

    if (resource.participants.deploymentIds.length > 0) {
      return resource.participants.deploymentIds.map((deploymentId) => ({
        id: `deployment:${deploymentId}->resource:${resource.name}`,
        source: `deployment:${deploymentId}`,
        target: `resource:${resource.name}`,
        kind: 'resource_link' as const,
        severity: hasCriticalFinding ? ('critical' as const) : ('warning' as const),
        metadata: {},
      }));
    }

    return resource.participants.automataIds.map((automataId) => ({
      id: `automata:${automataId}->resource:${resource.name}`,
      source: `automata:${automataId}`,
      target: `resource:${resource.name}`,
      kind: 'resource_link' as const,
      severity: 'warning' as const,
      metadata: {},
    }));
  });

  const bindingEdges = analyzerConnections.flatMap((connection) => {
    const sourceDeployment =
      filteredDeployments.find((deployment) => deployment.automataId === connection.sourceAutomata) ??
      null;
    const targetDeployment =
      filteredDeployments.find((deployment) => deployment.automataId === connection.targetAutomata) ??
      null;
    const sourceId = sourceDeployment
      ? `deployment:${sourceDeployment.deploymentId}`
      : `automata:${connection.sourceAutomata}`;
    const targetId = targetDeployment
      ? `deployment:${targetDeployment.deploymentId}`
      : `automata:${connection.targetAutomata}`;

    return [
      {
        id: `${sourceId}->binding:${connection.id}`,
        source: sourceId,
        target: `binding:${connection.id}`,
        kind: 'binding_out' as const,
        severity: 'info' as const,
        metadata: {},
      },
      {
        id: `binding:${connection.id}->${targetId}`,
        source: `binding:${connection.id}`,
        target: targetId,
        kind: 'binding_in' as const,
        severity: 'info' as const,
        metadata: {},
      },
    ];
  });

  const graphEdges = [...resourceEdges, ...bindingEdges];

  return {
    query: {
      scope: query.scope,
      deploymentIds: query.deploymentIds ?? [],
      automataIds: query.automataIds ?? [],
      afterTs: query.afterTs,
      beforeTs: query.beforeTs,
      includeStructural: query.includeStructural ?? true,
      includeTimeline: false,
      limit: query.limit ?? 5000,
    },
    generatedAt: Date.now(),
    evidenceMode: 'structural_only',
    warnings,
    automata: filteredAutomata.map((automata) => ({
      id: automata.id,
      name: automata.config.name,
      black_box: automata.blackBox,
    })),
    deployments: filteredDeployments,
    connections: analyzerConnections,
    resources,
    timelines: {},
    findings,
    graph: {
      nodes: graphNodes,
      edges: graphEdges,
    },
    summary: {
      findingCount: findings.length,
      criticalCount: findings.filter((finding) => finding.severity === 'critical').length,
      sharedResourceCount: resources.filter((resource) => resource.shared).length,
      observedFindingCount: 0,
      structuralFindingCount: findings.length,
      unknownEvidenceCount: findings.filter((finding) => finding.kind === 'unknown_evidence').length,
    },
    source: 'ide_structural_fallback',
  };
}

function normalizeDeployments(): AnalyzerBundle['deployments'] {
  return Array.from(useRuntimeViewStore.getState().deployments.values()).map((deployment) => ({
    deploymentId: deployment.deploymentId,
    automataId: deployment.automataId,
    deviceId: deployment.deviceId,
    status: deployment.status,
    currentState: deployment.currentState,
    variables: deployment.variables,
  }));
}

function resolveEffectiveQuery(query: AnalyzerQuery): { query: AnalyzerQuery; warnings: string[] } {
  const warnings: string[] = [];
  const runtimeSelection = useRuntimeViewStore.getState().selectedDeploymentIds;
  const activeAutomataId = useAutomataStore.getState().activeAutomataId;
  const runtimeDeployments = normalizeDeployments();

  const nextQuery: AnalyzerQuery = { ...query };

  if (nextQuery.scope === 'deployment' && (!nextQuery.deploymentIds || nextQuery.deploymentIds.length === 0)) {
    if (runtimeSelection.length > 0) {
      nextQuery.deploymentIds = runtimeSelection;
    } else {
      warnings.push('deployment_scope_without_selection');
      nextQuery.scope = 'project';
    }
  }

  if (nextQuery.scope === 'group' && (!nextQuery.automataIds || nextQuery.automataIds.length === 0)) {
    const selectedAutomataIds = runtimeSelection
      .map((deploymentId) => runtimeDeployments.find((deployment) => deployment.deploymentId === deploymentId)?.automataId)
      .filter(Boolean) as AutomataId[];

    if (selectedAutomataIds.length > 0) {
      nextQuery.automataIds = selectedAutomataIds;
    } else if (activeAutomataId) {
      nextQuery.automataIds = [activeAutomataId];
    } else {
      warnings.push('group_scope_without_selection');
      nextQuery.scope = 'project';
    }
  }

  return { query: nextQuery, warnings };
}

async function buildFallbackBundle(query: AnalyzerQuery, warnings: string[]): Promise<AnalyzerBundle> {
  const automataEntries = Array.from(useAutomataStore.getState().automata.values());
  const deployments = normalizeDeployments();
  let connections: AutomataBinding[] = [];

  try {
    if (useGatewayStore.getState().status === 'connected') {
      connections = await useGatewayStore.getState().service.listConnections();
    }
  } catch {
    // Structural fallback can still work without explicit connections.
  }

  return buildLocalStructuralBundle(query, automataEntries, deployments, connections, warnings);
}

const initialState: AnalyzerState = {
  bundle: null,
  loading: false,
  error: null,
  query: initialQuery,
  search: '',
  severityFilter: 'all',
  confidenceFilter: 'all',
  observedOnly: false,
  selectedFindingId: null,
};

export const useAnalyzerStore = create<AnalyzerStore>((set, get) => ({
  ...initialState,

  updateQuery: (updates) => {
    set((state) => ({ query: { ...state.query, ...updates } }));
  },

  refresh: async () => {
    const gateway = useGatewayStore.getState();
    const { query } = get();
    const resolved = resolveEffectiveQuery(query);

    set({ loading: true, error: null });

    try {
      const bundle =
        gateway.status === 'connected'
          ? await gateway.service.queryAnalyzer(resolved.query)
          : await buildFallbackBundle(resolved.query, resolved.warnings);

      if (resolved.warnings.length > 0) {
        bundle.warnings = Array.from(new Set([...(bundle.warnings ?? []), ...resolved.warnings]));
      }

      set({
        loading: false,
        bundle,
        error: null,
        selectedFindingId: bundle.findings[0]?.id ?? null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Analyzer query failed';
      const bundle = await buildFallbackBundle(resolved.query, [...resolved.warnings, 'timeline_unavailable_for_selected_scope']);
      set({
        loading: false,
        error: message,
        bundle,
        selectedFindingId: bundle.findings[0]?.id ?? null,
      });
    }
  },

  setSearch: (search) => set({ search }),
  setSeverityFilter: (severityFilter) => set({ severityFilter }),
  setConfidenceFilter: (confidenceFilter) => set({ confidenceFilter }),
  setObservedOnly: (observedOnly) => set({ observedOnly }),
  selectFinding: (selectedFindingId) => set({ selectedFindingId }),
  reset: () => set(initialState),
}));
