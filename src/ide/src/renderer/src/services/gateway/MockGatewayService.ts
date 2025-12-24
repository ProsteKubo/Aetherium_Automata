/**
 * Aetherium Automata - Mock Gateway Service
 * 
 * A mock implementation of the gateway service for development and testing.
 * Simulates device behavior, state changes, and time-travel debugging.
 */

import { v4 as uuid } from 'uuid';
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
  State,
  Transition,
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
// Mock Data Generation
// ============================================================================

function createMockState(id: string, index: number): State {
  return {
    id,
    name: id,
    inputs: [`input_${index}_1`, `input_${index}_2`],
    outputs: [`output_${index}_1`],
    variables: [`var_${index}`],
    code: `-- ${id} execution code\nlocal val = value("input_${index}_1")\nsetVal("var_${index}", val)\nemit("output_${index}_1", val * 2)`,
    hooks: {
      onEnter: `log("info", "Entering ${id}")`,
      onExit: `log("info", "Exiting ${id}")`,
    },
    isComposite: false,
    position: { x: 100 + (index % 3) * 250, y: 100 + Math.floor(index / 3) * 200 },
    description: `Mock state ${id}`,
  };
}

function createMockTransition(id: string, from: string, to: string): Transition {
  return {
    id,
    name: id,
    from,
    to,
    condition: `check("output_ready")`,
    body: `log("info", "Transitioning from ${from} to ${to}")`,
    priority: 0,
    weight: 1,
    description: `Transition from ${from} to ${to}`,
  };
}

function createMockAutomata(id: string, name: string): Automata {
  const states: Record<string, State> = {};
  const transitions: Record<string, Transition> = {};
  
  // Create 4 states
  const stateIds = ['Idle', 'Processing', 'Waiting', 'Complete'];
  stateIds.forEach((stateId, index) => {
    states[stateId] = createMockState(stateId, index);
  });
  
  // Create transitions
  transitions['t_idle_processing'] = createMockTransition('t_idle_processing', 'Idle', 'Processing');
  transitions['t_processing_waiting'] = createMockTransition('t_processing_waiting', 'Processing', 'Waiting');
  transitions['t_waiting_complete'] = createMockTransition('t_waiting_complete', 'Waiting', 'Complete');
  transitions['t_complete_idle'] = createMockTransition('t_complete_idle', 'Complete', 'Idle');
  transitions['t_processing_idle'] = createMockTransition('t_processing_idle', 'Processing', 'Idle');
  
  return {
    id,
    version: '0.0.1',
    config: {
      name,
      type: 'inline',
      language: 'lua',
      description: `Mock automata: ${name}`,
      tags: ['mock', 'demo'],
      version: '1.0.0',
    },
    initialState: 'Idle',
    states,
    transitions,
  };
}

function createMockDevice(id: string, name: string, serverId: ServerId): Device {
  return {
    id,
    name,
    description: `Mock device: ${name}`,
    serverId,
    address: `192.168.1.${Math.floor(Math.random() * 254) + 1}`,
    port: 8080,
    status: 'online',
    metrics: {
      cpuUsage: Math.random() * 100,
      memoryUsage: Math.random() * 100,
      networkLatency: Math.random() * 50,
      uptime: Math.floor(Math.random() * 86400000),
      executionCyclesPerSecond: Math.floor(Math.random() * 1000),
      lastHeartbeat: Date.now(),
    },
    capabilities: ['basic', 'fuzzy', 'probabilistic'],
    engineVersion: '1.0.0',
    tags: ['mock'],
  };
}

function createMockServer(id: string, name: string): Server {
  return {
    id,
    name,
    description: `Mock server: ${name}`,
    address: `server-${id}.aetherium.local`,
    port: 9090,
    status: 'connected',
    deviceIds: [],
    maxDevices: 100,
    lastSeen: Date.now(),
    latency: Math.random() * 100,
    region: 'local',
    tags: ['mock'],
  };
}

function createMockSnapshot(
  automataId: AutomataId,
  deviceId: DeviceId,
  currentState: string,
  cycle: number
): ExecutionSnapshot {
  return {
    id: uuid(),
    timestamp: Date.now(),
    automataId,
    deviceId,
    currentState,
    executionCycle: cycle,
    variables: {
      var_0: { name: 'var_0', value: Math.random() * 100, type: 'number', timestamp: Date.now() },
      var_1: { name: 'var_1', value: Math.random() * 100, type: 'number', timestamp: Date.now() },
    },
    inputs: {
      input_0_1: { name: 'input_0_1', value: Math.random() * 10, timestamp: Date.now() },
      input_0_2: { name: 'input_0_2', value: Math.random() > 0.5, timestamp: Date.now() },
    },
    outputs: {
      output_0_1: { name: 'output_0_1', value: Math.random() * 20, timestamp: Date.now() },
    },
  };
}

// ============================================================================
// Mock Gateway Service Implementation
// ============================================================================

export class MockGatewayService implements IGatewayService {
  private status: GatewayStatus = 'disconnected';
  private config: GatewayConfig | null = null;
  private sessionId: string | null = null;
  
  // Mock data stores
  private servers: Map<ServerId, Server> = new Map();
  private devices: Map<DeviceId, Device> = new Map();
  private automata: Map<AutomataId, Automata> = new Map();
  private deployments: Map<DeviceId, AutomataId> = new Map();
  private executions: Map<DeviceId, { running: boolean; cycle: number; currentState: string }> = new Map();
  private timeTravelSessions: Map<string, TimeTravelSession> = new Map();
  private subscriptions: Map<string, { deviceIds: DeviceId[]; subscriptions: string[] }> = new Map();
  
  // Event handlers
  private handlers: Partial<GatewayEventHandlers> = {};
  
  // Simulation intervals
  private simulationIntervals: Map<string, ReturnType<typeof setInterval>> = new Map();
  
  constructor() {
    this.initializeMockData();
  }
  
  private initializeMockData(): void {
    // Create mock servers
    const server1 = createMockServer('server-1', 'Primary Server');
    const server2 = createMockServer('server-2', 'Secondary Server');
    this.servers.set(server1.id, server1);
    this.servers.set(server2.id, server2);
    
    // Create mock devices
    for (let i = 1; i <= 5; i++) {
      const device = createMockDevice(`device-${i}`, `Device ${i}`, 'server-1');
      this.devices.set(device.id, device);
      server1.deviceIds.push(device.id);
    }
    for (let i = 6; i <= 8; i++) {
      const device = createMockDevice(`device-${i}`, `Device ${i}`, 'server-2');
      this.devices.set(device.id, device);
      server2.deviceIds.push(device.id);
    }
    
    // Create mock automata
    const automata1 = createMockAutomata('automata-1', 'Sensor Monitor');
    const automata2 = createMockAutomata('automata-2', 'Data Processor');
    const automata3 = createMockAutomata('automata-3', 'Control Loop');
    this.automata.set(automata1.id, automata1);
    this.automata.set(automata2.id, automata2);
    this.automata.set(automata3.id, automata3);
    
    // Deploy automata to some devices
    this.deployments.set('device-1', 'automata-1');
    this.deployments.set('device-2', 'automata-2');
    
    // Update device assignments
    const dev1 = this.devices.get('device-1');
    const dev2 = this.devices.get('device-2');
    if (dev1) dev1.assignedAutomataId = 'automata-1';
    if (dev2) dev2.assignedAutomataId = 'automata-2';
  }
  
  // ==========================================================================
  // Connection Management
  // ==========================================================================
  
  async connect(config: GatewayConfig): Promise<ConnectResponse> {
    this.config = config;
    this.status = 'connecting';
    this.handlers.onConnectionChange?.(this.status);
    
    // Simulate connection delay
    await this.delay(500);
    
    this.status = 'connected';
    this.sessionId = uuid();
    this.handlers.onConnectionChange?.(this.status);
    
    return {
      sessionId: this.sessionId,
      gatewayVersion: '1.0.0-mock',
      serverCount: this.servers.size,
      deviceCount: this.devices.size,
    };
  }
  
  async disconnect(): Promise<void> {
    // Stop all simulations
    this.simulationIntervals.forEach((interval) => clearInterval(interval));
    this.simulationIntervals.clear();
    
    this.status = 'disconnected';
    this.sessionId = null;
    this.handlers.onConnectionChange?.(this.status);
  }
  
  getStatus(): GatewayStatus {
    return this.status;
  }
  
  getConfig(): GatewayConfig | null {
    return this.config;
  }
  
  // ==========================================================================
  // Event Registration
  // ==========================================================================
  
  on<K extends keyof GatewayEventHandlers>(
    event: K,
    handler: NonNullable<GatewayEventHandlers[K]>
  ): () => void {
    this.handlers[event] = handler as GatewayEventHandlers[K];
    return () => {
      delete this.handlers[event];
    };
  }
  
  // ==========================================================================
  // Server Operations
  // ==========================================================================
  
  async listServers(): Promise<ServerListResponse> {
    await this.delay(100);
    return {
      servers: Array.from(this.servers.values()),
      totalCount: this.servers.size,
    };
  }
  
  async getServer(serverId: ServerId): Promise<Server> {
    await this.delay(50);
    const server = this.servers.get(serverId);
    if (!server) {
      throw new Error(`Server not found: ${serverId}`);
    }
    return server;
  }
  
  // ==========================================================================
  // Device Operations
  // ==========================================================================
  
  async listDevices(serverId?: ServerId): Promise<DeviceListResponse> {
    await this.delay(100);
    let devices = Array.from(this.devices.values());
    if (serverId) {
      devices = devices.filter((d) => d.serverId === serverId);
    }
    return {
      devices,
      totalCount: devices.length,
    };
  }
  
  async getDevice(deviceId: DeviceId): Promise<DeviceInfoResponse> {
    await this.delay(50);
    const device = this.devices.get(deviceId);
    if (!device) {
      throw new Error(`Device not found: ${deviceId}`);
    }
    
    const execution = this.executions.get(deviceId);
    const automataId = this.deployments.get(deviceId);
    let currentSnapshot: ExecutionSnapshot | undefined;
    
    if (execution && automataId) {
      currentSnapshot = createMockSnapshot(
        automataId,
        deviceId,
        execution.currentState,
        execution.cycle
      );
    }
    
    return { device, currentSnapshot };
  }
  
  async discoverDevices(serverId: ServerId): Promise<Device[]> {
    await this.delay(1000);
    // Simulate discovering a new device
    const newDevice = createMockDevice(
      `device-${uuid().slice(0, 8)}`,
      `Discovered Device ${Date.now()}`,
      serverId
    );
    this.devices.set(newDevice.id, newDevice);
    
    const server = this.servers.get(serverId);
    if (server) {
      server.deviceIds.push(newDevice.id);
    }
    
    return [newDevice];
  }
  
  // ==========================================================================
  // Automata Operations
  // ==========================================================================
  
  async listAutomata(): Promise<AutomataListResponse> {
    await this.delay(100);
    const automataList = Array.from(this.automata.values()).map((a) => ({
      id: a.id,
      name: a.config.name,
      version: a.config.version,
      tags: a.config.tags,
      deployedTo: Array.from(this.deployments.entries())
        .filter(([, automataId]) => automataId === a.id)
        .map(([deviceId]) => deviceId),
    }));
    
    return {
      automata: automataList,
      totalCount: automataList.length,
    };
  }
  
  async getAutomata(automataId: AutomataId): Promise<AutomataGetResponse> {
    await this.delay(50);
    const automata = this.automata.get(automataId);
    if (!automata) {
      throw new Error(`Automata not found: ${automataId}`);
    }
    return { automata };
  }
  
  async createAutomata(automata: Omit<Automata, 'id'>): Promise<Automata> {
    await this.delay(100);
    const newAutomata: Automata = {
      ...automata,
      id: `automata-${uuid().slice(0, 8)}`,
    };
    this.automata.set(newAutomata.id, newAutomata);
    return newAutomata;
  }
  
  async updateAutomata(automataId: AutomataId, updates: Partial<Automata>): Promise<Automata> {
    await this.delay(100);
    const existing = this.automata.get(automataId);
    if (!existing) {
      throw new Error(`Automata not found: ${automataId}`);
    }
    const updated = { ...existing, ...updates, id: automataId };
    this.automata.set(automataId, updated);
    return updated;
  }
  
  async deleteAutomata(automataId: AutomataId): Promise<boolean> {
    await this.delay(100);
    return this.automata.delete(automataId);
  }
  
  // ==========================================================================
  // Deployment Operations
  // ==========================================================================
  
  async deployAutomata(
    automataId: AutomataId,
    deviceId: DeviceId,
    options?: { persistState?: boolean; resetExecution?: boolean; enableMonitoring?: boolean }
  ): Promise<DeployResponse> {
    await this.delay(500);
    
    const automata = this.automata.get(automataId);
    const device = this.devices.get(deviceId);
    
    if (!automata) throw new Error(`Automata not found: ${automataId}`);
    if (!device) throw new Error(`Device not found: ${deviceId}`);
    
    const previousAutomataId = this.deployments.get(deviceId);
    this.deployments.set(deviceId, automataId);
    device.assignedAutomataId = automataId;
    device.deployedVersion = automata.config.version;
    
    // Initialize execution state
    if (!options?.persistState || !this.executions.has(deviceId)) {
      this.executions.set(deviceId, {
        running: false,
        cycle: 0,
        currentState: automata.initialState,
      });
    }
    
    return {
      success: true,
      deviceId,
      deployedVersion: automata.config.version,
      previousVersion: previousAutomataId 
        ? this.automata.get(previousAutomataId)?.config.version 
        : undefined,
    };
  }
  
  async undeployAutomata(deviceId: DeviceId): Promise<ExecutionSnapshot | null> {
    await this.delay(200);
    
    const device = this.devices.get(deviceId);
    const automataId = this.deployments.get(deviceId);
    const execution = this.executions.get(deviceId);
    
    if (!device) throw new Error(`Device not found: ${deviceId}`);
    
    let finalSnapshot: ExecutionSnapshot | null = null;
    if (automataId && execution) {
      finalSnapshot = createMockSnapshot(automataId, deviceId, execution.currentState, execution.cycle);
    }
    
    this.deployments.delete(deviceId);
    this.executions.delete(deviceId);
    device.assignedAutomataId = undefined;
    device.deployedVersion = undefined;
    
    // Stop simulation if running
    const intervalKey = `exec-${deviceId}`;
    if (this.simulationIntervals.has(intervalKey)) {
      clearInterval(this.simulationIntervals.get(intervalKey)!);
      this.simulationIntervals.delete(intervalKey);
    }
    
    return finalSnapshot;
  }
  
  // ==========================================================================
  // Execution Control
  // ==========================================================================
  
  async startExecution(deviceId: DeviceId): Promise<ExecutionStartResponse> {
    await this.delay(100);
    
    const execution = this.executions.get(deviceId);
    const automataId = this.deployments.get(deviceId);
    
    if (!execution || !automataId) {
      throw new Error(`No automata deployed to device: ${deviceId}`);
    }
    
    execution.running = true;
    
    // Start simulation
    this.startExecutionSimulation(deviceId);
    
    const snapshot = createMockSnapshot(automataId, deviceId, execution.currentState, execution.cycle);
    return { started: true, snapshot };
  }
  
  async stopExecution(deviceId: DeviceId): Promise<ExecutionStopResponse> {
    await this.delay(100);
    
    const execution = this.executions.get(deviceId);
    const automataId = this.deployments.get(deviceId);
    
    if (!execution || !automataId) {
      throw new Error(`No automata deployed to device: ${deviceId}`);
    }
    
    execution.running = false;
    
    // Stop simulation
    const intervalKey = `exec-${deviceId}`;
    if (this.simulationIntervals.has(intervalKey)) {
      clearInterval(this.simulationIntervals.get(intervalKey)!);
      this.simulationIntervals.delete(intervalKey);
    }
    
    const snapshot = createMockSnapshot(automataId, deviceId, execution.currentState, execution.cycle);
    return { stopped: true, finalSnapshot: snapshot };
  }
  
  async pauseExecution(deviceId: DeviceId): Promise<void> {
    await this.delay(50);
    const execution = this.executions.get(deviceId);
    if (execution) {
      execution.running = false;
    }
    
    const intervalKey = `exec-${deviceId}`;
    if (this.simulationIntervals.has(intervalKey)) {
      clearInterval(this.simulationIntervals.get(intervalKey)!);
      this.simulationIntervals.delete(intervalKey);
    }
  }
  
  async resumeExecution(deviceId: DeviceId): Promise<void> {
    await this.delay(50);
    const execution = this.executions.get(deviceId);
    if (execution) {
      execution.running = true;
      this.startExecutionSimulation(deviceId);
    }
  }
  
  async stepExecution(deviceId: DeviceId, steps = 1): Promise<ExecutionSnapshot[]> {
    await this.delay(100);
    
    const execution = this.executions.get(deviceId);
    const automataId = this.deployments.get(deviceId);
    const automata = automataId ? this.automata.get(automataId) : null;
    
    if (!execution || !automataId || !automata) {
      throw new Error(`No automata deployed to device: ${deviceId}`);
    }
    
    const snapshots: ExecutionSnapshot[] = [];
    const stateIds = Object.keys(automata.states);
    
    for (let i = 0; i < steps; i++) {
      execution.cycle++;
      // Simulate state transition (cycle through states)
      const currentIndex = stateIds.indexOf(execution.currentState);
      execution.currentState = stateIds[(currentIndex + 1) % stateIds.length];
      
      snapshots.push(createMockSnapshot(automataId, deviceId, execution.currentState, execution.cycle));
    }
    
    return snapshots;
  }
  
  async getSnapshot(deviceId: DeviceId): Promise<ExecutionSnapshotResponse> {
    await this.delay(50);
    
    const execution = this.executions.get(deviceId);
    const automataId = this.deployments.get(deviceId);
    
    if (!execution || !automataId) {
      throw new Error(`No automata deployed to device: ${deviceId}`);
    }
    
    const snapshot = createMockSnapshot(automataId, deviceId, execution.currentState, execution.cycle);
    return { snapshot };
  }
  
  private startExecutionSimulation(deviceId: DeviceId): void {
    const intervalKey = `exec-${deviceId}`;
    
    // Clear existing interval
    if (this.simulationIntervals.has(intervalKey)) {
      clearInterval(this.simulationIntervals.get(intervalKey)!);
    }
    
    const interval = setInterval(() => {
      const execution = this.executions.get(deviceId);
      const automataId = this.deployments.get(deviceId);
      const automata = automataId ? this.automata.get(automataId) : null;
      
      if (!execution?.running || !automata || !automataId) {
        return;
      }
      
      execution.cycle++;
      
      // Randomly transition states
      if (Math.random() > 0.7) {
        const stateIds = Object.keys(automata.states);
        const currentIndex = stateIds.indexOf(execution.currentState);
        const previousState = execution.currentState;
        execution.currentState = stateIds[(currentIndex + 1) % stateIds.length];
        
        // Emit transition event
        this.handlers.onExecutionTransition?.({
          deviceId,
          automataId,
          fromState: previousState,
          toState: execution.currentState,
          transitionId: `t_${previousState}_${execution.currentState}`,
          timestamp: Date.now(),
          variables: {},
        });
      }
      
      // Emit snapshot event
      const snapshot = createMockSnapshot(automataId, deviceId, execution.currentState, execution.cycle);
      this.handlers.onExecutionSnapshot?.({
        deviceId,
        automataId,
        snapshot,
      });
      
      // Update device metrics
      const device = this.devices.get(deviceId);
      if (device && device.metrics) {
        device.metrics.cpuUsage = Math.random() * 100;
        device.metrics.memoryUsage = 30 + Math.random() * 40;
        device.metrics.lastHeartbeat = Date.now();
        device.metrics.executionCyclesPerSecond = 50 + Math.floor(Math.random() * 50);
        
        this.handlers.onDeviceMetrics?.({
          deviceId,
          metrics: device.metrics,
        });
      }
    }, 1000);
    
    this.simulationIntervals.set(intervalKey, interval);
  }
  
  // ==========================================================================
  // Time Travel
  // ==========================================================================
  
  async startTimeTravel(
    deviceId: DeviceId,
    options?: { maxSnapshots?: number; captureInterval?: number }
  ): Promise<TimeTravelStartResponse> {
    await this.delay(100);
    
    const automataId = this.deployments.get(deviceId);
    if (!automataId) {
      throw new Error(`No automata deployed to device: ${deviceId}`);
    }
    
    const session: TimeTravelSession = {
      id: uuid(),
      deviceId,
      automataId,
      startTime: Date.now(),
      history: {
        automataId,
        deviceId,
        snapshots: [],
        maxSnapshots: options?.maxSnapshots || 1000,
        currentIndex: -1,
      },
      bookmarks: [],
      isRecording: true,
      isReplaying: false,
      replaySpeed: 1,
      currentReplayIndex: 0,
    };
    
    this.timeTravelSessions.set(session.id, session);
    
    // Start capturing snapshots
    const intervalKey = `tt-${session.id}`;
    const interval = setInterval(() => {
      const execution = this.executions.get(deviceId);
      if (!execution) return;
      
      const snapshot = createMockSnapshot(automataId, deviceId, execution.currentState, execution.cycle);
      session.history.snapshots.push(snapshot);
      session.history.currentIndex = session.history.snapshots.length - 1;
      
      // Limit snapshots
      if (session.history.snapshots.length > session.history.maxSnapshots) {
        session.history.snapshots.shift();
        session.history.currentIndex--;
      }
    }, options?.captureInterval || 500);
    
    this.simulationIntervals.set(intervalKey, interval);
    
    return { session };
  }
  
  async stopTimeTravel(sessionId: string): Promise<TimeTravelSession> {
    await this.delay(50);
    
    const session = this.timeTravelSessions.get(sessionId);
    if (!session) {
      throw new Error(`Time travel session not found: ${sessionId}`);
    }
    
    session.isRecording = false;
    session.endTime = Date.now();
    
    // Stop capturing
    const intervalKey = `tt-${sessionId}`;
    if (this.simulationIntervals.has(intervalKey)) {
      clearInterval(this.simulationIntervals.get(intervalKey)!);
      this.simulationIntervals.delete(intervalKey);
    }
    
    return session;
  }
  
  async navigateTimeTravel(
    sessionId: string,
    options: {
      targetIndex?: number;
      targetTimestamp?: number;
      direction?: 'forward' | 'backward';
      steps?: number;
    }
  ): Promise<TimeTravelNavigateResponse> {
    await this.delay(50);
    
    const session = this.timeTravelSessions.get(sessionId);
    if (!session) {
      throw new Error(`Time travel session not found: ${sessionId}`);
    }
    
    const history = session.history;
    let newIndex = history.currentIndex;
    
    if (options.targetIndex !== undefined) {
      newIndex = Math.max(0, Math.min(options.targetIndex, history.snapshots.length - 1));
    } else if (options.direction && options.steps) {
      const delta = options.direction === 'forward' ? options.steps : -options.steps;
      newIndex = Math.max(0, Math.min(newIndex + delta, history.snapshots.length - 1));
    } else if (options.targetTimestamp !== undefined) {
      // Find closest snapshot to target timestamp
      let closestIndex = 0;
      let closestDiff = Math.abs(history.snapshots[0]?.timestamp - options.targetTimestamp);
      for (let i = 1; i < history.snapshots.length; i++) {
        const diff = Math.abs(history.snapshots[i].timestamp - options.targetTimestamp);
        if (diff < closestDiff) {
          closestDiff = diff;
          closestIndex = i;
        }
      }
      newIndex = closestIndex;
    }
    
    history.currentIndex = newIndex;
    
    return {
      currentIndex: newIndex,
      snapshot: history.snapshots[newIndex],
      canGoForward: newIndex < history.snapshots.length - 1,
      canGoBackward: newIndex > 0,
    };
  }
  
  async createBookmark(sessionId: string, name: string, description?: string): Promise<void> {
    await this.delay(50);
    
    const session = this.timeTravelSessions.get(sessionId);
    if (!session) {
      throw new Error(`Time travel session not found: ${sessionId}`);
    }
    
    session.bookmarks.push({
      id: uuid(),
      name,
      description,
      snapshotIndex: session.history.currentIndex,
      timestamp: Date.now(),
      tags: [],
    });
  }
  
  // ==========================================================================
  // Monitoring
  // ==========================================================================
  
  async subscribeToDevice(
    deviceId: DeviceId,
    subscriptions: string[]
  ): Promise<MonitorSubscribeResponse> {
    await this.delay(50);
    
    const subscriptionId = uuid();
    this.subscriptions.set(subscriptionId, {
      deviceIds: [deviceId],
      subscriptions,
    });
    
    return {
      subscriptionId,
      activeSubscriptions: subscriptions,
    };
  }
  
  async unsubscribeFromDevice(subscriptionId: string): Promise<void> {
    await this.delay(50);
    this.subscriptions.delete(subscriptionId);
  }
  
  // ==========================================================================
  // OTA Updates
  // ==========================================================================
  
  async prepareOTA(
    deviceId: DeviceId,
    _targetVersion: string
  ): Promise<{ ready: boolean; estimatedDuration: number }> {
    await this.delay(200);
    
    const device = this.devices.get(deviceId);
    if (!device) {
      throw new Error(`Device not found: ${deviceId}`);
    }
    
    return {
      ready: true,
      estimatedDuration: 5000,
    };
  }
  
  async uploadOTA(_deviceId: DeviceId, _automata: Automata): Promise<string> {
    await this.delay(1000);
    return uuid();
  }
  
  async applyOTA(
    _deviceId: DeviceId,
    _uploadId: string,
    _options?: { preserveState?: boolean; rollbackOnError?: boolean }
  ): Promise<boolean> {
    await this.delay(2000);
    return true;
  }
  
  async rollbackOTA(_deviceId: DeviceId): Promise<boolean> {
    await this.delay(1000);
    return true;
  }
  
  // ==========================================================================
  // Utility
  // ==========================================================================
  
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
