/**
 * Aetherium Automata - Execution Store
 * 
 * Manages execution state, time-travel debugging, and monitoring.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type {
  DeviceId,
  AutomataId,
  ExecutionSnapshot,
  TimeTravelSession,
} from '../types';
import { useGatewayStore } from './gatewayStore';

// ============================================================================
// State Types
// ============================================================================

interface ExecutionState {
  // Per-device execution state
  deviceExecutions: Map<DeviceId, {
    isRunning: boolean;
    isPaused: boolean;
    currentSnapshot: ExecutionSnapshot | null;
    automataId: AutomataId | null;
  }>;
  
  // Time travel sessions
  timeTravelSessions: Map<string, TimeTravelSession>;
  activeTimeTravelSessionId: string | null;
  
  // Monitoring subscriptions
  monitoringSubscriptions: Map<string, DeviceId[]>;
  
  // Selected device for detailed view
  selectedDeviceId: DeviceId | null;
  
  // Loading states
  isStarting: Map<DeviceId, boolean>;
  isStopping: Map<DeviceId, boolean>;
}

interface ExecutionActions {
  // Execution control
  startExecution: (deviceId: DeviceId) => Promise<void>;
  stopExecution: (deviceId: DeviceId) => Promise<void>;
  pauseExecution: (deviceId: DeviceId) => Promise<void>;
  resumeExecution: (deviceId: DeviceId) => Promise<void>;
  resetExecution: (deviceId: DeviceId) => Promise<void>;
  stepExecution: (deviceId: DeviceId, steps?: number) => Promise<void>;
  
  // Snapshot management
  updateSnapshot: (deviceId: DeviceId, snapshot: ExecutionSnapshot) => void;
  applyDeploymentStatus: (deviceId: DeviceId, status: string, automataId?: AutomataId | null) => void;
  fetchSnapshot: (deviceId: DeviceId) => Promise<ExecutionSnapshot>;
  
  // Time travel
  startTimeTravel: (deviceId: DeviceId) => Promise<string>;
  stopTimeTravel: (sessionId: string) => Promise<void>;
  navigateTimeTravel: (sessionId: string, options: {
    targetIndex?: number;
    direction?: 'forward' | 'backward';
    steps?: number;
  }) => Promise<void>;
  createBookmark: (sessionId: string, name: string) => Promise<void>;
  setActiveTimeTravelSession: (sessionId: string | null) => void;
  
  // Monitoring
  subscribeToDevice: (deviceId: DeviceId) => Promise<string>;
  unsubscribeFromDevice: (subscriptionId: string) => Promise<void>;
  
  // Selection
  selectDevice: (deviceId: DeviceId | null) => void;
  
  // Utility
  reset: () => void;
}

type ExecutionStore = ExecutionState & ExecutionActions;

// ============================================================================
// Initial State
// ============================================================================

const initialState: ExecutionState = {
  deviceExecutions: new Map(),
  timeTravelSessions: new Map(),
  activeTimeTravelSessionId: null,
  monitoringSubscriptions: new Map(),
  selectedDeviceId: null,
  isStarting: new Map(),
  isStopping: new Map(),
};

function signalMapsEqual(
  left: ExecutionSnapshot['inputs'] | ExecutionSnapshot['outputs'],
  right: ExecutionSnapshot['inputs'] | ExecutionSnapshot['outputs'],
): boolean {
  const leftKeys = Object.keys(left ?? {});
  const rightKeys = Object.keys(right ?? {});
  if (leftKeys.length !== rightKeys.length) return false;

  return leftKeys.every((key) => {
    const leftEntry = left[key];
    const rightEntry = right[key];
    return rightEntry && leftEntry?.value === rightEntry.value;
  });
}

function variablesEqual(
  left: ExecutionSnapshot['variables'],
  right: ExecutionSnapshot['variables'],
): boolean {
  const leftKeys = Object.keys(left ?? {});
  const rightKeys = Object.keys(right ?? {});
  if (leftKeys.length !== rightKeys.length) return false;

  return leftKeys.every((key) => {
    const leftEntry = left[key];
    const rightEntry = right[key];
    return rightEntry && leftEntry?.value === rightEntry.value && leftEntry?.type === rightEntry.type;
  });
}

function snapshotsSemanticallyEqual(left: ExecutionSnapshot | null, right: ExecutionSnapshot): boolean {
  if (!left) return false;
  if (left.automataId !== right.automataId) return false;
  if (left.deviceId !== right.deviceId) return false;
  if (left.currentState !== right.currentState) return false;
  if (left.previousState !== right.previousState) return false;
  if (left.lastTransition !== right.lastTransition) return false;
  if (left.executionCycle !== right.executionCycle) return false;
  if (left.errorState !== right.errorState) return false;
  if (!variablesEqual(left.variables, right.variables)) return false;
  if (!signalMapsEqual(left.inputs, right.inputs)) return false;
  if (!signalMapsEqual(left.outputs, right.outputs)) return false;
  return true;
}

// ============================================================================
// Store
// ============================================================================

export const useExecutionStore = create<ExecutionStore>()(
  immer((set, get) => ({
    ...initialState,
    
    // ========================================================================
    // Execution Control
    // ========================================================================
    
    startExecution: async (deviceId: DeviceId) => {
      const gatewayStore = useGatewayStore.getState();
      
      set((state) => {
        state.isStarting.set(deviceId, true);
      });
      
      try {
        const response = await gatewayStore.service.startExecution(deviceId);
        
        set((state) => {
          state.deviceExecutions.set(deviceId, {
            isRunning: true,
            isPaused: false,
            currentSnapshot: response.snapshot,
            automataId: response.snapshot.automataId,
          });
          state.isStarting.set(deviceId, false);
        });
      } catch (error) {
        set((state) => {
          state.isStarting.set(deviceId, false);
        });
        throw error;
      }
    },
    
    stopExecution: async (deviceId: DeviceId) => {
      const gatewayStore = useGatewayStore.getState();
      
      set((state) => {
        state.isStopping.set(deviceId, true);
      });
      
      try {
        const response = await gatewayStore.service.stopExecution(deviceId);
        
        set((state) => {
          const execution = state.deviceExecutions.get(deviceId);
          if (execution) {
            execution.isRunning = false;
            execution.isPaused = false;
            execution.currentSnapshot = response.finalSnapshot;
          }
          state.isStopping.set(deviceId, false);
        });
      } catch (error) {
        set((state) => {
          state.isStopping.set(deviceId, false);
        });
        throw error;
      }
    },
    
    pauseExecution: async (deviceId: DeviceId) => {
      const gatewayStore = useGatewayStore.getState();
      
      await gatewayStore.service.pauseExecution(deviceId);
      
      set((state) => {
        const execution = state.deviceExecutions.get(deviceId);
        if (execution) {
          execution.isPaused = true;
        }
      });
    },
    
    resumeExecution: async (deviceId: DeviceId) => {
      const gatewayStore = useGatewayStore.getState();
      
      await gatewayStore.service.resumeExecution(deviceId);
      
      set((state) => {
        const execution = state.deviceExecutions.get(deviceId);
        if (execution) {
          execution.isPaused = false;
        }
      });
    },

    resetExecution: async (deviceId: DeviceId) => {
      const gatewayStore = useGatewayStore.getState();

      const response = await gatewayStore.service.resetExecution(deviceId);

      set((state) => {
        const existing = state.deviceExecutions.get(deviceId);
        state.deviceExecutions.set(deviceId, {
          isRunning: existing?.isRunning ?? false,
          isPaused: false,
          currentSnapshot: response.snapshot,
          automataId: response.snapshot.automataId,
        });
      });
    },
    
    stepExecution: async (deviceId: DeviceId, steps = 1) => {
      const gatewayStore = useGatewayStore.getState();
      
      const snapshots = await gatewayStore.service.stepExecution(deviceId, steps);
      
      if (snapshots.length > 0) {
        set((state) => {
          const execution = state.deviceExecutions.get(deviceId);
          if (execution) {
            execution.currentSnapshot = snapshots[snapshots.length - 1];
          }
        });
      }
    },
    
    // ========================================================================
    // Snapshot Management
    // ========================================================================
    
    updateSnapshot: (deviceId: DeviceId, snapshot: ExecutionSnapshot) => {
      set((state) => {
        let execution = state.deviceExecutions.get(deviceId);
        if (!execution) {
          execution = {
            isRunning: false,
            isPaused: false,
            currentSnapshot: null,
            automataId: snapshot.automataId,
          };
          state.deviceExecutions.set(deviceId, execution);
        }

        if (snapshotsSemanticallyEqual(execution.currentSnapshot, snapshot)) {
          return;
        }

        execution.currentSnapshot = snapshot;
      });
    },

    applyDeploymentStatus: (deviceId: DeviceId, status: string, automataId?: AutomataId | null) => {
      const normalized = String(status || '').toLowerCase();
      const isPaused = normalized === 'paused';
      const isRunning = normalized === 'running' || normalized === 'loading' || isPaused;

      set((state) => {
        let execution = state.deviceExecutions.get(deviceId);
        if (!execution) {
          execution = {
            isRunning,
            isPaused,
            currentSnapshot: null,
            automataId: automataId ?? null,
          };
          state.deviceExecutions.set(deviceId, execution);
          return;
        }

        execution.isRunning = isRunning;
        execution.isPaused = isPaused;
        if (automataId) {
          execution.automataId = automataId;
        }
      });
    },
    
    fetchSnapshot: async (deviceId: DeviceId) => {
      const gatewayStore = useGatewayStore.getState();
      
      const response = await gatewayStore.service.getSnapshot(deviceId);
      
      get().updateSnapshot(deviceId, response.snapshot);
      
      return response.snapshot;
    },
    
    // ========================================================================
    // Time Travel
    // ========================================================================
    
    startTimeTravel: async (deviceId: DeviceId) => {
      const gatewayStore = useGatewayStore.getState();
      
      const response = await gatewayStore.service.startTimeTravel(deviceId);
      
      set((state) => {
        state.timeTravelSessions.set(response.session.id, response.session);
        state.activeTimeTravelSessionId = response.session.id;
      });
      
      return response.session.id;
    },
    
    stopTimeTravel: async (sessionId: string) => {
      const gatewayStore = useGatewayStore.getState();
      
      const session = await gatewayStore.service.stopTimeTravel(sessionId);
      
      set((state) => {
        state.timeTravelSessions.set(sessionId, session);
        if (state.activeTimeTravelSessionId === sessionId) {
          state.activeTimeTravelSessionId = null;
        }
      });
    },
    
    navigateTimeTravel: async (sessionId: string, options) => {
      const gatewayStore = useGatewayStore.getState();
      
      const response = await gatewayStore.service.navigateTimeTravel(sessionId, options);
      
      set((state) => {
        const session = state.timeTravelSessions.get(sessionId);
        if (session) {
          session.history.currentIndex = response.currentIndex;
          session.currentReplayIndex = response.currentIndex;
        }
      });
    },
    
    createBookmark: async (sessionId: string, name: string) => {
      const gatewayStore = useGatewayStore.getState();
      
      await gatewayStore.service.createBookmark(sessionId, name);
    },
    
    setActiveTimeTravelSession: (sessionId: string | null) => {
      set((state) => {
        state.activeTimeTravelSessionId = sessionId;
      });
    },
    
    // ========================================================================
    // Monitoring
    // ========================================================================
    
    subscribeToDevice: async (deviceId: DeviceId) => {
      const gatewayStore = useGatewayStore.getState();
      
      const response = await gatewayStore.service.subscribeToDevice(deviceId, [
        'metrics',
        'snapshots',
        'transitions',
        'errors',
      ]);
      
      set((state) => {
        const existing = state.monitoringSubscriptions.get(response.subscriptionId) || [];
        existing.push(deviceId);
        state.monitoringSubscriptions.set(response.subscriptionId, existing);
      });
      
      return response.subscriptionId;
    },
    
    unsubscribeFromDevice: async (subscriptionId: string) => {
      const gatewayStore = useGatewayStore.getState();
      
      await gatewayStore.service.unsubscribeFromDevice(subscriptionId);
      
      set((state) => {
        state.monitoringSubscriptions.delete(subscriptionId);
      });
    },
    
    // ========================================================================
    // Selection
    // ========================================================================
    
    selectDevice: (deviceId: DeviceId | null) => {
      set((state) => {
        state.selectedDeviceId = deviceId;
      });
    },
    
    // ========================================================================
    // Utility
    // ========================================================================
    
    reset: () => {
      set((state) => {
        Object.assign(state, initialState);
      });
    },
  }))
);

// ============================================================================
// Selectors
// ============================================================================

export const selectDeviceExecution = (deviceId: DeviceId) => (state: ExecutionStore) =>
  state.deviceExecutions.get(deviceId);

export const selectActiveTimeTravelSession = (state: ExecutionStore) =>
  state.activeTimeTravelSessionId
    ? state.timeTravelSessions.get(state.activeTimeTravelSessionId)
    : null;

export const selectSelectedDeviceExecution = (state: ExecutionStore) =>
  state.selectedDeviceId
    ? state.deviceExecutions.get(state.selectedDeviceId)
    : null;
