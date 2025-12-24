/**
 * Aetherium Automata - Gateway Communication Protocol Types
 * 
 * Defines all message types for communication between IDE and Gateway.
 * The gateway acts as the central hub for all device management and routing.
 */

import type {
  AutomataId,
  DeviceId,
  ServerId,
  Automata,
  Device,
  Server,
  ExecutionSnapshot,
  TimeTravelSession,
} from './automata';

// ============================================================================
// Message Base Types
// ============================================================================

export type MessageType = 
  // Connection
  | 'connect'
  | 'disconnect'
  | 'heartbeat'
  | 'authenticate'
  
  // Discovery
  | 'server.list'
  | 'server.info'
  | 'device.list'
  | 'device.info'
  | 'device.discover'
  
  // Automata Management
  | 'automata.list'
  | 'automata.get'
  | 'automata.create'
  | 'automata.update'
  | 'automata.delete'
  | 'automata.deploy'
  | 'automata.undeploy'
  
  // Execution Control
  | 'execution.start'
  | 'execution.stop'
  | 'execution.pause'
  | 'execution.resume'
  | 'execution.step'
  | 'execution.snapshot'
  
  // Time Travel
  | 'timetravel.start'
  | 'timetravel.stop'
  | 'timetravel.rewind'
  | 'timetravel.forward'
  | 'timetravel.goto'
  | 'timetravel.bookmark'
  | 'timetravel.history'
  
  // Monitoring
  | 'monitor.subscribe'
  | 'monitor.unsubscribe'
  | 'monitor.metrics'
  | 'monitor.logs'
  
  // OTA Updates
  | 'ota.prepare'
  | 'ota.upload'
  | 'ota.apply'
  | 'ota.rollback'
  | 'ota.status'
  
  // Events (server -> client)
  | 'event.device.status'
  | 'event.device.metrics'
  | 'event.execution.snapshot'
  | 'event.execution.transition'
  | 'event.execution.error'
  | 'event.server.status';

export interface MessageBase {
  id: string;
  type: MessageType;
  timestamp: number;
  correlationId?: string;  // For request-response matching
}

export interface RequestMessage<T = unknown> extends MessageBase {
  payload: T;
}

export interface ResponseMessage<T = unknown> extends MessageBase {
  success: boolean;
  payload?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface EventMessage<T = unknown> extends MessageBase {
  source: string;
  payload: T;
}

// ============================================================================
// Connection Messages
// ============================================================================

export interface ConnectRequest {
  clientId: string;
  clientVersion: string;
  capabilities: string[];
}

export interface ConnectResponse {
  sessionId: string;
  gatewayVersion: string;
  serverCount: number;
  deviceCount: number;
}

export interface AuthenticateRequest {
  token: string;
  method: 'token' | 'certificate' | 'password';
}

export interface AuthenticateResponse {
  authenticated: boolean;
  permissions: string[];
  expiresAt: number;
}

export interface HeartbeatMessage {
  timestamp: number;
  sessionId: string;
}

// ============================================================================
// Server Discovery Messages
// ============================================================================

export interface ServerListRequest {
  filter?: {
    status?: Server['status'];
    region?: string;
    tags?: string[];
  };
}

export interface ServerListResponse {
  servers: Server[];
  totalCount: number;
}

export interface ServerInfoRequest {
  serverId: ServerId;
}

export interface ServerInfoResponse {
  server: Server;
  devices: Device[];
}

// ============================================================================
// Device Discovery Messages
// ============================================================================

export interface DeviceListRequest {
  serverId?: ServerId;
  filter?: {
    status?: Device['status'];
    capability?: string;
    group?: string;
    tags?: string[];
  };
  pagination?: {
    offset: number;
    limit: number;
  };
}

export interface DeviceListResponse {
  devices: Device[];
  totalCount: number;
}

export interface DeviceInfoRequest {
  deviceId: DeviceId;
}

export interface DeviceInfoResponse {
  device: Device;
  currentSnapshot?: ExecutionSnapshot;
}

export interface DeviceDiscoverRequest {
  serverId: ServerId;
  timeout?: number;
}

export interface DeviceDiscoverResponse {
  discoveredDevices: Device[];
  duration: number;
}

// ============================================================================
// Automata Management Messages
// ============================================================================

export interface AutomataListRequest {
  filter?: {
    tags?: string[];
    isTemplate?: boolean;
  };
}

export interface AutomataListResponse {
  automata: Array<{
    id: AutomataId;
    name: string;
    version: string;
    tags: string[];
    deployedTo: DeviceId[];
  }>;
  totalCount: number;
}

export interface AutomataGetRequest {
  automataId: AutomataId;
  includeNested?: boolean;
}

export interface AutomataGetResponse {
  automata: Automata;
  nestedAutomata?: Automata[];
}

export interface AutomataCreateRequest {
  automata: Omit<Automata, 'id'>;
}

export interface AutomataCreateResponse {
  automata: Automata;
}

export interface AutomataUpdateRequest {
  automataId: AutomataId;
  automata: Partial<Automata>;
  createVersion?: boolean;
}

export interface AutomataUpdateResponse {
  automata: Automata;
  previousVersion?: string;
}

export interface AutomataDeleteRequest {
  automataId: AutomataId;
  force?: boolean;  // Delete even if deployed
}

export interface AutomataDeleteResponse {
  deleted: boolean;
  undeployedFrom?: DeviceId[];
}

// ============================================================================
// Deployment Messages
// ============================================================================

export interface DeployRequest {
  automataId: AutomataId;
  deviceId: DeviceId;
  options?: {
    persistState?: boolean;      // Keep current state values
    resetExecution?: boolean;    // Reset to initial state
    enableMonitoring?: boolean;  // Auto-enable metrics collection
  };
}

export interface DeployResponse {
  success: boolean;
  deviceId: DeviceId;
  deployedVersion: string;
  previousVersion?: string;
}

export interface UndeployRequest {
  deviceId: DeviceId;
  options?: {
    stopExecution?: boolean;
    preserveState?: boolean;
  };
}

export interface UndeployResponse {
  success: boolean;
  deviceId: DeviceId;
  finalSnapshot?: ExecutionSnapshot;
}

// ============================================================================
// Execution Control Messages
// ============================================================================

export interface ExecutionControlRequest {
  deviceId: DeviceId;
}

export interface ExecutionStartResponse {
  started: boolean;
  snapshot: ExecutionSnapshot;
}

export interface ExecutionStopResponse {
  stopped: boolean;
  finalSnapshot: ExecutionSnapshot;
}

export interface ExecutionStepRequest extends ExecutionControlRequest {
  steps?: number;  // Number of execution cycles to step
}

export interface ExecutionStepResponse {
  stepsExecuted: number;
  snapshots: ExecutionSnapshot[];
}

export interface ExecutionSnapshotRequest {
  deviceId: DeviceId;
}

export interface ExecutionSnapshotResponse {
  snapshot: ExecutionSnapshot;
}

// ============================================================================
// Time Travel Messages
// ============================================================================

export interface TimeTravelStartRequest {
  deviceId: DeviceId;
  options?: {
    maxSnapshots?: number;
    captureInterval?: number;  // ms between snapshots
  };
}

export interface TimeTravelStartResponse {
  session: TimeTravelSession;
}

export interface TimeTravelStopRequest {
  sessionId: string;
}

export interface TimeTravelStopResponse {
  session: TimeTravelSession;
  totalSnapshots: number;
}

export interface TimeTravelNavigateRequest {
  sessionId: string;
  targetIndex?: number;
  targetTimestamp?: number;
  direction?: 'forward' | 'backward';
  steps?: number;
}

export interface TimeTravelNavigateResponse {
  currentIndex: number;
  snapshot: ExecutionSnapshot;
  canGoForward: boolean;
  canGoBackward: boolean;
}

export interface TimeTravelBookmarkRequest {
  sessionId: string;
  name: string;
  description?: string;
  tags?: string[];
}

export interface TimeTravelBookmarkResponse {
  bookmark: TimeTravelSession['bookmarks'][0];
}

export interface TimeTravelHistoryRequest {
  sessionId: string;
  range?: {
    startIndex: number;
    endIndex: number;
  };
}

export interface TimeTravelHistoryResponse {
  snapshots: ExecutionSnapshot[];
  totalCount: number;
  currentIndex: number;
}

// ============================================================================
// Monitoring Messages
// ============================================================================

export interface MonitorSubscribeRequest {
  deviceIds: DeviceId[];
  subscriptions: Array<'metrics' | 'snapshots' | 'transitions' | 'errors' | 'logs'>;
  interval?: number;  // Update interval in ms
}

export interface MonitorSubscribeResponse {
  subscriptionId: string;
  activeSubscriptions: string[];
}

export interface MonitorUnsubscribeRequest {
  subscriptionId: string;
  deviceIds?: DeviceId[];  // Unsubscribe from specific devices, or all if omitted
}

export interface MonitorMetricsRequest {
  deviceId: DeviceId;
  range?: {
    start: number;
    end: number;
  };
}

export interface MonitorMetricsResponse {
  deviceId: DeviceId;
  metrics: Array<{
    timestamp: number;
    cpuUsage: number;
    memoryUsage: number;
    networkLatency: number;
    executionCyclesPerSecond: number;
  }>;
}

// ============================================================================
// OTA Update Messages
// ============================================================================

export interface OTAPrepareRequest {
  deviceId: DeviceId;
  targetVersion: string;
}

export interface OTAPrepareResponse {
  ready: boolean;
  currentVersion: string;
  requiredSpace: number;
  estimatedDuration: number;
}

export interface OTAUploadRequest {
  deviceId: DeviceId;
  automata: Automata;
  options?: {
    compress?: boolean;
    verify?: boolean;
  };
}

export interface OTAUploadResponse {
  uploadId: string;
  bytesTransferred: number;
  verified: boolean;
}

export interface OTAApplyRequest {
  deviceId: DeviceId;
  uploadId: string;
  options?: {
    preserveState?: boolean;
    rollbackOnError?: boolean;
    restartExecution?: boolean;
  };
}

export interface OTAApplyResponse {
  applied: boolean;
  newVersion: string;
  snapshot?: ExecutionSnapshot;
}

export interface OTARollbackRequest {
  deviceId: DeviceId;
  targetVersion?: string;  // If omitted, rollback to previous
}

export interface OTARollbackResponse {
  rolledBack: boolean;
  currentVersion: string;
  snapshot?: ExecutionSnapshot;
}

// ============================================================================
// Event Payloads (Server -> Client)
// ============================================================================

export interface DeviceStatusEvent {
  deviceId: DeviceId;
  previousStatus: Device['status'];
  currentStatus: Device['status'];
  reason?: string;
}

export interface DeviceMetricsEvent {
  deviceId: DeviceId;
  metrics: Device['metrics'];
}

export interface ExecutionSnapshotEvent {
  deviceId: DeviceId;
  automataId: AutomataId;
  snapshot: ExecutionSnapshot;
}

export interface ExecutionTransitionEvent {
  deviceId: DeviceId;
  automataId: AutomataId;
  fromState: string;
  toState: string;
  transitionId: string;
  timestamp: number;
  variables: Record<string, unknown>;
}

export interface ExecutionErrorEvent {
  deviceId: DeviceId;
  automataId: AutomataId;
  error: {
    code: string;
    message: string;
    state?: string;
    transition?: string;
    luaError?: string;
    stackTrace?: string;
  };
  snapshot: ExecutionSnapshot;
}

export interface ServerStatusEvent {
  serverId: ServerId;
  previousStatus: Server['status'];
  currentStatus: Server['status'];
  affectedDevices: DeviceId[];
}

// ============================================================================
// Type Helpers
// ============================================================================

export type AnyRequest = 
  | ConnectRequest
  | AuthenticateRequest
  | ServerListRequest
  | DeviceListRequest
  | AutomataGetRequest
  | DeployRequest
  | ExecutionControlRequest
  | TimeTravelStartRequest
  | MonitorSubscribeRequest
  | OTAPrepareRequest;

export type AnyResponse =
  | ConnectResponse
  | AuthenticateResponse
  | ServerListResponse
  | DeviceListResponse
  | AutomataGetResponse
  | DeployResponse
  | ExecutionStartResponse
  | TimeTravelStartResponse
  | MonitorSubscribeResponse
  | OTAPrepareResponse;

export type AnyEvent =
  | DeviceStatusEvent
  | DeviceMetricsEvent
  | ExecutionSnapshotEvent
  | ExecutionTransitionEvent
  | ExecutionErrorEvent
  | ServerStatusEvent;
