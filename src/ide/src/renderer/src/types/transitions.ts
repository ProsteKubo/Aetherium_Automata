/**
 * Aetherium Automata - Enhanced Transition Type Definitions
 * 
 * Supports multiple transition paradigms:
 * - Classic: condition-based (guard expressions)
 * - Timed: delay, timeout, periodic
 * - Event: triggered by input/output signals
 * - Probabilistic: weighted random selection
 */

import type { StateId, TransitionId } from './automata';

// ============================================================================
// Transition Categories
// ============================================================================

export type TransitionType = 
  | 'classic'       // Guard condition (Lua expression)
  | 'timed'         // Time-based (delay, timeout, after)
  | 'event'         // Signal-triggered (on input/output change)
  | 'probabilistic' // Weighted random
  | 'immediate';    // No guard, fires immediately (epsilon transition)

// ============================================================================
// Classic Transition (Condition/Guard Based)
// ============================================================================

export interface ClassicTransitionConfig {
  /** Lua expression returning boolean */
  condition: string;
  
  /** Only fire if condition was false before and is now true */
  onRisingEdge?: boolean;
}

// ============================================================================
// Timed Transition (DEVS ta() function)
// ============================================================================

export type TimedTransitionMode = 
  | 'after'    // Fire after delay from state entry
  | 'at'       // Fire at absolute time
  | 'every'    // Periodic (requires staying in state)
  | 'timeout'  // Fire if no other transition fires within time
  | 'window';  // Fire only during time window

export interface TimedTransitionConfig {
  mode: TimedTransitionMode;
  
  /** Delay in milliseconds */
  delayMs: number;
  
  /** For 'at' mode: absolute timestamp */
  absoluteTime?: number;
  
  /** For 'every' mode: repeat count (0 = infinite) */
  repeatCount?: number;
  
  /** For 'window' mode: end of window */
  windowEndMs?: number;
  
  /** Jitter range (+/- ms) for randomization */
  jitterMs?: number;
  
  /** Optional additional guard condition */
  additionalCondition?: string;
  
  /** Visual: show countdown */
  showCountdown?: boolean;
}

// ============================================================================
// Event Transition (Signal Triggered)
// ============================================================================

export type EventTriggerType = 
  | 'onChange'     // Any value change
  | 'onRise'       // Value went from falsy to truthy
  | 'onFall'       // Value went from truthy to falsy
  | 'onThreshold'  // Value crossed threshold
  | 'onMatch';     // Value matches pattern

export interface SignalTrigger {
  /** Signal name (input or output) */
  signalName: string;
  
  /** Signal type */
  signalType: 'input' | 'output' | 'variable';
  
  /** Trigger mode */
  triggerType: EventTriggerType;
  
  /** For threshold: comparison operator and value */
  threshold?: {
    operator: '>' | '<' | '>=' | '<=' | '==' | '!=';
    value: number | string | boolean;
    /** Only fire once per crossing (hysteresis) */
    oneShot?: boolean;
  };
  
  /** For match: pattern to match (string/regex) */
  pattern?: string;
}

export interface EventTransitionConfig {
  /** List of triggers (OR logic) */
  triggers: SignalTrigger[];
  
  /** Require all triggers (AND logic) */
  requireAll?: boolean;
  
  /** Debounce time in ms */
  debounceMs?: number;
  
  /** Optional additional guard */
  additionalCondition?: string;
}

// ============================================================================
// Probabilistic Transition
// ============================================================================

export type ProbabilisticMode = 
  | 'static'     // Fixed weights
  | 'dynamic'    // Weights computed at runtime (Lua)
  | 'adaptive';  // Weights adjust based on history (learning)

export interface ProbabilisticTransitionConfig {
  mode: ProbabilisticMode;
  
  /** Static weight (0-100 or 0-1) */
  weight: number;
  
  /** For dynamic: Lua expression returning weight */
  weightExpression?: string;
  
  /** For adaptive: learning parameters */
  adaptive?: {
    /** Initial weight */
    initialWeight: number;
    /** Learning rate */
    learningRate: number;
    /** Reward signal name */
    rewardSignal?: string;
  };
  
  /** Normalize with sibling transitions */
  normalizeWeights?: boolean;
  
  /** Minimum probability floor */
  minProbability?: number;
}

// ============================================================================
// Enhanced Transition (combines all types)
// ============================================================================

export interface EnhancedTransition {
  id: TransitionId;
  name: string;
  from: StateId;
  to: StateId;
  
  /** Primary transition type */
  type: TransitionType;
  
  /** Type-specific configuration */
  classic?: ClassicTransitionConfig;
  timed?: TimedTransitionConfig;
  event?: EventTransitionConfig;
  probabilistic?: ProbabilisticTransitionConfig;
  
  /** Execution code (runs when transition fires) */
  body: string;
  
  /** Post-transition callback */
  triggered?: string;
  
  /** Priority for conflict resolution (lower = higher priority) */
  priority: number;
  
  /** Is this transition enabled? */
  enabled: boolean;
  
  /** Description for documentation */
  description?: string;
  
  /** Tags for filtering */
  tags?: string[];
  
  // Visual metadata
  visual: TransitionVisual;
  
  // Runtime state (not persisted)
  runtime?: TransitionRuntimeState;
}

export interface TransitionVisual {
  /** Custom label (overrides auto-generated) */
  label?: string;
  
  /** Label position along edge (0-1) */
  labelPosition?: number;
  
  /** Color */
  color?: string;
  
  /** Line style */
  lineStyle?: 'solid' | 'dashed' | 'dotted';
  
  /** Line width */
  lineWidth?: number;
  
  /** Curved path offset */
  pathOffset?: number;
  
  /** Bezier control point */
  controlPoint?: { x: number; y: number };
  
  /** Show animation when active */
  animate?: boolean;
  
  /** Icon to display */
  icon?: 'timer' | 'signal' | 'dice' | 'lightning' | 'guard';
}

export interface TransitionRuntimeState {
  /** Times this transition has fired */
  fireCount: number;
  
  /** Last fire timestamp */
  lastFiredAt?: number;
  
  /** For timed: remaining time */
  remainingMs?: number;
  
  /** For timed: is countdown active */
  isCountdownActive?: boolean;
  
  /** For probabilistic: computed probability */
  computedProbability?: number;
  
  /** Is currently evaluating */
  isEvaluating?: boolean;
  
  /** Last evaluation result */
  lastEvaluationResult?: boolean;
}

// ============================================================================
// Transition Quick-Create Templates
// ============================================================================

export interface TransitionTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  shortcut?: string;
  defaults: Partial<EnhancedTransition>;
}

export const TRANSITION_TEMPLATES: TransitionTemplate[] = [
  {
    id: 'classic',
    name: 'Guard Transition',
    description: 'Condition-based transition (Lua expression)',
    icon: 'guard',
    shortcut: 'G',
    defaults: {
      type: 'classic',
      classic: { condition: 'true', onRisingEdge: false },
      priority: 0,
    },
  },
  {
    id: 'timed-after',
    name: 'Timed (After)',
    description: 'Fire after delay from state entry',
    icon: 'timer',
    shortcut: 'A',
    defaults: {
      type: 'timed',
      timed: { mode: 'after', delayMs: 1000, showCountdown: true },
      priority: 0,
    },
  },
  {
    id: 'timed-timeout',
    name: 'Timeout',
    description: 'Fire if no other transition fires within time',
    icon: 'timer',
    shortcut: 'O',
    defaults: {
      type: 'timed',
      timed: { mode: 'timeout', delayMs: 5000, showCountdown: true },
      priority: 100, // Low priority (fallback)
    },
  },
  {
    id: 'event-input',
    name: 'On Input Change',
    description: 'Fire when input signal changes',
    icon: 'signal',
    shortcut: 'I',
    defaults: {
      type: 'event',
      event: {
        triggers: [{ signalName: '', signalType: 'input', triggerType: 'onChange' }],
        debounceMs: 50,
      },
      priority: 0,
    },
  },
  {
    id: 'event-threshold',
    name: 'Threshold Crossing',
    description: 'Fire when value crosses threshold',
    icon: 'signal',
    shortcut: 'H',
    defaults: {
      type: 'event',
      event: {
        triggers: [{
          signalName: '',
          signalType: 'input',
          triggerType: 'onThreshold',
          threshold: { operator: '>', value: 0, oneShot: true },
        }],
      },
      priority: 0,
    },
  },
  {
    id: 'probabilistic',
    name: 'Probabilistic',
    description: 'Random selection with weight',
    icon: 'dice',
    shortcut: 'P',
    defaults: {
      type: 'probabilistic',
      probabilistic: { mode: 'static', weight: 50, normalizeWeights: true },
      priority: 0,
    },
  },
  {
    id: 'immediate',
    name: 'Immediate (ε)',
    description: 'No guard, fires immediately',
    icon: 'lightning',
    shortcut: 'E',
    defaults: {
      type: 'immediate',
      priority: 0,
    },
  },
];

// ============================================================================
// Factory Functions
// ============================================================================

export function createTransition(
  from: StateId,
  to: StateId,
  type: TransitionType = 'classic',
  partial?: Partial<EnhancedTransition>
): EnhancedTransition {
  const id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  
  const base: EnhancedTransition = {
    id,
    name: `${from} → ${to}`,
    from,
    to,
    type,
    body: '',
    priority: 0,
    enabled: true,
    visual: {
      animate: true,
      icon: getIconForType(type),
    },
  };
  
  // Add type-specific defaults
  switch (type) {
    case 'classic':
      base.classic = { condition: 'true' };
      break;
    case 'timed':
      base.timed = { mode: 'after', delayMs: 1000, showCountdown: true };
      break;
    case 'event':
      base.event = { triggers: [], debounceMs: 50 };
      break;
    case 'probabilistic':
      base.probabilistic = { mode: 'static', weight: 50 };
      break;
    case 'immediate':
      // No extra config needed
      break;
  }
  
  return { ...base, ...partial };
}

function getIconForType(type: TransitionType): TransitionVisual['icon'] {
  switch (type) {
    case 'classic': return 'guard';
    case 'timed': return 'timer';
    case 'event': return 'signal';
    case 'probabilistic': return 'dice';
    case 'immediate': return 'lightning';
    default: return 'guard';
  }
}

// ============================================================================
// Transition Evaluation Order
// ============================================================================

/**
 * Determines evaluation order based on DEVS semantics:
 * 1. Internal transitions (timed) evaluated first
 * 2. External transitions (event/classic) second
 * 3. Lower priority number = higher priority
 * 4. Probabilistic selection among equal-priority enabled transitions
 */
export function sortTransitionsByPriority(
  transitions: EnhancedTransition[]
): EnhancedTransition[] {
  return [...transitions].sort((a, b) => {
    // Timed transitions first (internal in DEVS)
    const aIsInternal = a.type === 'timed' ? 0 : 1;
    const bIsInternal = b.type === 'timed' ? 0 : 1;
    if (aIsInternal !== bIsInternal) return aIsInternal - bIsInternal;
    
    // Then by priority
    return a.priority - b.priority;
  });
}
