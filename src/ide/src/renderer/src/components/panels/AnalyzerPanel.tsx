import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactFlow, { Background, Controls, MiniMap } from 'reactflow';
import 'reactflow/dist/style.css';
import type { AnalyzerBundle, AnalyzerConfidence, AnalyzerSeverity, Automata, PanelId } from '../../types';
import {
  useAnalyzerStore,
  useAutomataStore,
  useProjectStore,
  useRuntimeViewStore,
  useUIStore,
} from '../../stores';
import { buildAnalyzerFlow } from '../../utils/analyzerGraph';
import { analyzerSeverityRank, findingMatchesFilters, formatAnalyzerWarning } from '../../utils/analyzerFormat';
import { normalizeImportedAutomata } from '../../utils/importedAutomata';

const ANALYZER_DEMO_SETS = [
  {
    id: 'analyzer_contention',
    title: 'Contention Demo',
    description:
      'Three automata competing for one shared dc_bus resource. This is the cleanest offline analyzer demo.',
    relativePaths: [
      'example/automata/showcase/14_petri_contention/petri_power_allocator.yaml',
      'example/automata/showcase/14_petri_contention/petri_charger_node.yaml',
      'example/automata/showcase/14_petri_contention/petri_motion_axis.yaml',
    ],
    scope: 'group' as const,
  },
  {
    id: 'analyzer_signal_chain',
    title: 'Signal Chain Demo',
    description:
      'Four connected automata with a shared field bus and a black-box drive unit so you can inspect multi-actor analyzer topology.',
    relativePaths: [
      'example/automata/showcase/13_petri_signal_chain/petri_command_router.yaml',
      'example/automata/showcase/13_petri_signal_chain/petri_safety_gate.yaml',
      'example/automata/showcase/13_petri_signal_chain/petri_drive_unit_black_box.yaml',
      'example/automata/showcase/13_petri_signal_chain/petri_telemetry_observer.yaml',
    ],
    scope: 'group' as const,
  },
] as const;

const activateCenterPanel = (panelId: PanelId): void => {
  const store = useUIStore.getState();
  const isVisible = store.layout.panels[panelId]?.isVisible ?? false;
  if (!isVisible) {
    store.togglePanel(panelId);
  }
};

const TIME_WINDOWS = [
  { label: 'All', value: 'all' },
  { label: '5m', value: '5m' },
  { label: '1h', value: '1h' },
  { label: '24h', value: '24h' },
] as const;

function applyTimeWindow(value: string): Pick<AnalyzerBundle['query'], 'afterTs' | 'beforeTs'> {
  const now = Date.now();

  switch (value) {
    case '5m':
      return { afterTs: now - 5 * 60 * 1000, beforeTs: now };
    case '1h':
      return { afterTs: now - 60 * 60 * 1000, beforeTs: now };
    case '24h':
      return { afterTs: now - 24 * 60 * 60 * 1000, beforeTs: now };
    default:
      return { afterTs: undefined, beforeTs: undefined };
  }
}

export const AnalyzerPanel: React.FC = () => {
  const bundle = useAnalyzerStore((state) => state.bundle);
  const loading = useAnalyzerStore((state) => state.loading);
  const error = useAnalyzerStore((state) => state.error);
  const query = useAnalyzerStore((state) => state.query);
  const search = useAnalyzerStore((state) => state.search);
  const severityFilter = useAnalyzerStore((state) => state.severityFilter);
  const confidenceFilter = useAnalyzerStore((state) => state.confidenceFilter);
  const observedOnly = useAnalyzerStore((state) => state.observedOnly);
  const selectedFindingId = useAnalyzerStore((state) => state.selectedFindingId);
  const updateQuery = useAnalyzerStore((state) => state.updateQuery);
  const refresh = useAnalyzerStore((state) => state.refresh);
  const setSearch = useAnalyzerStore((state) => state.setSearch);
  const setSeverityFilter = useAnalyzerStore((state) => state.setSeverityFilter);
  const setConfidenceFilter = useAnalyzerStore((state) => state.setConfidenceFilter);
  const setObservedOnly = useAnalyzerStore((state) => state.setObservedOnly);
  const selectFinding = useAnalyzerStore((state) => state.selectFinding);
  const openTab = useUIStore((state) => state.openTab);
  const addNotification = useUIStore((state) => state.addNotification);
  const setAutomataMap = useAutomataStore((state) => state.setAutomataMap);
  const setActiveAutomata = useAutomataStore((state) => state.setActiveAutomata);
  const createNetwork = useProjectStore((state) => state.createNetwork);
  const addAutomataToNetwork = useProjectStore((state) => state.addAutomataToNetwork);
  const ensureLocalProject = useProjectStore((state) => state.ensureLocalProject);
  const markProjectDirty = useProjectStore((state) => state.markDirty);
  const setSelectedDeployments = useRuntimeViewStore((state) => state.setSelected);
  const [timeWindow, setTimeWindow] = useState<string>('all');
  const [selectedGraphId, setSelectedGraphId] = useState<string | null>(null);
  const [selectedGraphType, setSelectedGraphType] = useState<'node' | 'edge' | null>(null);
  const [importingDemoId, setImportingDemoId] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filteredFindings = useMemo(() => {
    const findings = bundle?.findings ?? [];
    return findings
      .filter((finding) =>
        findingMatchesFilters(
          finding,
          search,
          severityFilter as AnalyzerSeverity | 'all',
          confidenceFilter as AnalyzerConfidence | 'all',
          observedOnly,
        ),
      )
      .sort((left, right) => analyzerSeverityRank(right.severity) - analyzerSeverityRank(left.severity));
  }, [bundle?.findings, confidenceFilter, observedOnly, search, severityFilter]);

  useEffect(() => {
    if (!filteredFindings.length) {
      selectFinding(null);
      return;
    }

    if (!selectedFindingId || !filteredFindings.some((finding) => finding.id === selectedFindingId)) {
      selectFinding(filteredFindings[0].id);
    }
  }, [filteredFindings, selectedFindingId, selectFinding]);

  const selectedFinding = useMemo(
    () => filteredFindings.find((finding) => finding.id === selectedFindingId) ?? null,
    [filteredFindings, selectedFindingId],
  );

  const flow = useMemo(
    () => (bundle ? buildAnalyzerFlow(bundle, selectedFinding?.id ?? null) : { nodes: [], edges: [] }),
    [bundle, selectedFinding?.id],
  );

  const selectedNode = useMemo(
    () => (selectedGraphType === 'node' ? flow.nodes.find((node) => node.id === selectedGraphId) ?? null : null),
    [flow.nodes, selectedGraphId, selectedGraphType],
  );

  const selectedEdge = useMemo(
    () => (selectedGraphType === 'edge' ? flow.edges.find((edge) => edge.id === selectedGraphId) ?? null : null),
    [flow.edges, selectedGraphId, selectedGraphType],
  );

  const selectedAutomataIds =
    selectedFinding?.sourceRefs.automataIds ??
    (selectedNode?.data && typeof selectedNode.data === 'object' ? [] : []);
  const selectedDeploymentIds = selectedFinding?.sourceRefs.deploymentIds ?? [];
  const selectedConnectionIds = selectedFinding?.sourceRefs.connectionIds ?? [];
  const selectedResourceNames = selectedFinding?.sourceRefs.resourceNames ?? [];
  const hasAnalyzerContent =
    (bundle?.automata.length ?? 0) > 0 ||
    (bundle?.findings.length ?? 0) > 0 ||
    (bundle?.graph.nodes.length ?? 0) > 0;

  const openAutomata = (): void => {
    const automataId = selectedFinding?.sourceRefs.automataIds[0] ?? selectedNode?.id.replace(/^automata:/, '');
    if (!automataId) return;

    activateCenterPanel('automata');
    setActiveAutomata(automataId);
    openTab({
      type: 'automata',
      targetId: automataId,
      name: automataId,
      isDirty: false,
    });
  };

  const openRuntime = (): void => {
    if (!selectedDeploymentIds.length) return;
    activateCenterPanel('runtime');
    setSelectedDeployments(selectedDeploymentIds);
  };

  const openPetri = (): void => {
    const automataId =
      selectedFinding?.sourceRefs.automataIds[0] ?? selectedNode?.id.replace(/^automata:/, '');
    if (automataId) {
      setActiveAutomata(automataId);
    }
    activateCenterPanel('petri');
  };
  const openNetwork = (): void => activateCenterPanel('network');
  const openBlackBoxes = (): void => activateCenterPanel('blackboxes');

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
        ensureLocalProject('Analyzer Demo Project');
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
    [addAutomataToNetwork, createNetwork, ensureLocalProject, markProjectDirty, setAutomataMap],
  );

  const importShowcaseAutomata = useCallback(
    async (target: string): Promise<{ id: string; name: string; skipped: boolean } | null> => {
      const result = await window.api.automata.loadShowcase(target);
      if (!result.success || !result.data) {
        addNotification('error', 'Analyzer Demo', result.error || `Failed to load ${target}`);
        return null;
      }

      return attachImportedAutomata(result.data as Record<string, unknown>, result.filePath);
    },
    [addNotification, attachImportedAutomata],
  );

  const importDemoSet = useCallback(
    async (demoId: string) => {
      const demo = ANALYZER_DEMO_SETS.find((entry) => entry.id === demoId);
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

        const first = loaded[0];
        setActiveAutomata(first.id);

        updateQuery({
          scope: demo.scope,
          automataIds: loaded.map((entry) => entry.id),
        });
        await refresh();

        const importedCount = loaded.filter((entry) => !entry.skipped).length;
        const skippedCount = loaded.filter((entry) => entry.skipped).length;
        const summary =
          skippedCount > 0
            ? `Loaded ${importedCount} new automata and reused ${skippedCount} existing automata.`
            : `Loaded ${importedCount} automata into the analyzer workspace.`;
        addNotification('success', demo.title, summary);
      } finally {
        setImportingDemoId(null);
      }
    },
    [addNotification, importShowcaseAutomata, openTab, refresh, setActiveAutomata, updateQuery],
  );

  return (
    <div className="analyzer-shell">
      <div className="analyzer-toolbar">
        <div className="analyzer-toolbar-group">
          <label className="analyzer-toolbar-field">
            <span>Scope</span>
            <select
              value={query.scope}
              onChange={(event) => {
                updateQuery({ scope: event.target.value as AnalyzerBundle['query']['scope'] });
                void refresh();
              }}
            >
              <option value="project">Project</option>
              <option value="group">Group</option>
              <option value="deployment">Deployment</option>
            </select>
          </label>

          <label className="analyzer-toolbar-field">
            <span>Window</span>
            <select
              value={timeWindow}
              onChange={(event) => {
                const value = event.target.value;
                setTimeWindow(value);
                updateQuery(applyTimeWindow(value));
                void refresh();
              }}
            >
              {TIME_WINDOWS.map((window) => (
                <option key={window.value} value={window.value}>
                  {window.label}
                </option>
              ))}
            </select>
          </label>

          <label className="analyzer-toolbar-field analyzer-search">
            <span>Search</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search findings, resources, deployments"
            />
          </label>
        </div>

        <div className="analyzer-toolbar-group">
          <label className="analyzer-toolbar-field">
            <span>Severity</span>
            <select
              value={severityFilter}
              onChange={(event) => setSeverityFilter(event.target.value as AnalyzerSeverity | 'all')}
            >
              <option value="all">All</option>
              <option value="critical">Critical</option>
              <option value="warning">Warning</option>
              <option value="info">Info</option>
            </select>
          </label>

          <label className="analyzer-toolbar-field">
            <span>Confidence</span>
            <select
              value={confidenceFilter}
              onChange={(event) =>
                setConfidenceFilter(event.target.value as AnalyzerConfidence | 'all')
              }
            >
              <option value="all">All</option>
              <option value="observed">Observed</option>
              <option value="mixed">Mixed</option>
              <option value="declared">Declared</option>
              <option value="inferred">Inferred</option>
            </select>
          </label>

          <label className="analyzer-toolbar-toggle">
            <input
              type="checkbox"
              checked={observedOnly}
              onChange={(event) => setObservedOnly(event.target.checked)}
            />
            <span>Observed only</span>
          </label>

          <button type="button" className="btn btn-secondary" onClick={() => void refresh()}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className={`analyzer-demo-strip ${hasAnalyzerContent ? 'compact' : ''}`}>
        {ANALYZER_DEMO_SETS.map((demo) => (
          <div key={demo.id} className="analyzer-demo-card">
            <div className="analyzer-demo-meta">Demo</div>
            <strong>{demo.title}</strong>
            <p>{demo.description}</p>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => void importDemoSet(demo.id)}
              disabled={Boolean(importingDemoId)}
            >
              {importingDemoId === demo.id ? 'Importing…' : 'Import Demo'}
            </button>
          </div>
        ))}
      </div>

      <div className="analyzer-workspace">
        <aside className="analyzer-findings">
          <div className="analyzer-pane-header">
            <div>
              <h3>Findings</h3>
              <div className="analyzer-pane-subtitle">
                {bundle?.source === 'ide_structural_fallback'
                  ? 'Structural fallback'
                  : bundle?.source || bundle?.evidenceMode || 'analyzer'}
              </div>
            </div>
            <span>{filteredFindings.length}</span>
          </div>

          {error && <div className="analyzer-error-banner">{error}</div>}

          <div className="analyzer-warning-list">
            {(bundle?.warnings ?? []).map((warning) => (
              <div key={warning} className="analyzer-warning-chip">
                {formatAnalyzerWarning(warning)}
              </div>
            ))}
          </div>

          <div className="analyzer-finding-list">
            {filteredFindings.map((finding) => (
              <button
                key={finding.id}
                type="button"
                className={`analyzer-finding-card ${selectedFinding?.id === finding.id ? 'active' : ''} severity-${finding.severity}`}
                onClick={() => {
                  selectFinding(finding.id);
                  setSelectedGraphId(null);
                  setSelectedGraphType(null);
                }}
              >
                <div className="analyzer-finding-meta">
                  <span className="analyzer-chip">{finding.severity}</span>
                  <span className="analyzer-chip">{finding.confidence}</span>
                </div>
                <strong>{finding.title}</strong>
                <p>{finding.summary}</p>
              </button>
            ))}

            {!filteredFindings.length && <div className="analyzer-empty-state">No findings match the current filters.</div>}
          </div>
        </aside>

        <div className="analyzer-canvas">
          <ReactFlow
            nodes={flow.nodes}
            edges={flow.edges}
            fitView
            onNodeClick={(_, node) => {
              setSelectedGraphId(node.id);
              setSelectedGraphType('node');
            }}
            onEdgeClick={(_, edge) => {
              setSelectedGraphId(edge.id);
              setSelectedGraphType('edge');
            }}
          >
            <Background gap={20} size={1} color="rgba(148, 163, 184, 0.15)" />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>

        <aside className="analyzer-inspector">
          <div className="analyzer-pane-header">
            <div>
              <h3>Inspector</h3>
              <div className="analyzer-pane-subtitle">
                Generated {bundle ? new Date(bundle.generatedAt).toLocaleString() : 'n/a'}
              </div>
            </div>
            <span>{bundle?.evidenceMode ?? 'structural_only'}</span>
          </div>

          {selectedFinding ? (
            <div className="analyzer-inspector-body">
              <h4>{selectedFinding.title}</h4>
              <p>{selectedFinding.summary}</p>

              <div className="analyzer-inspector-grid">
                <div>
                  <span>Severity</span>
                  <strong>{selectedFinding.severity}</strong>
                </div>
                <div>
                  <span>Confidence</span>
                  <strong>{selectedFinding.confidence}</strong>
                </div>
                <div>
                  <span>Kind</span>
                  <strong>{selectedFinding.kind}</strong>
                </div>
                <div>
                  <span>Actors</span>
                  <strong>{selectedFinding.sourceRefs.automataIds.length}</strong>
                </div>
              </div>

              <div className="analyzer-inspector-actions">
                <button type="button" className="btn btn-secondary" onClick={openAutomata} disabled={!selectedAutomataIds.length}>
                  Open Automata
                </button>
                <button type="button" className="btn btn-secondary" onClick={openRuntime} disabled={!selectedDeploymentIds.length}>
                  Open Runtime
                </button>
                <button type="button" className="btn btn-secondary" onClick={openPetri}>
                  Open Structural View
                </button>
                <button type="button" className="btn btn-secondary" onClick={openNetwork}>
                  Open Network
                </button>
                <button type="button" className="btn btn-secondary" onClick={openBlackBoxes}>
                  Open Black Boxes
                </button>
              </div>

              <div className="analyzer-inspector-list">
                <h5>Automata</h5>
                {(selectedFinding.sourceRefs.automataIds.length > 0 ? selectedFinding.sourceRefs.automataIds : ['n/a']).map((automataId) => (
                  <div key={automataId} className="analyzer-list-row">
                    {automataId}
                  </div>
                ))}
              </div>

              <div className="analyzer-inspector-list">
                <h5>Deployments</h5>
                {(selectedFinding.sourceRefs.deploymentIds.length > 0 ? selectedFinding.sourceRefs.deploymentIds : ['n/a']).map((deploymentId) => (
                  <div key={deploymentId} className="analyzer-list-row">
                    {deploymentId}
                  </div>
                ))}
              </div>

              <div className="analyzer-inspector-list">
                <h5>Resources</h5>
                {(selectedResourceNames.length > 0 ? selectedResourceNames : ['n/a']).map((resourceName) => (
                  <div key={resourceName} className="analyzer-list-row">
                    {resourceName}
                  </div>
                ))}
              </div>

              <div className="analyzer-inspector-list">
                <h5>Bindings</h5>
                {(selectedConnectionIds.length > 0 ? selectedConnectionIds : ['n/a']).map((connectionId) => (
                  <div key={connectionId} className="analyzer-list-row">
                    {connectionId}
                  </div>
                ))}
              </div>

              <div className="analyzer-inspector-list">
                <h5>Evidence</h5>
                {selectedFinding.evidence.length > 0 ? (
                  selectedFinding.evidence.map((entry, index) => (
                    <div key={`${entry.type}:${entry.deploymentId ?? 'n/a'}:${index}`} className="analyzer-list-row">
                      <strong>{entry.type}</strong>
                      {entry.deploymentId ? ` · ${entry.deploymentId}` : ''}
                      {typeof entry.eventCount === 'number' ? ` · ${entry.eventCount} events` : ''}
                    </div>
                  ))
                ) : (
                  <div className="analyzer-list-row">No observed evidence entries for this finding.</div>
                )}
              </div>
            </div>
          ) : selectedNode || selectedEdge ? (
            <div className="analyzer-inspector-body">
              <h4>{selectedNode?.data?.label ?? selectedEdge?.id ?? 'Selection'}</h4>
              <p>Graph element selected. Pick a finding to inspect scored evidence and deep links.</p>
            </div>
          ) : (
            <div className="analyzer-inspector-body">
              <h4>No selection</h4>
              <p>Select a finding, node, or edge to inspect the analyzer output.</p>
            </div>
          )}
        </aside>
      </div>

      <div className="analyzer-summary">
        <div className="analyzer-summary-card">
          <span>Findings</span>
          <strong>{bundle?.summary.findingCount ?? 0}</strong>
        </div>
        <div className="analyzer-summary-card">
          <span>Critical</span>
          <strong>{bundle?.summary.criticalCount ?? 0}</strong>
        </div>
        <div className="analyzer-summary-card">
          <span>Shared Resources</span>
          <strong>{bundle?.summary.sharedResourceCount ?? 0}</strong>
        </div>
        <div className="analyzer-summary-card">
          <span>Observed</span>
          <strong>{bundle?.summary.observedFindingCount ?? 0}</strong>
        </div>
        <div className="analyzer-summary-card">
          <span>Structural</span>
          <strong>{bundle?.summary.structuralFindingCount ?? 0}</strong>
        </div>
        <div className="analyzer-summary-card">
          <span>Unknown Evidence</span>
          <strong>{bundle?.summary.unknownEvidenceCount ?? 0}</strong>
        </div>
      </div>
    </div>
  );
};
