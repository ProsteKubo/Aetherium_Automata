import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  useAutomataStore,
  useExecutionStore,
  useGatewayStore,
  useProjectStore,
  useRuntimeViewStore,
  useUIStore,
} from '../../stores';
import type {
  Automata,
  BlackBoxDescription,
  BlackBoxSnapshot,
  ExecutionSnapshot,
  TimeTravelSession,
} from '../../types';
import type { RuntimeDeploymentTransfer, RuntimeRenderFrame } from '../../types/runtimeView';
import { normalizeImportedAutomata } from '../../utils/importedAutomata';
import {
  IconCheck,
  IconDevice,
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

type LogicalRuntimeGroup = {
  id: string;
  name: string;
  color?: string;
  automataIds: string[];
  deploymentIds: string[];
  deviceIds: string[];
  runningCount: number;
  totalCount: number;
  serverNames: string[];
};

const FSM_STATE_W = 80;
const FSM_STATE_H = 28;
const FSM_ARROW_SZ = 6;

function fmtVarVal(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(3);
  if (typeof v === 'string') return v.slice(0, 24);
  return JSON.stringify(v).slice(0, 24);
}

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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function supportsRuntimeCommand(commands: string[] | undefined, command: string): boolean {
  return !commands || commands.length === 0 || commands.includes(command);
}

function snapshotToBlackBoxSnapshot(snapshot: ExecutionSnapshot | null): BlackBoxSnapshot | null {
  if (!snapshot?.blackBox) return null;

  return {
    automataId: snapshot.automataId,
    deviceId: snapshot.deviceId,
    currentState: snapshot.currentState,
    variables: Object.fromEntries(
      Object.entries(snapshot.variables ?? {}).map(([name, meta]) => [name, meta?.value]),
    ),
    outputs: Object.fromEntries(
      Object.entries(snapshot.outputs ?? {}).map(([name, meta]) => [name, meta?.value]),
    ),
    deploymentMetadata: snapshot.deploymentMetadata,
    blackBox: snapshot.blackBox,
    observableState: snapshot.observableState,
  };
}

const FSM_STATUS_COLORS: Record<string, string> = {
  running: '#3d8fe9',
  loading: '#3de9e9',
  paused: '#e9d63d',
  error: '#e93d3d',
  stopped: '#8fe93d',
};

const RuntimeFsmCard = React.memo(function RuntimeFsmCard({
  item,
  frame,
  transfer,
  liveVariables,
  automata,
}: {
  item: DisplayItem;
  frame?: RuntimeRenderFrame;
  transfer?: RuntimeDeploymentTransfer;
  liveVariables?: Record<string, unknown>;
  automata?: Automata;
}) {
  const activeState = frame?.activeStateId || item.currentState || null;
  const color = FSM_STATUS_COLORS[item.status] ?? '#8fe93d';

  const states = useMemo(
    () => automata ? Object.values(automata.states).filter(Boolean) : [],
    [automata],
  );
  const transitions = useMemo(
    () => automata ? Object.values(automata.transitions).filter(Boolean) : [],
    [automata],
  );

  const TILE_W = 320;
  const TILE_H = 200;

  const { scale, offsetX, offsetY } = useMemo(() => {
    if (!states.length) return { scale: 1, offsetX: 0, offsetY: 0 };
    const pad = 20;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of states) {
      const { x, y } = s.position ?? { x: 0, y: 0 };
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x + FSM_STATE_W > maxX) maxX = x + FSM_STATE_W;
      if (y + FSM_STATE_H > maxY) maxY = y + FSM_STATE_H;
    }
    const rawW = maxX - minX || 1;
    const rawH = maxY - minY || 1;
    const availW = TILE_W - pad * 2;
    const availH = TILE_H - pad * 2;
    const s = Math.min(availW / rawW, availH / rawH, 1.4);
    return {
      scale: s,
      offsetX: pad + (availW - rawW * s) / 2 - minX * s,
      offsetY: pad + (availH - rawH * s) / 2 - minY * s,
    };
  }, [states]);

  const sw = FSM_STATE_W * scale;
  const sh = FSM_STATE_H * scale;
  const px = (x: number) => x * scale + offsetX;
  const py = (y: number) => y * scale + offsetY;
  const markerId = `arr-rt-${item.automataId.replace(/[^a-z0-9]/gi, '_')}`;

  const varEntries = useMemo(
    () => (liveVariables ? Object.entries(liveVariables) : []),
    [liveVariables],
  );

  return (
    <div className="runtime-card">
      <div className="runtime-card-header" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2, padding: '6px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />
          <span className="runtime-card-title" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>{item.automataId}</span>
          <span className={`runtime-status status-${item.status}`} style={{ fontSize: 9, flexShrink: 0 }}>{item.status}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', paddingLeft: 13 }}>
          <span style={{ fontSize: 10, fontFamily: 'monospace', color, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {activeState ?? 'unknown'}
          </span>
          {item.deviceId && (
            <span style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--color-text-disabled)', flexShrink: 0 }}>
              {String(item.deviceId).slice(0, 12)}
            </span>
          )}
          {frame && frame.droppedEvents > 0 && (
            <span className="runtime-dropped" title="Visual decimation under burst load" style={{ flexShrink: 0 }}>
              −{frame.droppedEvents}
            </span>
          )}
        </div>
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
      {!automata ? (
        <div className="runtime-card-empty">
          Automata <code>{item.automataId}</code> definition not available. Open the automata file in the editor.
        </div>
      ) : (
        <div className="runtime-flow" style={{ overflow: 'hidden', flex: 1, position: 'relative' }}>
          <svg width="100%" height="100%" viewBox={`0 0 ${TILE_W} ${TILE_H}`}
            style={{ display: 'block', opacity: (item.status === 'stopped' || item.status === 'error') ? 0.6 : 1 }}>
            <defs>
              <marker id={markerId} markerWidth={FSM_ARROW_SZ} markerHeight={FSM_ARROW_SZ} refX={FSM_ARROW_SZ - 1} refY={FSM_ARROW_SZ / 2} orient="auto">
                <path d={`M0,0 L${FSM_ARROW_SZ},${FSM_ARROW_SZ / 2} L0,${FSM_ARROW_SZ} Z`} fill="var(--color-text-disabled)" />
              </marker>
            </defs>
            {transitions.map((tr) => {
              const fs = automata.states[tr.from];
              const ts = automata.states[tr.to];
              if (!fs || !ts) return null;
              const fp = fs.position ?? { x: 0, y: 0 };
              const tp = ts.position ?? { x: 0, y: 0 };
              const x1 = px(fp.x) + sw / 2, y1 = py(fp.y) + sh / 2;
              const x2 = px(tp.x) + sw / 2, y2 = py(tp.y) + sh / 2;
              if (tr.from === tr.to) {
                return (
                  <path key={tr.id}
                    d={`M${x1 + sw / 2},${y1} C${x1 + sw / 2 + 20},${y1 - 25} ${x1 + sw / 2 + 20},${y1 + 5} ${x1 + sw / 2},${y1}`}
                    fill="none" stroke="var(--color-text-disabled)" strokeWidth={1} opacity={0.35}
                    markerEnd={`url(#${markerId})`}
                  />
                );
              }
              const dist = Math.hypot(x2 - x1, y2 - y1);
              if (dist < 2) return null;
              const ux = (x2 - x1) / dist, uy = (y2 - y1) / dist;
              return (
                <line key={tr.id}
                  x1={x1 + ux * (sw / 2 + 2)} y1={y1 + uy * (sh / 2 + 2)}
                  x2={x2 - ux * (sw / 2 + FSM_ARROW_SZ + 2)} y2={y2 - uy * (sh / 2 + FSM_ARROW_SZ + 2)}
                  stroke="var(--color-text-disabled)" strokeWidth={1} opacity={0.38}
                  markerEnd={`url(#${markerId})`}
                />
              );
            })}
            {states.map((s) => {
              const { x, y } = s.position ?? { x: 0, y: 0 };
              const isActive = s.id === activeState || s.name === activeState;
              const isInitial = s.id === automata.initialState;
              const fs = Math.max(7, Math.min(11, sh * 0.45));
              return (
                <g key={s.id}>
                  {isInitial && (
                    <circle cx={px(x) - 6} cy={py(y) + sh / 2} r={3} fill="var(--color-text-disabled)" opacity={0.5} />
                  )}
                  <rect
                    x={px(x)} y={py(y)} width={sw} height={sh} rx={sh * 0.28}
                    fill={isActive ? color : 'var(--color-bg-3)'}
                    stroke={isActive ? color : 'var(--color-border)'}
                    strokeWidth={isActive ? 1.5 : 0.8}
                    opacity={isActive ? 0.9 : 0.65}
                  />
                  <text
                    x={px(x) + sw / 2} y={py(y) + sh / 2 + 1}
                    textAnchor="middle" dominantBaseline="middle"
                    fontSize={fs} fontFamily="monospace"
                    fill={isActive ? '#fff' : 'var(--color-text-secondary)'}
                    fontWeight={isActive ? 700 : 400}
                  >
                    {s.name.slice(0, 15)}
                  </text>
                </g>
              );
            })}
          </svg>
          {(item.status === 'stopped' || item.status === 'error') && (
            <div style={{
              position: 'absolute', bottom: 0, left: 0, right: 0,
              padding: '4px 0',
              background: item.status === 'error'
                ? 'rgba(233, 61, 61, 0.12)'
                : 'rgba(143, 233, 61, 0.08)',
              borderTop: `1px solid ${item.status === 'error' ? 'rgba(233,61,61,0.3)' : 'rgba(143,233,61,0.25)'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
              <span style={{ fontSize: 8, fontFamily: 'monospace', letterSpacing: '0.1em', color }}>
                {item.status === 'error' ? '✕ ERROR' : '✓ FINISHED'}
              </span>
              {activeState && (
                <span style={{ fontSize: 8, fontFamily: 'monospace', color: 'var(--color-text-disabled)' }}>
                  @ {activeState}
                </span>
              )}
            </div>
          )}
        </div>
      )}
      {varEntries.length > 0 && (
        <div style={{ borderTop: '1px solid var(--color-border)', padding: '4px 8px', background: 'var(--color-bg-2)' }}>
          <div style={{ fontSize: 8, fontFamily: 'monospace', color: 'var(--color-text-disabled)', letterSpacing: '0.06em', marginBottom: 3 }}>
            VARIABLES (LIVE)
          </div>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <tbody>
              {varEntries.map(([k, v]) => (
                <tr key={k}>
                  <td style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--color-text-secondary)', paddingRight: 6, whiteSpace: 'nowrap' }}>
                    {k}
                  </td>
                  <td style={{ fontSize: 9, fontFamily: 'monospace', color, fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {fmtVarVal(v)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
});

export const RuntimeMonitorPanel: React.FC = () => {
  const [varName, setVarName] = useState('');
  const [varValue, setVarValue] = useState('');
  const [eventName, setEventName] = useState('');
  const [eventData, setEventData] = useState('');
  const [forceState, setForceState] = useState('');
  const [blackBoxDescription, setBlackBoxDescription] = useState<BlackBoxDescription | null>(null);
  const [blackBoxSnapshot, setBlackBoxSnapshot] = useState<BlackBoxSnapshot | null>(null);
  const [blackBoxLoading, setBlackBoxLoading] = useState(false);
  const [blackBoxInputPort, setBlackBoxInputPort] = useState('');
  const [blackBoxInputValue, setBlackBoxInputValue] = useState('');
  const [blackBoxEvent, setBlackBoxEvent] = useState('');
  const [blackBoxEventData, setBlackBoxEventData] = useState('');
  const [blackBoxForceState, setBlackBoxForceState] = useState('');
  const [timeTravelSession, setTimeTravelSession] = useState<TimeTravelSession | null>(null);
  const [timeTravelLoading, setTimeTravelLoading] = useState(false);
  const [timeTravelMaxSnapshots, setTimeTravelMaxSnapshots] = useState('500');
  const [timeTravelBookmarkName, setTimeTravelBookmarkName] = useState('');
  const [manualSnapshot, setManualSnapshot] = useState<ExecutionSnapshot | null>(null);
  const [lastSnapshotAt, setLastSnapshotAt] = useState<number | null>(null);
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
  // tickAnimator and clearStale are driven exclusively by GatewayEventBridge
  // (always mounted) — do not run duplicate intervals here.
  const upsertRuntimeDeployment = useRuntimeViewStore((state) => state.upsertDeployment);
  const setTimeTravelFrame = useRuntimeViewStore((state) => state.setTimeTravelFrame);
  const focusedDeviceId = useExecutionStore((state) => state.selectedDeviceId);
  const selectDevice = useExecutionStore((state) => state.selectDevice);
  const focusedExecution = useExecutionStore((state) =>
    focusedDeviceId ? state.deviceExecutions.get(focusedDeviceId as any) : undefined,
  );

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

  const networkByAutomataId = useMemo(() => {
    const mapped = new Map<string, { id: string; name: string; color?: string }>();
    project?.networks.forEach((network) => {
      network.automataIds.forEach((automataId) => {
        mapped.set(automataId, {
          id: network.id,
          name: network.name,
          color: network.color,
        });
      });
    });
    return mapped;
  }, [project]);

  const logicalNetworkGroups = useMemo<LogicalRuntimeGroup[]>(() => {
    if (!project) {
      return [];
    }

    return project.networks.map((network) => {
      const automataIds = network.automataIds.filter((automataId) => automataMap.has(automataId));
      const deploymentsForNetwork = deployments.filter((deployment) => automataIds.includes(deployment.automataId));
      const deviceIds = Array.from(new Set(deploymentsForNetwork.map((deployment) => String(deployment.deviceId))));
      const serverNames = Array.from(
        new Set(
          deviceIds
            .map((deviceId) => devicesMap.get(deviceId)?.serverId)
            .map((serverId) => (serverId ? serversMap.get(serverId)?.name ?? serverId : null))
            .filter((value): value is string => Boolean(value)),
        ),
      );

      return {
        id: network.id,
        name: network.name,
        color: network.color,
        automataIds,
        deploymentIds: deploymentsForNetwork.map((deployment) => deployment.deploymentId),
        deviceIds,
        runningCount: deploymentsForNetwork.filter((deployment) => isRunningLike(deployment.status)).length,
        totalCount: automataIds.length,
        serverNames,
      };
    });
  }, [automataMap, deployments, devicesMap, project, serversMap]);

  const displayItems = useMemo<DisplayItem[]>(() => {
    let items: DisplayItem[];

    if (scope === 'running') {
      items = deployments
        .filter((deployment) =>
          isRunningLike(deployment.status) ||
          deployment.status === 'stopped' ||
          deployment.status === 'error'
        )
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
    } else if (scope === 'networks') {
      items = logicalNetworkGroups.flatMap((group) =>
        group.automataIds.map((automataId) => {
          const automata = automataMap.get(automataId);
          const attached = deployments.find((deployment) => deployment.automataId === automataId);
          const device = attached ? devicesMap.get(attached.deviceId as any) : undefined;
          return {
            id: attached?.deploymentId ?? `project:${automataId}`,
            deploymentId: attached?.deploymentId,
            automataId,
            deviceId: attached?.deviceId,
            status: attached?.status || 'unknown',
            currentState: attached?.currentState,
            label: `${group.name} · ${automata?.config.name || automataId}${device ? ` · ${device.name}` : ''}`,
          };
        }),
      );
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
  }, [automataMap, deployments, devicesMap, focusedDeviceId, logicalNetworkGroups, scope]);

  useEffect(() => {
    const validIds = new Set(displayItems.map((item) => item.id));
    const stillValid = selectedIds.filter((id) => validIds.has(id));

    if (!sameSelection(stillValid, selectedIds)) {
      // When selection becomes empty due to item ID changes (e.g., "project:automataId"
      // → "automataId:deviceId" when a deployment starts), try to re-select an equivalent
      // item for the same automata/device so the graph doesn't vanish.
      if (stillValid.length === 0 && selectedIds.length > 0) {
        const lostIds = new Set(selectedIds.filter((id) => !validIds.has(id)));
        const recovered: string[] = [];

        lostIds.forEach((lostId) => {
          // "project:automataId" pattern — find the now-deployed item for that automata
          const projectPrefix = 'project:';
          if (lostId.startsWith(projectPrefix)) {
            const automataId = lostId.slice(projectPrefix.length);
            const match = displayItems.find((item) => item.automataId === automataId);
            if (match) recovered.push(match.id);
          }
        });

        setSelected(recovered.length > 0 ? recovered : stillValid);
      } else {
        setSelected(stillValid);
      }
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

  const selectedLogicalNetworkLabel = useMemo(() => {
    if (selectedFocusDeployment) {
      return networkByAutomataId.get(selectedFocusDeployment.automataId)?.name ?? 'Unscoped deployment';
    }

    const names = Array.from(
      new Set(
        displayItems
          .filter((item) => selectedIds.includes(item.id))
          .map((item) => networkByAutomataId.get(item.automataId)?.name)
          .filter((value): value is string => Boolean(value)),
      ),
    );

    if (names.length === 0) return 'Unscoped selection';
    if (names.length === 1) return names[0];
    return `${names.length} logical networks`;
  }, [displayItems, networkByAutomataId, selectedFocusDeployment, selectedIds]);

  useEffect(() => {
    setManualSnapshot(null);
    setLastSnapshotAt(null);
    setBlackBoxDescription(null);
    setBlackBoxSnapshot(null);
    setTimeTravelSession(null);
    setTimeTravelBookmarkName('');
  }, [focusedDeviceId, selectedFocusDeployment?.deploymentId]);

  const selectedCommandTarget = useMemo(
    () =>
      selectedFocusDeployment
        ? {
            automataId: selectedFocusDeployment.automataId as any,
            deploymentId: selectedFocusDeployment.deploymentId,
          }
        : undefined,
    [selectedFocusDeployment?.automataId, selectedFocusDeployment?.deploymentId],
  );

  const selectedSnapshot =
    manualSnapshot &&
    (!selectedFocusDeployment || String(manualSnapshot.automataId) === selectedFocusDeployment.automataId)
      ? manualSnapshot
      : focusedExecution?.currentSnapshot &&
          (!selectedFocusDeployment ||
            String(focusedExecution.currentSnapshot.automataId) === selectedFocusDeployment.automataId)
        ? focusedExecution.currentSnapshot
        : null;

  const derivedBlackBoxSnapshot = useMemo(
    () => snapshotToBlackBoxSnapshot(selectedSnapshot),
    [selectedSnapshot],
  );

  const activeBlackBoxSnapshot = blackBoxSnapshot ?? derivedBlackBoxSnapshot;
  const activeBlackBoxDescription = useMemo<BlackBoxDescription | null>(() => {
    if (blackBoxDescription) return blackBoxDescription;
    if (!derivedBlackBoxSnapshot?.blackBox) return null;

    return {
      deploymentId: selectedFocusDeployment?.deploymentId,
      automataId: derivedBlackBoxSnapshot.automataId,
      deviceId: derivedBlackBoxSnapshot.deviceId,
      status: selectedFocusDeployment?.status,
      observableState: derivedBlackBoxSnapshot.observableState,
      deploymentMetadata: derivedBlackBoxSnapshot.deploymentMetadata,
      blackBox: derivedBlackBoxSnapshot.blackBox,
    };
  }, [blackBoxDescription, derivedBlackBoxSnapshot, selectedFocusDeployment]);

  const blackBoxContract = activeBlackBoxDescription?.blackBox ?? activeBlackBoxSnapshot?.blackBox ?? null;
  const blackBoxMetadata =
    activeBlackBoxSnapshot?.deploymentMetadata ?? activeBlackBoxDescription?.deploymentMetadata;
  const blackBoxBattery = asRecord(blackBoxMetadata?.battery);
  const blackBoxLatency = asRecord(blackBoxMetadata?.latency);
  const blackBoxInputPorts = useMemo(
    () => blackBoxContract?.ports.filter((port) => port.direction === 'input') ?? [],
    [blackBoxContract],
  );
  const blackBoxOutputPorts = useMemo(
    () => blackBoxContract?.ports.filter((port) => port.direction === 'output') ?? [],
    [blackBoxContract],
  );
  const blackBoxInternalPorts = useMemo(
    () => blackBoxContract?.ports.filter((port) => port.direction === 'internal') ?? [],
    [blackBoxContract],
  );
  const blackBoxMetadataEntries = useMemo(
    () =>
      Object.entries(blackBoxMetadata ?? {}).sort(([left], [right]) => left.localeCompare(right)),
    [blackBoxMetadata],
  );

  const workspaceAutomata = useMemo(() => {
    return Array.from(automataMap.values()).sort((left, right) => {
      if (left.id === activeAutomataId) return -1;
      if (right.id === activeAutomataId) return 1;
      const leftPath = String(left.filePath ?? '');
      const rightPath = String(right.filePath ?? '');
      return left.config.name.localeCompare(right.config.name) || leftPath.localeCompare(rightPath);
    });
  }, [activeAutomataId, automataMap]);

  useEffect(() => {
    if (!blackBoxContract) {
      setBlackBoxInputPort('');
      setBlackBoxEvent('');
      setBlackBoxForceState('');
      return;
    }

    setBlackBoxInputPort((current) =>
      blackBoxInputPorts.some((port) => port.name === current) ? current : (blackBoxInputPorts[0]?.name ?? ''),
    );
    setBlackBoxEvent((current) =>
      blackBoxContract.emittedEvents.includes(current) ? current : (blackBoxContract.emittedEvents[0] ?? ''),
    );
    setBlackBoxForceState((current) =>
      blackBoxContract.observableStates.includes(current)
        ? current
        : (blackBoxContract.observableStates[0] ?? ''),
    );
  }, [blackBoxContract, blackBoxInputPorts]);

  useEffect(() => {
    let cancelled = false;

    const canDescribe =
      Boolean(focusedDevice && selectedCommandTarget) &&
      supportsRuntimeCommand(focusedDevice?.supportedCommands, 'black_box_describe');
    const canSnapshot =
      Boolean(focusedDevice && selectedCommandTarget) &&
      supportsRuntimeCommand(focusedDevice?.supportedCommands, 'black_box_snapshot');

    if (!focusedDevice || !selectedCommandTarget || (!canDescribe && !canSnapshot)) {
      setBlackBoxDescription(null);
      setBlackBoxSnapshot(null);
      setBlackBoxLoading(false);
      return;
    }

    const loadBlackBoxContext = async () => {
      setBlackBoxLoading(true);

      let nextDescription: BlackBoxDescription | null = null;
      let nextSnapshot: BlackBoxSnapshot | null = null;

      if (canDescribe) {
        try {
          nextDescription = await gatewayService.describeBlackBox(focusedDevice.id, selectedCommandTarget);
        } catch {
          nextDescription = null;
        }
      }

      if (canSnapshot) {
        try {
          nextSnapshot = await gatewayService.getBlackBoxSnapshot(
            focusedDevice.id,
            selectedCommandTarget,
            { silent: true },
          );
        } catch {
          nextSnapshot = null;
        }
      }

      if (cancelled) return;

      setBlackBoxDescription(nextDescription);
      setBlackBoxSnapshot(nextSnapshot);
      if (nextSnapshot) {
        setLastSnapshotAt(Date.now());
      }
      setBlackBoxLoading(false);
    };

    void loadBlackBoxContext();

    return () => {
      cancelled = true;
    };
  }, [
    focusedDevice?.id,
    (focusedDevice?.supportedCommands ?? []).join('|'),
    gatewayService,
    selectedCommandTarget,
  ]);

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
      const response = await gatewayService.deployAutomata(candidate.id, focusedDevice.id, { automata: candidate.automata });
      const deploymentId = response.deploymentId ?? `${candidate.id}:${focusedDevice.id}`;
      setSelected([deploymentId]);
      setActiveAutomata(candidate.id);
      addNotification('success', 'Deploy', `Deployed ${candidate.automata.config.name} to ${focusedDevice.name}`);
    } catch (err) {
      addNotification('error', 'Deploy', err instanceof Error ? err.message : 'Failed to deploy automata');
    }
  };

  const refreshBlackBoxContext = async (options?: { notify?: boolean; silentError?: boolean }) => {
    if (!focusedDevice || !selectedCommandTarget) return null;

    const canDescribe = supportsRuntimeCommand(focusedDevice.supportedCommands, 'black_box_describe');
    const canSnapshot = supportsRuntimeCommand(focusedDevice.supportedCommands, 'black_box_snapshot');

    if (!canDescribe && !canSnapshot) return null;

    setBlackBoxLoading(true);

    let nextDescription: BlackBoxDescription | null = null;
    let nextSnapshot: BlackBoxSnapshot | null = null;
    let lastError: unknown = null;

    if (canDescribe) {
      try {
        nextDescription = await gatewayService.describeBlackBox(focusedDevice.id, selectedCommandTarget);
      } catch (err) {
        lastError = err;
      }
    }

    if (canSnapshot) {
      try {
        nextSnapshot = await gatewayService.getBlackBoxSnapshot(
          focusedDevice.id,
          selectedCommandTarget,
          { silent: true },
        );
      } catch (err) {
        lastError = err;
      }
    }

    setBlackBoxDescription(nextDescription);
    setBlackBoxSnapshot(nextSnapshot);

    if (nextSnapshot && selectedFocusDeployment) {
      setLastSnapshotAt(Date.now());
      upsertRuntimeDeployment({
        deploymentId: selectedFocusDeployment.deploymentId,
        automataId: (nextSnapshot.automataId ?? selectedFocusDeployment.automataId) as any,
        deviceId: focusedDevice.id as any,
        status: selectedFocusDeployment.status,
        currentState: nextSnapshot.currentState,
        variables: nextSnapshot.variables,
        updatedAt: Date.now(),
      });
    }

    setBlackBoxLoading(false);

    if (!nextDescription && !nextSnapshot && lastError && !options?.silentError) {
      throw lastError;
    }

    if ((nextDescription || nextSnapshot) && options?.notify) {
      addNotification('info', 'Black Box', `Refreshed ${focusedDevice.name}`);
    }

    return { description: nextDescription, snapshot: nextSnapshot };
  };

  const syncFocusedSnapshot = async (
    snapshot: ExecutionSnapshot,
    options?: { refreshBlackBox?: boolean },
  ) => {
    setManualSnapshot(snapshot);
    setLastSnapshotAt(snapshot.timestamp ?? Date.now());

    if (focusedDevice && selectedFocusDeployment) {
      upsertRuntimeDeployment({
        deploymentId: selectedFocusDeployment.deploymentId,
        automataId: snapshot.automataId as any,
        deviceId: focusedDevice.id as any,
        status: selectedFocusDeployment.status,
        currentState: snapshot.currentState,
        variables: Object.fromEntries(
          Object.entries(snapshot.variables ?? {}).map(([name, meta]) => [name, meta?.value]),
        ),
        updatedAt: Date.now(),
      });
      if (snapshot.currentState) {
        setTimeTravelFrame(selectedFocusDeployment.deploymentId, snapshot.currentState);
      }
    }

    if (options?.refreshBlackBox) {
      await refreshBlackBoxContext({ silentError: true });
    }
  };

  const handleStartTimeTravel = async () => {
    if (!focusedDevice || !selectedFocusDeployment) return;

    try {
      setTimeTravelLoading(true);
      const parsed = Number.parseInt(timeTravelMaxSnapshots, 10);
      const maxSnapshots = Number.isFinite(parsed) && parsed > 0 ? parsed : 500;

      // Collect all device IDs currently deployed — rewind the full network together
      const allDeviceIds = Array.from(deploymentsMap.values())
        .map((d) => d.deviceId)
        .filter(Boolean);
      const networkDeviceIds =
        allDeviceIds.length > 0 ? ([...new Set(allDeviceIds)] as typeof allDeviceIds) : [focusedDevice.id];

      const { session } = await gatewayService.startTimeTravel(networkDeviceIds, { maxSnapshots });
      setTimeTravelSession(session);

      const initialSnapshot =
        session.history.snapshots[session.history.currentIndex] ??
        session.history.snapshots[session.history.snapshots.length - 1];

      if (initialSnapshot) {
        await syncFocusedSnapshot(initialSnapshot, { refreshBlackBox: true });
      }

      addNotification(
        'success',
        'Time Travel',
        `Loaded ${session.history.snapshots.length} timeline snapshots for ${focusedDevice.name}`,
      );
    } catch (err) {
      addNotification(
        'error',
        'Time Travel',
        err instanceof Error ? err.message : 'Failed to load deployment timeline',
      );
    } finally {
      setTimeTravelLoading(false);
    }
  };

  const handleStopTimeTravel = async () => {
    if (!timeTravelSession) return;

    try {
      setTimeTravelLoading(true);
      const session = await gatewayService.stopTimeTravel(timeTravelSession.id);
      setTimeTravelSession(session);
      addNotification('info', 'Time Travel', 'Closed the active replay session');
    } catch (err) {
      addNotification(
        'error',
        'Time Travel',
        err instanceof Error ? err.message : 'Failed to stop replay session',
      );
    } finally {
      setTimeTravelLoading(false);
    }
  };

  const handleNavigateTimeTravel = async (direction: 'forward' | 'backward') => {
    if (!timeTravelSession) return;

    try {
      setTimeTravelLoading(true);
      const response = await gatewayService.navigateTimeTravel(timeTravelSession.id, {
        direction,
        steps: 1,
      });

      setTimeTravelSession((current) => {
        if (!current) return current;
        return {
          ...current,
          isReplaying: true,
          currentReplayIndex: response.currentIndex,
          lastRewindEventsReplayed: response.eventsReplayed,
          lastRewindRequestedTimestamp: response.requestedTimestamp,
          lastRewindStateFingerprint: response.stateFingerprint,
          lastRewindEventCursorStart: response.eventCursorStart,
          lastRewindEventCursorEnd: response.eventCursorEnd,
          history: {
            ...current.history,
            currentIndex: response.currentIndex,
          },
        };
      });

      await syncFocusedSnapshot(response.snapshot, { refreshBlackBox: true });
    } catch (err) {
      addNotification(
        'error',
        'Time Travel',
        err instanceof Error ? err.message : 'Failed to move through the deployment timeline',
      );
    } finally {
      setTimeTravelLoading(false);
    }
  };

  const handleCreateTimeTravelBookmark = async () => {
    if (!timeTravelSession) return;

    const name = timeTravelBookmarkName.trim();
    if (!name) {
      addNotification('warning', 'Time Travel Bookmark', 'Bookmark name is required');
      return;
    }

    try {
      await gatewayService.createBookmark(timeTravelSession.id, name);
      setTimeTravelSession((current) => {
        if (!current) return current;
        return {
          ...current,
          bookmarks: [
            ...current.bookmarks,
            {
              id: `bookmark:${Date.now()}`,
              name,
              snapshotIndex: current.currentReplayIndex,
              timestamp: Date.now(),
              tags: [],
            },
          ],
        };
      });
      setTimeTravelBookmarkName('');
      addNotification('success', 'Time Travel Bookmark', `Saved bookmark ${name}`);
    } catch (err) {
      addNotification(
        'error',
        'Time Travel Bookmark',
        err instanceof Error ? err.message : 'Failed to save bookmark',
      );
    }
  };

  const handleSnapshot = async () => {
    if (!focusedDevice || !selectedFocusDeployment || !selectedCommandTarget) return;
    try {
      const snapshot = await gatewayService.getSnapshot(focusedDevice.id, selectedCommandTarget);
      await syncFocusedSnapshot(snapshot.snapshot, { refreshBlackBox: true });
      addNotification('info', 'Snapshot', `${focusedDevice.name} is in state ${snapshot.snapshot.currentState}`);
    } catch (err) {
      addNotification('error', 'Snapshot', err instanceof Error ? err.message : 'Failed to fetch snapshot');
    }
  };

  const handleSendVariable = async () => {
    if (!focusedDevice || !selectedFocusDeployment || !selectedCommandTarget) return;
    if (!varName.trim()) {
      addNotification('warning', 'Set Variable', 'Variable name is required');
      return;
    }

    try {
      await gatewayService.setVariable(
        focusedDevice.id,
        varName.trim(),
        parseJsonOrString(varValue),
        selectedCommandTarget,
      );
      addNotification('success', 'Set Variable', `Sent ${varName.trim()} to ${focusedDevice.name}`);
    } catch (err) {
      addNotification('error', 'Set Variable', err instanceof Error ? err.message : 'Failed to send');
    }
  };

  const handleTriggerEvent = async () => {
    if (!focusedDevice || !selectedFocusDeployment || !selectedCommandTarget) return;
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
        selectedCommandTarget,
      );
      addNotification('success', 'Trigger Event', `Triggered ${eventName.trim()} on ${focusedDevice.name}`);
    } catch (err) {
      addNotification('error', 'Trigger Event', err instanceof Error ? err.message : 'Failed to send');
    }
  };

  const handleForceTransition = async () => {
    if (!focusedDevice || !selectedFocusDeployment || !selectedCommandTarget) return;
    if (!forceState.trim()) {
      addNotification('warning', 'Force Transition', 'Target state is required');
      return;
    }

    try {
      await gatewayService.forceTransition(
        focusedDevice.id,
        forceState.trim(),
        selectedCommandTarget,
      );
      addNotification('success', 'Force Transition', `Forced ${focusedDevice.name} to ${forceState.trim()}`);
    } catch (err) {
      addNotification('error', 'Force Transition', err instanceof Error ? err.message : 'Failed to send');
    }
  };

  const handleBlackBoxSnapshot = async () => {
    try {
      await refreshBlackBoxContext({ notify: true });
    } catch (err) {
      addNotification('error', 'Black Box', err instanceof Error ? err.message : 'Failed to refresh black box');
    }
  };

  const handleSetBlackBoxInput = async () => {
    if (!focusedDevice || !selectedCommandTarget) return;
    if (!blackBoxInputPort.trim()) {
      addNotification('warning', 'Black Box Input', 'Input port is required');
      return;
    }

    try {
      await gatewayService.setBlackBoxInput(
        focusedDevice.id,
        blackBoxInputPort.trim(),
        parseJsonOrString(blackBoxInputValue),
        selectedCommandTarget,
      );
      await refreshBlackBoxContext({ silentError: true });
      addNotification('success', 'Black Box Input', `Sent ${blackBoxInputPort.trim()} to ${focusedDevice.name}`);
    } catch (err) {
      addNotification('error', 'Black Box Input', err instanceof Error ? err.message : 'Failed to send');
    }
  };

  const handleTriggerBlackBoxEvent = async () => {
    if (!focusedDevice || !selectedCommandTarget) return;
    if (!blackBoxEvent.trim()) {
      addNotification('warning', 'Black Box Event', 'Event name is required');
      return;
    }

    try {
      await gatewayService.triggerBlackBoxEvent(
        focusedDevice.id,
        blackBoxEvent.trim(),
        blackBoxEventData.trim() ? parseJsonOrString(blackBoxEventData) : undefined,
        selectedCommandTarget,
      );
      await refreshBlackBoxContext({ silentError: true });
      addNotification('success', 'Black Box Event', `Triggered ${blackBoxEvent.trim()} on ${focusedDevice.name}`);
    } catch (err) {
      addNotification('error', 'Black Box Event', err instanceof Error ? err.message : 'Failed to send');
    }
  };

  const handleForceBlackBoxState = async () => {
    if (!focusedDevice || !selectedCommandTarget) return;
    if (!blackBoxForceState.trim()) {
      addNotification('warning', 'Black Box State', 'Target state is required');
      return;
    }

    try {
      await gatewayService.forceBlackBoxState(
        focusedDevice.id,
        blackBoxForceState.trim(),
        selectedCommandTarget,
      );
      await refreshBlackBoxContext({ silentError: true });
      addNotification('success', 'Black Box State', `Forced ${focusedDevice.name} to ${blackBoxForceState.trim()}`);
    } catch (err) {
      addNotification('error', 'Black Box State', err instanceof Error ? err.message : 'Failed to send');
    }
  };

  const selectedVariableEntries = useMemo(
    () =>
      Object.entries(selectedSnapshot?.variables ?? {})
        .map(([name, meta]) => [name, meta?.value] as const)
        .sort(([a], [b]) => a.localeCompare(b)),
    [selectedSnapshot],
  );
  const blackBoxOutputEntries = useMemo(
    () =>
      Object.entries(activeBlackBoxSnapshot?.outputs ?? {}).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    [activeBlackBoxSnapshot],
  );
  const blackBoxVariableEntries = useMemo(
    () =>
      Object.entries(activeBlackBoxSnapshot?.variables ?? {}).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    [activeBlackBoxSnapshot],
  );
  const blackBoxCanDescribe =
    Boolean(focusedDevice && selectedCommandTarget) &&
    supportsRuntimeCommand(focusedDevice?.supportedCommands, 'black_box_describe');
  const blackBoxCanSnapshot =
    Boolean(focusedDevice && selectedCommandTarget) &&
    supportsRuntimeCommand(focusedDevice?.supportedCommands, 'black_box_snapshot');
  const blackBoxCanSetInput =
    Boolean(focusedDevice && selectedCommandTarget) &&
    supportsRuntimeCommand(focusedDevice?.supportedCommands, 'black_box_set_input');
  const blackBoxCanTriggerEvent =
    Boolean(focusedDevice && selectedCommandTarget) &&
    supportsRuntimeCommand(focusedDevice?.supportedCommands, 'black_box_trigger_event');
  const blackBoxCanForceState =
    Boolean(focusedDevice && selectedCommandTarget) &&
    supportsRuntimeCommand(focusedDevice?.supportedCommands, 'black_box_force_state');
  const hasBlackBoxView =
    Boolean(activeBlackBoxDescription || activeBlackBoxSnapshot || blackBoxCanDescribe || blackBoxCanSnapshot);
  const snapshotCanRun =
    Boolean(focusedDevice && selectedFocusDeployment) &&
    isDeviceReachable(focusedDevice?.status ?? 'unknown') &&
    supportsRuntimeCommand(focusedDevice?.supportedCommands, 'request_state');
  // Time travel queries the server's persisted time-series — the device doesn't
  // need to be live. Allow it whenever there's a focused deployment.
  const timeTravelCanRun = Boolean(focusedDevice && selectedFocusDeployment);
  const timeTravelCurrentSnapshot =
    timeTravelSession?.history.snapshots[timeTravelSession.currentReplayIndex] ?? null;
  const timeTravelCanGoBackward = Boolean(timeTravelSession && timeTravelSession.currentReplayIndex > 0);
  const timeTravelCanGoForward = Boolean(
    timeTravelSession && timeTravelSession.currentReplayIndex < timeTravelSession.history.snapshots.length - 1,
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
            className={`btn btn-secondary btn-sm ${scope === 'networks' ? 'active' : ''}`}
            onClick={() => setScope('networks')}
          >
            Networks
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
          <span className="runtime-now">{new Date().toLocaleTimeString()}</span>
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
            <span>{selectedLogicalNetworkLabel}</span>
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
          {logicalNetworkGroups.length > 0 && (
            <div className="petri-inspector-section" style={{ marginBottom: 12 }}>
              <div className="petri-block-title">Logical Networks</div>
              <div className="petri-inspector-subtitle">
                Runtime selection is framed around the flagship network-of-networks package. Use the Networks scope to
                follow deployment pressure across cooperating EFSM groups.
              </div>
              <div className="petri-warning-list">
                {logicalNetworkGroups.map((group) => (
                  <div key={group.id} className="petri-merge-item">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: 1 }}>
                      <strong>{group.name}</strong>
                      <span>
                        {group.runningCount}/{group.totalCount} active · {group.deviceIds.length} devices
                        {group.serverNames.length > 0 ? ` · ${group.serverNames.join(', ')}` : ''}
                      </span>
                    </div>
                    <span
                      className="petri-chip accent"
                      style={group.color ? { borderColor: group.color, color: group.color } : undefined}
                    >
                      network scope
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

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
              <RuntimeFsmCard
                key={item.id}
                item={item}
                frame={item.deploymentId ? renderFrames.get(item.deploymentId) : undefined}
                transfer={item.deploymentId ? transfersMap.get(item.deploymentId) : undefined}
                liveVariables={item.deploymentId ? deploymentsMap.get(item.deploymentId)?.variables : undefined}
                automata={
                  (project?.automata as Record<string, Automata> | undefined)?.[item.automataId] ??
                  automataMap.get(item.automataId as any)
                }
              />
            ))
          )}
        </section>

        {!focusedDevice && (
          <aside className="runtime-focus-panel">
            <div className="runtime-inline-empty" style={{ padding: '24px 16px', textAlign: 'center' }}>
              <strong>Click a device</strong> in the left column to focus it. The focus panel provides
              time travel debugging, snapshot control, black box inspection, and deployment commands.
            </div>
          </aside>
        )}

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
                    {selectedFocusDeployment?.currentState ||
                      focusedDevice.currentState ||
                      activeBlackBoxSnapshot?.currentState ||
                      selectedSnapshot?.currentState ||
                      'Idle'}
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
                  <span className="runtime-overview-value">
                    {hasBlackBoxView
                      ? `${blackBoxOutputEntries.length} outputs`
                      : `${selectedVariableEntries.length} vars`}
                  </span>
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
                {typeof blackBoxMetadata?.placement === 'string' && (
                  <div className="runtime-meta-row">
                    <span>Placement</span>
                    <span>{blackBoxMetadata.placement}</span>
                  </div>
                )}
                {typeof blackBoxBattery?.percent === 'number' && (
                  <div className="runtime-meta-row">
                    <span>Battery</span>
                    <span>
                      {blackBoxBattery.percent.toFixed(1)}%
                      {blackBoxBattery.low === true ? ' low' : ''}
                    </span>
                  </div>
                )}
                {typeof blackBoxLatency?.observed_ms === 'number' && (
                  <div className="runtime-meta-row">
                    <span>Observed Latency</span>
                    <span>{blackBoxLatency.observed_ms} ms</span>
                  </div>
                )}
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
                  <span>Flagship Source</span>
                </div>
                <div className="runtime-inline-empty">
                  The flagship workspace is now the primary deploy source. Use the loaded project automata above or
                  import a focused YAML when you intentionally want to stage something outside the default package.
                </div>
              </div>
            </section>

            <section className="runtime-focus-card">
              <div className="runtime-focus-card-header">
                <div>
                  <div className="runtime-focus-card-title">Time Travel</div>
                  <div className="runtime-focus-card-subtitle">
                    Capture the deployment timeline, rewind it, and bookmark interesting failure points
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={handleStartTimeTravel}
                    disabled={!timeTravelCanRun || timeTravelLoading}
                  >
                    <IconRefresh size={12} />
                    <span>{timeTravelSession ? 'Reload Timeline' : 'Load Timeline'}</span>
                  </button>
                  {timeTravelSession && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={handleStopTimeTravel}
                      disabled={timeTravelLoading}
                    >
                      <span>Close</span>
                    </button>
                  )}
                </div>
              </div>

              {!timeTravelSession ? (
                <div className="runtime-inline-empty">
                  Load the focused device timeline to make replay, rewind, and bookmark workflows part of the default
                  runtime story.
                </div>
              ) : (
                <>
                  <div className="runtime-overview-grid">
                    <div className="runtime-overview-stat">
                      <span className="runtime-overview-label">Timeline Source</span>
                      <span className="runtime-overview-value">{timeTravelSession.timelineSource || 'unknown'}</span>
                    </div>
                    <div className="runtime-overview-stat">
                      <span className="runtime-overview-label">Snapshots</span>
                      <span className="runtime-overview-value">{timeTravelSession.history.snapshots.length}</span>
                    </div>
                    <div className="runtime-overview-stat">
                      <span className="runtime-overview-label">Replay Cursor</span>
                      <span className="runtime-overview-value">
                        {timeTravelSession.currentReplayIndex + 1}/{timeTravelSession.history.snapshots.length}
                      </span>
                    </div>
                    <div className="runtime-overview-stat">
                      <span className="runtime-overview-label">Bookmarks</span>
                      <span className="runtime-overview-value">{timeTravelSession.bookmarks.length}</span>
                    </div>
                  </div>

                  <div className="runtime-focus-section">
                    <div className="runtime-focus-section-header">
                      <span>Replay Controls</span>
                      <span>{timeTravelCurrentSnapshot?.currentState || 'No snapshot selected'}</span>
                    </div>
                    <div className="runtime-deploy-toolbar">
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => void handleNavigateTimeTravel('backward')}
                        disabled={!timeTravelCanGoBackward || timeTravelLoading}
                      >
                        Previous
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => void handleNavigateTimeTravel('forward')}
                        disabled={!timeTravelCanGoForward || timeTravelLoading}
                      >
                        Next
                      </button>
                      <input
                        className="input"
                        style={{ maxWidth: 140 }}
                        value={timeTravelBookmarkName}
                        onChange={(event) => setTimeTravelBookmarkName(event.target.value)}
                        placeholder="bookmark name"
                      />
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={handleCreateTimeTravelBookmark}
                        disabled={timeTravelLoading}
                      >
                        Bookmark
                      </button>
                    </div>
                    <div className="runtime-meta-list">
                      <div className="runtime-meta-row">
                        <span>Replay State</span>
                        <span>{timeTravelCurrentSnapshot?.currentState || 'unknown'}</span>
                      </div>
                      <div className="runtime-meta-row">
                        <span>Replay Timestamp</span>
                        <span>
                          {timeTravelCurrentSnapshot
                            ? new Date(timeTravelCurrentSnapshot.timestamp).toLocaleString()
                            : 'n/a'}
                        </span>
                      </div>
                      <div className="runtime-meta-row">
                        <span>Events Replayed</span>
                        <span>{timeTravelSession.lastRewindEventsReplayed ?? 'n/a'}</span>
                      </div>
                      <div className="runtime-meta-row">
                        <span>Requested Timestamp</span>
                        <span>
                          {typeof timeTravelSession.lastRewindRequestedTimestamp === 'number'
                            ? new Date(timeTravelSession.lastRewindRequestedTimestamp).toLocaleString()
                            : 'n/a'}
                        </span>
                      </div>
                      <div className="runtime-meta-row">
                        <span>Replay Fingerprint</span>
                        <span>{timeTravelSession.lastRewindStateFingerprint || 'n/a'}</span>
                      </div>
                      <div className="runtime-meta-row">
                        <span>Replay Cursor Window</span>
                        <span>
                          {typeof timeTravelSession.lastRewindEventCursorStart === 'number' &&
                          typeof timeTravelSession.lastRewindEventCursorEnd === 'number'
                            ? `${timeTravelSession.lastRewindEventCursorStart} → ${timeTravelSession.lastRewindEventCursorEnd}`
                            : 'n/a'}
                        </span>
                      </div>
                      {timeTravelSession.timelineBackendError && (
                        <div className="runtime-meta-row">
                          <span>Timeline Warning</span>
                          <span>{timeTravelSession.timelineBackendError}</span>
                        </div>
                      )}
                      {timeTravelSession.lastRewindBackendError && (
                        <div className="runtime-meta-row">
                          <span>Replay Warning</span>
                          <span>{timeTravelSession.lastRewindBackendError}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="runtime-focus-section">
                    <div className="runtime-focus-section-header">
                      <span>Capture Window</span>
                    </div>
                    <div className="runtime-deploy-toolbar">
                      <input
                        className="input"
                        style={{ maxWidth: 140 }}
                        value={timeTravelMaxSnapshots}
                        onChange={(event) => setTimeTravelMaxSnapshots(event.target.value)}
                        placeholder="max snapshots"
                      />
                      <span className="runtime-inline-empty" style={{ padding: 0 }}>
                        Device-level timeline capture powers rewind and replay for the focused flagship deployment.
                      </span>
                    </div>
                  </div>

                  {timeTravelSession.bookmarks.length > 0 && (
                    <div className="runtime-focus-section">
                      <div className="runtime-focus-section-header">
                        <span>Bookmarks</span>
                        <span>{timeTravelSession.bookmarks.length}</span>
                      </div>
                      <div className="metadata-list">
                        {timeTravelSession.bookmarks.map((bookmark) => (
                          <span key={bookmark.id} className="tag-item">
                            {bookmark.name} @ {bookmark.snapshotIndex + 1}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </section>

            <section className="runtime-focus-card">
              <div className="runtime-focus-card-header">
                <div>
                  <div className="runtime-focus-card-title">Black Box</div>
                  <div className="runtime-focus-card-subtitle">
                    Contract-driven interface for the focused deployment
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={handleBlackBoxSnapshot}
                  disabled={!blackBoxCanSnapshot || blackBoxLoading}
                >
                  <IconRefresh size={12} />
                  <span>{blackBoxLoading ? 'Loading' : 'Refresh'}</span>
                </button>
              </div>

              {!hasBlackBoxView ? (
                <div className="runtime-inline-empty">
                  No black-box contract is available for this deployment yet.
                </div>
              ) : (
                <>
                  <div className="runtime-overview-grid">
                    <div className="runtime-overview-stat">
                      <span className="runtime-overview-label">Observable State</span>
                      <span className="runtime-overview-value">
                        {activeBlackBoxSnapshot?.observableState ||
                          activeBlackBoxDescription?.observableState ||
                          activeBlackBoxSnapshot?.currentState ||
                          'unknown'}
                      </span>
                    </div>
                    <div className="runtime-overview-stat">
                      <span className="runtime-overview-label">Placement</span>
                      <span className="runtime-overview-value">
                        {typeof blackBoxMetadata?.placement === 'string'
                          ? blackBoxMetadata.placement
                          : 'n/a'}
                      </span>
                    </div>
                    <div className="runtime-overview-stat">
                      <span className="runtime-overview-label">Battery</span>
                      <span className="runtime-overview-value">
                        {typeof blackBoxBattery?.percent === 'number'
                          ? `${blackBoxBattery.percent.toFixed(1)}%${blackBoxBattery.low === true ? ' low' : ''}`
                          : 'n/a'}
                      </span>
                    </div>
                    <div className="runtime-overview-stat">
                      <span className="runtime-overview-label">Observed Latency</span>
                      <span className="runtime-overview-value">
                        {typeof blackBoxLatency?.observed_ms === 'number'
                          ? `${blackBoxLatency.observed_ms} ms`
                          : 'n/a'}
                      </span>
                    </div>
                  </div>

                  {blackBoxMetadataEntries.length > 0 && (
                    <div className="runtime-focus-section">
                      <div className="runtime-focus-section-header">
                        <span>Deployment Metadata</span>
                        <span>{blackBoxMetadataEntries.length}</span>
                      </div>
                      <div className="metadata-list">
                        {blackBoxMetadataEntries.map(([name, value]) => (
                          <span key={name} className="tag-item" title={formatSignalValue(value)}>
                            {name}: {formatSignalValue(value)}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {blackBoxInputPorts.length > 0 && (
                    <div className="runtime-focus-section">
                      <div className="runtime-focus-section-header">
                        <span>Input Ports</span>
                        <span>{blackBoxInputPorts.length}</span>
                      </div>
                      <div className="runtime-black-box-port-grid">
                        {blackBoxInputPorts.map((port) => (
                          <div key={port.name} className="runtime-black-box-port-card">
                            <div className="runtime-black-box-port-head">
                              <span>{port.name}</span>
                              <span>{port.type}</span>
                            </div>
                            <div className="runtime-black-box-port-meta">
                              {port.description || 'No description'}
                            </div>
                            <div className="runtime-black-box-port-value">
                              {formatSignalValue(activeBlackBoxSnapshot?.variables?.[port.name])}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {blackBoxOutputPorts.length > 0 && (
                    <div className="runtime-focus-section">
                      <div className="runtime-focus-section-header">
                        <span>Output Ports</span>
                        <span>{blackBoxOutputPorts.length}</span>
                      </div>
                      <div className="runtime-black-box-port-grid">
                        {blackBoxOutputPorts.map((port) => (
                          <div key={port.name} className="runtime-black-box-port-card">
                            <div className="runtime-black-box-port-head">
                              <span>{port.name}</span>
                              <span>{port.type}</span>
                            </div>
                            <div className="runtime-black-box-port-meta">
                              {port.description || 'No description'}
                            </div>
                            <div className="runtime-black-box-port-value">
                              {formatSignalValue(activeBlackBoxSnapshot?.outputs?.[port.name])}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {blackBoxInternalPorts.length > 0 && (
                    <div className="runtime-focus-section">
                      <div className="runtime-focus-section-header">
                        <span>Internal Ports</span>
                        <span>{blackBoxInternalPorts.length}</span>
                      </div>
                      <div className="metadata-list">
                        {blackBoxInternalPorts.map((port) => (
                          <span key={port.name} className="tag-item" title={port.description}>
                            {port.name}: {port.type}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {blackBoxContract?.resources.length ? (
                    <div className="runtime-focus-section">
                      <div className="runtime-focus-section-header">
                        <span>Resources</span>
                        <span>{blackBoxContract.resources.length}</span>
                      </div>
                      <div className="metadata-list">
                        {blackBoxContract.resources.map((resource) => (
                          <span key={resource.name} className="tag-item" title={resource.description}>
                            {resource.name}: {resource.kind}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="runtime-form">
                    <label className="runtime-form-row">
                      <span>Set Input</span>
                      <select
                        className="input"
                        value={blackBoxInputPort}
                        onChange={(event) => setBlackBoxInputPort(event.target.value)}
                        disabled={!blackBoxCanSetInput || blackBoxInputPorts.length === 0}
                      >
                        {blackBoxInputPorts.length === 0 ? (
                          <option value="">No input ports</option>
                        ) : (
                          blackBoxInputPorts.map((port) => (
                            <option key={port.name} value={port.name}>
                              {port.name}
                            </option>
                          ))
                        )}
                      </select>
                      <input
                        className="input"
                        placeholder="value (json or text)"
                        value={blackBoxInputValue}
                        onChange={(event) => setBlackBoxInputValue(event.target.value)}
                      />
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={handleSetBlackBoxInput}
                        disabled={!blackBoxCanSetInput || blackBoxInputPorts.length === 0}
                      >
                        Send
                      </button>
                    </label>

                    <label className="runtime-form-row">
                      <span>Trigger Event</span>
                      <select
                        className="input"
                        value={blackBoxEvent}
                        onChange={(event) => setBlackBoxEvent(event.target.value)}
                        disabled={!blackBoxCanTriggerEvent || !blackBoxContract?.emittedEvents.length}
                      >
                        {!blackBoxContract?.emittedEvents.length ? (
                          <option value="">No emitted events</option>
                        ) : (
                          blackBoxContract.emittedEvents.map((eventName) => (
                            <option key={eventName} value={eventName}>
                              {eventName}
                            </option>
                          ))
                        )}
                      </select>
                      <input
                        className="input"
                        placeholder="data (optional json/text)"
                        value={blackBoxEventData}
                        onChange={(event) => setBlackBoxEventData(event.target.value)}
                      />
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={handleTriggerBlackBoxEvent}
                        disabled={!blackBoxCanTriggerEvent || !blackBoxContract?.emittedEvents.length}
                      >
                        Send
                      </button>
                    </label>

                    <label className="runtime-form-row compact">
                      <span>Force State</span>
                      <select
                        className="input"
                        value={blackBoxForceState}
                        onChange={(event) => setBlackBoxForceState(event.target.value)}
                        disabled={!blackBoxCanForceState || !blackBoxContract?.observableStates.length}
                      >
                        {!blackBoxContract?.observableStates.length ? (
                          <option value="">No observable states</option>
                        ) : (
                          blackBoxContract.observableStates.map((stateName) => (
                            <option key={stateName} value={stateName}>
                              {stateName}
                            </option>
                          ))
                        )}
                      </select>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={handleForceBlackBoxState}
                        disabled={!blackBoxCanForceState || !blackBoxContract?.observableStates.length}
                      >
                        Force
                      </button>
                    </label>
                  </div>

                  {blackBoxOutputEntries.length > 0 && (
                    <div className="runtime-focus-section">
                      <div className="runtime-focus-section-header">
                        <span>Observed Outputs</span>
                        <span>{blackBoxOutputEntries.length}</span>
                      </div>
                      <div className="metadata-list">
                        {blackBoxOutputEntries.map(([name, value]) => (
                          <span key={name} className="tag-item" title={formatSignalValue(value)}>
                            {name}: {formatSignalValue(value)}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {blackBoxVariableEntries.length > 0 && (
                    <div className="runtime-focus-section">
                      <div className="runtime-focus-section-header">
                        <span>Observed Variables</span>
                        <span>{blackBoxVariableEntries.length}</span>
                      </div>
                      <div className="metadata-list">
                        {blackBoxVariableEntries.slice(0, 12).map(([name, value]) => (
                          <span key={name} className="tag-item" title={formatSignalValue(value)}>
                            {name}: {formatSignalValue(value)}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
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
