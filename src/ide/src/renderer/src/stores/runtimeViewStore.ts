import { create } from 'zustand';
import type {
  RuntimeDeployment,
  RuntimeDeploymentStatus,
  RuntimeRenderFrame,
  RuntimeSnapshotPoint,
  RuntimeTransitionEvent,
  RuntimeViewScope,
} from '../types/runtimeView';

interface RuntimeViewState {
  scope: RuntimeViewScope;
  deployments: Map<string, RuntimeDeployment>;
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
  ingestTransition: (event: RuntimeTransitionEvent) => void;
  ingestDeploymentStatus: (payload: Record<string, unknown>) => void;
  setScope: (scope: RuntimeViewScope) => void;
  toggleSelection: (deploymentId: string, selected?: boolean) => void;
  setSelected: (deploymentIds: string[]) => void;
  selectRunning: () => void;
  seedFromDevices: (devices: RuntimeSeedDevice[]) => void;
  clearStale: (now?: number, staleMs?: number) => void;
  tickAnimator: (now?: number) => void;
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
    scope: 'running',
    deployments: new Map(),
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
  if (a.updatedAt !== b.updatedAt) return false;

  const aVars = a.variables ?? {};
  const bVars = b.variables ?? {};
  const aKeys = Object.keys(aVars);
  const bKeys = Object.keys(bVars);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => aVars[key] === bVars[key]);
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
      const merged = mergeDeployment(deployments.get(safeDeployment.deploymentId), safeDeployment);
      const previous = deployments.get(safeDeployment.deploymentId);
      if (shallowDeploymentEqual(previous, merged)) {
        return state;
      }

      deployments.set(safeDeployment.deploymentId, merged);
      return { ...state, deployments };
    });
  },

  ingestTransition: (event) => {
    const plainEvent = normalizeTransitionEvent(event);

    set((state) => {
      const transitionQueues = new Map(state.transitionQueues);
      const existingQueue = transitionQueues.get(plainEvent.deploymentId) ?? [];
      const queue = [...existingQueue, plainEvent];
      let dropped = 0;

      if (queue.length > state.maxQueueBurst) {
        const first = queue[0];
        const middle = queue[Math.floor(queue.length / 2)];
        const last = queue[queue.length - 1];
        const compacted = [first, middle, last];
        dropped = queue.length - compacted.length;
        transitionQueues.set(plainEvent.deploymentId, compacted);
      } else {
        transitionQueues.set(plainEvent.deploymentId, queue);
      }

      const renderFrames = new Map(state.renderFrames);
      if (dropped > 0) {
        const frame = { ...ensureFrame(renderFrames, plainEvent.deploymentId) };
        frame.droppedEvents += dropped;
        renderFrames.set(plainEvent.deploymentId, frame);
      }

      const deployments = new Map(state.deployments);
      const existing = deployments.get(plainEvent.deploymentId);
      deployments.set(plainEvent.deploymentId, {
        deploymentId: plainEvent.deploymentId,
        deviceId: plainEvent.deviceId,
        automataId: plainEvent.automataId,
        status: 'running',
        currentState: plainEvent.toState,
        variables: cloneRecord(plainEvent.variables) ?? existing?.variables,
        updatedAt: plainEvent.timestamp || Date.now(),
      });

      return {
        ...state,
        transitionQueues,
        renderFrames,
        deployments,
      };
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
      const next: RuntimeDeployment = {
        deploymentId,
        deviceId: deviceId as RuntimeDeployment['deviceId'],
        automataId: (automataId || existing?.automataId || 'unknown') as RuntimeDeployment['automataId'],
        status: mapStatus(payload.status),
        currentState: String(payload.current_state ?? payload.currentState ?? existing?.currentState ?? ''),
        variables: cloneRecord(payload.variables) ?? existing?.variables,
        updatedAt: Date.now(),
      };

      if (shallowDeploymentEqual(existing, next)) {
        return state;
      }

      deployments.set(deploymentId, next);
      return { ...state, deployments };
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
      const deployments = new Map(state.deployments);
      let changed = false;
      deployments.forEach((deployment, deploymentId) => {
        if (now - deployment.updatedAt > staleMs && deployment.status !== 'error' && deployment.status !== 'offline') {
          deployments.set(deploymentId, { ...deployment, status: 'offline' });
          changed = true;
        }
      });
      return changed ? { ...state, deployments } : state;
    });
  },

  tickAnimator: (now = Date.now()) => {
    set((state) => {
      const transitionQueues = new Map(state.transitionQueues);
      const transitionHistory = new Map(state.transitionHistory);
      const snapshots = new Map(state.snapshots);
      const renderFrames = new Map(state.renderFrames);
      const deployments = new Map(state.deployments);
      let changed = false;

      transitionQueues.forEach((queue, deploymentId) => {
        if (!queue || queue.length === 0) {
          return;
        }

        const [event, ...rest] = queue;
        transitionQueues.set(deploymentId, rest);

        const frame = { ...ensureFrame(renderFrames, deploymentId) };
        frame.previousStateId = event.fromState;
        frame.activeStateId = event.toState;
        frame.activeTransitionId = event.transitionId;
        frame.lastTransitionAt = event.timestamp;
        frame.edgePulseUntil = now + state.transitionHighlightMs;
        frame.statePulseUntil = now + state.statePulseMs;
        renderFrames.set(deploymentId, frame);

        const previousHistory = transitionHistory.get(deploymentId) ?? [];
        const history = [...previousHistory, event];
        if (history.length > state.maxEvents) {
          history.splice(0, history.length - state.maxEvents);
        }
        transitionHistory.set(deploymentId, history);

        const previousSnapshots = snapshots.get(deploymentId) ?? [];
        const nextSnapshots = [
          ...previousSnapshots,
          {
            timestamp: event.timestamp,
            state: event.toState,
            transitionId: event.transitionId,
          } as RuntimeSnapshotPoint,
        ];
        if (nextSnapshots.length > state.maxEvents) {
          nextSnapshots.splice(0, nextSnapshots.length - state.maxEvents);
        }
        snapshots.set(deploymentId, nextSnapshots);

        const deployment = deployments.get(deploymentId);
        if (deployment) {
          deployments.set(deploymentId, {
            ...deployment,
            currentState: event.toState,
            status: 'running',
            updatedAt: now,
          });
        }

        changed = true;
      });

      if (!changed) {
        return state;
      }

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
