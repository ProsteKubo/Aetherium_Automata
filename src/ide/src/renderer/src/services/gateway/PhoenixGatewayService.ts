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
  ExecutionResetResponse,
  ExecutionSnapshotResponse,
  TimeTravelStartResponse,
  TimeTravelNavigateResponse,
  MonitorSubscribeResponse,
  CommandOutcomeEvent,
} from '../../types/protocol';
import type { IGatewayService, GatewayEventHandlers } from './IGatewayService';

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
  type: 'device_crash' | 'device_disconnect' | 'lua_error' | 'device_restarted' | 'network_collapse';
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
  private pendingCommandOutcomes: Map<string, PendingCommandOutcome> = new Map();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private manualDisconnect = false;

  private static readonly DEFAULT_SERVER_ID: ServerId = 'default_server' as ServerId;
  private static readonly RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000];

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
    if (this.manualDisconnect || !this.config || this.reconnectTimer) {
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

      this.connect(this.config).catch((error) => {
        console.error('[Gateway] Reconnect attempt failed:', error);
      });
    }, delay);
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

  private inferVariableType(value: unknown): 'number' | 'string' | 'bool' | 'any' | 'table' {
    if (typeof value === 'number') return 'number';
    if (typeof value === 'string') return 'string';
    if (typeof value === 'boolean') return 'bool';
    if (value !== null && typeof value === 'object') return 'table';
    return 'any';
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
      inputs: {},
      outputs: {},
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
  
  // Connection Management
  // ========================================================================
  
  async connect(config: GatewayConfig): Promise<ConnectResponse> {
    // Validate config
    if (!config.host || !config.port) {
      throw new Error('Invalid gateway config: host and port are required');
    }

    this.manualDisconnect = false;
    this.clearReconnectTimer();
    
    // Disconnect existing connection first
    if (this.socket || this.channel || this.automataChannel) {
      console.log('[Gateway] Disconnecting existing connection before reconnecting');
      await this.disconnect();
      this.manualDisconnect = false;
    }
    
    this.config = config;
    this.setStatus('connecting');
    
    try {
      // Create Phoenix socket
      // URL format: ws://192.168.1.100:4000/socket
      const socketUrl = `ws://${config.host}:${config.port}/socket`;
      console.log('[Gateway] Connecting to:', socketUrl);
      
      this.socket = new Socket(socketUrl, {
        params: { token: config.password || 'dev_secret_token' },
        timeout: 10000,
        reconnectAfterMs: (tries) => {
          // Exponential backoff: 1s, 2s, 5s, 10s, then 10s
          return [1000, 2000, 5000, 10000][tries - 1] || 10000;
        },
      });
      
      // Socket-level event handlers
      this.socket.onOpen(() => {
        console.log('[Gateway] Socket opened');
      });
      
      this.socket.onError((error) => {
        console.error('[Gateway] Socket error:', error);
        this.setStatus('error', 'Socket connection error');
        this.scheduleReconnect('socket_error');
      });
      
      this.socket.onClose(() => {
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
        console.error('[Gateway] gateway:control channel error');
        this.setStatus('error', 'gateway:control channel error');
        this.scheduleReconnect('gateway_channel_error');
      });

      this.channel.onClose(() => {
        console.warn('[Gateway] gateway:control channel closed');
        this.scheduleReconnect('gateway_channel_closed');
      });

      this.automataChannel.onError(() => {
        console.error('[Gateway] automata:control channel error');
        this.setStatus('error', 'automata:control channel error');
        this.scheduleReconnect('automata_channel_error');
      });

      this.automataChannel.onClose(() => {
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
      this.setStatus('error', error instanceof Error ? error.message : 'Unknown error');
      this.scheduleReconnect('connect_failed');
      throw error;
    }
  }
  
  async disconnect(): Promise<void> {
    this.manualDisconnect = true;
    this.clearReconnectTimer();
    this.reconnectAttempts = 0;

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
    
    this.setStatus('disconnected');
    this.sessionId = null;
    this.config = null;
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
    
    // Alert events
    this.channel.on('alert', (payload: AlertEvent) => {
      console.warn(`[Gateway Alert] ${payload.type}: ${payload.message}`);
      this.alerts.push(payload);
      
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
      console.log('[Gateway] Device list update:', payload.devices);

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

        const device = this.devices.get(deviceId);
        if (device) {
          const automataId = payload.automata_id ?? payload.automataId;
          const currentState = payload.current_state ?? payload.currentState;
          // Create new object to avoid mutating frozen Immer objects
          this.devices.set(deviceId, {
            ...device,
            ...(automataId ? { assignedAutomataId: automataId } : {}),
            ...(currentState ? { currentState } : {}),
          });
          this.emit('onDeviceList', Array.from(this.devices.values()));
        }
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
  
  async deployAutomata(
    _automataId: AutomataId,
    _deviceId: DeviceId,
    _options?: any
  ): Promise<DeployResponse> {
    const device = this.devices.get(_deviceId);
    const serverId = (device?.serverId ?? PhoenixGatewayService.DEFAULT_SERVER_ID) as any;
    const payload: Record<string, any> = {
      automata_id: _automataId,
      device_id: _deviceId,
      server_id: serverId,
    };

    if (_options?.automata) {
      payload.automata = _options.automata;
    }

    await this.sendAutomataCommandWithOutcome('deploy', payload, 15_000);

    if (device) {
      // Create new object to avoid mutating frozen Immer objects
      this.devices.set(_deviceId, { ...device, assignedAutomataId: _automataId });
      this.emit('onDeviceList', Array.from(this.devices.values()));
    }

    return {
      deploymentId: `${_automataId}:${_deviceId}`,
      status: 'deployed',
      startedAt: Date.now(),
    } as any;
  }
  
  async undeployAutomata(_deviceId: DeviceId): Promise<ExecutionSnapshot | null> {
    const device = this.devices.get(String(_deviceId));
    await this.sendAutomataCommandWithOutcome(
      'stop_execution',
      {
        device_id: _deviceId,
        ...(device?.assignedAutomataId ? { automata_id: device.assignedAutomataId } : {}),
        ...(device?.serverId ? { server_id: device.serverId } : {}),
      },
      10_000
    );
    return null;
  }

  async setVariable(deviceId: DeviceId, name: string, value: unknown): Promise<{ status: string }> {
    const { outcome } = await this.sendAutomataCommandWithOutcome(
      'set_variable',
      { device_id: deviceId, name, value },
      10_000
    );
    return { status: outcome.status };
  }

  async triggerEvent(deviceId: DeviceId, event: string, data?: unknown): Promise<{ status: string }> {
    const payload: Record<string, any> = { device_id: deviceId, event };
    if (data !== undefined) payload.data = data;
    const { outcome } = await this.sendAutomataCommandWithOutcome('trigger_event', payload, 10_000);
    return { status: outcome.status };
  }

  async forceTransition(deviceId: DeviceId, toState: string): Promise<{ status: string }> {
    const { outcome } = await this.sendAutomataCommandWithOutcome(
      'force_transition',
      { device_id: deviceId, to_state: toState },
      10_000
    );
    return { status: outcome.status };
  }
  
  async startExecution(_deviceId: DeviceId): Promise<ExecutionStartResponse> {
    const device = this.devices.get(String(_deviceId));
    await this.sendAutomataCommandWithOutcome(
      'start_execution',
      {
        device_id: _deviceId,
        ...(device?.assignedAutomataId ? { automata_id: device.assignedAutomataId } : {}),
        ...(device?.serverId ? { server_id: device.serverId } : {}),
      },
      10_000
    );
    const snapshotResponse = await this.getSnapshot(_deviceId);
    return { started: true, snapshot: snapshotResponse.snapshot };
  }
  
  async stopExecution(_deviceId: DeviceId): Promise<ExecutionStopResponse> {
    const device = this.devices.get(String(_deviceId));
    await this.sendAutomataCommandWithOutcome(
      'stop_execution',
      {
        device_id: _deviceId,
        ...(device?.assignedAutomataId ? { automata_id: device.assignedAutomataId } : {}),
        ...(device?.serverId ? { server_id: device.serverId } : {}),
      },
      10_000
    );
    const snapshotResponse = await this.getSnapshot(_deviceId);
    return { stopped: true, finalSnapshot: snapshotResponse.snapshot };
  }
  
  async pauseExecution(_deviceId: DeviceId): Promise<void> {
    const device = this.devices.get(String(_deviceId));
    await this.sendAutomataCommandWithOutcome(
      'pause_execution',
      {
        device_id: _deviceId,
        ...(device?.assignedAutomataId ? { automata_id: device.assignedAutomataId } : {}),
        ...(device?.serverId ? { server_id: device.serverId } : {}),
      },
      10_000
    );
  }
  
  async resumeExecution(_deviceId: DeviceId): Promise<void> {
    const device = this.devices.get(String(_deviceId));
    await this.sendAutomataCommandWithOutcome(
      'resume_execution',
      {
        device_id: _deviceId,
        ...(device?.assignedAutomataId ? { automata_id: device.assignedAutomataId } : {}),
        ...(device?.serverId ? { server_id: device.serverId } : {}),
      },
      10_000
    );
  }

  async resetExecution(_deviceId: DeviceId): Promise<ExecutionResetResponse> {
    const device = this.devices.get(String(_deviceId));
    await this.sendAutomataCommandWithOutcome(
      'reset_execution',
      {
        device_id: _deviceId,
        ...(device?.assignedAutomataId ? { automata_id: device.assignedAutomataId } : {}),
        ...(device?.serverId ? { server_id: device.serverId } : {}),
      },
      10_000
    );
    const snapshotResponse = await this.getSnapshot(_deviceId);
    return { reset: true, snapshot: snapshotResponse.snapshot };
  }
  
  async stepExecution(_deviceId: DeviceId, _steps?: number): Promise<ExecutionSnapshot[]> {
    const { outcome } = await this.sendAutomataCommandWithOutcome(
      'step_execution',
      { device_id: _deviceId, steps: _steps ?? 1 },
      10_000
    );

    const snapshots = (outcome.data?.snapshots as ExecutionSnapshot[] | undefined) ?? [];
    if (snapshots.length > 0) {
      return snapshots;
    }

    const snapshotResponse = await this.getSnapshot(_deviceId);
    return [snapshotResponse.snapshot];
  }
  
  async getSnapshot(_deviceId: DeviceId): Promise<ExecutionSnapshotResponse> {
    const device = this.devices.get(String(_deviceId));
    const { response, outcome } = await this.sendAutomataCommandWithOutcome(
      'request_state',
      {
        device_id: _deviceId,
        ...(device?.assignedAutomataId ? { automata_id: device.assignedAutomataId } : {}),
        ...(device?.serverId ? { server_id: device.serverId } : {}),
      },
      10_000
    );

    const stateData =
      (outcome.data?.state as Record<string, any> | undefined) ??
      ((response as any)?.result?.state as Record<string, any> | undefined) ??
      ((response as any)?.state as Record<string, any> | undefined);

    return {
      snapshot: this.buildSnapshot(_deviceId, stateData),
    };
  }
  
  async startTimeTravel(_deviceId: DeviceId, _options?: any): Promise<TimeTravelStartResponse> {
    throw new Error('Not implemented yet - use Mock service');
  }
  
  async stopTimeTravel(_sessionId: string): Promise<TimeTravelSession> {
    throw new Error('Not implemented yet - use Mock service');
  }
  
  async navigateTimeTravel(_sessionId: string, _options: any): Promise<TimeTravelNavigateResponse> {
    throw new Error('Not implemented yet - use Mock service');
  }
  
  async createBookmark(_sessionId: string, _name: string, _description?: string): Promise<void> {
    throw new Error('Not implemented yet - use Mock service');
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
