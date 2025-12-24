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
  private devices: Map<string, any> = new Map();
  
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
        const device = this.devices.get(payload.device_id);
        if (device) {
          if (payload.type === 'device_disconnect') {
            device.status = 'offline';
          } else if (payload.type === 'device_crash' || payload.type === 'lua_error') {
            device.status = 'error';
            device.error = payload.message;
          }
          this.devices.set(payload.device_id, device);
        }
      }
      
      // TODO: Emit to UI handlers
    });
    
    // Device list updates
    this.channel.on('device_list', (payload: DeviceListEvent) => {
      console.log('[Gateway] Device list update:', payload.devices);
      
      // Update internal device map
      payload.devices.forEach((device) => {
        this.devices.set(device.id, device);
      });
      
      // TODO: Emit to UI handlers
    });
    
    // Device telemetry
    this.channel.on('device_telemetry', (payload: DeviceTelemetryEvent) => {
      console.log(`[Gateway] Telemetry from ${payload.device_id}:`, payload.metrics);
      
      // Update device with latest metrics
      const device = this.devices.get(payload.device_id);
      if (device) {
        device.metrics = payload.metrics;
        device.last_seen = payload.timestamp;
        this.devices.set(payload.device_id, device);
      }
      
      // TODO: Emit to UI handlers
    });
    
    // Automata state changes
    this.channel.on('automata_state_change', (payload: AutomataStateChangeEvent) => {
      console.log(`[Gateway] State change on ${payload.device_id}: ${payload.previous_state} -> ${payload.new_state}`);
      
      // Update device current state
      const device = this.devices.get(payload.device_id);
      if (device) {
        device.current_state = payload.new_state;
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
    
    const handlers = this.eventHandlers.get('onConnectionChange');
    if (handlers) {
      handlers.forEach((handler) => {
        (handler as any)(status, error);
      });
    }
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
  async listDevicesCommand(): Promise<{ devices: any[] }> {
    const result = await this.sendCommand<{ devices: any[] }>('list_devices', {});
    
    // Update internal device map
    result.devices.forEach((device) => {
      this.devices.set(device.id, device);
    });
    
    return result;
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
  
  // Placeholder implementations for IGatewayService interface
  // ========================================================================
  // These will be implemented as the backend adds more commands
  
  async listServers(): Promise<ServerListResponse> {
    throw new Error('Not implemented yet - use Mock service');
  }
  
  async getServer(_serverId: ServerId): Promise<Server> {
    throw new Error('Not implemented yet - use Mock service');
  }
  
  async listDevices(_serverId?: ServerId): Promise<DeviceListResponse> {
    // For now, use the list_devices command
    const result = await this.listDevicesCommand();
    
    return {
      devices: result.devices.map((d) => ({
        id: d.id,
        name: d.id,
        status: d.status as any,
        serverId: 'default_server' as ServerId,
        address: 'unknown',
        port: 0,
        capabilities: [],
        engineVersion: 'unknown',
        tags: [],
      })),
      totalCount: result.devices.length,
    };
  }
  
  async getDevice(deviceId: DeviceId): Promise<DeviceInfoResponse> {
    const device = this.devices.get(deviceId);
    
    if (!device) {
      throw new Error(`Device ${deviceId} not found`);
    }
    
    return {
      device: {
        id: device.id,
        name: device.id,
        status: device.status,
        serverId: 'default_server' as ServerId,
        address: 'unknown',
        port: 0,
        capabilities: [],
        engineVersion: 'unknown',
        tags: [],
      },
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
