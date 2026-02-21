import React, { useEffect, useMemo, useState } from 'react';
import ReactFlow, { Background, BackgroundVariant, Edge, MiniMap, Node } from 'reactflow';
import 'reactflow/dist/style.css';
import { useAutomataStore, useGatewayStore, useRuntimeViewStore } from '../../stores';
import { StateNode } from '../editor/StateNode';
import type { RuntimeRenderFrame } from '../../types/runtimeView';

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

function isRunningLike(status: string): boolean {
  return status === 'running' || status === 'loading' || status === 'paused';
}

function sameSelection(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, idx) => id === b[idx]);
}

function RuntimeGraphCard({
  item,
  frame,
  now,
}: {
  item: DisplayItem;
  frame?: RuntimeRenderFrame;
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
  const automataMap = useAutomataStore((state) => state.automata);
  const devicesMap = useGatewayStore((state) => state.devices);
  const scope = useRuntimeViewStore((state) => state.scope);
  const setScope = useRuntimeViewStore((state) => state.setScope);
  const deploymentsMap = useRuntimeViewStore((state) => state.deployments);
  const selectedIds = useRuntimeViewStore((state) => state.selectedDeploymentIds);
  const toggleSelection = useRuntimeViewStore((state) => state.toggleSelection);
  const setSelected = useRuntimeViewStore((state) => state.setSelected);
  const selectRunning = useRuntimeViewStore((state) => state.selectRunning);
  const renderFrames = useRuntimeViewStore((state) => state.renderFrames);
  const visualHz = useRuntimeViewStore((state) => state.visualHz);
  const setVisualHz = useRuntimeViewStore((state) => state.setVisualHz);
  const tickAnimator = useRuntimeViewStore((state) => state.tickAnimator);
  const clearStale = useRuntimeViewStore((state) => state.clearStale);
  const [now, setNow] = useState(Date.now());

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
    () => Array.from(deploymentsMap.values()).sort((a, b) => (statusOrder[b.status] || 0) - (statusOrder[a.status] || 0)),
    [deploymentsMap],
  );

  const runningDeployments = useMemo(
    () => deployments.filter((deployment) => isRunningLike(deployment.status)),
    [deployments],
  );

  const displayItems = useMemo<DisplayItem[]>(() => {
    if (scope === 'running') {
      return runningDeployments.map((deployment) => {
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
    }

    const byAutomata = new Map<string, DisplayItem>();
    Array.from(automataMap.values()).forEach((automata) => {
      const attached = deployments.find((deployment) => deployment.automataId === automata.id);
      const device = attached ? devicesMap.get(attached.deviceId as any) : undefined;
      byAutomata.set(`project:${automata.id}`, {
        id: `project:${automata.id}`,
        deploymentId: attached?.deploymentId,
        automataId: automata.id,
        deviceId: attached?.deviceId,
        status: attached?.status || 'unknown',
        currentState: attached?.currentState,
        label: `${automata.config.name}${device ? ` · ${device.name}` : ''}`,
      });
    });

    return Array.from(byAutomata.values());
  }, [automataMap, deployments, devicesMap, runningDeployments, scope]);

  useEffect(() => {
    const validIds = new Set(displayItems.map((item) => item.id));
    const stillValid = selectedIds.filter((id) => validIds.has(id));
    if (!sameSelection(stillValid, selectedIds)) {
      setSelected(stillValid);
    }
  }, [displayItems, selectedIds, setSelected]);

  const selectedItems = useMemo(() => {
    const selected = displayItems.filter((item) => selectedIds.includes(item.id));
    if (selected.length > 0) return selected;
    return displayItems.slice(0, Math.min(2, displayItems.length));
  }, [displayItems, selectedIds]);

  return (
    <div className="runtime-monitor-panel">
      <div className="runtime-monitor-header">
        <div className="runtime-header-title">Runtime Monitor</div>
        <div className="runtime-controls">
          <button className={`btn btn-secondary btn-sm ${scope === 'running' ? 'active' : ''}`} onClick={() => setScope('running')}>
            Running
          </button>
          <button className={`btn btn-secondary btn-sm ${scope === 'project' ? 'active' : ''}`} onClick={() => setScope('project')}>
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

      <div className="runtime-monitor-body">
        <aside className="runtime-sidebar">
          {displayItems.length === 0 ? (
            <div className="runtime-empty">No automata/deployments to visualize.</div>
          ) : (
            displayItems.map((item) => (
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
                </div>
              </label>
            ))
          )}
        </aside>

        <section className="runtime-grid">
          {selectedItems.length === 0 ? (
            <div className="runtime-empty">Select one or more automata from the left.</div>
          ) : (
            selectedItems.map((item) => (
              <RuntimeGraphCard
                key={item.id}
                item={item}
                now={now}
                frame={item.deploymentId ? renderFrames.get(item.deploymentId) : undefined}
              />
            ))
          )}
        </section>
      </div>
    </div>
  );
};
