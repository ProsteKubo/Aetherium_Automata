import { create } from 'zustand';
import type {
  RuntimeDeployment,
  RuntimeDeploymentTransfer,
  RuntimeDeploymentStatus,
  RuntimeRenderFrame,
  RuntimeSnapshotPoint,
  RuntimeTransitionEvent,
  RuntimeViewScope,
} from '../types/runtimeView';

interface RuntimeViewState {
  scope: RuntimeViewScope;
  deployments: Map<string, RuntimeDeployment>;
  transfers: Map<string, RuntimeDeploymentTransfer>;
  selectedDeploymentIds: string[];
  transitionQueues: Map<string, RuntimeTransitionEvent[]>;
  transitionHistory: Map<string, RuntimeTransitionEvent[]>;
  snapshots: Map<string, RuntimeSnapshotPoint[]>;
  renderFrames: Map<string, RuntimeRenderFrame>;
  visualHz: number;
  transitionHighlightMs: number;
  statePulseMs: number;
  maxEvents: number;
  maxQueueBurst: number;
}

interface RuntimeViewActions {
  upsertDeployment: (deployment: RuntimeDeployment) => void;
  replaceDeploymentInventory: (deployments: Array<Record<string, unknown>>) => void;
  ingestTransition: (event: RuntimeTransitionEvent) => void;
  ingestDeploymentStatus: (payload: Record<string, unknown>) => void;
  ingestDeploymentTransfer: (payload: Record<string, unknown>) => void;
  setScope: (scope: RuntimeViewScope) => void;
  toggleSelection: (deploymentId: string, selected?: boolean) => void;
  setSelected: (deploymentIds: string[]) => void;
  selectRunning: () => void;
  seedFromDevices: (devices: RuntimeSeedDevice[]) => void;
  clearStale: (now?: number, staleMs?: number) => void;
  tickAnimator: (now?: number) => void;
  setTimeTravelFrame: (deploymentId: string, activeStateId: string) => void;
  setVisualHz: (hz: number) => void;
  reset: () => void;
}

type RuntimeViewStore = RuntimeViewState & RuntimeViewActions;
type RuntimeSeedDevice = {
  id: string;
  status: string;
  assignedAutomataId?: string;
  currentState?: string;
};

function createInitialState(): RuntimeViewState {
  return {
    scope: 'networks',
    deployments: new Map(),
    transfers: new Map(),
    selectedDeploymentIds: [],
    transitionQueues: new Map(),
    transitionHistory: new Map(),
    snapshots: new Map(),
    renderFrames: new Map(),
    visualHz: 8,
    transitionHighlightMs: 220,
    statePulseMs: 400,
    maxEvents: 2000,
    maxQueueBurst: 150,
  };
}

const initialState = createInitialState();

function mapStatus(raw: unknown): RuntimeDeploymentStatus {
  const value = String(raw ?? 'unknown').toLowerCase();
  if (value === 'loading' || value === 'deploying' || value === 'pending') return 'loading';
  if (value === 'running') return 'running';
  if (value === 'paused') return 'paused';
  if (value === 'stopped') return 'stopped';
  if (value === 'error') return 'error';
  if (value === 'offline' || value === 'disconnected') return 'offline';
  return 'unknown';
}

function isRunningLike(status: RuntimeDeploymentStatus): boolean {
  return status === 'running' || status === 'loading' || status === 'paused';
}

function ensureFrame(
  frames: Map<string, RuntimeRenderFrame>,
  deploymentId: string,
): RuntimeRenderFrame {
  const existing = frames.get(deploymentId);
  if (existing) {
    return existing;
  }

  const created: RuntimeRenderFrame = {
    deploymentId,
    statePulseUntil: 0,
    edgePulseUntil: 0,
    droppedEvents: 0,
  };
  frames.set(deploymentId, created);
  return created;
}

function cloneRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  try {
    if (typeof structuredClone === 'function') {
      return structuredClone(value as Record<string, unknown>);
    }
  } catch {
    // fall through
  }

  try {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

// Flatten VariableValue meta-objects ({ name, value, type, ... }) to plain {name: value}.
// Also handles already-flat records where values are plain primitives/objects.
function flattenVariables(vars: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!vars) return undefined;
  const flat: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(vars)) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v) && 'value' in (v as object)) {
      flat[k] = (v as Record<string, unknown>).value;
    } else {
      flat[k] = v;
    }
  }
  return Object.keys(flat).length > 0 ? flat : undefined;
}

function normalizeTransitionEvent(event: RuntimeTransitionEvent): RuntimeTransitionEvent {
  return {
    deploymentId: String(event.deploymentId),
    automataId: String(event.automataId) as RuntimeTransitionEvent['automataId'],
    deviceId: String(event.deviceId) as RuntimeTransitionEvent['deviceId'],
    fromState: String(event.fromState ?? ''),
    toState: String(event.toState ?? ''),
    transitionId: event.transitionId ? String(event.transitionId) : undefined,
    timestamp: Number.isFinite(Number(event.timestamp)) ? Number(event.timestamp) : Date.now(),
    variables: cloneRecord(event.variables),
  };
}

function mergeDeployment(
  current: RuntimeDeployment | undefined,
  next: RuntimeDeployment,
): RuntimeDeployment {
  return {
    deploymentId: next.deploymentId,
    automataId: next.automataId,
    deviceId: next.deviceId,
    status: next.status,
    currentState: next.currentState,
    variables: next.variables ?? current?.variables,
    updatedAt: next.updatedAt,
  };
}

function selectionEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, idx) => id === b[idx]);
}

function shallowDeploymentEqual(a: RuntimeDeployment | undefined, b: RuntimeDeployment): boolean {
  if (!a) return false;
  if (a.deploymentId !== b.deploymentId) return false;
  if (a.automataId !== b.automataId) return false;
  if (a.deviceId !== b.deviceId) return false;
  if (a.status !== b.status) return false;
  if ((a.currentState ?? '') !== (b.currentState ?? '')) return false;

  const aVars = a.variables ?? {};
  const bVars = b.variables ?? {};
  const aKeys = Object.keys(aVars);
  const bKeys = Object.keys(bVars);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => aVars[key] === bVars[key]);
}

function clampProgress(progress: number): number {
  return Math.max(0, Math.min(100, progress));
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }

  return undefined;
}

function normalizeTransferStatus(
  stage: string,
  success: boolean | undefined,
  error: string | undefined,
): RuntimeDeploymentTransfer['status'] {
  if (stage === 'failed' || success === false || Boolean(error)) return 'failed';
  if (stage === 'completed' || success === true) return 'completed';
  return 'active';
}

function inferTransferProgress(
  stage: string,
  chunkIndex: number | undefined,
  totalChunks: number | undefined,
  success: boolean | undefined,
): number {
  if (stage === 'completed' && success !== false) return 100;
  if (stage === 'failed') return clampProgress(((chunkIndex ?? 0) + 1) * 5);
  if (!totalChunks || totalChunks <= 0) return 0;
  if (stage === 'awaiting_load_ack') {
    return clampProgress(((chunkIndex ?? 0) + 1) / totalChunks * 100);
  }
  return clampProgress((((chunkIndex ?? 0) + 1) / totalChunks) * 100);
}

export const useRuntimeViewStore = create<RuntimeViewStore>((set, get) => ({
  ...initialState,

  upsertDeployment: (deployment) => {
    const safeDeployment: RuntimeDeployment = {
      ...deployment,
      variables: cloneRecord(deployment.variables),
      updatedAt: deployment.updatedAt || Date.now(),
    };

    set((state) => {
      const deployments = new Map(state.deployments);
      const previous = deployments.get(safeDeployment.deploymentId);
      const merged = mergeDeployment(previous, safeDeployment);
      if (previous && shallowDeploymentEqual(previous, merged)) {
        return state;
      }
      merged.updatedAt =
        previous && shallowDeploymentEqual(previous, merged)
          ? previous.updatedAt
          : safeDeployment.updatedAt || Date.now();

      deployments.set(safeDeployment.deploymentId, merged);
      return { ...state, deployments };
    });
  },

  replaceDeploymentInventory: (inventory) => {
    set((state) => {
      const nextDeployments = new Map<string, RuntimeDeployment>();
      const now = Date.now();

      inventory.forEach((payload) => {
        const deviceId = String(payload.device_id ?? payload.deviceId ?? '');
        const automataId = String(payload.automata_id ?? payload.automataId ?? '');
        const deploymentId =
          String(payload.deployment_id ?? payload.deploymentId ?? '') ||
          (automataId && deviceId ? `${automataId}:${deviceId}` : '');

        if (!deploymentId || !deviceId) {
          return;
        }

        const existing = state.deployments.get(deploymentId);
        const incomingUpdatedAt =
          toFiniteNumber(payload.updated_at ?? payload.updatedAt ?? payload.timestamp) ?? now;
        // Preserve the most recent currentState. Heartbeat inventories carry the
        // server's view of the state which may lag behind live state_changed events
        // already processed by ingestTransition. Only overwrite if the incoming
        // data is strictly newer than what the frontend already knows.
        const useIncomingState =
          !existing || incomingUpdatedAt >= existing.updatedAt;
        const incomingState = String(payload.current_state ?? payload.currentState ?? '');
        nextDeployments.set(deploymentId, {
          deploymentId,
          deviceId: deviceId as RuntimeDeployment['deviceId'],
          automataId: (automataId || existing?.automataId || 'unknown') as RuntimeDeployment['automataId'],
          status: mapStatus(payload.status),
          currentState: (useIncomingState && incomingState) ? incomingState : (existing?.currentState ?? incomingState),
          variables: cloneRecord(payload.variables) ?? existing?.variables,
          updatedAt: Math.max(incomingUpdatedAt, existing?.updatedAt ?? 0),
        });
      });

      // Preserve recently stopped/error deployments not in the new inventory so the
      // UI can show the final state instead of blanking out.
      const LINGER_MS = 5 * 60_000;
      state.deployments.forEach((existing, deploymentId) => {
        if (
          !nextDeployments.has(deploymentId) &&
          (existing.status === 'stopped' || existing.status === 'error') &&
          now - existing.updatedAt < LINGER_MS
        ) {
          nextDeployments.set(deploymentId, existing);
        }
      });

      const previousEntries = Array.from(state.deployments.entries());
      const nextEntries = Array.from(nextDeployments.entries());

      const sameEntries =
        previousEntries.length === nextEntries.length &&
        previousEntries.every(([deploymentId, deployment], index) => {
          const [nextDeploymentId, nextDeployment] = nextEntries[index] ?? [];
          return (
            deploymentId === nextDeploymentId &&
            shallowDeploymentEqual(deployment, nextDeployment as RuntimeDeployment)
          );
        });

      if (sameEntries) {
        return state;
      }

      const selectedDeploymentIds = state.selectedDeploymentIds.filter((deploymentId) =>
        nextDeployments.has(deploymentId),
      );

      return {
        ...state,
        deployments: nextDeployments,
        selectedDeploymentIds,
      };
    });
  },

  ingestTransition: (event) => {
    const plainEvent = normalizeTransitionEvent(event);

    set((state) => {
      const existingQueue = state.transitionQueues.get(plainEvent.deploymentId) ?? [];
      const queue = [...existingQueue, plainEvent];

      let compacted: typeof queue;
      if (queue.length > state.maxQueueBurst) {
        compacted = [queue[0]!, queue[Math.floor(queue.length / 2)]!, queue[queue.length - 1]!];
      } else {
        compacted = queue;
      }

      const transitionQueues = new Map(state.transitionQueues);
      transitionQueues.set(plainEvent.deploymentId, compacted);

      // Only transitionQueues is updated here. deployments, renderFrames, and
      // snapshots are all updated in tickAnimator at the configured Hz rate.
      // This keeps ingestTransition cheap and prevents UI subscribers from
      // re-rendering at raw event rate.
      return { ...state, transitionQueues };
    });
  },

  ingestDeploymentStatus: (payload) => {
    set((state) => {
      const deviceId = String(payload.device_id ?? payload.deviceId ?? '');
      const automataId = String(payload.automata_id ?? payload.automataId ?? '');
      const deploymentId =
        String(payload.deployment_id ?? payload.deploymentId ?? '') ||
        (automataId && deviceId ? `${automataId}:${deviceId}` : '');

      if (!deploymentId || !deviceId) {
        return state;
      }

      const deployments = new Map(state.deployments);
      const existing = deployments.get(deploymentId);
      const proposedUpdatedAt =
        toFiniteNumber(payload.updated_at ?? payload.updatedAt ?? payload.timestamp) ?? Date.now();
      // Preserve the most recent currentState. deployment_status events may carry
      // a stale server state that lags behind live state_changed events already
      // processed by ingestTransition. Only overwrite if the incoming data is newer.
      const incomingState = String(payload.current_state ?? payload.currentState ?? '');
      const useIncomingState = !existing || proposedUpdatedAt >= existing.updatedAt;
      const incomingVars = flattenVariables(cloneRecord(payload.variables));
      const next: RuntimeDeployment = {
        deploymentId,
        deviceId: deviceId as RuntimeDeployment['deviceId'],
        automataId: (automataId || existing?.automataId || 'unknown') as RuntimeDeployment['automataId'],
        // Preserve existing status when payload doesn't include one (e.g. variable-only patches)
        status: payload.status !== undefined && payload.status !== null
          ? mapStatus(payload.status)
          : (existing?.status ?? 'unknown'),
        currentState: (useIncomingState && incomingState) ? incomingState : (existing?.currentState ?? incomingState),
        variables: incomingVars ?? existing?.variables,
        updatedAt: Math.max(proposedUpdatedAt, existing?.updatedAt ?? 0),
      };

      if (shallowDeploymentEqual(existing, next)) {
        return state;
      }

      deployments.set(deploymentId, next);

      // When a deployment stops/errors, drain its pending transition queue so stale
      // highlights don't keep playing out on a dead deployment.
      const isTerminal = next.status === 'stopped' || next.status === 'error' || next.status === 'offline';
      if (isTerminal) {
        const transitionQueues = new Map(state.transitionQueues);
        transitionQueues.delete(deploymentId);
        return { ...state, deployments, transitionQueues };
      }

      return { ...state, deployments };
    });
  },

  ingestDeploymentTransfer: (payload) => {
    set((state) => {
      const deviceId = String(payload.device_id ?? payload.deviceId ?? '');
      if (!deviceId) return state;

      const automataIdRaw = payload.automata_id ?? payload.automataId;
      const automataId =
        automataIdRaw === undefined || automataIdRaw === null || automataIdRaw === ''
          ? undefined
          : String(automataIdRaw);

      const deploymentIdRaw = payload.deployment_id ?? payload.deploymentId;
      const deploymentId =
        (deploymentIdRaw ? String(deploymentIdRaw) : '') ||
        (automataId ? `${automataId}:${deviceId}` : '');

      if (!deploymentId) return state;

      const stage = String(payload.stage ?? 'unknown');
      const phaseRaw = payload.phase;
      const formatRaw = payload.format;
      const phase =
        phaseRaw === undefined || phaseRaw === null || phaseRaw === '' ? undefined : String(phaseRaw);
      const format =
        formatRaw === undefined || formatRaw === null || formatRaw === ''
          ? undefined
          : String(formatRaw);

      const chunkIndex = toFiniteNumber(payload.chunk_index ?? payload.chunkIndex);
      const totalChunks = toFiniteNumber(payload.total_chunks ?? payload.totalChunks);
      const retryCount = toFiniteNumber(payload.retry_count ?? payload.retryCount);
      const maxRetries = toFiniteNumber(payload.max_retries ?? payload.maxRetries);
      const success = typeof payload.success === 'boolean' ? payload.success : undefined;
      const errorRaw = payload.error;
      const error =
        errorRaw === undefined || errorRaw === null || errorRaw === '' ? undefined : String(errorRaw);
      const status = normalizeTransferStatus(stage, success, error);
      const progressPercent = inferTransferProgress(stage, chunkIndex, totalChunks, success);

      const next: RuntimeDeploymentTransfer = {
        deploymentId,
        deviceId: deviceId as RuntimeDeploymentTransfer['deviceId'],
        automataId: automataId as RuntimeDeploymentTransfer['automataId'],
        stage,
        phase,
        format,
        progressPercent,
        chunkIndex,
        totalChunks,
        retryCount,
        maxRetries,
        error,
        success,
        status,
        updatedAt: Date.now(),
      };

      const previous = state.transfers.get(deploymentId);
      if (
        previous &&
        previous.stage === next.stage &&
        previous.progressPercent === next.progressPercent &&
        previous.status === next.status &&
        previous.chunkIndex === next.chunkIndex &&
        previous.totalChunks === next.totalChunks &&
        previous.retryCount === next.retryCount &&
        previous.maxRetries === next.maxRetries &&
        previous.error === next.error &&
        previous.success === next.success
      ) {
        return state;
      }

      const transfers = new Map(state.transfers);
      transfers.set(deploymentId, next);
      return { ...state, transfers };
    });
  },

  setScope: (scope) => {
    set((state) => (state.scope === scope ? state : { ...state, scope }));
  },

  toggleSelection: (deploymentId, selected) => {
    set((state) => {
      const current = state.selectedDeploymentIds.includes(deploymentId);
      const shouldSelect = selected === undefined ? !current : selected;
      if (shouldSelect && !current) {
        return { ...state, selectedDeploymentIds: [...state.selectedDeploymentIds, deploymentId] };
      }
      if (!shouldSelect && current) {
        return {
          ...state,
          selectedDeploymentIds: state.selectedDeploymentIds.filter((id) => id !== deploymentId),
        };
      }
      return state;
    });
  },

  setSelected: (deploymentIds) => {
    set((state) => {
      const next = Array.from(new Set(deploymentIds));
      if (selectionEqual(next, state.selectedDeploymentIds)) {
        return state;
      }
      return { ...state, selectedDeploymentIds: next };
    });
  },

  selectRunning: () => {
    const running = Array.from(get().deployments.values())
      .filter((deployment) => isRunningLike(deployment.status))
      .map((deployment) => deployment.deploymentId);
    get().setSelected(running);
  },

  seedFromDevices: (devices) => {
    set((state) => {
      const deployments = new Map(state.deployments);
      let changed = false;

      devices.forEach((device) => {
        if (!device.assignedAutomataId) {
          return;
        }

        const deploymentId = `${device.assignedAutomataId}:${device.id}`;
        const existing = deployments.get(deploymentId);
        const mapped = mapStatus(device.status);
        const status = mapped === 'unknown' && existing ? existing.status : mapped;
        const next: RuntimeDeployment = {
          deploymentId,
          automataId: String(device.assignedAutomataId) as RuntimeDeployment['automataId'],
          deviceId: String(device.id) as RuntimeDeployment['deviceId'],
          status,
          currentState: device.currentState ?? existing?.currentState,
          variables: cloneRecord(existing?.variables) ?? existing?.variables,
          updatedAt:
            existing &&
            existing.status === status &&
            (existing.currentState ?? '') === String(device.currentState ?? existing.currentState ?? '')
              ? existing.updatedAt
              : Date.now(),
        };

        if (!shallowDeploymentEqual(existing, next)) {
          deployments.set(deploymentId, next);
          changed = true;
        }
      });

      if (!changed) {
        return state;
      }
      return { ...state, deployments };
    });
  },

  clearStale: (now = Date.now(), staleMs = 30_000) => {
    set((state) => {
      // Fast-path: skip Map allocations when nothing is likely stale.
      let needsScan = false;
      for (const d of state.deployments.values()) {
        if (d.status === 'offline') continue;
        const threshold = d.status === 'stopped' || d.status === 'error' ? 5 * 60_000 : staleMs;
        if (now - d.updatedAt > threshold) { needsScan = true; break; }
      }
      if (!needsScan) {
        for (const t of state.transfers.values()) {
          const ttl = t.status === 'active' ? 120_000 : 30_000;
          if (now - t.updatedAt > ttl) { needsScan = true; break; }
        }
      }
      if (!needsScan) return state;

      const deployments = new Map(state.deployments);
      const transfers = new Map(state.transfers);
      deployments.forEach((deployment, deploymentId) => {
        if (deployment.status === 'offline') return;
        // Stopped/error deployments linger for 5 minutes so the UI can show the final state.
        const threshold = deployment.status === 'stopped' || deployment.status === 'error'
          ? 5 * 60_000
          : staleMs;
        if (now - deployment.updatedAt > threshold) {
          deployments.set(deploymentId, { ...deployment, status: 'offline' });
        }
      });

      transfers.forEach((transfer, deploymentId) => {
        const age = now - transfer.updatedAt;
        const ttl = transfer.status === 'active' ? 120_000 : 30_000;
        if (age > ttl) transfers.delete(deploymentId);
      });

      return { ...state, deployments, transfers };
    });
  },

  tickAnimator: (now = Date.now()) => {
    set((state) => {
      // Fast-path: skip all allocations when there is nothing queued.
      // tickAnimator fires at visualHz from two independent intervals (GatewayEventBridge
      // + RuntimeMonitorPanel), so idle ticks are extremely common — avoid the 5 Map
      // copies that used to happen on every call regardless of work.
      let hasWork = false;
      for (const q of state.transitionQueues.values()) {
        if (q && q.length > 0) { hasWork = true; break; }
      }
      if (!hasWork) return state;

      const transitionQueues = new Map(state.transitionQueues);
      const transitionHistory = new Map(state.transitionHistory);
      const snapshots = new Map(state.snapshots);
      const renderFrames = new Map(state.renderFrames);
      const deployments = new Map(state.deployments);

      transitionQueues.forEach((queue, deploymentId) => {
        if (!queue || queue.length === 0) return;

        // Drain the whole queue in one tick — intermediate frames are skipped visually
        // so the graph always shows the actual current state, not a lagging one.
        const lastEvent = queue[queue.length - 1]!;
        const skipped = queue.length - 1;
        transitionQueues.set(deploymentId, []);

        const frame = { ...ensureFrame(renderFrames, deploymentId) };
        frame.previousStateId = skipped > 0 ? queue[queue.length - 2]!.toState : lastEvent.fromState;
        frame.activeStateId = lastEvent.toState;
        frame.activeTransitionId = lastEvent.transitionId;
        frame.lastTransitionAt = lastEvent.timestamp;
        frame.edgePulseUntil = now + state.transitionHighlightMs;
        frame.statePulseUntil = now + state.statePulseMs;
        frame.droppedEvents += skipped;
        renderFrames.set(deploymentId, frame);

        const previousHistory = transitionHistory.get(deploymentId) ?? [];
        const combinedHistLen = previousHistory.length + queue.length;
        const history: RuntimeTransitionEvent[] = combinedHistLen <= state.maxEvents
          ? [...previousHistory, ...queue]
          : [
              ...previousHistory.slice(combinedHistLen - state.maxEvents < previousHistory.length
                ? combinedHistLen - state.maxEvents : previousHistory.length),
              ...queue.slice(Math.max(0, combinedHistLen - state.maxEvents - previousHistory.length)),
            ];
        transitionHistory.set(deploymentId, history);

        const deployment = deployments.get(deploymentId);
        // Use current deployment.variables as fallback so historical snapshot points
        // carry variable state even when state_changed events omit variables.
        const knownVars = deployment?.variables;

        const previousSnapshots = snapshots.get(deploymentId) ?? [];
        const newPoints: RuntimeSnapshotPoint[] = queue.map((event) => ({
          timestamp: event.timestamp,
          state: event.toState,
          transitionId: event.transitionId,
          variables: flattenVariables(event.variables) ?? knownVars,
        }));
        const combinedSnapLen = previousSnapshots.length + newPoints.length;
        const nextSnapshots: RuntimeSnapshotPoint[] = combinedSnapLen <= state.maxEvents
          ? [...previousSnapshots, ...newPoints]
          : [
              ...previousSnapshots.slice(combinedSnapLen - state.maxEvents < previousSnapshots.length
                ? combinedSnapLen - state.maxEvents : previousSnapshots.length),
              ...newPoints.slice(Math.max(0, combinedSnapLen - state.maxEvents - previousSnapshots.length)),
            ];
        snapshots.set(deploymentId, nextSnapshots);

        if (deployment) {
          const transitionVars = flattenVariables(lastEvent.variables);
          deployments.set(deploymentId, {
            ...deployment,
            currentState: lastEvent.toState,
            status: 'running',
            updatedAt: now,
            variables: transitionVars ?? deployment.variables,
          });
        }
      });

      return {
        ...state,
        transitionQueues,
        transitionHistory,
        snapshots,
        renderFrames,
        deployments,
      };
    });
  },

  setTimeTravelFrame: (deploymentId, activeStateId) => {
    set((state) => {
      const renderFrames = new Map(state.renderFrames);
      const existing = renderFrames.get(deploymentId);
      const frame: RuntimeRenderFrame = {
        deploymentId,
        droppedEvents: existing?.droppedEvents ?? 0,
        lastTransitionAt: existing?.lastTransitionAt,
        previousStateId: existing?.activeStateId,
        activeStateId,
        activeTransitionId: undefined,
        statePulseUntil: 0,
        edgePulseUntil: 0,
      };
      renderFrames.set(deploymentId, frame);
      return { ...state, renderFrames };
    });
  },

  setVisualHz: (hz) => {
    const next = Math.max(1, hz);
    set((state) => (state.visualHz === next ? state : { ...state, visualHz: next }));
  },

  reset: () => {
    set(() => createInitialState());
  },
}));

export const selectRuntimeDeployments = (state: RuntimeViewStore) =>
  Array.from(state.deployments.values());

export const selectRuntimeDeploymentById =
  (deploymentId: string) => (state: RuntimeViewStore) => state.deployments.get(deploymentId);
