/**
 * Aetherium Automata - Automata Connection Types
 * 
 * Defines how automata are connected through shared inputs/outputs.
 * When an output of one automata is bound to an input of another,
 * they communicate through the server.
 */

import type { AutomataId, InputId, OutputId, VariableType, DeviceId } from './automata';

// ============================================================================
// Binding Types
// ============================================================================

export type BindingId = string;

/**
 * A binding connects an output from one automata to an input of another.
 */
export interface AutomataBinding {
  id: BindingId;
  
  // Source (produces the value)
  sourceAutomataId: AutomataId;
  sourceOutputId: OutputId;
  sourceOutputName: string;
  
  // Target (consumes the value)
  targetAutomataId: AutomataId;
  targetInputId: InputId;
  targetInputName: string;
  
  // Type compatibility
  sourceType: VariableType;
  targetType: VariableType;
  
  // Options
  transform?: string;  // Optional Lua transform function
  enabled: boolean;
  
  // Metadata
  description?: string;
  createdAt: number;
  modifiedAt: number;
}

/**
 * Validation result for a binding
 */
export interface BindingValidation {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

// ============================================================================
// Network Topology
// ============================================================================

/**
 * Represents the full network of connected automata
 */
export interface AutomataNetwork {
  // All bindings in the network
  bindings: BindingBinding[];
  
  // Computed topology
  topology: NetworkTopology;
  
  // Validation
  isValid: boolean;
  validationErrors: string[];
}

export interface BindingBinding extends AutomataBinding {
  // Runtime status
  runtime?: BindingRuntimeStatus;
}

export interface BindingRuntimeStatus {
  // Last value transmitted
  lastValue?: unknown;
  lastValueTimestamp?: number;
  
  // Statistics
  messageCount: number;
  errorCount: number;
  lastError?: string;
  
  // Latency
  averageLatencyMs: number;
  maxLatencyMs: number;
}

/**
 * Graph representation of automata network
 */
export interface NetworkTopology {
  // Nodes are automata
  nodes: NetworkNode[];
  
  // Edges are bindings
  edges: NetworkEdge[];
  
  // Analysis results
  clusters: AutomataId[][];  // Groups of connected automata
  roots: AutomataId[];       // Automata with no inputs (sources)
  leaves: AutomataId[];      // Automata with no outputs (sinks)
  cycles: AutomataId[][];    // Detected cycles (potential issues)
}

export interface NetworkNode {
  automataId: AutomataId;
  name: string;
  
  // Deployment info
  deviceId?: DeviceId;
  deviceName?: string;
  
  // I/O summary
  inputCount: number;
  outputCount: number;
  boundInputCount: number;
  boundOutputCount: number;
  
  // Visual
  position: { x: number; y: number };
  color?: string;
  
  // Status
  isDeployed: boolean;
  isRunning: boolean;
  hasErrors: boolean;
}

export interface NetworkEdge {
  id: BindingId;
  sourceId: AutomataId;
  targetId: AutomataId;
  
  // Port info
  sourcePort: string;  // Output name
  targetPort: string;  // Input name
  
  // Visual
  label?: string;
  color?: string;
  animated?: boolean;
  
  // Status
  isActive: boolean;
  lastActivity?: number;
}

// ============================================================================
// Transition Groups
// ============================================================================

/**
 * Groups transitions with identical conditions for unified display/editing
 */
export interface TransitionGroup {
  id: string;
  
  // The shared condition
  conditionType: 'classic' | 'timed' | 'event';
  conditionText: string;  // Human-readable condition
  conditionCode?: string; // Lua code for classic
  
  // Source state (all transitions in group share this)
  sourceStateId: string;
  sourceStateName: string;
  
  // Member transitions
  members: TransitionGroupMember[];
  
  // Total weight (for normalization display)
  totalWeight: number;
  
  // Visual
  position?: { x: number; y: number };
  color?: string;
}

export interface TransitionGroupMember {
  transitionId: string;
  targetStateId: string;
  targetStateName: string;
  
  // Weight
  weight: number;          // Absolute weight
  probability: number;     // Normalized probability (0-1)
  probabilityPercent: string; // Display string "45.5%"
  
  // Priority (within group, usually same)
  priority: number;
}

// ============================================================================
// Variable Usage Tracking
// ============================================================================

/**
 * Tracks where each variable is used in the automata
 */
export interface VariableUsage {
  variableName: string;
  variableType: VariableType;
  direction: 'input' | 'output' | 'internal';
  
  // Usage locations
  usedInStates: StateUsage[];
  usedInTransitions: TransitionUsage[];
  reads: UsageLocation[];
  writes: UsageLocation[];
  conditions: UsageLocation[];
  
  // Summary
  totalReads: number;
  totalWrites: number;
  isUnused: boolean;
}

export interface StateUsage {
  stateId: string;
  stateName: string;
  locations: UsageLocation[];
}

export interface TransitionUsage {
  transitionId: string;
  transitionName: string;
  locations: UsageLocation[];
}

export type UsageLocation = 
  | { type: 'condition'; line?: number }
  | { type: 'body'; line?: number }
  | { type: 'on_enter'; line?: number }
  | { type: 'on_exit'; line?: number }
  | { type: 'triggered'; line?: number };

export type VariableUsageLocation = UsageLocation;

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a new binding between automata
 */
export function createBinding(
  source: { automataId: AutomataId; outputId: OutputId; outputName: string; type: VariableType },
  target: { automataId: AutomataId; inputId: InputId; inputName: string; type: VariableType }
): AutomataBinding {
  const now = Date.now();
  return {
    id: `bind_${now}_${Math.random().toString(36).slice(2, 6)}`,
    sourceAutomataId: source.automataId,
    sourceOutputId: source.outputId,
    sourceOutputName: source.outputName,
    sourceType: source.type,
    targetAutomataId: target.automataId,
    targetInputId: target.inputId,
    targetInputName: target.inputName,
    targetType: target.type,
    enabled: true,
    createdAt: now,
    modifiedAt: now,
  };
}

/**
 * Validate type compatibility for binding
 */
export function validateBindingTypes(
  sourceType: VariableType,
  targetType: VariableType
): BindingValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Exact match is always valid
  if (sourceType === targetType) {
    return { isValid: true, errors, warnings };
  }

  // 'any' type is always compatible
  if (sourceType === 'any' || targetType === 'any') {
    warnings.push(`Binding uses 'any' type - runtime type errors possible`);
    return { isValid: true, errors, warnings };
  }

  // Numeric types are compatible with warning
  const numericTypes: VariableType[] = ['number'];
  if (numericTypes.includes(sourceType) && numericTypes.includes(targetType)) {
    warnings.push(`Numeric type coercion: ${sourceType} → ${targetType}`);
    return { isValid: true, errors, warnings };
  }

  // String can accept any type (toString)
  if (targetType === 'string') {
    warnings.push(`Value will be converted to string`);
    return { isValid: true, errors, warnings };
  }

  // Otherwise incompatible
  errors.push(`Type mismatch: cannot bind ${sourceType} to ${targetType}`);
  return { isValid: false, errors, warnings };
}

/**
 * Group transitions by their condition for visual grouping
 */
export function groupTransitionsByCondition(
  transitions: Array<{
    id: string;
    name: string;
    from: string;
    fromName: string;
    to: string;
    toName: string;
    type: string;
    condition?: string;
    weight: number;
    priority: number;
  }>
): TransitionGroup[] {
  const groups = new Map<string, TransitionGroup>();

  for (const t of transitions) {
    // Create group key from source + condition
    const conditionKey = `${t.from}:${t.type}:${t.condition || ''}`;
    
    let group = groups.get(conditionKey);
    if (!group) {
      group = {
        id: `group_${conditionKey.replace(/[^a-z0-9]/gi, '_')}`,
        conditionType: t.type as 'classic' | 'timed' | 'event',
        conditionText: t.condition || (t.type === 'immediate' ? 'always' : ''),
        conditionCode: t.condition,
        sourceStateId: t.from,
        sourceStateName: t.fromName,
        members: [],
        totalWeight: 0,
      };
      groups.set(conditionKey, group);
    }

    group.members.push({
      transitionId: t.id,
      targetStateId: t.to,
      targetStateName: t.toName,
      weight: t.weight,
      probability: 0, // Will be computed below
      probabilityPercent: '',
      priority: t.priority,
    });
    group.totalWeight += t.weight;
  }

  // Compute probabilities
  for (const group of groups.values()) {
    for (const member of group.members) {
      if (group.totalWeight > 0) {
        member.probability = member.weight / group.totalWeight;
        member.probabilityPercent = `${(member.probability * 100).toFixed(1)}%`;
      } else {
        member.probability = 1 / group.members.length;
        member.probabilityPercent = `${(member.probability * 100).toFixed(1)}%`;
      }
    }
  }

  // Only return groups with multiple members (weighted transitions)
  return Array.from(groups.values()).filter(g => g.members.length > 1);
}

/**
 * Analyze variable usage across an automata
 */
export function analyzeVariableUsage(
  variables: Array<{ name: string; type: VariableType; direction: 'input' | 'output' | 'internal' }>,
  states: Array<{ id: string; name: string; code?: string; onEnter?: string; onExit?: string }>,
  transitions: Array<{ id: string; name: string; condition?: string; body?: string; triggered?: string }>
): VariableUsage[] {
  const usages: VariableUsage[] = [];

  for (const variable of variables) {
    const usage: VariableUsage = {
      variableName: variable.name,
      variableType: variable.type,
      direction: variable.direction,
      usedInStates: [],
      usedInTransitions: [],
      reads: [],
      writes: [],
      conditions: [],
      totalReads: 0,
      totalWrites: 0,
      isUnused: true,
    };

    // Check states
    for (const state of states) {
      const locations: UsageLocation[] = [];
      
      if (state.code && state.code.includes(variable.name)) {
        locations.push({ type: 'body' });
        usage.totalReads++;
      }
      if (state.onEnter && state.onEnter.includes(variable.name)) {
        locations.push({ type: 'on_enter' });
        usage.totalReads++;
      }
      if (state.onExit && state.onExit.includes(variable.name)) {
        locations.push({ type: 'on_exit' });
        usage.totalReads++;
      }

      if (locations.length > 0) {
        usage.usedInStates.push({
          stateId: state.id,
          stateName: state.name,
          locations,
        });
        usage.isUnused = false;
      }
    }

    // Check transitions
    for (const trans of transitions) {
      const locations: UsageLocation[] = [];
      
      if (trans.condition && trans.condition.includes(variable.name)) {
        locations.push({ type: 'condition' });
        usage.totalReads++;
      }
      if (trans.body && trans.body.includes(variable.name)) {
        locations.push({ type: 'body' });
        usage.totalWrites++;
      }
      if (trans.triggered && trans.triggered.includes(variable.name)) {
        locations.push({ type: 'triggered' });
        usage.totalReads++;
      }

      if (locations.length > 0) {
        usage.usedInTransitions.push({
          transitionId: trans.id,
          transitionName: trans.name,
          locations,
        });
        usage.isUnused = false;
      }
    }

    usages.push(usage);
  }

  return usages;
}

/**
 * Create a transition group from a set of transitions
 */
export function createTransitionGroup(
  sourceStateId: string,
  sourceStateName: string,
  conditionType: 'classic' | 'timed' | 'event',
  conditionText: string
): TransitionGroup {
  return {
    id: `group_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    conditionType,
    conditionText,
    conditionCode: conditionText,
    sourceStateId,
    sourceStateName,
    members: [],
    totalWeight: 0,
  };
}

/**
 * Analyze a single transition group's properties
 */
export function analyzeTransitionGroup(group: TransitionGroup): {
  totalWeight: number;
  averageProbability: number;
  memberCount: number;
  isBalanced: boolean;
  targetCount: number;
  hasDeadWeight: boolean;
  isNormalized: boolean;
  entropyScore: number;
} {
  const totalWeight = group.totalWeight;
  const memberCount = group.members.length;
  const averageProbability = memberCount > 0 ? 1 / memberCount : 0;
  
  // Check if probabilities are roughly balanced (within 10%)
  const isBalanced = group.members.every(
    m => Math.abs(m.probability - averageProbability) < 0.1
  );
  
  // Check for dead weight (zero weight transitions)
  const hasDeadWeight = group.members.some(m => m.weight === 0);
  
  // Check if weights sum to 100 (normalized)
  const isNormalized = Math.abs(totalWeight - 100) < 0.01;
  
  // Calculate entropy (measure of uncertainty)
  const entropyScore = group.members.reduce((sum, m) => {
    if (m.probability > 0) {
      return sum - m.probability * Math.log2(m.probability);
    }
    return sum;
  }, 0);
  
  return {
    totalWeight,
    averageProbability,
    memberCount,
    isBalanced,
    targetCount: memberCount,
    hasDeadWeight,
    isNormalized,
    entropyScore,
  };
}

/**
 * Track variable usage by analyzing code blocks
 */
export function trackVariableUsage(
  variableName: string,
  states: Array<{ id: string; name: string; code?: string; onEnter?: string; onExit?: string }>,
  transitions: Array<{ id: string; name: string; condition?: string; body?: string; triggered?: string }>
): { reads: UsageLocation[]; writes: UsageLocation[]; conditions: UsageLocation[] } {
  const reads: UsageLocation[] = [];
  const writes: UsageLocation[] = [];
  const conditions: UsageLocation[] = [];
  
  // Simple pattern to detect reads vs writes
  const writePattern = new RegExp(`\\b${variableName}\\s*=`, 'g');
  const readPattern = new RegExp(`\\b${variableName}\\b`, 'g');
  
  // Check states
  for (const state of states) {
    if (state.code) {
      if (writePattern.test(state.code)) writes.push({ type: 'body' });
      else if (readPattern.test(state.code)) reads.push({ type: 'body' });
    }
    if (state.onEnter) {
      if (writePattern.test(state.onEnter)) writes.push({ type: 'on_enter' });
      else if (readPattern.test(state.onEnter)) reads.push({ type: 'on_enter' });
    }
    if (state.onExit) {
      if (writePattern.test(state.onExit)) writes.push({ type: 'on_exit' });
      else if (readPattern.test(state.onExit)) reads.push({ type: 'on_exit' });
    }
  }
  
  // Check transitions
  for (const trans of transitions) {
    if (trans.condition && readPattern.test(trans.condition)) {
      conditions.push({ type: 'condition' });
    }
    if (trans.body) {
      if (writePattern.test(trans.body)) writes.push({ type: 'body' });
      else if (readPattern.test(trans.body)) reads.push({ type: 'body' });
    }
    if (trans.triggered && readPattern.test(trans.triggered)) {
      reads.push({ type: 'triggered' });
    }
  }
  
  return { reads, writes, conditions };
}

/**
 * Create an automata binding between automata
 */
export function createAutomataBinding(
  sourceAutomataId: AutomataId,
  sourceOutputId: OutputId,
  targetAutomataId: AutomataId,
  targetInputId: InputId
): Omit<AutomataBinding, 'id'> {
  const now = Date.now();
  return {
    sourceAutomataId,
    sourceOutputId,
    sourceOutputName: sourceOutputId,
    targetAutomataId,
    targetInputId,
    targetInputName: targetInputId,
    sourceType: 'any',
    targetType: 'any',
    enabled: true,
    createdAt: now,
    modifiedAt: now,
  };
}

/**
 * Build network topology from automata and bindings
 */
export function buildNetworkTopology(
  automataList: any[],
  bindings: AutomataBinding[]
): NetworkTopology {
  const nodes: NetworkNode[] = [];
  const edges: NetworkEdge[] = [];
  
  // Create nodes for each automata
  for (const automata of automataList) {
    nodes.push({
      automataId: automata.id,
      name: automata.config?.name || automata.id,
      inputCount: 0,
      outputCount: 0,
      boundInputCount: 0,
      boundOutputCount: 0,
      position: { x: 0, y: 0 },
      isDeployed: false,
      isRunning: false,
      hasErrors: false,
    });
  }
  
  // Create edges from bindings
  for (const binding of bindings) {
    edges.push({
      id: binding.id,
      sourceId: binding.sourceAutomataId,
      targetId: binding.targetAutomataId,
      sourcePort: binding.sourceOutputName,
      targetPort: binding.targetInputName,
      isActive: binding.enabled,
    });
  }
  
  return {
    nodes,
    edges,
    clusters: [],
    roots: [],
    leaves: [],
    cycles: [],
  };
}
