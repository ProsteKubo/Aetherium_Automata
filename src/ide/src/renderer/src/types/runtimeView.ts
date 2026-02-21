import type { AutomataId, DeviceId } from './automata';

export type RuntimeViewScope = 'running' | 'project';

export type RuntimeDeploymentStatus =
  | 'loading'
  | 'running'
  | 'paused'
  | 'stopped'
  | 'error'
  | 'offline'
  | 'unknown';

export interface RuntimeDeployment {
  deploymentId: string;
  automataId: AutomataId;
  deviceId: DeviceId;
  status: RuntimeDeploymentStatus;
  currentState?: string;
  variables?: Record<string, unknown>;
  updatedAt: number;
}

export interface RuntimeTransitionEvent {
  deploymentId: string;
  deviceId: DeviceId;
  automataId: AutomataId;
  fromState: string;
  toState: string;
  transitionId?: string;
  timestamp: number;
  variables?: Record<string, unknown>;
}

export interface RuntimeSnapshotPoint {
  timestamp: number;
  state: string;
  transitionId?: string;
}

export interface RuntimeRenderFrame {
  deploymentId: string;
  activeStateId?: string;
  previousStateId?: string;
  activeTransitionId?: string;
  statePulseUntil: number;
  edgePulseUntil: number;
  lastTransitionAt?: number;
  droppedEvents: number;
}
