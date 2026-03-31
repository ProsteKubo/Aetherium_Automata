import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, { Background, BackgroundVariant, Edge, MiniMap, Node } from 'reactflow';
import 'reactflow/dist/style.css';
import {
  useAutomataStore,
  useExecutionStore,
  useGatewayStore,
  useProjectStore,
  useRuntimeViewStore,
  useUIStore,
} from '../../stores';
import type { Automata, ExecutionSnapshot } from '../../types';
import type { RuntimeDeploymentTransfer, RuntimeRenderFrame } from '../../types/runtimeView';
import { normalizeImportedAutomata } from '../../utils/importedAutomata';
import { StateNode } from '../editor/StateNode';
import {
  IconCheck,
  IconDevice,
  IconPlay,
  IconRefresh,
  IconUpload,
  IconX,
} from '../common/Icons';
import {
  deploymentStatusRank,
  DeviceDeploymentView,
  humanizeTransferStage,
  isDeviceReachable,
  isRunningLike,
  runtimeStatusToLabel,
  ShowcaseAutomataEntry,
  supportsMultipleDeployments,
  transferForDevice,
} from './devicePanelShared';

type DisplayItem = {
  id: string;
  deploymentId?: string;
  automataId: string;
  deviceId?: string;
  status: string;
  currentState?: string;
  label: string;
};

const runtimeNodeTypes = {
  stateNode: StateNode,
};

const runtimeEdgeTypes = {};

const statusOrder: Record<string, number> = {
  running: 6,
  loading: 5,
  paused: 4,
  stopped: 3,
  unknown: 2,
  offline: 1,
  error: 0,
};

function sameSelection(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, idx) => id === b[idx]);
}

function formatSignalValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null ||
    value === undefined
  ) {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable]';
  }
}

function parseJsonOrString(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return '';
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

function RuntimeGraphCard({
  item,
  frame,
  transfer,
  now,
}: {
  item: DisplayItem;
  frame?: RuntimeRenderFrame;
  transfer?: RuntimeDeploymentTransfer;
  now: number;
}) {
  const automata = useAutomataStore((state) => state.automata.get(item.automataId as any));

  const nodes = useMemo<Node[]>(() => {
    if (!automata) return [];

    return Object.values(automata.states).map((state) => {
      const active = frame?.activeStateId === state.id;
      const pulsing = Boolean(active && now <= (frame?.statePulseUntil || 0));
      return {
        id: state.id,
        type: 'stateNode',
        position: state.position,
        data: {
          ...state,
          isActive: active,
          isExecuting: pulsing,
        },
        draggable: false,
        selectable: false,
      } as Node;
    });
  }, [automata, frame?.activeStateId, frame?.statePulseUntil, now]);

  const edges = useMemo<Edge[]>(() => {
    if (!automata) return [];

    return Object.values(automata.transitions).map((transition) => {
      const hot = frame?.activeTransitionId === transition.id && now <= (frame?.edgePulseUntil || 0);
      const className = `transition-edge ${hot ? 'active animating' : ''}`;
      return {
        id: transition.id,
        source: transition.from,
        target: transition.to,
        className,
        style: hot ? { stroke: 'var(--color-success)', strokeWidth: 3 } : undefined,
        selectable: false,
      } as Edge;
    });
  }, [automata, frame?.activeTransitionId, frame?.edgePulseUntil, now]);

  if (!automata) {
    return (
      <div className="runtime-card">
        <div className="runtime-card-header">
          <span className="runtime-card-title">{item.label}</span>
        </div>
        <div className="runtime-card-empty">Automata `{item.automataId}` is not loaded in editor.</div>
      </div>
    );
  }

  return (
    <div className="runtime-card">
      <div className="runtime-card-header">
        <span className="runtime-card-title">{item.label}</span>
        <span className={`runtime-status status-${item.status}`}>{item.status}</span>
        <span className="runtime-state">{item.currentState || 'unknown'}</span>
        {frame && frame.droppedEvents > 0 && (
          <span className="runtime-dropped" title="Visual decimation under burst load">
            dropped {frame.droppedEvents}
          </span>
        )}
      </div>
      {transfer && (
        <div className={`runtime-transfer runtime-transfer-${transfer.status}`}>
          <div className="runtime-transfer-meta">
            <span>{humanizeTransferStage(transfer.stage)}</span>
            <span>{Math.round(transfer.progressPercent)}%</span>
          </div>
          <div className="runtime-transfer-track">
            <div
              className="runtime-transfer-fill"
              style={{ width: `${Math.round(transfer.progressPercent)}%` }}
            />
          </div>
        </div>
      )}
      <div className="runtime-flow">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={runtimeNodeTypes}
          edgeTypes={runtimeEdgeTypes}
          fitView
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnDrag={false}
          zoomOnScroll={false}
          zoomOnPinch={false}
          zoomOnDoubleClick={false}
          proOptions={{ hideAttribution: true }}
        >
          <MiniMap zoomable pannable />
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        </ReactFlow>
      </div>
    </div>
  );
}

export const RuntimeMonitorPanel: React.FC = () => {
  const [showcaseEntries, setShowcaseEntries] = useState<ShowcaseAutomataEntry[]>([]);
  const [selectedShowcasePath, setSelectedShowcasePath] = useState('');
  const [showcaseFilterText, setShowcaseFilterText] = useState('');
  const [showcaseBusy, setShowcaseBusy] = useState(false);
  const [varName, setVarName] = useState('');
  const [varValue, setVarValue] = useState('');
  const [eventName, setEventName] = useState('');
  const [eventData, setEventData] = useState('');
  const [forceState, setForceState] = useState('');
  const [manualSnapshot, setManualSnapshot] = useState<ExecutionSnapshot | null>(null);
  const [lastSnapshotAt, setLastSnapshotAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const lastFocusedDeviceIdRef = useRef<string | null>(null);

  const automataMap = useAutomataStore((state) => state.automata);
  const activeAutomataId = useAutomataStore((state) => state.activeAutomataId);
  const setAutomataMap = useAutomataStore((state) => state.setAutomataMap);
  const setActiveAutomata = useAutomataStore((state) => state.setActiveAutomata);
  const devicesMap = useGatewayStore((state) => state.devices);
  const serversMap = useGatewayStore((state) => state.servers);
  const gatewayService = useGatewayStore((state) => state.service);
  const addNotification = useUIStore((state) => state.addNotification);
  const project = useProjectStore((state) => state.project);
  const createNetwork = useProjectStore((state) => state.createNetwork);
  const addAutomataToNetwork = useProjectStore((state) => state.addAutomataToNetwork);
  const markProjectDirty = useProjectStore((state) => state.markDirty);
  const scope = useRuntimeViewStore((state) => state.scope);
  const setScope = useRuntimeViewStore((state) => state.setScope);
  const deploymentsMap = useRuntimeViewStore((state) => state.deployments);
  const transfersMap = useRuntimeViewStore((state) => state.transfers);
  const selectedIds = useRuntimeViewStore((state) => state.selectedDeploymentIds);
  const toggleSelection = useRuntimeViewStore((state) => state.toggleSelection);
  const setSelected = useRuntimeViewStore((state) => state.setSelected);
  const selectRunning = useRuntimeViewStore((state) => state.selectRunning);
  const renderFrames = useRuntimeViewStore((state) => state.renderFrames);
  const visualHz = useRuntimeViewStore((state) => state.visualHz);
  const setVisualHz = useRuntimeViewStore((state) => state.setVisualHz);
  const tickAnimator = useRuntimeViewStore((state) => state.tickAnimator);
  const clearStale = useRuntimeViewStore((state) => state.clearStale);
  const upsertRuntimeDeployment = useRuntimeViewStore((state) => state.upsertDeployment);
  const focusedDeviceId = useExecutionStore((state) => state.selectedDeviceId);
  const selectDevice = useExecutionStore((state) => state.selectDevice);
  const focusedExecution = useExecutionStore((state) =>
    focusedDeviceId ? state.deviceExecutions.get(focusedDeviceId as any) : undefined,
  );

  useEffect(() => {
    let cancelled = false;

    const loadShowcaseCatalog = async () => {
      const result = await window.api.automata.listShowcase();
      if (cancelled) return;

      if (!result.success || !result.data) {
        if (result.error) {
          addNotification('warning', 'Showcase', `Showcase catalog unavailable: ${result.error}`);
        }
        return;
      }

      const entries = result.data ?? [];
      setShowcaseEntries(entries);
      setSelectedShowcasePath((prev) => {
        if (prev && entries.some((entry) => entry.relativePath === prev)) {
          return prev;
        }
        return entries[0]?.relativePath || '';
      });
    };

    void loadShowcaseCatalog();

    return () => {
      cancelled = true;
    };
  }, [addNotification]);

  useEffect(() => {
    const animator = setInterval(() => {
      tickAnimator(Date.now());
    }, Math.max(50, Math.round(1000 / visualHz)));

    return () => clearInterval(animator);
  }, [tickAnimator, visualHz]);

  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 120);
    const stale = setInterval(() => clearStale(Date.now(), 30_000), 5000);
    return () => {
      clearInterval(clock);
      clearInterval(stale);
    };
  }, [clearStale]);

  const deployments = useMemo(
    () =>
      Array.from(deploymentsMap.values()).sort(
        (a, b) => (statusOrder[b.status] || 0) - (statusOrder[a.status] || 0),
      ),
    [deploymentsMap],
  );

  const deploymentsByDevice = useMemo(() => {
    const mapped = new Map<string, DeviceDeploymentView[]>();

    deployments.forEach((deployment) => {
      const existing = mapped.get(String(deployment.deviceId)) ?? [];
      existing.push({
        deploymentId: String(deployment.deploymentId),
        automataId: String(deployment.automataId),
        deviceId: String(deployment.deviceId),
        status: deployment.status,
        currentState: deployment.currentState,
        updatedAt: deployment.updatedAt,
        source: 'runtime',
      });
      mapped.set(String(deployment.deviceId), existing);
    });

    mapped.forEach((entries, deviceId) => {
      const sorted = [...entries].sort((a, b) => {
        const statusDelta = deploymentStatusRank(b.status) - deploymentStatusRank(a.status);
        if (statusDelta !== 0) return statusDelta;
        return b.updatedAt - a.updatedAt;
      });

      const device = devicesMap.get(deviceId);
      if (!supportsMultipleDeployments(device)) {
        const activeEntry = sorted.find((deployment) => isRunningLike(deployment.status)) ?? sorted[0];
        mapped.set(deviceId, activeEntry ? [activeEntry] : []);
        return;
      }

      mapped.set(deviceId, sorted);
    });

    return mapped;
  }, [deployments, devicesMap]);

  const focusedDevice = focusedDeviceId ? devicesMap.get(focusedDeviceId as any) : undefined;
  const focusedServer = focusedDevice ? serversMap.get(focusedDevice.serverId as any) : undefined;
  const focusDeployments = useMemo(
    () => (focusedDevice ? deploymentsByDevice.get(focusedDevice.id) ?? [] : []),
    [deploymentsByDevice, focusedDevice],
  );
  const focusedTransfer = focusedDevice ? transferForDevice(focusedDevice, transfersMap, focusDeployments[0]) : undefined;

  const displayItems = useMemo<DisplayItem[]>(() => {
    let items: DisplayItem[];

    if (scope === 'running') {
      items = deployments
        .filter((deployment) => isRunningLike(deployment.status))
        .map((deployment) => {
          const device = devicesMap.get(deployment.deviceId as any);
          return {
            id: deployment.deploymentId,
            deploymentId: deployment.deploymentId,
            automataId: deployment.automataId,
            deviceId: deployment.deviceId,
            status: deployment.status,
            currentState: deployment.currentState,
            label: `${device?.name || deployment.deviceId} · ${deployment.automataId}`,
          };
        });
    } else {
      items = Array.from(automataMap.values()).map((automata) => {
        const attached = deployments.find((deployment) => deployment.automataId === automata.id);
        const device = attached ? devicesMap.get(attached.deviceId as any) : undefined;
        return {
          id: attached?.deploymentId ?? `project:${automata.id}`,
          deploymentId: attached?.deploymentId,
          automataId: automata.id,
          deviceId: attached?.deviceId,
          status: attached?.status || 'unknown',
          currentState: attached?.currentState,
          label: `${automata.config.name}${device ? ` · ${device.name}` : ''}`,
        };
      });
    }

    if (!focusedDeviceId) {
      return items;
    }

    return items.filter((item) => item.deviceId === focusedDeviceId);
  }, [automataMap, deployments, devicesMap, focusedDeviceId, scope]);

  useEffect(() => {
    const validIds = new Set(displayItems.map((item) => item.id));
    const stillValid = selectedIds.filter((id) => validIds.has(id));
    if (!sameSelection(stillValid, selectedIds)) {
      setSelected(stillValid);
    }
  }, [displayItems, selectedIds, setSelected]);

  useEffect(() => {
    if (!focusedDeviceId) {
      lastFocusedDeviceIdRef.current = null;
      return;
    }

    const focusItems = displayItems.filter((item) => item.deviceId === focusedDeviceId);
    const hasFocusSelection = selectedIds.some((id) => focusItems.some((item) => item.id === id));
    const focusChanged = lastFocusedDeviceIdRef.current !== focusedDeviceId;

    if ((focusChanged || !hasFocusSelection) && focusItems.length > 0) {
      const preferred = focusItems
        .filter((item) => isRunningLike(item.status))
        .map((item) => item.id);
      const next = preferred.length > 0 ? preferred : [focusItems[0].id];
      setSelected(next);
    }

    lastFocusedDeviceIdRef.current = focusedDeviceId;
  }, [displayItems, focusedDeviceId, selectedIds, setSelected]);

  const selectedItems = useMemo(() => {
    const selected = displayItems.filter((item) => selectedIds.includes(item.id));
    if (selected.length > 0) return selected;
    return displayItems.slice(0, Math.min(focusedDeviceId ? 3 : 2, displayItems.length));
  }, [displayItems, focusedDeviceId, selectedIds]);

  const selectedFocusDeployment = useMemo(() => {
    if (!focusedDevice) return null;
    const selectedByRuntime = focusDeployments.find((deployment) => selectedIds.includes(deployment.deploymentId));
    return (
      selectedByRuntime ??
      focusDeployments.find((deployment) => isRunningLike(deployment.status)) ??
      focusDeployments[0] ??
      null
    );
  }, [focusDeployments, focusedDevice, selectedIds]);

  useEffect(() => {
    setManualSnapshot(null);
    setLastSnapshotAt(null);
  }, [focusedDeviceId, selectedFocusDeployment?.deploymentId]);

  const selectedSnapshot =
    manualSnapshot &&
    (!selectedFocusDeployment || String(manualSnapshot.automataId) === selectedFocusDeployment.automataId)
      ? manualSnapshot
      : focusedExecution?.currentSnapshot &&
          (!selectedFocusDeployment ||
            String(focusedExecution.currentSnapshot.automataId) === selectedFocusDeployment.automataId)
        ? focusedExecution.currentSnapshot
        : null;

  const workspaceAutomata = useMemo(() => {
    return Array.from(automataMap.values()).sort((left, right) => {
      if (left.id === activeAutomataId) return -1;
      if (right.id === activeAutomataId) return 1;
      const leftPath = String(left.filePath ?? '');
      const rightPath = String(right.filePath ?? '');
      return left.config.name.localeCompare(right.config.name) || leftPath.localeCompare(rightPath);
    });
  }, [activeAutomataId, automataMap]);

  const filteredShowcaseEntries = useMemo(() => {
    const query = showcaseFilterText.trim().toLowerCase();
    const filtered = showcaseEntries.filter((entry) => {
      if (!query) return true;
      return `${entry.category} ${entry.name} ${entry.relativePath}`.toLowerCase().includes(query);
    });
    return filtered.slice(0, 10);
  }, [showcaseEntries, showcaseFilterText]);

  const attachImportedAutomata = (
    importedData: Partial<Automata>,
    filePath?: string,
    successLabel = 'Automata',
  ): { id: string; automata: Automata } | null => {
    const normalizedPath = String(filePath || '').replace(/\\/g, '/');
    const existing = normalizedPath
      ? Array.from(automataMap.values()).find(
          (automata) => String(automata.filePath || '').replace(/\\/g, '/') === normalizedPath,
        )
      : undefined;

    if (existing?.id) {
      setActiveAutomata(existing.id);
      return { id: existing.id, automata: existing };
    }

    const imported = normalizeImportedAutomata(importedData, {
      filePath,
      keepDirty: true,
    });

    const nextMap = new Map(automataMap);
    nextMap.set(imported.id, imported);
    setAutomataMap(nextMap);
    setActiveAutomata(imported.id);

    if (project) {
      let networkId = project.networks[0]?.id;
      if (!networkId) {
        networkId = createNetwork('Default Network');
      }
      addAutomataToNetwork(networkId, imported);
      markProjectDirty();
    }

    addNotification('success', successLabel, `Loaded ${imported.config.name} into editor.`);
    return { id: imported.id, automata: imported };
  };

  const importShowcaseAutomata = async (target: string): Promise<{ id: string; automata: Automata } | null> => {
    const result = await window.api.automata.loadShowcase(target);
    if (!result.success || !result.data) {
      addNotification('error', 'Showcase', result.error || `Failed to load showcase automata: ${target}`);
      return null;
    }

    return attachImportedAutomata(result.data as Partial<Automata>, result.filePath, 'Showcase');
  };

  const handleImportYamlAutomata = async (): Promise<{ id: string; automata: Automata } | null> => {
    const result = await window.api.automata.loadYaml();
    if (!result.success || !result.data) {
      if (result.error && result.error !== 'Cancelled') {
        addNotification('error', 'Import', result.error || 'Failed to load automata');
      }
      return null;
    }

    return attachImportedAutomata(result.data as Partial<Automata>, result.filePath, 'Import');
  };

  const handleDeployAutomataCandidate = async (candidate: { id: string; automata: Automata }) => {
    if (!focusedDevice) return;
    try {
      await gatewayService.deployAutomata(candidate.id, focusedDevice.id, { automata: candidate.automata });
      const deploymentId = `${candidate.id}:${focusedDevice.id}`;
      upsertRuntimeDeployment({
        deploymentId,
        automataId: candidate.id as any,
        deviceId: focusedDevice.id as any,
        status: isDeviceReachable(focusedDevice.status) ? 'loading' : 'offline',
        currentState: focusedDevice.currentState,
        updatedAt: Date.now(),
      });
      setSelected([deploymentId]);
      setActiveAutomata(candidate.id);
      addNotification('success', 'Deploy', `Deployed ${candidate.automata.config.name} to ${focusedDevice.name}`);
    } catch (err) {
      addNotification('error', 'Deploy', err instanceof Error ? err.message : 'Failed to deploy automata');
    }
  };

  const handleLoadShowcase = async () => {
    if (!selectedShowcasePath) {
      addNotification('warning', 'Showcase', 'No showcase automata selected.');
      return;
    }

    setShowcaseBusy(true);
    try {
      await importShowcaseAutomata(selectedShowcasePath);
    } finally {
      setShowcaseBusy(false);
    }
  };

  const handleDeployShowcase = async () => {
    if (!focusedDevice || !selectedShowcasePath) {
      addNotification('warning', 'Showcase Deploy', 'Select a device and showcase first.');
      return;
    }

    setShowcaseBusy(true);
    try {
      const candidate = await importShowcaseAutomata(selectedShowcasePath);
      if (!candidate) return;
      await handleDeployAutomataCandidate(candidate);
    } finally {
      setShowcaseBusy(false);
    }
  };

  const getCommandTarget = (deployment?: DeviceDeploymentView | null) =>
    deployment
      ? {
          automataId: deployment.automataId as any,
          deploymentId: deployment.deploymentId,
        }
      : undefined;

  const handleSnapshot = async () => {
    if (!focusedDevice || !selectedFocusDeployment) return;
    try {
      const snapshot = await gatewayService.getSnapshot(
        focusedDevice.id,
        getCommandTarget(selectedFocusDeployment),
      );
      setManualSnapshot(snapshot.snapshot);
      setLastSnapshotAt(Date.now());
      upsertRuntimeDeployment({
        deploymentId: selectedFocusDeployment.deploymentId,
        automataId: snapshot.snapshot.automataId as any,
        deviceId: focusedDevice.id as any,
        status: selectedFocusDeployment.status,
        currentState: snapshot.snapshot.currentState,
        variables: Object.fromEntries(
          Object.entries(snapshot.snapshot.variables ?? {}).map(([name, meta]) => [name, meta?.value]),
        ),
        updatedAt: Date.now(),
      });
      addNotification('info', 'Snapshot', `${focusedDevice.name} is in state ${snapshot.snapshot.currentState}`);
    } catch (err) {
      addNotification('error', 'Snapshot', err instanceof Error ? err.message : 'Failed to fetch snapshot');
    }
  };

  const handleSendVariable = async () => {
    if (!focusedDevice || !selectedFocusDeployment) return;
    if (!varName.trim()) {
      addNotification('warning', 'Set Variable', 'Variable name is required');
      return;
    }

    try {
      await gatewayService.setVariable(
        focusedDevice.id,
        varName.trim(),
        parseJsonOrString(varValue),
        getCommandTarget(selectedFocusDeployment),
      );
      addNotification('success', 'Set Variable', `Sent ${varName.trim()} to ${focusedDevice.name}`);
    } catch (err) {
      addNotification('error', 'Set Variable', err instanceof Error ? err.message : 'Failed to send');
    }
  };

  const handleTriggerEvent = async () => {
    if (!focusedDevice || !selectedFocusDeployment) return;
    if (!eventName.trim()) {
      addNotification('warning', 'Trigger Event', 'Event name is required');
      return;
    }

    try {
      const data = eventData.trim() ? parseJsonOrString(eventData) : undefined;
      await gatewayService.triggerEvent(
        focusedDevice.id,
        eventName.trim(),
        data,
        getCommandTarget(selectedFocusDeployment),
      );
      addNotification('success', 'Trigger Event', `Triggered ${eventName.trim()} on ${focusedDevice.name}`);
    } catch (err) {
      addNotification('error', 'Trigger Event', err instanceof Error ? err.message : 'Failed to send');
    }
  };

  const handleForceTransition = async () => {
    if (!focusedDevice || !selectedFocusDeployment) return;
    if (!forceState.trim()) {
      addNotification('warning', 'Force Transition', 'Target state is required');
      return;
    }

    try {
      await gatewayService.forceTransition(
        focusedDevice.id,
        forceState.trim(),
        getCommandTarget(selectedFocusDeployment),
      );
      addNotification('success', 'Force Transition', `Forced ${focusedDevice.name} to ${forceState.trim()}`);
    } catch (err) {
      addNotification('error', 'Force Transition', err instanceof Error ? err.message : 'Failed to send');
    }
  };

  const selectedShowcaseEntry =
    showcaseEntries.find((entry) => entry.relativePath === selectedShowcasePath) ?? null;
  const selectedVariableEntries = useMemo(
    () =>
      Object.entries(selectedSnapshot?.variables ?? {})
        .map(([name, meta]) => [name, meta?.value] as const)
        .sort(([a], [b]) => a.localeCompare(b)),
    [selectedSnapshot],
  );
  const snapshotCanRun =
    Boolean(focusedDevice && selectedFocusDeployment) &&
    isDeviceReachable(focusedDevice?.status ?? 'unknown') &&
    Boolean(
      !focusedDevice?.supportedCommands ||
        focusedDevice.supportedCommands.length === 0 ||
        focusedDevice.supportedCommands.includes('request_state'),
    );

  return (
    <div className="runtime-monitor-panel">
      <div className="runtime-monitor-header">
        <div className="runtime-header-title">Runtime Monitor</div>
        <div className="runtime-controls">
          <button
            className={`btn btn-secondary btn-sm ${scope === 'running' ? 'active' : ''}`}
            onClick={() => setScope('running')}
          >
            Running
          </button>
          <button
            className={`btn btn-secondary btn-sm ${scope === 'project' ? 'active' : ''}`}
            onClick={() => setScope('project')}
          >
            Project
          </button>
          <button className="btn btn-ghost btn-sm" onClick={selectRunning}>
            Select Running
          </button>
          <label className="runtime-hz">
            Hz
            <select value={visualHz} onChange={(e) => setVisualHz(Number(e.target.value))}>
              <option value={4}>4</option>
              <option value={8}>8</option>
              <option value={12}>12</option>
            </select>
          </label>
          <span className="runtime-now">{new Date(now).toLocaleTimeString()}</span>
        </div>
      </div>

      {focusedDevice && (
        <div className="runtime-focus-strip">
          <div className="runtime-focus-title">
            <IconDevice size={14} />
            <span>{focusedDevice.name}</span>
            <span className={`runtime-status status-${selectedFocusDeployment?.status ?? focusedDevice.status}`}>
              {runtimeStatusToLabel(selectedFocusDeployment?.status ?? focusedDevice.status)}
            </span>
          </div>
          <div className="runtime-focus-meta">
            <span>{focusedServer?.name || 'Unknown server'}</span>
            <span>{selectedFocusDeployment?.automataId || 'No deployment selected'}</span>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              selectDevice(null);
              setSelected([]);
            }}
          >
            <IconX size={12} />
            <span>Clear Focus</span>
          </button>
        </div>
      )}

      <div className={`runtime-monitor-body ${focusedDevice ? 'focused' : ''}`}>
        <aside className="runtime-sidebar">
          {displayItems.length === 0 ? (
            <div className="runtime-empty">
              {focusedDevice
                ? 'This device has no visible runtime graphs yet. Use Deploy to stage an automata.'
                : 'No automata or deployments to visualize.'}
            </div>
          ) : (
            displayItems.map((item) => {
              const transfer = item.deploymentId ? transfersMap.get(item.deploymentId) : undefined;

              return (
                <label key={item.id} className="runtime-item">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(item.id)}
                    onChange={(e) => toggleSelection(item.id, e.target.checked)}
                  />
                  <div className="runtime-item-content">
                    <div className="runtime-item-label">{item.label}</div>
                    <div className="runtime-item-meta">
                      <span className={`runtime-status status-${item.status}`}>{item.status}</span>
                      {item.currentState && <span className="runtime-state">{item.currentState}</span>}
                    </div>
                    {transfer && (
                      <div className="runtime-item-transfer">
                        <div className="runtime-item-transfer-meta">
                          <span>{humanizeTransferStage(transfer.stage)}</span>
                          <span>{Math.round(transfer.progressPercent)}%</span>
                        </div>
                        <div className="runtime-item-transfer-track">
                          <div
                            className="runtime-item-transfer-fill"
                            style={{ width: `${Math.round(transfer.progressPercent)}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </label>
              );
            })
          )}
        </aside>

        <section className="runtime-grid">
          {selectedItems.length === 0 ? (
            <div className="runtime-empty">Select one or more deployments from the left.</div>
          ) : (
            selectedItems.map((item) => (
              <RuntimeGraphCard
                key={item.id}
                item={item}
                now={now}
                frame={item.deploymentId ? renderFrames.get(item.deploymentId) : undefined}
                transfer={item.deploymentId ? transfersMap.get(item.deploymentId) : undefined}
              />
            ))
          )}
        </section>

        {focusedDevice && (
          <aside className="runtime-focus-panel">
            <section className="runtime-focus-card">
              <div className="runtime-focus-card-header">
                <div>
                  <div className="runtime-focus-card-title">Overview</div>
                  <div className="runtime-focus-card-subtitle">Selected device and deployment health</div>
                </div>
                <div className="runtime-focus-chip">
                  <IconCheck size={12} />
                  <span>{focusedDevice.connectorType || focusedDevice.transport || 'connector n/a'}</span>
                </div>
              </div>

              <div className="runtime-overview-grid">
                <div className="runtime-overview-stat">
                  <span className="runtime-overview-label">Deployment</span>
                  <span className="runtime-overview-value">{selectedFocusDeployment?.automataId || 'None'}</span>
                </div>
                <div className="runtime-overview-stat">
                  <span className="runtime-overview-label">Current State</span>
                  <span className="runtime-overview-value">
                    {selectedSnapshot?.currentState || selectedFocusDeployment?.currentState || focusedDevice.currentState || 'Idle'}
                  </span>
                </div>
                <div className="runtime-overview-stat">
                  <span className="runtime-overview-label">Last Snapshot</span>
                  <span className="runtime-overview-value">
                    {lastSnapshotAt ? new Date(lastSnapshotAt).toLocaleTimeString() : 'No manual snapshot'}
                  </span>
                </div>
                <div className="runtime-overview-stat">
                  <span className="runtime-overview-label">Signals</span>
                  <span className="runtime-overview-value">{selectedVariableEntries.length} vars</span>
                </div>
              </div>

              {focusedTransfer && (
                <div className="runtime-transfer runtime-transfer-inline">
                  <div className="runtime-transfer-meta">
                    <span>{humanizeTransferStage(focusedTransfer.stage)}</span>
                    <span>{Math.round(focusedTransfer.progressPercent)}%</span>
                  </div>
                  <div className="runtime-transfer-track">
                    <div
                      className="runtime-transfer-fill"
                      style={{ width: `${Math.round(focusedTransfer.progressPercent)}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="runtime-meta-list">
                <div className="runtime-meta-row">
                  <span>Server</span>
                  <span>{focusedServer?.name || 'Unknown'}</span>
                </div>
                <div className="runtime-meta-row">
                  <span>Engine</span>
                  <span>{focusedDevice.engineVersion || 'Unknown'}</span>
                </div>
                <div className="runtime-meta-row">
                  <span>Transport</span>
                  <span>{focusedDevice.transport || focusedDevice.link || 'n/a'}</span>
                </div>
                {focusedDevice.lastSeen && (
                  <div className="runtime-meta-row">
                    <span>Last Seen</span>
                    <span>{focusedDevice.lastSeen}</span>
                  </div>
                )}
              </div>
            </section>

            <section className="runtime-focus-card">
              <div className="runtime-focus-card-header">
                <div>
                  <div className="runtime-focus-card-title">Deploy</div>
                  <div className="runtime-focus-card-subtitle">Stage and ship automata to this device</div>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    const active = workspaceAutomata.find((automata) => automata.id === activeAutomataId) ?? workspaceAutomata[0];
                    if (active) {
                      void handleDeployAutomataCandidate({ id: active.id, automata: active });
                    }
                  }}
                  disabled={!isDeviceReachable(focusedDevice.status) || workspaceAutomata.length === 0}
                >
                  <IconUpload size={12} />
                  <span>Deploy Active</span>
                </button>
              </div>

              <div className="runtime-deploy-toolbar">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => void handleImportYamlAutomata()}>
                  Import YAML
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={handleLoadShowcase}
                  disabled={showcaseBusy || !selectedShowcasePath}
                >
                  Load Showcase
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={handleDeployShowcase}
                  disabled={showcaseBusy || !selectedShowcasePath || !isDeviceReachable(focusedDevice.status)}
                >
                  <IconPlay size={12} />
                  <span>Deploy Showcase</span>
                </button>
              </div>

              <div className="runtime-focus-section">
                <div className="runtime-focus-section-header">
                  <span>Workspace Automata</span>
                  {activeAutomataId && <span>{activeAutomataId}</span>}
                </div>
                <div className="runtime-card-list">
                  {workspaceAutomata.length === 0 ? (
                    <div className="runtime-inline-empty">Import or create automata to deploy.</div>
                  ) : (
                    workspaceAutomata.map((automata) => (
                      <div key={automata.id} className={`runtime-inline-card ${activeAutomataId === automata.id ? 'active' : ''}`}>
                        <div className="runtime-inline-card-copy">
                          <span className="runtime-inline-card-title">{automata.config.name}</span>
                          <span className="runtime-inline-card-meta">
                            {automata.filePath ? String(automata.filePath).split(/[\\/]/).pop() : automata.id}
                          </span>
                        </div>
                        <div className="runtime-inline-card-actions">
                          <button
                            type="button"
                            className={`btn btn-xs ${activeAutomataId === automata.id ? 'btn-primary' : 'btn-secondary'}`}
                            onClick={() => setActiveAutomata(automata.id)}
                          >
                            {activeAutomataId === automata.id ? 'Active' : 'Use'}
                          </button>
                          <button
                            type="button"
                            className="btn btn-xs btn-secondary"
                            onClick={() => void handleDeployAutomataCandidate({ id: automata.id, automata })}
                            disabled={!isDeviceReachable(focusedDevice.status)}
                          >
                            Deploy
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="runtime-focus-section">
                <div className="runtime-focus-section-header">
                  <span>Showcase Browser</span>
                  {selectedShowcaseEntry && <span>{selectedShowcaseEntry.category}</span>}
                </div>
                <input
                  className="input devices-search"
                  placeholder="Filter showcase examples"
                  value={showcaseFilterText}
                  onChange={(event) => setShowcaseFilterText(event.target.value)}
                />
                <div className="runtime-card-list">
                  {filteredShowcaseEntries.length === 0 ? (
                    <div className="runtime-inline-empty">No showcase automata match this filter.</div>
                  ) : (
                    filteredShowcaseEntries.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        className={`showcase-card ${selectedShowcasePath === entry.relativePath ? 'selected' : ''}`}
                        onClick={() => setSelectedShowcasePath(entry.relativePath)}
                      >
                        <span className="showcase-card-category">{entry.category}</span>
                        <span className="showcase-card-name">{entry.name}</span>
                        <span className="showcase-card-path">
                          {entry.relativePath.split('/').slice(-2).join('/')}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </section>

            <section className="runtime-focus-card">
              <div className="runtime-focus-card-header">
                <div>
                  <div className="runtime-focus-card-title">Control</div>
                  <div className="runtime-focus-card-subtitle">Low-level commands for the focused deployment</div>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={handleSnapshot}
                  disabled={!snapshotCanRun}
                >
                  <IconRefresh size={12} />
                  <span>Snapshot</span>
                </button>
              </div>

              <div className="runtime-form">
                <label className="runtime-form-row">
                  <span>Set Variable</span>
                  <input
                    className="input"
                    placeholder="name"
                    value={varName}
                    onChange={(event) => setVarName(event.target.value)}
                  />
                  <input
                    className="input"
                    placeholder="value (json or text)"
                    value={varValue}
                    onChange={(event) => setVarValue(event.target.value)}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={handleSendVariable}
                    disabled={!focusedDevice || !selectedFocusDeployment}
                  >
                    Send
                  </button>
                </label>

                <label className="runtime-form-row">
                  <span>Trigger Event</span>
                  <input
                    className="input"
                    placeholder="event"
                    value={eventName}
                    onChange={(event) => setEventName(event.target.value)}
                  />
                  <input
                    className="input"
                    placeholder="data (optional json/text)"
                    value={eventData}
                    onChange={(event) => setEventData(event.target.value)}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={handleTriggerEvent}
                    disabled={!focusedDevice || !selectedFocusDeployment}
                  >
                    Send
                  </button>
                </label>

                <label className="runtime-form-row compact">
                  <span>Force State</span>
                  <input
                    className="input"
                    placeholder="state id"
                    value={forceState}
                    onChange={(event) => setForceState(event.target.value)}
                  />
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={handleForceTransition}
                    disabled={!focusedDevice || !selectedFocusDeployment}
                  >
                    Force
                  </button>
                </label>
              </div>

              {selectedVariableEntries.length > 0 && (
                <div className="runtime-focus-section">
                  <div className="runtime-focus-section-header">
                    <span>Snapshot Variables</span>
                    <span>{selectedVariableEntries.length}</span>
                  </div>
                  <div className="metadata-list">
                    {selectedVariableEntries.slice(0, 12).map(([name, value]) => (
                      <span key={name} className="tag-item" title={formatSignalValue(value)}>
                        {name}: {formatSignalValue(value)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </section>
          </aside>
        )}
      </div>
    </div>
  );
};
