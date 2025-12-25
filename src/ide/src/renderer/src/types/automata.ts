/**
 * Aetherium Automata - Core Automata Type Definitions
 * 
 * These types define the structure of automata as per the YAML spec,
 * with additional runtime and editor state information.
 */

// ============================================================================
// Base Identifiers
// ============================================================================

export type StateId = string;
export type TransitionId = string;
export type InputId = string;
export type OutputId = string;
export type VariableId = string;
export type AutomataId = string;
export type DeviceId = string;
export type ServerId = string;

// ============================================================================
// Variable Definitions
// ============================================================================

export type VariableType = 'number' | 'string' | 'bool' | 'any' | 'table';

export interface VariableDefinition {
  name: VariableId;
  type: VariableType;
  initial?: unknown;
  description?: string;
}

export type VariableSpec = VariableId | VariableDefinition;

// ============================================================================
// Fuzzy Logic Support
// ============================================================================

export interface FuzzySet {
  name: string;
  type: 'triangular' | 'trapezoidal' | 'gaussian' | 'sigmoid';
  parameters: number[];
}

export interface FuzzyVariable {
  name: string;
  universe: [number, number]; // min, max range
  sets: FuzzySet[];
}

export interface FuzzyRule {
  antecedents: Array<{ variable: string; set: string; operator?: 'AND' | 'OR' }>;
  consequent: { variable: string; set: string };
  weight?: number;
}

export interface FuzzyGuard {
  enabled: boolean;
  variables: FuzzyVariable[];
  rules: FuzzyRule[];
  defuzzificationMethod: 'centroid' | 'bisector' | 'mom' | 'som' | 'lom';
}

// ============================================================================
// Probabilistic Transitions (Markov-like)
// ============================================================================

export interface ProbabilisticWeight {
  enabled: boolean;
  weight: number;
  condition?: string; // Optional Lua condition
}

// ============================================================================
// State Definition
// ============================================================================

export interface StateHooks {
  onEnter?: string;   // Lua code
  onExit?: string;    // Lua code
  onTick?: string;    // Lua code - called each execution cycle
  onError?: string;   // Lua code - error handling
}

export interface State {
  id: StateId;
  name: string;
  inputs: InputId[];
  outputs: OutputId[];
  variables: VariableSpec[];
  code: string;        // Main Lua code body
  hooks: StateHooks;
  
  // Nested automata support (Petri-net like composition)
  nestedAutomata?: AutomataId;
  isComposite: boolean;
  
  // Visual editor metadata
  position: { x: number; y: number };
  color?: string;
  description?: string;
  
  // Runtime state
  isActive?: boolean;
  executionCount?: number;
  lastExecutedAt?: number;
}

// ============================================================================
// Transition Definition
// ============================================================================

export interface Transition {
  id: TransitionId;
  name: string;
  from: StateId;
  to: StateId;
  
  // Condition and execution
  condition: string;         // Lua code returning boolean
  body: string;              // Lua code executed on transition
  triggered?: string;        // Optional callback after transition
  
  // Priority and probabilistic selection
  priority: number;          // Lower = higher priority
  weight: number;            // For probabilistic selection among equal priority
  probabilistic?: ProbabilisticWeight;
  
  // Fuzzy logic guard
  fuzzyGuard?: FuzzyGuard;
  
  // Visual metadata
  label?: string;
  color?: string;
  description?: string;
  pathOffset?: number;
  controlPoint?: { x: number; y: number };
  
  // Runtime state
  fireCount?: number;
  lastFiredAt?: number;
}

// ============================================================================
// Automata Configuration
// ============================================================================

export type AutomataLayoutType = 'inline' | 'folder';

export interface AutomataConfig {
  name: string;
  type: AutomataLayoutType;
  location?: string;        // For folder layout
  language: 'lua';          // Currently only Lua supported
  description?: string;
  tags: string[];
  author?: string;
  version: string;
  created?: number;
  modified?: number;
}

// ============================================================================
// Complete Automata Definition
// ============================================================================

export interface Automata {
  id: AutomataId;
  version: string;          // Spec version
  config: AutomataConfig;
  
  initialState: StateId;
  states: Record<StateId, State>;
  transitions: Record<TransitionId, Transition>;
  
  // Global inputs/outputs (for nested automata interface)
  inputs?: InputId[];
  outputs?: OutputId[];
  
  // Nested automata references
  nestedAutomataIds?: AutomataId[];
  parentAutomataId?: AutomataId;
  
  // Metadata
  isTemplate?: boolean;
  isDirty?: boolean;
  filePath?: string;
}

// ============================================================================
// Execution State (Runtime)
// ============================================================================

export interface VariableValue {
  name: VariableId;
  value: unknown;
  type: VariableType;
  timestamp: number;
}

export interface SignalValue {
  name: string;
  value: unknown;
  timestamp: number;
}

export interface ExecutionSnapshot {
  id: string;
  timestamp: number;
  automataId: AutomataId;
  deviceId: DeviceId;
  
  currentState: StateId;
  previousState?: StateId;
  lastTransition?: TransitionId;
  
  variables: Record<VariableId, VariableValue>;
  inputs: Record<InputId, SignalValue>;
  outputs: Record<OutputId, SignalValue>;
  
  executionCycle: number;
  errorState?: string;
}

export interface ExecutionHistory {
  automataId: AutomataId;
  deviceId: DeviceId;
  snapshots: ExecutionSnapshot[];
  maxSnapshots: number;
  currentIndex: number;
}

// ============================================================================
// Time Travel Debugging
// ============================================================================

export interface TimeTravelBookmark {
  id: string;
  name: string;
  description?: string;
  snapshotIndex: number;
  timestamp: number;
  tags: string[];
}

export interface TimeTravelSession {
  id: string;
  deviceId: DeviceId;
  automataId: AutomataId;
  startTime: number;
  endTime?: number;
  history: ExecutionHistory;
  bookmarks: TimeTravelBookmark[];
  isRecording: boolean;
  isReplaying: boolean;
  replaySpeed: number;
  currentReplayIndex: number;
}

// ============================================================================
// Device Types
// ============================================================================

export type DeviceStatus = 'online' | 'offline' | 'error' | 'updating' | 'unknown';
export type DeviceCapability = 'basic' | 'fuzzy' | 'probabilistic' | 'nested' | 'full';

export interface DeviceMetrics {
  cpuUsage: number;
  memoryUsage: number;
  networkLatency: number;
  uptime: number;
  executionCyclesPerSecond: number;
  lastHeartbeat: number;
}

export interface Device {
  id: DeviceId;
  name: string;
  description?: string;
  
  // Connection info
  serverId: ServerId;
  address: string;
  port: number;
  
  // Status
  status: DeviceStatus;
  metrics?: Partial<DeviceMetrics> & Record<string, any>;
  lastSeen?: string;
  temperature?: number | null;
  error?: string | null;
  
  // Capabilities
  capabilities: DeviceCapability[];
  engineVersion: string;
  
  // Assigned automata
  assignedAutomataId?: AutomataId;
  deployedVersion?: string;
  currentState?: string;
  
  // Metadata
  tags: string[];
  group?: string;
  location?: string;
  
  // Visual
  position?: { x: number; y: number };
  icon?: string;
}

// ============================================================================
// Server (Aggregator) Types
// ============================================================================

export type ServerStatus = 'connected' | 'disconnected' | 'error' | 'syncing';

export interface Server {
  id: ServerId;
  name: string;
  description?: string;
  
  // Connection
  address: string;
  port: number;
  status: ServerStatus;
  
  // Managed devices
  deviceIds: DeviceId[];
  maxDevices: number;
  
  // Health
  lastSeen: number;
  latency: number;
  
  // Metadata
  region?: string;
  tags: string[];
}

// ============================================================================
// Gateway Types
// ============================================================================

export type GatewayStatus = 'connected' | 'disconnected' | 'connecting' | 'error';

export interface GatewayConfig {
  host: string; // Changed from 'address' to 'host' for WebSocket URL
  port: number;
  password?: string; // Added for authentication
  reconnectInterval?: number;
  heartbeatInterval?: number;
  timeout?: number;
  useTLS?: boolean;
}

export interface GatewayConnection {
  status: GatewayStatus;
  config: GatewayConfig;
  connectedAt?: number;
  lastMessageAt?: number;
  serverIds: ServerId[];
  error?: string;
}

// ============================================================================
// Editor State Types
// ============================================================================

export type EditorMode = 'visual' | 'code' | 'split';
export type PanelId = 'automata' | 'devices' | 'network' | 'timetravel' | 'properties' | 'console' | 'explorer' | 'gateway';

export interface EditorTab {
  id: string;
  type: 'automata' | 'device' | 'server' | 'settings' | 'code';
  targetId: string;
  name: string;
  isDirty: boolean;
  isActive: boolean;
}

export interface PanelState {
  id: PanelId;
  isVisible: boolean;
  size: number;        // Percentage or pixels
  position: 'left' | 'right' | 'bottom' | 'center';
  isCollapsed: boolean;
}

export interface LayoutConfig {
  panels: Record<PanelId, PanelState>;
  sidebarWidth: number;
  bottomPanelHeight: number;
  rightPanelWidth: number;
}

// ============================================================================
// Notification Types
// ============================================================================

export type NotificationType = 'info' | 'success' | 'warning' | 'error';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: number;
  duration?: number;    // Auto-dismiss duration in ms
  actions?: Array<{
    label: string;
    action: () => void;
  }>;
}

// ============================================================================
// Command System (for extensibility)
// ============================================================================

export interface Command {
  id: string;
  name: string;
  description?: string;
  shortcut?: string;
  category: string;
  execute: (...args: unknown[]) => void | Promise<void>;
  isEnabled?: () => boolean;
}

// ============================================================================
// Plugin System Types
// ============================================================================

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  main: string;
  contributes?: {
    commands?: Command[];
    panels?: PanelState[];
    themes?: string[];
    languages?: string[];
  };
}

export interface Plugin {
  manifest: PluginManifest;
  isLoaded: boolean;
  isEnabled: boolean;
  instance?: unknown;
}
