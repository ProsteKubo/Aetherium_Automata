/**
 * Aetherium Automata - Gateway Service Interface
 * 
 * Defines the interface for gateway communication.
 * This allows for easy mocking and future implementation swapping.
 */

import type {
  GatewayConfig,
  GatewayStatus,
  Server,
  Device,
  Automata,
  ExecutionSnapshot,
  TimeTravelSession,
  DeviceId,
  ServerId,
  AutomataId,
} from '../../types';

import type {
  ConnectResponse,
  ServerListResponse,
  DeviceListResponse,
  DeviceInfoResponse,
  AutomataListResponse,
  AutomataGetResponse,
  DeployResponse,
  ExecutionStartResponse,
  ExecutionStopResponse,
  ExecutionSnapshotResponse,
  TimeTravelStartResponse,
  TimeTravelNavigateResponse,
  MonitorSubscribeResponse,
  DeviceStatusEvent,
  DeviceMetricsEvent,
  ExecutionSnapshotEvent,
  ExecutionTransitionEvent,
  ExecutionErrorEvent,
  ServerStatusEvent,
} from '../../types/protocol';

// ============================================================================
// Event Handler Types
// ============================================================================

export type ConnectionEventHandler = (status: GatewayStatus, error?: string) => void;
export type DeviceStatusEventHandler = (event: DeviceStatusEvent) => void;
export type DeviceMetricsEventHandler = (event: DeviceMetricsEvent) => void;
export type DeviceListEventHandler = (devices: Device[]) => void;
export type ExecutionSnapshotEventHandler = (event: ExecutionSnapshotEvent) => void;
export type ExecutionTransitionEventHandler = (event: ExecutionTransitionEvent) => void;
export type ExecutionErrorEventHandler = (event: ExecutionErrorEvent) => void;
export type ServerStatusEventHandler = (event: ServerStatusEvent) => void;

export interface GatewayEventHandlers {
  onConnectionChange?: ConnectionEventHandler;
  onDeviceList?: DeviceListEventHandler;
  onDeviceStatus?: DeviceStatusEventHandler;
  onDeviceMetrics?: DeviceMetricsEventHandler;
  onExecutionSnapshot?: ExecutionSnapshotEventHandler;
  onExecutionTransition?: ExecutionTransitionEventHandler;
  onExecutionError?: ExecutionErrorEventHandler;
  onServerStatus?: ServerStatusEventHandler;
}

// ============================================================================
// Gateway Service Interface
// ============================================================================

export interface IGatewayService {
  // Connection Management
  connect(config: GatewayConfig): Promise<ConnectResponse>;
  disconnect(): Promise<void>;
  getStatus(): GatewayStatus;
  getConfig(): GatewayConfig | null;
  
  // Event Registration
  on<K extends keyof GatewayEventHandlers>(
    event: K,
    handler: NonNullable<GatewayEventHandlers[K]>
  ): () => void;
  
  // Server Operations
  listServers(): Promise<ServerListResponse>;
  getServer(serverId: ServerId): Promise<Server>;
  
  // Device Operations
  listDevices(serverId?: ServerId): Promise<DeviceListResponse>;
  getDevice(deviceId: DeviceId): Promise<DeviceInfoResponse>;
  discoverDevices(serverId: ServerId): Promise<Device[]>;
  
  // Automata Operations
  listAutomata(): Promise<AutomataListResponse>;
  getAutomata(automataId: AutomataId): Promise<AutomataGetResponse>;
  createAutomata(automata: Omit<Automata, 'id'>): Promise<Automata>;
  updateAutomata(automataId: AutomataId, updates: Partial<Automata>): Promise<Automata>;
  deleteAutomata(automataId: AutomataId): Promise<boolean>;
  
  // Deployment Operations
  deployAutomata(automataId: AutomataId, deviceId: DeviceId, options?: {
    persistState?: boolean;
    resetExecution?: boolean;
    enableMonitoring?: boolean;
  }): Promise<DeployResponse>;
  undeployAutomata(deviceId: DeviceId): Promise<ExecutionSnapshot | null>;
  
  // Execution Control
  startExecution(deviceId: DeviceId): Promise<ExecutionStartResponse>;
  stopExecution(deviceId: DeviceId): Promise<ExecutionStopResponse>;
  pauseExecution(deviceId: DeviceId): Promise<void>;
  resumeExecution(deviceId: DeviceId): Promise<void>;
  stepExecution(deviceId: DeviceId, steps?: number): Promise<ExecutionSnapshot[]>;
  getSnapshot(deviceId: DeviceId): Promise<ExecutionSnapshotResponse>;
  
  // Time Travel
  startTimeTravel(deviceId: DeviceId, options?: {
    maxSnapshots?: number;
    captureInterval?: number;
  }): Promise<TimeTravelStartResponse>;
  stopTimeTravel(sessionId: string): Promise<TimeTravelSession>;
  navigateTimeTravel(sessionId: string, options: {
    targetIndex?: number;
    targetTimestamp?: number;
    direction?: 'forward' | 'backward';
    steps?: number;
  }): Promise<TimeTravelNavigateResponse>;
  createBookmark(sessionId: string, name: string, description?: string): Promise<void>;
  
  // Monitoring
  subscribeToDevice(deviceId: DeviceId, subscriptions: string[]): Promise<MonitorSubscribeResponse>;
  unsubscribeFromDevice(subscriptionId: string): Promise<void>;
  
  // OTA Updates
  prepareOTA(deviceId: DeviceId, targetVersion: string): Promise<{
    ready: boolean;
    estimatedDuration: number;
  }>;
  uploadOTA(deviceId: DeviceId, automata: Automata): Promise<string>;
  applyOTA(deviceId: DeviceId, uploadId: string, options?: {
    preserveState?: boolean;
    rollbackOnError?: boolean;
  }): Promise<boolean>;
  rollbackOTA(deviceId: DeviceId): Promise<boolean>;
}

// ============================================================================
// Gateway Service Factory
// ============================================================================

export type GatewayServiceFactory = () => IGatewayService;
