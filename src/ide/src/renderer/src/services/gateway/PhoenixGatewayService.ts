/**
 * Aetherium Automata - Phoenix Gateway Service
 * 
 * Real implementation using Phoenix Channels for gateway communication.
 */

import { Socket, Channel } from 'phoenix';
import type {
  GatewayConfig,
  GatewayStatus,
  Server,
  Device,
  ConnectorStatus,
  Automata,
  AutomataBinding,
  BlackBoxContract,
  BlackBoxDescription,
  BlackBoxSnapshot,
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
  ExecutionResetResponse,
  ExecutionSnapshotResponse,
  TimeTravelStartResponse,
  TimeTravelNavigateResponse,
  MonitorSubscribeResponse,
  CommandOutcomeEvent,
  DeploymentStatusEvent,
  DeploymentTransferEvent,
  DeploymentListEvent,
  ConnectionListEvent,
  DeviceLogEvent,
} from '../../types/protocol';
import type {
  IGatewayService,
  GatewayEventHandlers,
  PersistedGatewayEvent,
  RuntimeCommandTarget,
  ConnectionDraft,
  SnapshotRequestOptions,
} from './IGatewayService';

// ============================================================================
// Types
// ============================================================================

interface LogEvent {
  level: 'info' | 'warning' | 'error';
  message: string;
  timestamp: string;
  ui_session: string;
}

interface AlertEvent {
  type:
    | 'device_crash'
    | 'device_disconnect'
    | 'lua_error'
    | 'device_restarted'
    | 'network_collapse'
    | 'metrics';
  severity: 'error' | 'warning' | 'info';
  device_id: string;
  message: string;
  timestamp: string;
}

interface DeviceListEvent {
  devices: Array<{
    id: string;
    status: 'online' | 'offline' | 'error';
    last_seen: string;
    temp: number | null;
    error: string | null;
  }>;
}

interface DeviceTelemetryEvent {
  device_id: string;
  timestamp: string;
  metrics: Record<string, any>;
}

interface AutomataStateChangeEvent {
  device_id: string;
  previous_state: string;
  new_state: string;
  timestamp: string;
}

interface StateChangedEvent {
  device_id?: string;
  deviceId?: string;
  automata_id?: string;
  automataId?: string;
  from_state?: string;
  fromState?: string;
  to_state?: string;
  toState?: string;
  transition_id?: string;
  transitionId?: string;
  timestamp?: string;
  variables?: Record<string, unknown>;
}

interface PendingCommandOutcome {
  resolve: (outcome: CommandOutcomeEvent) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface SnapshotCacheEntry {
  response: ExecutionSnapshotResponse;
  cachedAt: number;
}

// ============================================================================
// Phoenix Gateway Service
// ============================================================================

export class PhoenixGatewayService implements IGatewayService {
  private socket: Socket | null = null;
  private channel: Channel | null = null;
  private automataChannel: Channel | null = null;
  private status: GatewayStatus = 'disconnected';
  private config: GatewayConfig | null = null;
  private sessionId: string | null = null;
  private eventHandlers: Map<keyof GatewayEventHandlers, Set<Function>> = new Map();
  
  // Logs and alerts storage
  private logs: LogEvent[] = [];
  private alerts: AlertEvent[] = [];
  private devices: Map<string, Device> = new Map();
  private servers: Map<string, Server> = new Map();
  private connectors: Map<string, ConnectorStatus> = new Map();
  private pendingCommandOutcomes: Map<string, PendingCommandOutcome> = new Map();
  private snapshotCache: Map<string, SnapshotCacheEntry> = new Map();
  private snapshotInFlight: Map<string, Promise<ExecutionSnapshotResponse>> = new Map();
  private timeTravelSessions: Map<string, TimeTravelSession> = new Map();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private manualDisconnect = false;
  private connectionGeneration = 0;
  private hasConnectedOnce = false;
  private autoReconnectSuppressed = false;

  private static readonly DEFAULT_SERVER_ID: ServerId = 'default_server' as ServerId;
  private static readonly RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000];
  private static readonly MAX_AUTO_RECONNECT_ATTEMPTS = 6;
  private static readonly SOCKET_RECONNECT_DISABLED_MS = 2_147_483_647;
  private static readonly SNAPSHOT_CACHE_TTL_MS = 750;

  private emit<K extends keyof GatewayEventHandlers>(
    event: K,
    ...args: Parameters<NonNullable<GatewayEventHandlers[K]>>
  ): void {
    const handlers = this.eventHandlers.get(event);
    if (!handlers) return;
    handlers.forEach((handler) => {
      (handler as any)(...args);
    });
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private scheduleReconnect(reason: string): void {
    // Do not auto-reconnect before at least one successful connection.
    if (
      !this.hasConnectedOnce ||
      this.autoReconnectSuppressed ||
      this.manualDisconnect ||
      !this.config ||
      this.reconnectTimer
    ) {
      return;
    }

    if (this.reconnectAttempts >= PhoenixGatewayService.MAX_AUTO_RECONNECT_ATTEMPTS) {
      this.setStatus('error', 'Auto-reconnect paused. Please reconnect manually.');
      return;
    }

    const idx = Math.min(
      this.reconnectAttempts,
      PhoenixGatewayService.RECONNECT_DELAYS_MS.length - 1
    );
    const delay = PhoenixGatewayService.RECONNECT_DELAYS_MS[idx];
    this.reconnectAttempts += 1;

    this.setStatus('connecting', `Reconnecting: ${reason}`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;

      if (this.manualDisconnect || !this.config) {
        return;
      }

      this.connect(this.config, true).catch((error) => {
        console.error('[Gateway] Reconnect attempt failed:', error);
      });
    }, delay);
  }

  private teardownConnectionState(): void {
    if (this.channel) {
      this.channel.leave();
      this.channel = null;
    }

    if (this.automataChannel) {
      this.automataChannel.leave();
      this.automataChannel = null;
    }

    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }

    this.pendingCommandOutcomes.forEach((pending, commandId) => {
      clearTimeout(pending.timer);
      pending.reject(new Error(`Disconnected before command outcome (${commandId})`));
    });
    this.pendingCommandOutcomes.clear();
    this.snapshotInFlight.clear();
    this.snapshotCache.clear();
    this.connectors.clear();
  }

  private makeId(prefix: string): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `${prefix}_${crypto.randomUUID()}`;
    }
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }

  private buildEnvelope(commandType: string, deadlineMs: number): Record<string, any> {
    const commandId = this.makeId('cmd');
    return {
      version: 1,
      command_id: commandId,
      correlation_id: this.makeId('corr'),
      idempotency_key: this.makeId('idem'),
      issued_at: Date.now(),
      deadline_ms: deadlineMs,
      command_type: commandType,
    };
  }

  private normalizeCommandOutcome(payload: Record<string, any>): CommandOutcomeEvent {
    const statusRaw = String(payload.status ?? payload.outcome ?? 'ERROR').toUpperCase();
    const status = (statusRaw === 'ACK' || statusRaw === 'NAK' ? statusRaw : 'ERROR') as CommandOutcomeEvent['status'];
    const timestampRaw = payload.timestamp ?? payload.ts;
    const timestamp =
      typeof timestampRaw === 'number'
        ? timestampRaw
        : typeof timestampRaw === 'string'
          ? Date.parse(timestampRaw)
          : Date.now();

    const dataRaw = payload.data ?? payload.result;
    const data = dataRaw && typeof dataRaw === 'object' ? (dataRaw as Record<string, unknown>) : undefined;

    return {
      status,
      command_id: payload.command_id,
      correlation_id: payload.correlation_id,
      idempotency_key: payload.idempotency_key,
      command_type: payload.command_type,
      reason: payload.reason,
      data,
      timestamp: Number.isNaN(timestamp) ? Date.now() : timestamp,
    };
  }

  private normalizeDeploymentTransfer(payload: Record<string, any>): DeploymentTransferEvent {
    const toNumber = (value: unknown): number | undefined => {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
      }
      return undefined;
    };

    return {
      deployment_id: payload.deployment_id ?? payload.deploymentId,
      deploymentId: payload.deploymentId ?? payload.deployment_id,
      automata_id: payload.automata_id ?? payload.automataId,
      automataId: payload.automataId ?? payload.automata_id,
      device_id: payload.device_id ?? payload.deviceId,
      deviceId: payload.deviceId ?? payload.device_id,
      server_id: payload.server_id ?? payload.serverId,
      serverId: payload.serverId ?? payload.server_id,
      run_id: toNumber(payload.run_id ?? payload.runId),
      runId: toNumber(payload.runId ?? payload.run_id),
      format: payload.format ? String(payload.format) : undefined,
      phase: payload.phase ? String(payload.phase) : undefined,
      stage: payload.stage ? String(payload.stage) : undefined,
      total_chunks: toNumber(payload.total_chunks ?? payload.totalChunks),
      awaiting_chunk_index: toNumber(payload.awaiting_chunk_index ?? payload.awaitingChunkIndex),
      awaitingChunkIndex: toNumber(payload.awaitingChunkIndex ?? payload.awaiting_chunk_index),
      next_chunk_index: toNumber(payload.next_chunk_index ?? payload.nextChunkIndex),
      nextChunkIndex: toNumber(payload.nextChunkIndex ?? payload.next_chunk_index),
      chunk_index: toNumber(payload.chunk_index ?? payload.chunkIndex),
      chunkIndex: toNumber(payload.chunkIndex ?? payload.chunk_index),
      message_id: toNumber(payload.message_id ?? payload.messageId),
      messageId: toNumber(payload.messageId ?? payload.message_id),
      retry_count: toNumber(payload.retry_count ?? payload.retryCount),
      retryCount: toNumber(payload.retryCount ?? payload.retry_count),
      max_retries: toNumber(payload.max_retries ?? payload.maxRetries),
      maxRetries: toNumber(payload.maxRetries ?? payload.max_retries),
      success: typeof payload.success === 'boolean' ? payload.success : undefined,
      error: payload.error ? String(payload.error) : undefined,
      warnings: Array.isArray(payload.warnings) ? payload.warnings : undefined,
    };
  }

  private deploymentStatusRank(status: unknown): number {
    switch (String(status ?? '').toLowerCase()) {
      case 'running':
        return 6;
      case 'loading':
      case 'deploying':
      case 'pending':
        return 5;
      case 'paused':
        return 4;
      case 'stopped':
        return 3;
      case 'error':
        return 2;
      default:
        return 0;
    }
  }

  private reconcileDeviceAssignmentsFromDeployments(deployments: Array<Record<string, any>>): void {
    const grouped = new Map<string, Array<Record<string, any>>>();

    deployments.forEach((deployment) => {
      const deviceId = String(deployment.device_id ?? deployment.deviceId ?? '');
      if (!deviceId) return;
      const list = grouped.get(deviceId) ?? [];
      list.push(deployment);
      grouped.set(deviceId, list);
    });

    let changed = false;

    this.devices.forEach((device, deviceId) => {
      const deploymentsForDevice = [...(grouped.get(deviceId) ?? [])].sort((left, right) => {
        const rankDelta =
          this.deploymentStatusRank(right.status ?? right['status']) -
          this.deploymentStatusRank(left.status ?? left['status']);
        if (rankDelta !== 0) return rankDelta;
        return String(right.automata_id ?? right.automataId ?? '').localeCompare(
          String(left.automata_id ?? left.automataId ?? ''),
        );
      });

      const isHostRuntime =
        device.connectorType === 'host_runtime' || device.transport === 'host_runtime';

      const nextAssigned =
        deploymentsForDevice.length === 0
          ? undefined
          : deploymentsForDevice.length === 1 || !isHostRuntime
            ? String(
                deploymentsForDevice[0].automata_id ?? deploymentsForDevice[0].automataId ?? '',
              ) || undefined
            : undefined;

      const nextState =
        deploymentsForDevice.length === 0
          ? undefined
          : deploymentsForDevice.length === 1 || !isHostRuntime
            ? String(
                deploymentsForDevice[0].current_state ??
                  deploymentsForDevice[0].currentState ??
                  '',
              ) || undefined
            : undefined;

      if (
        nextAssigned !== device.assignedAutomataId ||
        nextState !== device.currentState
      ) {
        this.devices.set(deviceId, {
          ...device,
          assignedAutomataId: nextAssigned,
          currentState: nextState,
        });
        changed = true;
      }
    });

    if (changed) {
      this.emit('onDeviceList', Array.from(this.devices.values()));
    }
  }

  private normalizeConnection(payload: Record<string, any>): AutomataBinding {
    const sourceOutput = String(payload.source_output ?? payload.sourceOutput ?? '');
    const targetInput = String(payload.target_input ?? payload.targetInput ?? '');
    const createdAtRaw = payload.created_at ?? payload.createdAt;
    const createdAt =
      typeof createdAtRaw === 'number'
        ? createdAtRaw
        : typeof createdAtRaw === 'string'
          ? Number(createdAtRaw)
          : Date.now();

    return {
      id: String(payload.id ?? this.makeId('conn')),
      sourceAutomataId: String(payload.source_automata ?? payload.sourceAutomata ?? ''),
      sourceOutputId: sourceOutput,
      sourceOutputName: sourceOutput,
      targetAutomataId: String(payload.target_automata ?? payload.targetAutomata ?? ''),
      targetInputId: targetInput,
      targetInputName: targetInput,
      sourceType: 'any',
      targetType: 'any',
      transform:
        payload.transform === undefined || payload.transform === null
          ? undefined
          : String(payload.transform),
      enabled: payload.enabled !== false,
      createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
      modifiedAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
    };
  }

  private handleCommandOutcome(payload: Record<string, any>): void {
    const outcome = this.normalizeCommandOutcome(payload);
    this.emit('onCommandOutcome', outcome);

    const commandId = outcome.command_id;
    if (!commandId) return;

    const pending = this.pendingCommandOutcomes.get(commandId);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pendingCommandOutcomes.delete(commandId);
    pending.resolve(outcome);
  }

  private awaitCommandOutcome(commandId: string, timeoutMs: number): Promise<CommandOutcomeEvent> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCommandOutcomes.delete(commandId);
        reject(new Error(`Command outcome timeout (${commandId})`));
      }, timeoutMs);

      this.pendingCommandOutcomes.set(commandId, { resolve, reject, timer });
    });
  }

  private parseCommandFailure(commandType: string, source: Record<string, any>): Error {
    const status = String(source.status ?? 'ERROR').toUpperCase();
    const reason = String(source.reason ?? source.error ?? 'unknown_error');
    return new Error(`${commandType} ${status}: ${reason}`);
  }

  private getSnapshotCacheKey(deviceId: DeviceId, target?: RuntimeCommandTarget): string {
    return `${String(deviceId)}::${target?.automataId ?? target?.deploymentId ?? 'default'}`;
  }

  private getCachedSnapshot(deviceId: DeviceId, target?: RuntimeCommandTarget): ExecutionSnapshotResponse | null {
    const key = this.getSnapshotCacheKey(deviceId, target);
    const entry = this.snapshotCache.get(key);
    if (!entry) return null;

    if (Date.now() - entry.cachedAt > PhoenixGatewayService.SNAPSHOT_CACHE_TTL_MS) {
      this.snapshotCache.delete(key);
      return null;
    }

    return entry.response;
  }

  private setCachedSnapshot(
    deviceId: DeviceId,
    response: ExecutionSnapshotResponse,
    target?: RuntimeCommandTarget,
  ): void {
    const key = this.getSnapshotCacheKey(deviceId, target);
    this.snapshotCache.set(key, { response, cachedAt: Date.now() });
  }

  private invalidateSnapshotCache(deviceId?: DeviceId, target?: RuntimeCommandTarget): void {
    if (deviceId === undefined || deviceId === null) {
      this.snapshotCache.clear();
      return;
    }

    this.snapshotCache.delete(this.getSnapshotCacheKey(deviceId, target));
  }

  private buildCommandTargetPayload(
    deviceId: DeviceId,
    target?: RuntimeCommandTarget,
  ): Record<string, any> {
    return {
      device_id: deviceId,
      ...(target?.automataId ? { automata_id: target.automataId } : null),
      ...(target?.deploymentId ? { deployment_id: target.deploymentId } : null),
      ...(target?.serverId ? { server_id: target.serverId } : null),
    };
  }

  private emitDeploymentStatusHint(
    deviceId: DeviceId,
    status: string,
    target?: RuntimeCommandTarget,
    snapshot?: ExecutionSnapshot,
  ): void {
    const automataId =
      target?.automataId ??
      target?.deploymentId?.split(':')[0] ??
      snapshot?.automataId;

    if (!automataId) {
      return;
    }

    this.emit('onDeploymentStatus', {
      deployment_id: target?.deploymentId ?? `${automataId}:${deviceId}`,
      automata_id: automataId,
      device_id: deviceId,
      status,
      current_state: snapshot?.currentState,
      variables: snapshot
        ? Object.fromEntries(
            Object.entries(snapshot.variables ?? {}).map(([name, meta]) => [name, meta?.value]),
          )
        : undefined,
      timestamp: Date.now(),
    });
  }

  private buildBestEffortSnapshot(
    deviceId: DeviceId,
    target?: RuntimeCommandTarget,
    runtimeState?: Record<string, any>,
  ): ExecutionSnapshotResponse['snapshot'] {
    const cached = this.getCachedSnapshot(deviceId, target);
    if (cached) {
      return cached.snapshot;
    }

    const snapshot = this.buildSnapshot(deviceId, {
      ...(runtimeState ?? {}),
      ...(target?.automataId ? { automata_id: target.automataId } : null),
    });

    this.setCachedSnapshot(deviceId, { snapshot }, target);
    return snapshot;
  }

  private inferVariableType(value: unknown): 'number' | 'string' | 'bool' | 'any' | 'table' {
    if (typeof value === 'number') return 'number';
    if (typeof value === 'string') return 'string';
    if (typeof value === 'boolean') return 'bool';
    if (value !== null && typeof value === 'object') return 'table';
    return 'any';
  }

  private normalizeBlackBoxContract(raw: any): BlackBoxContract {
    const ports = Array.isArray(raw?.ports) ? raw.ports : [];
    const observableStates = Array.isArray(raw?.observable_states)
      ? raw.observable_states
      : Array.isArray(raw?.observableStates)
        ? raw.observableStates
        : [];
    const emittedEvents = Array.isArray(raw?.emitted_events)
      ? raw.emitted_events
      : Array.isArray(raw?.emittedEvents)
        ? raw.emittedEvents
        : [];
    const resources = Array.isArray(raw?.resources) ? raw.resources : [];

    return {
      ports: ports.map((port: Record<string, any>) => ({
        name: String(port?.name ?? ''),
        direction: String(port?.direction ?? 'internal') as BlackBoxContract['ports'][number]['direction'],
        type: String(port?.type ?? 'unknown'),
        ...(typeof port?.observable === 'boolean' ? { observable: port.observable } : null),
        ...(typeof port?.fault_injectable === 'boolean'
          ? { faultInjectable: port.fault_injectable }
          : typeof port?.faultInjectable === 'boolean'
            ? { faultInjectable: port.faultInjectable }
            : null),
        ...(port?.description ? { description: String(port.description) } : null),
      })),
      observableStates: observableStates.map((state: unknown) => String(state)),
      emittedEvents: emittedEvents.map((event: unknown) => String(event)),
      resources: resources.map((resource: Record<string, any>) => ({
        name: String(resource?.name ?? ''),
        kind: String(resource?.kind ?? 'unknown'),
        ...(typeof resource?.capacity === 'number' ? { capacity: resource.capacity } : null),
        ...(typeof resource?.shared === 'boolean' ? { shared: resource.shared } : null),
        ...(typeof resource?.latency_sensitive === 'boolean'
          ? { latencySensitive: resource.latency_sensitive }
          : typeof resource?.latencySensitive === 'boolean'
            ? { latencySensitive: resource.latencySensitive }
            : null),
        ...(resource?.description ? { description: String(resource.description) } : null),
      })),
    };
  }

  private normalizeBlackBoxDescription(raw: any): BlackBoxDescription {
    return {
      deploymentId: raw?.deployment_id ?? raw?.deploymentId,
      automataId: raw?.automata_id ?? raw?.automataId,
      deviceId: raw?.device_id ?? raw?.deviceId,
      serverId: raw?.server_id ?? raw?.serverId,
      status: raw?.status ? String(raw.status) : undefined,
      observableState: raw?.observable_state ?? raw?.observableState,
      deploymentMetadata:
        raw?.deployment_metadata && typeof raw.deployment_metadata === 'object'
          ? raw.deployment_metadata
          : raw?.deploymentMetadata && typeof raw.deploymentMetadata === 'object'
            ? raw.deploymentMetadata
            : undefined,
      blackBox: this.normalizeBlackBoxContract(raw?.black_box ?? raw?.blackBox ?? {}),
    };
  }

  private normalizeBlackBoxSnapshot(deviceId: DeviceId, raw: any): BlackBoxSnapshot {
    const state = raw && typeof raw === 'object' ? raw : {};
    const snapshot = this.buildSnapshot(deviceId, state);

    return {
      automataId: snapshot.automataId,
      deviceId,
      deploymentId: state.deployment_id ?? state.deploymentId,
      currentState: snapshot.currentState,
      variables: Object.fromEntries(
        Object.entries(snapshot.variables ?? {}).map(([name, meta]) => [name, meta?.value]),
      ),
      outputs: Object.fromEntries(
        Object.entries(snapshot.outputs ?? {}).map(([name, meta]) => [name, meta?.value]),
      ),
      running: typeof state.running === 'boolean' ? state.running : undefined,
      deploymentMetadata: snapshot.deploymentMetadata,
      blackBox: snapshot.blackBox,
      observableState:
        (state.observable_state as string | undefined) ??
        (state.observableState as string | undefined) ??
        snapshot.observableState,
    };
  }

  private buildSignalMap(
    signals: unknown,
    now: number,
  ): ExecutionSnapshotResponse['snapshot']['inputs'] {
    if (!signals || typeof signals !== 'object' || Array.isArray(signals)) {
      return {};
    }

    return Object.entries(signals as Record<string, unknown>).reduce((acc, [name, value]) => {
      if (value && typeof value === 'object' && !Array.isArray(value) && 'value' in (value as Record<string, unknown>)) {
        const entry = value as Record<string, unknown>;
        acc[name] = {
          name,
          value: entry.value,
          timestamp:
            typeof entry.timestamp === 'number' && Number.isFinite(entry.timestamp)
              ? entry.timestamp
              : now,
        };
        return acc;
      }

      acc[name] = {
        name,
        value,
        timestamp: now,
      };
      return acc;
    }, {} as ExecutionSnapshotResponse['snapshot']['inputs']);
  }

  private buildSnapshot(deviceId: DeviceId, runtimeState?: Record<string, any>): ExecutionSnapshotResponse['snapshot'] {
    const now = Date.now();
    const device = this.devices.get(String(deviceId));
    const variablesMap = runtimeState?.variables && typeof runtimeState.variables === 'object' ? runtimeState.variables : {};

    const variables = Object.entries(variablesMap).reduce((acc, [name, value]) => {
      acc[name] = {
        name,
        value,
        type: this.inferVariableType(value),
        timestamp: now,
      };
      return acc;
    }, {} as ExecutionSnapshotResponse['snapshot']['variables']);

    return {
      id: `${String(deviceId)}:${now}`,
      timestamp: now,
      automataId:
        (runtimeState?.automata_id as AutomataId | undefined) ??
        (runtimeState?.automataId as AutomataId | undefined) ??
        (device?.assignedAutomataId as AutomataId | undefined) ??
        ('unknown' as AutomataId),
      deviceId,
      currentState:
        String(runtimeState?.current_state ?? runtimeState?.currentState ?? device?.currentState ?? 'unknown'),
      variables,
      inputs: this.buildSignalMap(runtimeState?.inputs, now),
      outputs: this.buildSignalMap(runtimeState?.outputs, now),
      deploymentMetadata:
        runtimeState?.deployment_metadata && typeof runtimeState.deployment_metadata === 'object'
          ? runtimeState.deployment_metadata
          : runtimeState?.deploymentMetadata && typeof runtimeState.deploymentMetadata === 'object'
            ? runtimeState.deploymentMetadata
            : undefined,
      blackBox:
        runtimeState?.black_box || runtimeState?.blackBox
          ? this.normalizeBlackBoxContract(runtimeState?.black_box ?? runtimeState?.blackBox)
          : undefined,
      observableState:
        (runtimeState?.observable_state as string | undefined) ??
        (runtimeState?.observableState as string | undefined),
      executionCycle:
        Number(runtimeState?.execution_cycle ?? runtimeState?.executionCycle ?? runtimeState?.tick ?? 0) || 0,
    };
  }

  private async sendAutomataCommandWithOutcome<T = any>(
    command: string,
    payload: Record<string, any> = {},
    timeout: number = 5000
  ): Promise<{ response: T; outcome: CommandOutcomeEvent }> {
    const envelope = this.buildEnvelope(command, timeout);
    const commandPayload = { ...payload, ...envelope };
    const targetDeviceId = (commandPayload.device_id ?? commandPayload.deviceId) as DeviceId | undefined;
    const targetAutomataId = commandPayload.automata_id ?? commandPayload.automataId;
    const targetDeploymentId = commandPayload.deployment_id ?? commandPayload.deploymentId;
    if (command !== 'request_state' && targetDeviceId) {
      this.invalidateSnapshotCache(targetDeviceId, {
        automataId: typeof targetAutomataId === 'string' ? targetAutomataId : undefined,
        deploymentId: typeof targetDeploymentId === 'string' ? targetDeploymentId : undefined,
      });
    }
    const commandId = envelope.command_id;
    const outcomePromise = this.awaitCommandOutcome(commandId, timeout);

    try {
      const response = await this.sendAutomataCommand<T & Record<string, any>>(command, commandPayload, timeout);
      const responseStatus = String((response as any)?.status ?? '').toUpperCase();

      if ((response as any)?.outcome) {
        const immediateOutcome = this.normalizeCommandOutcome((response as any).outcome);
        this.emit('onCommandOutcome', immediateOutcome);

        const pending = this.pendingCommandOutcomes.get(commandId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingCommandOutcomes.delete(commandId);
        }

        if (immediateOutcome.status !== 'ACK') {
          throw this.parseCommandFailure(command, immediateOutcome as any);
        }

        return { response: response as T, outcome: immediateOutcome };
      }

      if (responseStatus === 'NAK' || responseStatus === 'ERROR') {
        const immediateOutcome = (response as any)?.outcome
          ? this.normalizeCommandOutcome((response as any).outcome)
          : ({
              status: responseStatus as CommandOutcomeEvent['status'],
              command_id: commandId,
              command_type: command,
              reason: (response as any)?.reason,
              data: (response as any)?.result,
              timestamp: Date.now(),
            } as CommandOutcomeEvent);
        this.emit('onCommandOutcome', immediateOutcome);

        const pending = this.pendingCommandOutcomes.get(commandId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingCommandOutcomes.delete(commandId);
        }
        throw this.parseCommandFailure(command, response as any);
      }

      const outcome = await outcomePromise;
      if (outcome.status !== 'ACK') {
        throw this.parseCommandFailure(command, outcome as any);
      }
      return { response: response as T, outcome };
    } catch (error) {
      const pending = this.pendingCommandOutcomes.get(commandId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingCommandOutcomes.delete(commandId);
      }
      throw error;
    }
  }

  private normalizeDevice(raw: DeviceListEvent['devices'][number] | Record<string, any>): Device {
    const id = String((raw as any).id ?? (raw as any).device_id ?? (raw as any).deviceId);
    const status = this.normalizeDeviceStatus((raw as any).status ?? 'unknown');

    const previous = this.devices.get(id);
    const supportedCommandsRaw =
      (raw as any).supported_commands ??
      (raw as any).supportedCommands ??
      previous?.supportedCommands;
    const supportedCommands =
      Array.isArray(supportedCommandsRaw)
        ? supportedCommandsRaw.map((command) => String(command))
        : previous?.supportedCommands;

    const serverIdFromRaw = (raw as any).server_id ?? (raw as any).serverId ?? previous?.serverId ?? PhoenixGatewayService.DEFAULT_SERVER_ID;

    const base: Device = {
      id,
      name: (raw as any).name ?? previous?.name ?? id,
      status,
      serverId: serverIdFromRaw,
      address: previous?.address ?? 'unknown',
      port: previous?.port ?? 0,
      connectorId: (raw as any).connector_id ?? (raw as any).connectorId ?? previous?.connectorId,
      connectorType: (raw as any).connector_type ?? (raw as any).connectorType ?? previous?.connectorType,
      transport: (raw as any).transport ?? previous?.transport,
      link: (raw as any).link ?? previous?.link,
      capabilities: previous?.capabilities ?? [],
      engineVersion: previous?.engineVersion ?? 'unknown',
      tags: previous?.tags ?? [],
      ...(supportedCommands ? { supportedCommands } : null),
    };

    const lastSeen = (raw as any).last_seen ?? (raw as any).lastSeen ?? previous?.lastSeen;
    const temperature = (raw as any).temp ?? (raw as any).temperature ?? previous?.temperature;
    const error = (raw as any).error ?? previous?.error;

    return {
      ...previous,
      ...base,
      ...(lastSeen !== undefined ? { lastSeen: String(lastSeen) } : null),
      ...(temperature !== undefined ? { temperature } : null),
      ...(error !== undefined ? { error } : null),
    } as Device;
  }

  private normalizeDeviceStatus(statusRaw: unknown): Device['status'] {
    const status = String(statusRaw ?? 'unknown').toLowerCase();

    if (status === 'online' || status === 'connected' || status === 'running') return 'online';
    if (status === 'offline' || status === 'disconnected' || status === 'stopped') return 'offline';
    if (status === 'error' || status === 'failed') return 'error';
    if (status === 'updating') return 'updating';

    return 'unknown';
  }

  private statusPriority(status: Device['status']): number {
    switch (status) {
      case 'online':
        return 5;
      case 'updating':
        return 4;
      case 'error':
        return 3;
      case 'unknown':
        return 2;
      case 'offline':
      default:
        return 1;
    }
  }

  private consolidateDevices(devices: Device[]): Device[] {
    const bestById = new Map<string, Device>();

    devices.forEach((device) => {
      const existing = bestById.get(device.id);
      if (!existing) {
        bestById.set(device.id, device);
        return;
      }

      if (this.statusPriority(device.status) >= this.statusPriority(existing.status)) {
        bestById.set(device.id, { ...existing, ...device });
      }
    });

    return Array.from(bestById.values());
  }

  private normalizeServer(raw: Record<string, any>): Server {
    const id = String(raw.server_id ?? raw.serverId ?? raw.id);
    const statusRaw = raw.status ?? 'disconnected';
    const status: Server['status'] = statusRaw === 'online' ? 'connected' : (statusRaw as Server['status']);

    const lastHeartbeat = raw.last_heartbeat ?? raw.lastHeartbeat ?? raw.lastSeen ?? raw.connected_at ?? raw.connectedAt;
    const lastSeen = lastHeartbeat ? (typeof lastHeartbeat === 'string' ? Date.parse(lastHeartbeat) : (lastHeartbeat instanceof Date ? lastHeartbeat.getTime() : Date.now())) : Date.now();

    const deviceIds = Array.from(this.devices.values()).filter(d => d.serverId === id).map(d => d.id as any);

    return {
      id,
      name: raw.name ?? id,
      description: raw.description ?? '',
      address: this.config?.host ?? 'unknown',
      port: this.config?.port ?? 0,
      status,
      deviceIds,
      maxDevices: raw.max_devices ?? raw.maxDevices ?? 10000,
      lastSeen,
      latency: raw.latency ?? 0,
      region: raw.region,
      tags: raw.tags ?? [],
    };
  }

  private normalizeConnectorStatus(raw: Record<string, any>): ConnectorStatus {
    const id = String(raw.id ?? raw.connector_id ?? raw.connectorId ?? 'unknown_connector');
    const statusRaw = String(raw.status ?? 'unknown').toLowerCase();
    const status: ConnectorStatus['status'] =
      statusRaw === 'running' || statusRaw === 'stopped' || statusRaw === 'disabled'
        ? statusRaw
        : 'unknown';

    const timestampRaw = raw.timestamp;
    const timestamp =
      typeof timestampRaw === 'number'
        ? timestampRaw
        : typeof timestampRaw === 'string'
          ? Date.parse(timestampRaw)
          : Date.now();

    return {
      id,
      type: String(raw.type ?? raw.connector_type ?? raw.connectorType ?? 'unknown'),
      status,
      enabled: raw.enabled !== false,
      pid: raw.pid ? String(raw.pid) : undefined,
      serverId: (raw.server_id ?? raw.serverId) as ServerId | undefined,
      timestamp: Number.isNaN(timestamp) ? Date.now() : timestamp,
    };
  }
  
  // Connection Management
  // ========================================================================
  
  async connect(config: GatewayConfig, isAutoReconnect = false): Promise<ConnectResponse> {
    // Validate config
    if (!config.host || !config.port) {
      throw new Error('Invalid gateway config: host and port are required');
    }

    if (!isAutoReconnect) {
      this.autoReconnectSuppressed = true;
      this.reconnectAttempts = 0;
    }

    this.clearReconnectTimer();
    const generation = ++this.connectionGeneration;
    this.manualDisconnect = true;
    
    // Disconnect existing connection first and suppress stale close/error callbacks.
    if (this.socket || this.channel || this.automataChannel) {
      console.log('[Gateway] Disconnecting existing connection before reconnecting');
      this.teardownConnectionState();
    }
    this.manualDisconnect = false;
    
    this.config = config;
    this.sessionId = null;
    this.setStatus('connecting');
    
    try {
      // Create Phoenix socket
      // URL format: ws://192.168.1.100:4000/socket
      const socketUrl = `ws://${config.host}:${config.port}/socket`;
      console.log('[Gateway] Connecting to:', socketUrl);
      
      this.socket = new Socket(socketUrl, {
        params: { token: config.password || 'dev_secret_token' },
        timeout: 10000,
        // Disable Phoenix internal reconnect loop; we own retry policy via scheduleReconnect().
        reconnectAfterMs: () => PhoenixGatewayService.SOCKET_RECONNECT_DISABLED_MS,
      });
      
      // Socket-level event handlers
      this.socket.onOpen(() => {
        if (generation !== this.connectionGeneration) return;
        console.log('[Gateway] Socket opened');
      });
      
      this.socket.onError((error) => {
        if (generation !== this.connectionGeneration) return;
        console.error('[Gateway] Socket error:', error);
        this.setStatus('error', 'Socket connection error');
        this.scheduleReconnect('socket_error');
      });
      
      this.socket.onClose(() => {
        if (generation !== this.connectionGeneration) return;
        console.log('[Gateway] Socket closed');
        this.setStatus('disconnected');
        this.scheduleReconnect('socket_closed');
      });
      
      // Connect socket
      this.socket.connect();
      
      // Join the control channel with token in payload
      const token = config.password || 'dev_secret_token';
      this.channel = this.socket.channel('gateway:control', { token });

      // Join the automata control channel for deploy/runtime control
      this.automataChannel = this.socket.channel('automata:control', { token });

      this.channel.onError(() => {
        if (generation !== this.connectionGeneration) return;
        console.error('[Gateway] gateway:control channel error');
        this.setStatus('error', 'gateway:control channel error');
        this.scheduleReconnect('gateway_channel_error');
      });

      this.channel.onClose(() => {
        if (generation !== this.connectionGeneration) return;
        console.warn('[Gateway] gateway:control channel closed');
        this.scheduleReconnect('gateway_channel_closed');
      });

      this.automataChannel.onError(() => {
        if (generation !== this.connectionGeneration) return;
        console.error('[Gateway] automata:control channel error');
        this.setStatus('error', 'automata:control channel error');
        this.scheduleReconnect('automata_channel_error');
      });

      this.automataChannel.onClose(() => {
        if (generation !== this.connectionGeneration) return;
        console.warn('[Gateway] automata:control channel closed');
        this.scheduleReconnect('automata_channel_closed');
      });
      
      // Set up channel event handlers BEFORE joining
      this.setupChannelHandlers();
      
      // Join both channels and wait for responses
      const joinGateway = new Promise<void>((resolve, reject) => {
        if (!this.channel) {
          reject(new Error('Channel not initialized'));
          return;
        }

        this.channel
          .join()
          .receive('ok', (response) => {
            console.log('[Gateway] Channel joined successfully', response);
            this.sessionId = response.session_id || `session_${Date.now()}`;
            resolve();
          })
          .receive('error', (resp) => {
            console.error('[Gateway] Failed to join channel:', resp);
            reject(new Error(resp.reason || 'Failed to join channel'));
          })
          .receive('timeout', () => {
            console.error('[Gateway] Channel join timeout');
            reject(new Error('Connection timeout'));
          });
      });

      const joinAutomata = new Promise<void>((resolve, reject) => {
        if (!this.automataChannel) {
          reject(new Error('Automata channel not initialized'));
          return;
        }

        this.automataChannel
          .join()
          .receive('ok', (response) => {
            console.log('[Gateway] Automata channel joined successfully', response);
            resolve();
          })
          .receive('error', (resp) => {
            console.error('[Gateway] Failed to join automata channel:', resp);
            reject(new Error(resp.reason || 'Failed to join automata channel'));
          })
          .receive('timeout', () => {
            console.error('[Gateway] Automata channel join timeout');
            reject(new Error('Automata channel join timeout'));
          });
      });

      await Promise.all([joinGateway, joinAutomata]);

      this.hasConnectedOnce = true;
      this.autoReconnectSuppressed = false;
      this.reconnectAttempts = 0;
      this.setStatus('connected');

      return {
        sessionId: this.sessionId || '',
        gatewayVersion: '1.0.0',
        serverCount: 0,
        deviceCount: 0,
      };
    } catch (error) {
      console.error('[Gateway] Connection error:', error);
      this.manualDisconnect = true;
      this.teardownConnectionState();
      this.manualDisconnect = false;
      this.setStatus('error', error instanceof Error ? error.message : 'Unknown error');
      if (this.hasConnectedOnce && isAutoReconnect) {
        this.scheduleReconnect('connect_failed');
      }
      throw error;
    }
  }
  
  async disconnect(): Promise<void> {
    this.connectionGeneration += 1;
    this.manualDisconnect = true;
    this.autoReconnectSuppressed = true;
    this.clearReconnectTimer();
    this.reconnectAttempts = 0;
    this.teardownConnectionState();
    
    this.setStatus('disconnected');
    this.sessionId = null;
    this.config = null;
    this.timeTravelSessions.clear();
  }
  
  getStatus(): GatewayStatus {
    return this.status;
  }
  
  getConfig(): GatewayConfig | null {
    return this.config;
  }
  
  // Event Registration
  // ========================================================================
  
  on<K extends keyof GatewayEventHandlers>(
    event: K,
    handler: NonNullable<GatewayEventHandlers[K]>
  ): () => void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    
    this.eventHandlers.get(event)!.add(handler);
    
    // Return unsubscribe function
    return () => {
      const handlers = this.eventHandlers.get(event);
      if (handlers) {
        handlers.delete(handler);
      }
    };
  }
  
  // Private: Channel Event Handlers Setup
  // ========================================================================
  
  private setupChannelHandlers(): void {
    if (!this.channel) return;
    
    // Log events
    this.channel.on('log', (payload: LogEvent) => {
      console.log(`[Gateway Log] [${payload.level}] ${payload.message}`);
      this.logs.push(payload);
      // Emit to UI if needed
    });

    this.channel.on('device_log', (payload: Record<string, any>) => {
      const deviceLog: DeviceLogEvent = {
        device_id: payload.device_id ?? payload.deviceId,
        level: payload.level ?? 'info',
        message: String(payload.message ?? ''),
        timestamp: payload.timestamp ?? Date.now(),
        server_id: payload.server_id ?? payload.serverId,
      };
      this.emit('onDeviceLog', deviceLog);
    });

    this.channel.on('command_outcome', (payload: Record<string, any>) => {
      this.handleCommandOutcome(payload);
    });

    // Alert events
    this.channel.on('alert', (payload: AlertEvent) => {
      const alertType = payload.type ?? 'unknown';
      const alertMessage =
        payload.message ??
        (alertType === 'metrics' ? 'telemetry update' : undefined) ??
        'no details';
      if (alertType === 'metrics') {
        console.debug(`[Gateway Alert] ${alertType}: ${alertMessage}`);
      } else {
        console.warn(`[Gateway Alert] ${alertType}: ${alertMessage}`);
      }
      this.alerts.push({ ...payload, type: alertType as AlertEvent['type'], message: alertMessage });

      if (alertType === 'metrics') {
        const telemetry = (payload as any).telemetry;
        if (payload.device_id && telemetry && typeof telemetry === 'object') {
          this.emit('onDeviceMetrics', {
            deviceId: payload.device_id as DeviceId,
            metrics: telemetry,
          });
        }
      }
      
      // Update device status if applicable
      if (payload.device_id) {
        const prev = this.devices.get(payload.device_id);
        const prevStatus = prev?.status ?? 'unknown';

        const next = this.normalizeDevice({
          id: payload.device_id,
          status:
            payload.type === 'device_disconnect'
              ? 'offline'
              : payload.type === 'device_crash' || payload.type === 'lua_error'
                ? 'error'
                : prevStatus,
          error:
            payload.type === 'device_crash' || payload.type === 'lua_error' ? payload.message : prev?.error,
          last_seen: payload.timestamp,
        });

        this.devices.set(payload.device_id, next);

        if (next.status !== prevStatus) {
          this.emit('onDeviceStatus', {
            deviceId: payload.device_id,
            previousStatus: prevStatus,
            currentStatus: next.status,
            reason: payload.message,
          });
        }

        this.emit('onDeviceList', Array.from(this.devices.values()));
      }
      
      // TODO: Emit to UI handlers
    });
    
    // Device list updates
    this.channel.on('device_list', (payload: DeviceListEvent) => {
      const normalized = this.consolidateDevices(payload.devices.map((d) => this.normalizeDevice(d)));
      
      // Collect incoming device IDs
      const incomingIds = new Set(normalized.map(d => d.id));
      
      // Find devices that are no longer in the list (disconnected)
      const prevIds = Array.from(this.devices.keys());
      const removedIds = prevIds.filter(id => !incomingIds.has(id));
      
      // Emit device status events for removed devices and remove them
      removedIds.forEach((id) => {
        const prev = this.devices.get(id);
        if (prev) {
          this.emit('onDeviceStatus', {
            deviceId: id,
            previousStatus: prev.status,
            currentStatus: 'offline',
            reason: 'Removed from gateway device list',
          });
          
          this.devices.delete(id);
        }
      });
      
      // Add/update remaining devices
      normalized.forEach((device) => {
        this.devices.set(device.id, device);
      });

      this.emit('onDeviceList', Array.from(this.devices.values()));
    });
    
    // Device telemetry
    this.channel.on('device_telemetry', (payload: DeviceTelemetryEvent) => {
      console.log(`[Gateway] Telemetry from ${payload.device_id}:`, payload.metrics);

      const prev = this.devices.get(payload.device_id);
      const next = this.normalizeDevice({
        id: payload.device_id,
        status: prev?.status ?? 'unknown',
        last_seen: payload.timestamp,
      });

      // Create new object to avoid mutating frozen Immer objects
      this.devices.set(payload.device_id, { ...next, metrics: payload.metrics });

      this.emit('onDeviceMetrics', {
        deviceId: payload.device_id,
        metrics: payload.metrics,
      });

      this.emit('onDeviceList', Array.from(this.devices.values()));
    });

    // Server list updates
    this.channel.on('server_list', (payload: { servers: any[] }) => {
      const incoming = payload.servers || [];
      incoming.forEach((raw) => {
        const id = raw.server_id ?? raw.serverId ?? raw.id;
        if (!id) return;

        const previous = this.servers.get(id);
        const server = this.normalizeServer(raw);

        // Update deviceIds using current devices map (create new object to avoid Immer freeze issues)
        const updatedServer = {
          ...server,
          deviceIds: Array.from(this.devices.values()).filter(d => d.serverId === server.id).map(d => d.id as any),
        };

        this.servers.set(updatedServer.id, updatedServer);

        if (!previous || previous.status !== server.status) {
          this.emit('onServerStatus', {
            serverId: server.id,
            previousStatus: previous?.status ?? (previous ? previous.status : 'disconnected'),
            currentStatus: server.status,
            affectedDevices: server.deviceIds,
          });
        }
      });

      // Ensure consumers get updated device list too
      this.emit('onDeviceList', Array.from(this.devices.values()));
    });

    this.channel.on('connector_status', (payload: Record<string, any>) => {
      const connectorsRaw = Array.isArray(payload.connectors) ? payload.connectors : [];
      const serverId = payload.server_id ?? payload.serverId;
      const timestamp = payload.timestamp ?? Date.now();

      const normalized = connectorsRaw.map((connector) =>
        this.normalizeConnectorStatus({
          ...(connector && typeof connector === 'object' ? connector : {}),
          server_id: serverId,
          timestamp,
        })
      );

      normalized.forEach((connector) => {
        this.connectors.set(connector.id, connector);
      });

      this.emit('onConnectorStatus', {
        connectors: normalized,
        server_id: serverId,
        timestamp,
      });
    });

    // Devices updated for a specific server (streamed from server processes)
    this.channel.on('devices_updated', (payload: { server_id?: string; serverId?: string; devices?: any[]; timestamp?: string }) => {
      const serverId = payload.server_id ?? payload.serverId;
      const devices = payload.devices || [];

      // Normalize incoming devices and collect their ids
      const incomingNormalized = devices.map((d) => this.normalizeDevice({ ...d, server_id: serverId }));
      const incomingIds = new Set(incomingNormalized.map(d => d.id));

      // Remove devices that used to belong to this server but are not in the new list
      const prevIds = Array.from(this.devices.values()).filter(d => d.serverId === serverId).map(d => d.id);
      const removedIds = prevIds.filter(id => !incomingIds.has(id));

      removedIds.forEach((id) => {
        const prev = this.devices.get(id);
        if (prev) {
          // Emit a device status event so consumers can react to removal
          this.emit('onDeviceStatus', {
            deviceId: id,
            previousStatus: prev.status,
            currentStatus: 'offline',
            reason: 'Removed from server device list',
          } as any);

          this.devices.delete(id);
        }
      });

      // Upsert incoming devices
      incomingNormalized.forEach((n) => this.devices.set(n.id, n));

      // Update server deviceIds (create new object to avoid Immer freeze issues)
      const server = this.servers.get(serverId as string);
      if (server) {
        const updatedServer = {
          ...server,
          deviceIds: Array.from(this.devices.values()).filter(d => d.serverId === serverId).map(d => d.id as any),
        };
        this.servers.set(updatedServer.id, updatedServer);
      }

      // Emit updated device list for consumers to replace local caches
      this.emit('onDeviceList', Array.from(this.devices.values()));
    });
    
    // State changes (gateway broadcasts "state_changed")
    this.channel.on('state_changed', (payload: StateChangedEvent) => {
      const deviceId = String(payload.device_id ?? payload.deviceId ?? '');
      if (!deviceId) return;

      const fromState = String(payload.from_state ?? payload.fromState ?? '');
      const toState = String(payload.to_state ?? payload.toState ?? '');
      const automataId = String(payload.automata_id ?? payload.automataId ?? '') as any;
      const transitionId = String(payload.transition_id ?? payload.transitionId ?? '');
      const variables = payload.variables ?? {};

      console.log(`[Gateway] state_changed ${deviceId}: ${fromState} -> ${toState}`);

      const device = this.devices.get(deviceId);
      if (device) {
        // Create new object to avoid mutating frozen Immer objects
        this.devices.set(deviceId, { ...device, currentState: toState });
        this.emit('onDeviceList', Array.from(this.devices.values()));
      }

      this.emit('onExecutionTransition', {
        deviceId: deviceId as any,
        automataId,
        fromState,
        toState,
        transitionId,
        timestamp: payload.timestamp ? Date.parse(payload.timestamp) : Date.now(),
        variables,
      });
    });

    // Legacy event name (older gateway builds)
    this.channel.on('automata_state_change', (payload: AutomataStateChangeEvent) => {
      console.log(`[Gateway] (legacy) automata_state_change on ${payload.device_id}: ${payload.previous_state} -> ${payload.new_state}`);

      const device = this.devices.get(payload.device_id);
      if (device) {
        // Create new object to avoid mutating frozen Immer objects
        this.devices.set(payload.device_id, { ...device, currentState: payload.new_state });
        this.emit('onDeviceList', Array.from(this.devices.values()));
      }
    });

    // Also listen on automata:control for deployments/state (some events are broadcast there only)
    if (this.automataChannel) {
      this.automataChannel.on('command_outcome', (payload: Record<string, any>) => {
        this.handleCommandOutcome(payload);
      });

      this.automataChannel.on('deployment_transfer', (payload: Record<string, any>) => {
        this.emit('onDeploymentTransfer', this.normalizeDeploymentTransfer(payload));
      });

      this.automataChannel.on('state_changed', (payload: StateChangedEvent) => {
        const deviceId = String(payload.device_id ?? payload.deviceId ?? '');
        if (!deviceId) return;
        const toState = String(payload.to_state ?? payload.toState ?? '');

        const device = this.devices.get(deviceId);
        if (device) {
          // Create new object to avoid mutating frozen Immer objects
          this.devices.set(deviceId, { ...device, currentState: toState });
          this.emit('onDeviceList', Array.from(this.devices.values()));
        }
      });

      this.automataChannel.on('deployment_status', (payload: any) => {
        const deviceId = String(payload.device_id ?? payload.deviceId ?? '');
        if (!deviceId) return;
        const automataId = payload.automata_id ?? payload.automataId;

        const device = this.devices.get(deviceId);
        if (device) {
          const currentState = payload.current_state ?? payload.currentState;
          // Create new object to avoid mutating frozen Immer objects
          this.devices.set(deviceId, {
            ...device,
            ...(automataId ? { assignedAutomataId: automataId } : {}),
            ...(currentState ? { currentState } : {}),
          });
          this.emit('onDeviceList', Array.from(this.devices.values()));
        }

        const snapshot = this.buildSnapshot(deviceId as any, {
          automata_id: automataId,
          current_state: payload.current_state ?? payload.currentState,
          variables: payload.variables,
        });
        this.emit('onExecutionSnapshot', {
          deviceId: deviceId as any,
          automataId: (automataId ?? snapshot.automataId) as any,
          snapshot,
        });
        this.setCachedSnapshot(
          deviceId as any,
          { snapshot },
          automataId ? { automataId: String(automataId) as AutomataId } : undefined,
        );

        const deploymentStatus: DeploymentStatusEvent = {
          deployment_id: payload.deployment_id ?? payload.deploymentId,
          automata_id: automataId,
          device_id: payload.device_id ?? payload.deviceId,
          status: payload.status,
          current_state: payload.current_state ?? payload.currentState,
          variables: payload.variables,
          timestamp: payload.timestamp,
        };
        this.emit('onDeploymentStatus', deploymentStatus);
      });

      this.automataChannel.on('deployment_list', (payload: any) => {
        const deployments: DeploymentListEvent = {
          deployments: Array.isArray(payload?.deployments) ? payload.deployments : [],
        };
        this.reconcileDeviceAssignmentsFromDeployments(
          deployments.deployments as Array<Record<string, any>>,
        );
        this.emit('onDeploymentList', deployments);
      });

      this.automataChannel.on('connection_list', (payload: any) => {
        const connections: ConnectionListEvent = {
          connections: Array.isArray(payload?.connections) ? payload.connections : [],
        };
        this.emit('onConnectionList', connections);
      });
    }
  }
  
  // Private: Command Helper
  // ========================================================================
  
  private async sendCommand<T = any>(
    command: string,
    payload: Record<string, any> = {},
    timeout: number = 5000
  ): Promise<T> {
    if (!this.channel) {
      throw new Error('Not connected to gateway');
    }
    
    return new Promise((resolve, reject) => {
      this.channel!
        .push(command, payload, timeout)
        .receive('ok', (response) => {
          resolve(response as T);
        })
        .receive('error', (error) => {
          reject(error);
        })
        .receive('timeout', () => {
          reject(new Error('Command timeout'));
        });
    });
  }

  private async sendAutomataCommand<T = any>(
    command: string,
    payload: Record<string, any> = {},
    timeout: number = 5000
  ): Promise<T> {
    if (!this.automataChannel) {
      throw new Error('Not connected to automata channel');
    }

    return new Promise((resolve, reject) => {
      this.automataChannel!
        .push(command, payload, timeout)
        .receive('ok', (response) => resolve(response as T))
        .receive('error', (error) => reject(error))
        .receive('timeout', () => reject(new Error('Command timeout')));
    });
  }
  
  // Private: Status Management
  // ========================================================================
  
  private setStatus(status: GatewayStatus, error?: string): void {
    this.status = status;

    this.emit('onConnectionChange', status, error);
  }
  
  // Commands Implementation
  // ========================================================================
  
  /**
   * Ping command - test connectivity
   */
  async ping(): Promise<{ response: string; timestamp: string }> {
    const result = await this.sendCommand<{ response: string; timestamp: string }>('ping', {});
    return result;
  }
  
  /**
   * List devices command
   */
  async listDevicesCommand(): Promise<{ devices: Device[] }> {
    const result = await this.sendCommand<{ devices: any[] }>('list_devices', {});

    const normalized = this.consolidateDevices(result.devices.map((d) => this.normalizeDevice(d)));
    
    // Handle device removals: find devices that are no longer reported by the gateway
    const incomingIds = new Set(normalized.map(d => d.id));
    const prevIds = Array.from(this.devices.keys());
    const removedIds = prevIds.filter(id => !incomingIds.has(id));
    
    // Emit device status events for removed devices
    removedIds.forEach((id) => {
      const prev = this.devices.get(id);
      if (prev) {
        this.emit('onDeviceStatus', {
          deviceId: id,
          previousStatus: prev.status,
          currentStatus: 'offline',
          reason: 'Device not found in command response',
        });
        
        this.devices.delete(id);
      }
    });
    
    // Update devices map with current devices
    this.devices.clear();
    normalized.forEach((device) => {
      this.devices.set(device.id, device);
    });

    this.emit('onDeviceList', Array.from(this.devices.values()));

    return { devices: normalized };
  }
  
  /**
   * Restart device command
   */
  async restartDevice(deviceId: string): Promise<{ status: string }> {
    const result = await this.sendCommand<{ status: string }>('restart_device', {
      device_id: deviceId,
    });
    
    return result;
  }

  async listServersCommand(): Promise<{ servers: Server[] }> {
    const result = await this.sendCommand<{ servers: any[] }>('list_servers', {});

    const normalized = result.servers.map((s) => this.normalizeServer(s));
    
    // Handle server removals
    const incomingIds = new Set(normalized.map(s => s.id));
    const prevIds = Array.from(this.servers.keys());
    const removedIds = prevIds.filter(id => !incomingIds.has(id));
    
    // Emit server status events for removed servers
    removedIds.forEach((id) => {
      const prev = this.servers.get(id);
      if (prev) {
        this.emit('onServerStatus', {
          serverId: id,
          previousStatus: prev.status,
          currentStatus: 'disconnected',
          affectedDevices: prev.deviceIds,
        });
        
        this.servers.delete(id);
      }
    });
    
    // Update servers map
    normalized.forEach((server) => {
      // Update deviceIds using current devices map (create new object to avoid Immer freeze issues)
      const updatedServer = {
        ...server,
        deviceIds: Array.from(this.devices.values()).filter(d => d.serverId === server.id).map(d => d.id as any),
      };
      this.servers.set(updatedServer.id, updatedServer);
    });

    return { servers: normalized };
  }

  async listServers(): Promise<ServerListResponse> {
    const servers = Array.from(this.servers.values());

    // If there are no tracked servers, fall back to a default gateway server
    if (servers.length === 0) {
      const server: Server = {
        id: PhoenixGatewayService.DEFAULT_SERVER_ID,
        name: 'Gateway',
        description: 'Phoenix gateway (serverless mode)',
        address: this.config?.host ?? 'unknown',
        port: this.config?.port ?? 0,
        status: this.status === 'connected' ? 'connected' : 'disconnected',
        deviceIds: Array.from(this.devices.keys()) as any,
        maxDevices: 10_000,
        lastSeen: Date.now(),
        latency: 0,
        tags: [],
      };

      return {
        servers: [server],
        totalCount: 1,
      };
    }

    return {
      servers,
      totalCount: servers.length,
    };
  }

  async listRecentEvents(limit: number = 100): Promise<PersistedGatewayEvent[]> {
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 100;
    const result = await this.sendCommand<{ events?: PersistedGatewayEvent[] }>(
      'list_recent_events',
      { limit: safeLimit },
      5000
    );

    return Array.isArray(result.events) ? result.events : [];
  }

  async listEvents(cursor: number = 0, limit: number = 100): Promise<PersistedGatewayEvent[]> {
    const safeCursor = Number.isFinite(cursor) ? Math.max(0, Math.floor(cursor)) : 0;
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 100;
    const result = await this.sendCommand<{ events?: PersistedGatewayEvent[] }>(
      'list_events',
      { cursor: safeCursor, limit: safeLimit },
      5000
    );

    return Array.isArray(result.events) ? result.events : [];
  }
  
  async getServer(_serverId: ServerId): Promise<Server> {
    const server = this.servers.get(_serverId);
    if (!server) {
      // fall back to default
      const response = await this.listServers();
      return response.servers[0];
    }
    return server;
  }
  
  async listDevices(_serverId?: ServerId): Promise<DeviceListResponse> {
    // For now, use the list_devices command
    const result = await this.listDevicesCommand();

    let devices = result.devices;
    if (_serverId) {
      devices = devices.filter((d) => d.serverId === _serverId);
    }

    return {
      devices,
      totalCount: devices.length,
    };
  }
  
  async getDevice(deviceId: DeviceId): Promise<DeviceInfoResponse> {
    const device = this.devices.get(deviceId);
    
    if (!device) {
      throw new Error(`Device ${deviceId} not found`);
    }
    
    return {
      device,
    };
  }
  
  async discoverDevices(_serverId: ServerId): Promise<Device[]> {
    throw new Error('Not implemented yet - use Mock service');
  }
  
  async listAutomata(): Promise<AutomataListResponse> {
    const result = await this.sendAutomataCommand<{ automata: any[] }>('list_automata', {});

    const automata = (result.automata || []).map((a) => ({
      id: a.id,
      name: a.name,
      version: a.version ?? '1.0.0',
      tags: a.tags ?? [],
      deployedTo: [],
    }));

    return { automata, totalCount: automata.length };
  }
  
  async getAutomata(_automataId: AutomataId): Promise<AutomataGetResponse> {
    const result = await this.sendAutomataCommand<{ automata: any }>('get_automata', { id: _automataId });
    return { automata: result.automata as Automata };
  }
  
  async createAutomata(_automata: Omit<Automata, 'id'>): Promise<Automata> {
    // The gateway currently expects a simplified schema; pass through common fields.
    const payload: Record<string, any> = {
      name: (_automata as any).config?.name ?? (_automata as any).name ?? 'Untitled',
      description: (_automata as any).config?.description ?? (_automata as any).description,
      version: (_automata as any).config?.version ?? (_automata as any).version ?? '1.0.0',
      states: (_automata as any).states ?? {},
      transitions: (_automata as any).transitions ?? {},
      variables: (_automata as any).variables ?? [],
      inputs: (_automata as any).inputs ?? [],
      outputs: (_automata as any).outputs ?? [],
    };

    const result = await this.sendAutomataCommand<{ automata_id: string }>('create_automata', payload);

    return {
      ...(_automata as any),
      id: result.automata_id as any,
    } as Automata;
  }
  
  async updateAutomata(_automataId: AutomataId, _updates: Partial<Automata>): Promise<Automata> {
    await this.sendAutomataCommand('update_automata', { id: _automataId, ...(_updates as any) });
    const refreshed = await this.getAutomata(_automataId);
    return refreshed.automata;
  }
  
  async deleteAutomata(_automataId: AutomataId): Promise<boolean> {
    await this.sendAutomataCommand('delete_automata', { id: _automataId });
    return true;
  }

  async listConnections(): Promise<AutomataBinding[]> {
    const result = await this.sendAutomataCommand<{ connections?: Record<string, any>[] }>(
      'list_connections',
      {},
    );

    const connections = Array.isArray(result.connections)
      ? result.connections.map((entry) => this.normalizeConnection(entry))
      : [];

    this.emit('onConnectionList', { connections });
    return connections;
  }

  async createConnection(binding: ConnectionDraft): Promise<AutomataBinding> {
    const { response } = await this.sendAutomataCommandWithOutcome<{ connection_id?: string }>(
      'create_connection',
      {
        source_automata_id: binding.sourceAutomataId,
        source_output: binding.sourceOutputName,
        target_automata_id: binding.targetAutomataId,
        target_input: binding.targetInputName,
        transform: binding.transform,
        enabled: binding.enabled,
      },
      10_000,
    );

    const created: AutomataBinding = {
      ...binding,
      id: String(response.connection_id ?? this.makeId('conn')),
      createdAt: Date.now(),
      modifiedAt: Date.now(),
    };

    try {
      await this.listConnections();
    } catch (error) {
      console.warn('[Gateway] Failed to refresh connections after create:', error);
    }

    return created;
  }

  async deleteConnection(connectionId: string): Promise<void> {
    await this.sendAutomataCommandWithOutcome(
      'delete_connection',
      { id: connectionId },
      10_000,
    );

    try {
      await this.listConnections();
    } catch (error) {
      console.warn('[Gateway] Failed to refresh connections after delete:', error);
    }
  }
  
  async deployAutomata(
    _automataId: AutomataId,
    _deviceId: DeviceId,
    _options?: any
  ): Promise<DeployResponse> {
    const serverId = (this.devices.get(_deviceId)?.serverId ?? PhoenixGatewayService.DEFAULT_SERVER_ID) as any;
    const payload: Record<string, any> = {
      automata_id: _automataId,
      device_id: _deviceId,
      server_id: serverId,
    };

    if (_options?.automata) {
      payload.automata = _options.automata;
    }

    await this.sendAutomataCommandWithOutcome('deploy', payload, 15_000);

    return {
      deploymentId: `${_automataId}:${_deviceId}`,
      status: 'deployed',
      startedAt: Date.now(),
    } as any;
  }
  
  async undeployAutomata(_deviceId: DeviceId): Promise<ExecutionSnapshot | null> {
    await this.sendAutomataCommandWithOutcome(
      'stop_execution',
      { device_id: _deviceId },
      10_000
    );
    return null;
  }

  async setVariable(
    deviceId: DeviceId,
    name: string,
    value: unknown,
    target?: RuntimeCommandTarget,
  ): Promise<{ status: string }> {
    const { outcome } = await this.sendAutomataCommandWithOutcome(
      'set_variable',
      { ...this.buildCommandTargetPayload(deviceId, target), name, value },
      10_000
    );
    return { status: outcome.status };
  }

  async triggerEvent(
    deviceId: DeviceId,
    event: string,
    data?: unknown,
    target?: RuntimeCommandTarget,
  ): Promise<{ status: string }> {
    const payload: Record<string, any> = { ...this.buildCommandTargetPayload(deviceId, target), event };
    if (data !== undefined) payload.data = data;
    const { outcome } = await this.sendAutomataCommandWithOutcome('trigger_event', payload, 10_000);
    return { status: outcome.status };
  }

  async forceTransition(
    deviceId: DeviceId,
    toState: string,
    target?: RuntimeCommandTarget,
  ): Promise<{ status: string }> {
    const { outcome } = await this.sendAutomataCommandWithOutcome(
      'force_transition',
      { ...this.buildCommandTargetPayload(deviceId, target), to_state: toState },
      10_000
    );
    return { status: outcome.status };
  }

  async describeBlackBox(
    deviceId: DeviceId,
    target?: RuntimeCommandTarget,
  ): Promise<BlackBoxDescription> {
    const response = await this.sendAutomataCommand<{ black_box?: Record<string, any> }>(
      'black_box_describe',
      this.buildCommandTargetPayload(deviceId, target),
      10_000,
    );

    return this.normalizeBlackBoxDescription(response?.black_box ?? {});
  }

  async getBlackBoxSnapshot(
    deviceId: DeviceId,
    target?: RuntimeCommandTarget,
    options?: SnapshotRequestOptions,
  ): Promise<BlackBoxSnapshot> {
    const { outcome } = await this.sendAutomataCommandWithOutcome(
      'black_box_snapshot',
      this.buildCommandTargetPayload(deviceId, target),
      10_000,
    );

    const stateData =
      (outcome.data?.state as Record<string, any> | undefined) ??
      (target?.automataId ? { automata_id: target.automataId } : {});

    const normalized = this.normalizeBlackBoxSnapshot(deviceId, stateData);
    this.setCachedSnapshot(
      deviceId,
      { snapshot: this.buildSnapshot(deviceId, stateData) },
      target,
    );

    if (!options?.silent) {
      this.emit('onExecutionSnapshot', {
        deviceId,
        automataId: normalized.automataId ?? ('unknown' as AutomataId),
        snapshot: this.buildSnapshot(deviceId, stateData),
      });
    }

    return normalized;
  }

  async setBlackBoxInput(
    deviceId: DeviceId,
    port: string,
    value: unknown,
    target?: RuntimeCommandTarget,
  ): Promise<{ status: string }> {
    const { outcome } = await this.sendAutomataCommandWithOutcome(
      'black_box_set_input',
      { ...this.buildCommandTargetPayload(deviceId, target), port, value },
      10_000,
    );
    return { status: outcome.status };
  }

  async triggerBlackBoxEvent(
    deviceId: DeviceId,
    event: string,
    data?: unknown,
    target?: RuntimeCommandTarget,
  ): Promise<{ status: string }> {
    const payload: Record<string, any> = {
      ...this.buildCommandTargetPayload(deviceId, target),
      event,
    };

    if (data !== undefined) payload.data = data;

    const { outcome } = await this.sendAutomataCommandWithOutcome(
      'black_box_trigger_event',
      payload,
      10_000,
    );
    return { status: outcome.status };
  }

  async forceBlackBoxState(
    deviceId: DeviceId,
    state: string,
    target?: RuntimeCommandTarget,
  ): Promise<{ status: string }> {
    const { outcome } = await this.sendAutomataCommandWithOutcome(
      'black_box_force_state',
      { ...this.buildCommandTargetPayload(deviceId, target), state },
      10_000,
    );
    return { status: outcome.status };
  }
  
  async startExecution(_deviceId: DeviceId, target?: RuntimeCommandTarget): Promise<ExecutionStartResponse> {
    await this.sendAutomataCommandWithOutcome(
      'start_execution',
      this.buildCommandTargetPayload(_deviceId, target),
      10_000
    );
    const snapshot = this.buildBestEffortSnapshot(_deviceId, target);
    this.emitDeploymentStatusHint(_deviceId, 'running', target, snapshot);
    return { started: true, snapshot };
  }
  
  async stopExecution(_deviceId: DeviceId, target?: RuntimeCommandTarget): Promise<ExecutionStopResponse> {
    await this.sendAutomataCommandWithOutcome(
      'stop_execution',
      this.buildCommandTargetPayload(_deviceId, target),
      10_000
    );
    const snapshot = this.buildBestEffortSnapshot(_deviceId, target);
    this.emitDeploymentStatusHint(_deviceId, 'stopped', target, snapshot);
    return { stopped: true, finalSnapshot: snapshot };
  }
  
  async pauseExecution(_deviceId: DeviceId, target?: RuntimeCommandTarget): Promise<void> {
    await this.sendAutomataCommandWithOutcome(
      'pause_execution',
      this.buildCommandTargetPayload(_deviceId, target),
      10_000
    );
    this.emitDeploymentStatusHint(_deviceId, 'paused', target);
  }
  
  async resumeExecution(_deviceId: DeviceId, target?: RuntimeCommandTarget): Promise<void> {
    await this.sendAutomataCommandWithOutcome(
      'resume_execution',
      this.buildCommandTargetPayload(_deviceId, target),
      10_000
    );
    this.emitDeploymentStatusHint(_deviceId, 'running', target);
  }

  async resetExecution(_deviceId: DeviceId, target?: RuntimeCommandTarget): Promise<ExecutionResetResponse> {
    await this.sendAutomataCommandWithOutcome(
      'reset_execution',
      this.buildCommandTargetPayload(_deviceId, target),
      10_000
    );
    const snapshot = this.buildBestEffortSnapshot(_deviceId, target);
    this.emitDeploymentStatusHint(_deviceId, 'stopped', target, snapshot);
    return { reset: true, snapshot };
  }
  
  async stepExecution(
    _deviceId: DeviceId,
    _steps?: number,
    target?: RuntimeCommandTarget,
  ): Promise<ExecutionSnapshot[]> {
    const { outcome } = await this.sendAutomataCommandWithOutcome(
      'step_execution',
      { ...this.buildCommandTargetPayload(_deviceId, target), steps: _steps ?? 1 },
      10_000
    );

    const snapshots = (outcome.data?.snapshots as ExecutionSnapshot[] | undefined) ?? [];
    if (snapshots.length > 0) {
      return snapshots;
    }

    const snapshotResponse = await this.getSnapshot(_deviceId, target);
    return [snapshotResponse.snapshot];
  }
  
  async getSnapshot(
    _deviceId: DeviceId,
    target?: RuntimeCommandTarget,
    options?: SnapshotRequestOptions,
  ): Promise<ExecutionSnapshotResponse> {
    const cached = options?.bypassCache ? null : this.getCachedSnapshot(_deviceId, target);
    if (cached) {
      return cached;
    }

    const cacheKey = this.getSnapshotCacheKey(_deviceId, target);
    const inFlight = this.snapshotInFlight.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const fetchPromise = (async (): Promise<ExecutionSnapshotResponse> => {
      const { response, outcome } = await this.sendAutomataCommandWithOutcome(
        'request_state',
        this.buildCommandTargetPayload(_deviceId, target),
        10_000
      );

      const stateData =
        (outcome.data?.state as Record<string, any> | undefined) ??
        ((response as any)?.result?.state as Record<string, any> | undefined) ??
        ((response as any)?.state as Record<string, any> | undefined);

      const normalizedStateData =
        stateData || target?.automataId
          ? {
              ...(stateData ?? {}),
              ...(target?.automataId ? { automata_id: target.automataId } : null),
            }
          : undefined;

      const result = {
        snapshot: this.buildSnapshot(_deviceId, normalizedStateData),
      };
      const status =
        stateData?.running === true
          ? 'running'
          : stateData?.running === false
            ? 'stopped'
            : 'unknown';

      if (!options?.silent) {
        this.emit('onExecutionSnapshot', {
          deviceId: _deviceId,
          automataId: result.snapshot.automataId,
          snapshot: result.snapshot,
        });
        this.emitDeploymentStatusHint(_deviceId, status, target, result.snapshot);
      }
      this.setCachedSnapshot(_deviceId, result, target);
      return result;
    })();

    this.snapshotInFlight.set(cacheKey, fetchPromise);
    try {
      return await fetchPromise;
    } finally {
      this.snapshotInFlight.delete(cacheKey);
    }
  }
  
  async startTimeTravel(deviceId: DeviceId, options?: any): Promise<TimeTravelStartResponse> {
    const maxSnapshots = Number.isFinite(options?.maxSnapshots)
      ? Math.max(1, Math.floor(options.maxSnapshots))
      : 500;

    const { response, outcome } = await this.sendAutomataCommandWithOutcome(
      'time_travel_query',
      { device_id: deviceId, limit: maxSnapshots },
      15_000
    );

    const timeline =
      (outcome.data?.timeline as Record<string, any> | undefined) ??
      ((response as any)?.result?.timeline as Record<string, any> | undefined) ??
      ((response as any)?.timeline as Record<string, any> | undefined) ??
      {};
    const timelineSource =
      typeof timeline.source === 'string' ? timeline.source : 'unknown';
    const timelineBackendError =
      typeof timeline.backend_error === 'string' ? timeline.backend_error : undefined;

    const snapshotsRaw = Array.isArray(timeline.snapshots) ? timeline.snapshots : [];

    const snapshots: ExecutionSnapshot[] = snapshotsRaw.map((entry: any, index: number) => {
      const state = entry?.state ?? {};
      const timestamp = Number(entry?.timestamp ?? Date.now());
      const automataId =
        (state?.automata_id as AutomataId | undefined) ??
        (this.devices.get(String(deviceId))?.assignedAutomataId as AutomataId | undefined) ??
        ('unknown' as AutomataId);

      const variables = Object.entries(state?.variables ?? {}).reduce((acc, [name, value]) => {
        acc[name] = {
          name,
          value,
          type: this.inferVariableType(value),
          timestamp,
        };
        return acc;
      }, {} as ExecutionSnapshot['variables']);

      return {
        id: `${String(deviceId)}:tt:${entry?.snapshot_cursor ?? index}`,
        timestamp,
        automataId,
        deviceId,
        currentState: String(state?.current_state ?? 'unknown'),
        variables,
        inputs: this.buildSignalMap(state?.inputs, timestamp),
        outputs: this.buildSignalMap(state?.outputs, timestamp),
        executionCycle: Number(entry?.snapshot_cursor ?? index),
        ...(state?.error ? { errorState: String(state.error) } : {}),
      };
    });

    const latestSnapshot =
      snapshots[snapshots.length - 1] ?? (await this.getSnapshot(deviceId)).snapshot;

    const sessionId = this.makeId('tt');
    const session: TimeTravelSession = {
      id: sessionId,
      deviceId,
      automataId: latestSnapshot.automataId,
      startTime: Date.now(),
      history: {
        automataId: latestSnapshot.automataId,
        deviceId,
        snapshots: snapshots.length > 0 ? snapshots : [latestSnapshot],
        maxSnapshots,
        currentIndex: Math.max((snapshots.length > 0 ? snapshots.length : 1) - 1, 0),
      },
      bookmarks: [],
      isRecording: false,
      isReplaying: false,
      replaySpeed: 1,
      currentReplayIndex: Math.max((snapshots.length > 0 ? snapshots.length : 1) - 1, 0),
      timelineSource,
      timelineBackendError,
    };

    this.timeTravelSessions.set(sessionId, session);
    return { session };
  }
  
  async stopTimeTravel(sessionId: string): Promise<TimeTravelSession> {
    const session = this.timeTravelSessions.get(sessionId);
    if (!session) {
      throw new Error(`Time travel session not found: ${sessionId}`);
    }

    const updated: TimeTravelSession = {
      ...session,
      endTime: Date.now(),
      isReplaying: false,
      isRecording: false,
    };

    this.timeTravelSessions.set(sessionId, updated);
    return updated;
  }
  
  async navigateTimeTravel(sessionId: string, options: any): Promise<TimeTravelNavigateResponse> {
    const session = this.timeTravelSessions.get(sessionId);
    if (!session) {
      throw new Error(`Time travel session not found: ${sessionId}`);
    }

    const snapshots = session.history.snapshots;
    if (snapshots.length === 0) {
      throw new Error('Time travel session has no snapshots');
    }

    let targetIndex = session.currentReplayIndex;

    if (Number.isFinite(options?.targetIndex)) {
      targetIndex = Math.floor(Number(options.targetIndex));
    } else if (Number.isFinite(options?.targetTimestamp)) {
      const ts = Number(options.targetTimestamp);
      const found = snapshots.findIndex((snapshot) => snapshot.timestamp >= ts);
      targetIndex = found >= 0 ? found : snapshots.length - 1;
    } else if (options?.direction === 'backward') {
      const steps = Number.isFinite(options?.steps) ? Math.max(1, Math.floor(Number(options.steps))) : 1;
      targetIndex = targetIndex - steps;
    } else if (options?.direction === 'forward') {
      const steps = Number.isFinite(options?.steps) ? Math.max(1, Math.floor(Number(options.steps))) : 1;
      targetIndex = targetIndex + steps;
    }

    targetIndex = Math.max(0, Math.min(snapshots.length - 1, targetIndex));
    const snapshot = snapshots[targetIndex];

    const { outcome } = await this.sendAutomataCommandWithOutcome(
      'rewind_deployment',
      { device_id: session.deviceId, target_timestamp: snapshot.timestamp },
      15_000
    );

    const rewindSource =
      typeof outcome.data?.source === 'string'
        ? outcome.data.source
        : session.lastRewindSource;
    const rewindBackendError =
      typeof outcome.data?.backend_error === 'string'
        ? outcome.data.backend_error
        : undefined;
    const rewindEventsReplayed =
      typeof outcome.data?.events_replayed === 'number'
        ? outcome.data.events_replayed
        : undefined;
    const rewindRequestedTimestamp =
      typeof outcome.data?.requested_timestamp === 'number'
        ? outcome.data.requested_timestamp
        : undefined;
    const rewindStateFingerprint =
      typeof outcome.data?.state_fingerprint === 'string'
        ? outcome.data.state_fingerprint
        : undefined;
    const rewindEventCursorStart =
      typeof outcome.data?.event_cursor_start === 'number'
        ? outcome.data.event_cursor_start
        : undefined;
    const rewindEventCursorEnd =
      typeof outcome.data?.event_cursor_end === 'number'
        ? outcome.data.event_cursor_end
        : undefined;

    const updated: TimeTravelSession = {
      ...session,
      isReplaying: true,
      currentReplayIndex: targetIndex,
      lastRewindSource: rewindSource,
      lastRewindBackendError: rewindBackendError,
      lastRewindEventsReplayed: rewindEventsReplayed,
      lastRewindRequestedTimestamp: rewindRequestedTimestamp,
      lastRewindStateFingerprint: rewindStateFingerprint,
      lastRewindEventCursorStart: rewindEventCursorStart,
      lastRewindEventCursorEnd: rewindEventCursorEnd,
      history: {
        ...session.history,
        currentIndex: targetIndex,
      },
    };

    this.timeTravelSessions.set(sessionId, updated);

    return {
      currentIndex: targetIndex,
      snapshot,
      canGoForward: targetIndex < snapshots.length - 1,
      canGoBackward: targetIndex > 0,
      eventsReplayed: rewindEventsReplayed,
      requestedTimestamp: rewindRequestedTimestamp,
      stateFingerprint: rewindStateFingerprint,
      eventCursorStart: rewindEventCursorStart,
      eventCursorEnd: rewindEventCursorEnd,
    };
  }
  
  async createBookmark(sessionId: string, name: string, description?: string): Promise<void> {
    const session = this.timeTravelSessions.get(sessionId);
    if (!session) {
      throw new Error(`Time travel session not found: ${sessionId}`);
    }

    const bookmark = {
      id: this.makeId('tt_bookmark'),
      name,
      description,
      snapshotIndex: session.currentReplayIndex,
      timestamp: Date.now(),
      tags: [] as string[],
    };

    this.timeTravelSessions.set(sessionId, {
      ...session,
      bookmarks: [...session.bookmarks, bookmark],
    });
  }
  
  async subscribeToDevice(
    _deviceId: DeviceId,
    _subscriptions: string[]
  ): Promise<MonitorSubscribeResponse> {
    throw new Error('Not implemented yet - use Mock service');
  }
  
  async unsubscribeFromDevice(_subscriptionId: string): Promise<void> {
    throw new Error('Not implemented yet - use Mock service');
  }
  
  async prepareOTA(_deviceId: DeviceId, _targetVersion: string): Promise<any> {
    throw new Error('Not implemented yet - use Mock service');
  }
  
  async uploadOTA(_deviceId: DeviceId, _automata: Automata): Promise<string> {
    throw new Error('Not implemented yet - use Mock service');
  }
  
  async applyOTA(_deviceId: DeviceId, _uploadId: string, _options?: any): Promise<boolean> {
    throw new Error('Not implemented yet - use Mock service');
  }
  
  async rollbackOTA(_deviceId: DeviceId): Promise<boolean> {
    throw new Error('Not implemented yet - use Mock service');
  }
}
