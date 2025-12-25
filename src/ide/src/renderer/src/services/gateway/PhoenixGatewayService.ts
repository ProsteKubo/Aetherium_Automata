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
  ExecutionSnapshotResponse,
  TimeTravelStartResponse,
  TimeTravelNavigateResponse,
  MonitorSubscribeResponse,
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

// ============================================================================
// Phoenix Gateway Service
// ============================================================================

export class PhoenixGatewayService implements IGatewayService {
  private socket: Socket | null = null;
  private channel: Channel | null = null;
  private status: GatewayStatus = 'disconnected';
  private config: GatewayConfig | null = null;
  private sessionId: string | null = null;
  private eventHandlers: Map<keyof GatewayEventHandlers, Set<Function>> = new Map();
  
  // Logs and alerts storage
  private logs: LogEvent[] = [];
  private alerts: AlertEvent[] = [];
  private devices: Map<string, Device> = new Map();
  private servers: Map<string, Server> = new Map();

  private static readonly DEFAULT_SERVER_ID: ServerId = 'default_server' as ServerId;

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

  private normalizeDevice(raw: DeviceListEvent['devices'][number] | Record<string, any>): Device {
    const id = String((raw as any).id ?? (raw as any).device_id ?? (raw as any).deviceId);
    const status = ((raw as any).status ?? 'unknown') as Device['status'];

    const previous = this.devices.get(id);

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
    
    // Disconnect existing connection first
    if (this.socket || this.channel) {
      console.log('[Gateway] Disconnecting existing connection before reconnecting');
      await this.disconnect();
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
      });
      
      this.socket.onClose(() => {
        console.log('[Gateway] Socket closed');
        this.setStatus('disconnected');
      });
      
      // Connect socket
      this.socket.connect();
      
      // Join the control channel with token in payload
      const token = config.password || 'dev_secret_token';
      this.channel = this.socket.channel('gateway:control', { token });
      
      // Set up channel event handlers BEFORE joining
      this.setupChannelHandlers();
      
      // Join channel and wait for response
      return new Promise((resolve, reject) => {
        if (!this.channel) {
          reject(new Error('Channel not initialized'));
          return;
        }
        
        this.channel
          .join()
          .receive('ok', (response) => {
            console.log('[Gateway] Channel joined successfully', response);
            this.sessionId = response.session_id || `session_${Date.now()}`;
            this.setStatus('connected');
            
            resolve({
              sessionId: this.sessionId || '',
              gatewayVersion: '1.0.0',
              serverCount: 0,
              deviceCount: 0,
            });
          })
          .receive('error', (resp) => {
            console.error('[Gateway] Failed to join channel:', resp);
            this.setStatus('error', resp.reason || 'Authentication failed');
            
            reject(new Error(resp.reason || 'Failed to join channel'));
          })
          .receive('timeout', () => {
            console.error('[Gateway] Channel join timeout');
            this.setStatus('error', 'Connection timeout');
            
            reject(new Error('Connection timeout'));
          });
      });
    } catch (error) {
      console.error('[Gateway] Connection error:', error);
      this.setStatus('error', error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }
  
  async disconnect(): Promise<void> {
    if (this.channel) {
      this.channel.leave();
      this.channel = null;
    }
    
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    
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

      const normalized = payload.devices.map((d) => this.normalizeDevice(d));
      
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

      next.metrics = payload.metrics;
      this.devices.set(payload.device_id, next);

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

        // Update deviceIds using current devices map
        server.deviceIds = Array.from(this.devices.values()).filter(d => d.serverId === server.id).map(d => d.id as any);

        this.servers.set(server.id, server);

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

      // Update server deviceIds
      const server = this.servers.get(serverId as string);
      if (server) {
        server.deviceIds = Array.from(this.devices.values()).filter(d => d.serverId === serverId).map(d => d.id as any);
        this.servers.set(server.id, server);
      }

      // Emit updated device list for consumers to replace local caches
      this.emit('onDeviceList', Array.from(this.devices.values()));
    });
    
    // Automata state changes
    this.channel.on('automata_state_change', (payload: AutomataStateChangeEvent) => {
      console.log(`[Gateway] State change on ${payload.device_id}: ${payload.previous_state} -> ${payload.new_state}`);
      
      // Update device current state
      const device = this.devices.get(payload.device_id);
      if (device) {
        device.currentState = payload.new_state;
        this.devices.set(payload.device_id, device);
      }
      
      // TODO: Emit to UI handlers
    });
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

    const normalized = result.devices.map((d) => this.normalizeDevice(d));
    
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
      // Update deviceIds using current devices map
      server.deviceIds = Array.from(this.devices.values()).filter(d => d.serverId === server.id).map(d => d.id as any);
      this.servers.set(server.id, server);
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
    throw new Error('Not implemented yet - use Mock service');
  }
  
  async getAutomata(_automataId: AutomataId): Promise<AutomataGetResponse> {
    throw new Error('Not implemented yet - use Mock service');
  }
  
  async createAutomata(_automata: Omit<Automata, 'id'>): Promise<Automata> {
    throw new Error('Not implemented yet - use Mock service');
  }
  
  async updateAutomata(_automataId: AutomataId, _updates: Partial<Automata>): Promise<Automata> {
    throw new Error('Not implemented yet - use Mock service');
  }
  
  async deleteAutomata(_automataId: AutomataId): Promise<boolean> {
    throw new Error('Not implemented yet - use Mock service');
  }
  
  async deployAutomata(
    _automataId: AutomataId,
    _deviceId: DeviceId,
    _options?: any
  ): Promise<DeployResponse> {
    throw new Error('Not implemented yet - use Mock service');
  }
  
  async undeployAutomata(_deviceId: DeviceId): Promise<ExecutionSnapshot | null> {
    throw new Error('Not implemented yet - use Mock service');
  }
  
  async startExecution(_deviceId: DeviceId): Promise<ExecutionStartResponse> {
    throw new Error('Not implemented yet - use Mock service');
  }
  
  async stopExecution(_deviceId: DeviceId): Promise<ExecutionStopResponse> {
    throw new Error('Not implemented yet - use Mock service');
  }
  
  async pauseExecution(_deviceId: DeviceId): Promise<void> {
    throw new Error('Not implemented yet - use Mock service');
  }
  
  async resumeExecution(_deviceId: DeviceId): Promise<void> {
    throw new Error('Not implemented yet - use Mock service');
  }
  
  async stepExecution(_deviceId: DeviceId, _steps?: number): Promise<ExecutionSnapshot[]> {
    throw new Error('Not implemented yet - use Mock service');
  }
  
  async getSnapshot(_deviceId: DeviceId): Promise<ExecutionSnapshotResponse> {
    throw new Error('Not implemented yet - use Mock service');
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
