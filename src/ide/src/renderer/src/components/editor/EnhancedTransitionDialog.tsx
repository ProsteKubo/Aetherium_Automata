/**
 * Aetherium Automata - Enhanced Transition Dialog Component
 * 
 * Modal dialog for creating and editing transitions with support for:
 * - Classic (guard condition)
 * - Timed (delay, timeout, after)
 * - Event (signal triggered)
 * - Probabilistic (weighted)
 * 
 * Features:
 * - Tab-based type selection
 * - Visual delay/timer editor
 * - Weight sliders
 * - Quick-create shortcuts
 */

import React, { useState, useEffect, useRef } from 'react';
import { useAutomataStore } from '../../stores';
import { IconClose, IconArrowRight } from '../common/Icons';
import type {
  TransitionType,
  TimedTransitionConfig,
  EventTransitionConfig,
  ProbabilisticTransitionConfig,
} from '../../types/transitions';

// ============================================================================
// Icons for transition types
// ============================================================================

const GuardIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <path d="M8 1L2 3v5c0 4 2.5 6 6 7 3.5-1 6-3 6-7V3L8 1zm0 1.3l5 1.6v4.6c0 3.2-2 4.8-5 5.8-3-.9-5-2.6-5-5.8V3.9l5-1.6z"/>
    <path d="M7 8.5L5.5 7l-.7.7L7 9.9l3.2-3.2-.7-.7L7 8.5z"/>
  </svg>
);

const TimerIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <path d="M8 2a6 6 0 100 12A6 6 0 008 2zM1 8a7 7 0 1114 0A7 7 0 011 8z"/>
    <path d="M8 4v4.5l3 1.5-.5 1L7 9V4h1z"/>
  </svg>
);

const SignalIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <path d="M1 8h2l2-4 2 8 2-4 2 2 2-1 2 1V8h1v2l-3 1-2-2-2 4-2-8-2 4H1V8z"/>
  </svg>
);

const DiceIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <path d="M2 2h12v12H2V2zm1 1v10h10V3H3z"/>
    <circle cx="5" cy="5" r="1"/>
    <circle cx="11" cy="5" r="1"/>
    <circle cx="8" cy="8" r="1"/>
    <circle cx="5" cy="11" r="1"/>
    <circle cx="11" cy="11" r="1"/>
  </svg>
);

const LightningIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <path d="M9 1L3 9h4l-1 6 6-8H8l1-6z"/>
  </svg>
);

// ============================================================================
// Type Tab Component
// ============================================================================

interface TypeTabProps {
  type: TransitionType;
  label: string;
  shortcut: string;
  icon: React.ReactNode;
  isActive: boolean;
  onClick: () => void;
}

const TypeTab: React.FC<TypeTabProps> = ({ label, shortcut, icon, isActive, onClick }) => (
  <button
    type="button"
    className={`type-tab ${isActive ? 'active' : ''}`}
    onClick={onClick}
    style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: 'var(--spacing-2) var(--spacing-3)',
      backgroundColor: isActive ? 'var(--color-primary)' : 'var(--color-bg-secondary)',
      border: `1px solid ${isActive ? 'var(--color-primary)' : 'var(--color-border)'}`,
      borderRadius: 'var(--radius-md)',
      color: isActive ? 'white' : 'var(--color-text-secondary)',
      cursor: 'pointer',
      transition: 'all 0.15s ease',
      minWidth: 70,
    }}
  >
    <span style={{ marginBottom: 4 }}>{icon}</span>
    <span style={{ fontSize: 'var(--font-size-xs)', fontWeight: 500 }}>{label}</span>
    <span style={{ fontSize: 10, opacity: 0.7, marginTop: 2 }}>{shortcut}</span>
  </button>
);

// ============================================================================
// Timer Editor Component
// ============================================================================

interface TimerEditorProps {
  config: TimedTransitionConfig;
  onChange: (config: TimedTransitionConfig) => void;
}

const TimerEditor: React.FC<TimerEditorProps> = ({ config, onChange }) => {
  const [displayMs, setDisplayMs] = useState(config.delayMs);
  
  const formatTime = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };
  
  return (
    <div className="timer-editor" style={{ marginTop: 'var(--spacing-3)' }}>
      <div className="form-group">
        <label>Mode</label>
        <div style={{ display: 'flex', gap: 'var(--spacing-2)', flexWrap: 'wrap' }}>
          {(['after', 'timeout', 'every', 'window'] as const).map((mode) => (
            <label key={mode} style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
              <input
                type="radio"
                name="timerMode"
                checked={config.mode === mode}
                onChange={() => onChange({ ...config, mode })}
                style={{ marginRight: 'var(--spacing-1)' }}
              />
              <span style={{ textTransform: 'capitalize' }}>{mode}</span>
            </label>
          ))}
        </div>
        <span className="form-hint">
          {config.mode === 'after' && 'Fire after delay from state entry'}
          {config.mode === 'timeout' && 'Fire if no other transition fires within time'}
          {config.mode === 'every' && 'Fire periodically while in state'}
          {config.mode === 'window' && 'Only fire during time window'}
        </span>
      </div>
      
      <div className="form-group">
        <label>Delay: {formatTime(displayMs)}</label>
        <input
          type="range"
          min={100}
          max={60000}
          step={100}
          value={displayMs}
          onChange={(e) => {
            const ms = Number(e.target.value);
            setDisplayMs(ms);
            onChange({ ...config, delayMs: ms });
          }}
          style={{ width: '100%' }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>
          <span>100ms</span>
          <span>1s</span>
          <span>10s</span>
          <span>60s</span>
        </div>
      </div>
      
      <div className="form-group">
        <label htmlFor="exactDelay">Exact Value (ms)</label>
        <input
          id="exactDelay"
          type="number"
          min={1}
          value={config.delayMs}
          onChange={(e) => {
            const ms = Number(e.target.value);
            setDisplayMs(ms);
            onChange({ ...config, delayMs: ms });
          }}
        />
      </div>
      
      <div className="form-group">
        <label style={{ display: 'flex', alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={config.showCountdown || false}
            onChange={(e) => onChange({ ...config, showCountdown: e.target.checked })}
            style={{ marginRight: 'var(--spacing-2)' }}
          />
          Show countdown in editor
        </label>
      </div>
    </div>
  );
};

// ============================================================================
// Event Editor Component
// ============================================================================

interface EventEditorProps {
  config: EventTransitionConfig;
  onChange: (config: EventTransitionConfig) => void;
  availableSignals: { name: string; type: 'input' | 'output' | 'variable' }[];
}

const EventEditor: React.FC<EventEditorProps> = ({ config, onChange, availableSignals }) => {
  const trigger = config.triggers[0] || { signalName: '', signalType: 'input' as const, triggerType: 'onChange' as const };
  
  const updateTrigger = (updates: Partial<typeof trigger>) => {
    onChange({
      ...config,
      triggers: [{ ...trigger, ...updates }],
    });
  };
  
  return (
    <div className="event-editor" style={{ marginTop: 'var(--spacing-3)' }}>
      <div className="form-group">
        <label>Signal</label>
        <select
          value={`${trigger.signalType}:${trigger.signalName}`}
          onChange={(e) => {
            const [type, name] = e.target.value.split(':');
            updateTrigger({ signalType: type as 'input' | 'output' | 'variable', signalName: name });
          }}
        >
          <option value="">Select signal...</option>
          {availableSignals.map((s) => (
            <option key={`${s.type}:${s.name}`} value={`${s.type}:${s.name}`}>
              [{s.type}] {s.name}
            </option>
          ))}
        </select>
      </div>
      
      <div className="form-group">
        <label>Trigger Type</label>
        <select
          value={trigger.triggerType}
          onChange={(e) => updateTrigger({ triggerType: e.target.value as typeof trigger.triggerType })}
        >
          <option value="onChange">On Change</option>
          <option value="onRise">On Rise (false → true)</option>
          <option value="onFall">On Fall (true → false)</option>
          <option value="onThreshold">On Threshold</option>
          <option value="onMatch">On Match</option>
        </select>
      </div>
      
      {trigger.triggerType === 'onThreshold' && (
        <div style={{ display: 'flex', gap: 'var(--spacing-2)' }}>
          <div className="form-group" style={{ flex: 1 }}>
            <label>Operator</label>
            <select
              value={trigger.threshold?.operator || '>'}
              onChange={(e) => updateTrigger({
                threshold: { ...trigger.threshold, operator: e.target.value as '>' | '<', value: trigger.threshold?.value || 0 },
              })}
            >
              <option value=">">&gt;</option>
              <option value="<">&lt;</option>
              <option value=">=">&gt;=</option>
              <option value="<=">&lt;=</option>
              <option value="==">==</option>
              <option value="!=">!=</option>
            </select>
          </div>
          <div className="form-group" style={{ flex: 2 }}>
            <label>Value</label>
            <input
              type="number"
              value={typeof trigger.threshold?.value === 'number' ? trigger.threshold.value : 0}
              onChange={(e) => updateTrigger({
                threshold: { ...trigger.threshold, operator: trigger.threshold?.operator || '>', value: Number(e.target.value) },
              })}
            />
          </div>
        </div>
      )}
      
      <div className="form-group">
        <label>Debounce (ms)</label>
        <input
          type="number"
          min={0}
          value={config.debounceMs || 0}
          onChange={(e) => onChange({ ...config, debounceMs: Number(e.target.value) })}
        />
        <span className="form-hint">Ignore rapid signal changes within this time</span>
      </div>
    </div>
  );
};

// ============================================================================
// Probabilistic Editor Component
// ============================================================================

interface ProbabilisticEditorProps {
  config: ProbabilisticTransitionConfig;
  onChange: (config: ProbabilisticTransitionConfig) => void;
  siblingWeights: number[]; // Weights of other transitions from same state
}

const ProbabilisticEditor: React.FC<ProbabilisticEditorProps> = ({ config, onChange, siblingWeights }) => {
  const totalWeight = siblingWeights.reduce((a, b) => a + b, 0) + config.weight;
  const probability = totalWeight > 0 ? (config.weight / totalWeight * 100).toFixed(1) : '0';
  
  return (
    <div className="probabilistic-editor" style={{ marginTop: 'var(--spacing-3)' }}>
      <div className="form-group">
        <label>Mode</label>
        <div style={{ display: 'flex', gap: 'var(--spacing-2)' }}>
          {(['static', 'dynamic', 'adaptive'] as const).map((mode) => (
            <label key={mode} style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
              <input
                type="radio"
                name="probMode"
                checked={config.mode === mode}
                onChange={() => onChange({ ...config, mode })}
                style={{ marginRight: 'var(--spacing-1)' }}
              />
              <span style={{ textTransform: 'capitalize' }}>{mode}</span>
            </label>
          ))}
        </div>
      </div>
      
      <div className="form-group">
        <label>Weight: {config.weight} ({probability}%)</label>
        <input
          type="range"
          min={1}
          max={100}
          value={config.weight}
          onChange={(e) => onChange({ ...config, weight: Number(e.target.value) })}
          style={{ width: '100%' }}
        />
        <div style={{
          marginTop: 'var(--spacing-2)',
          padding: 'var(--spacing-2)',
          backgroundColor: 'var(--color-bg-tertiary)',
          borderRadius: 'var(--radius-sm)',
          fontSize: 'var(--font-size-sm)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ flex: 1 }}>This transition</span>
            <span>{probability}%</span>
          </div>
          <div style={{
            height: 8,
            backgroundColor: 'var(--color-bg-secondary)',
            borderRadius: 4,
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: `${probability}%`,
              backgroundColor: 'var(--color-primary)',
              transition: 'width 0.2s ease',
            }} />
          </div>
        </div>
      </div>
      
      {config.mode === 'dynamic' && (
        <div className="form-group">
          <label>Weight Expression (Lua)</label>
          <input
            type="text"
            value={config.weightExpression || ''}
            onChange={(e) => onChange({ ...config, weightExpression: e.target.value })}
            placeholder="e.g., value('confidence') * 100"
          />
        </div>
      )}
    </div>
  );
};

// ============================================================================
// Main Dialog Component
// ============================================================================

interface EnhancedTransitionDialogProps {
  automataId: string;
  isOpen: boolean;
  onClose: () => void;
  editTransitionId?: string;
  initialFromState?: string;
  initialToState?: string;
}

export const EnhancedTransitionDialog: React.FC<EnhancedTransitionDialogProps> = ({
  automataId,
  isOpen,
  onClose,
  editTransitionId,
  initialFromState,
  initialToState,
}) => {
  const automata = useAutomataStore((state) => state.automata.get(automataId));
  const selectedStateIds = useAutomataStore((state) => state.selectedStateIds);
  const addTransition = useAutomataStore((state) => state.addTransition);
  const updateTransition = useAutomataStore((state) => state.updateTransition);
  const deleteTransition = useAutomataStore((state) => state.deleteTransition);
  
  const states = automata ? Object.values(automata.states) : [];
  const existingTransition = editTransitionId && automata 
    ? automata.transitions[editTransitionId] 
    : null;
  
  // Form state
  const [transitionType, setTransitionType] = useState<TransitionType>('classic');
  const [fromState, setFromState] = useState<string>('');
  const [toState, setToState] = useState<string>('');
  const [name, setName] = useState<string>('');
  const [condition, setCondition] = useState<string>('');
  const [body, setBody] = useState<string>('');
  const [priority, setPriority] = useState<number>(0);
  
  // Type-specific configs
  const [timedConfig, setTimedConfig] = useState<TimedTransitionConfig>({
    mode: 'after',
    delayMs: 1000,
    showCountdown: true,
  });
  
  const [eventConfig, setEventConfig] = useState<EventTransitionConfig>({
    triggers: [{ signalName: '', signalType: 'input', triggerType: 'onChange' }],
    debounceMs: 50,
  });
  
  const [probabilisticConfig, setProbabilisticConfig] = useState<ProbabilisticTransitionConfig>({
    mode: 'static',
    weight: 50,
    normalizeWeights: true,
  });
  
  // Initialize form
  const initializedRef = useRef<string | null>(null);
  
  useEffect(() => {
    if (!isOpen) {
      initializedRef.current = null;
      return;
    }
    
    const sessionKey = editTransitionId || 'new';
    if (initializedRef.current === sessionKey) return;
    initializedRef.current = sessionKey;
    
    if (existingTransition) {
      setFromState(existingTransition.from);
      setToState(existingTransition.to);
      setName(existingTransition.name);
      setCondition(existingTransition.condition || '');
      setBody(existingTransition.body || '');
      setPriority(existingTransition.priority || 0);
      // TODO: Parse type from existing transition
      setTransitionType('classic');
    } else {
      // Smart state pre-selection:
      // 1. Use explicit props if provided
      // 2. Use currently selected state as "from"
      // 3. Fall back to first/second state
      const selectedState = selectedStateIds.length === 1 ? selectedStateIds[0] : null;
      
      let defaultFrom = initialFromState || selectedState || states[0]?.id || '';
      let defaultTo = initialToState || '';
      
      // If we have a selected state, try to find the next logical state
      if (selectedState && !initialToState) {
        // Look for states that don't have a transition from selected state yet
        const existingTargets = automata 
          ? Object.values(automata.transitions)
              .filter((t) => t.from === selectedState)
              .map((t) => t.to)
          : [];
        
        const availableTargets = states.filter(
          (s) => s.id !== selectedState && !existingTargets.includes(s.id)
        );
        
        defaultTo = availableTargets[0]?.id || states.find((s) => s.id !== selectedState)?.id || states[0]?.id || '';
      } else if (!defaultTo) {
        defaultTo = states.find((s) => s.id !== defaultFrom)?.id || states[0]?.id || '';
      }
      
      setFromState(defaultFrom);
      setToState(defaultTo);
      setName('');
      setCondition('');
      setBody('');
      setPriority(0);
      setTransitionType('classic');
    }
  }, [isOpen, editTransitionId, existingTransition, initialFromState, initialToState, states, selectedStateIds, automata]);
  
  // Keyboard shortcuts for type selection
  useEffect(() => {
    if (!isOpen) return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      
      const shortcuts: Record<string, TransitionType> = {
        'g': 'classic',
        'a': 'timed',
        'i': 'event',
        'p': 'probabilistic',
        'e': 'immediate',
      };
      
      const type = shortcuts[e.key.toLowerCase()];
      if (type) {
        setTransitionType(type);
        e.preventDefault();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);
  
  // Get available signals for event editor
  const availableSignals = states.flatMap((state) => [
    ...state.inputs.map((name) => ({ name: String(name), type: 'input' as const })),
    ...state.outputs.map((name) => ({ name: String(name), type: 'output' as const })),
    ...state.variables.map((v) => ({ name: typeof v === 'string' ? v : v.name, type: 'variable' as const })),
  ]).filter((s, i, arr) => arr.findIndex((x) => x.name === s.name && x.type === s.type) === i);
  
  // Get sibling weights for probabilistic editor
  const siblingWeights = automata
    ? Object.values(automata.transitions)
        .filter((t) => t.from === fromState && t.id !== editTransitionId)
        .map((t) => t.weight || 1)
    : [];
  
  const getStateName = (stateId: string): string => {
    const state = states.find((s) => s.id === stateId);
    return state?.name || stateId;
  };
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!fromState || !toState) return;
    
    const transitionName = name.trim() || `${getStateName(fromState)} → ${getStateName(toState)}`;
    
    // Build condition based on type
    let finalCondition = condition;
    if (transitionType === 'immediate') {
      finalCondition = 'true';
    }
    
    if (editTransitionId) {
      updateTransition(editTransitionId, {
        from: fromState,
        to: toState,
        name: transitionName,
        condition: finalCondition,
        body,
        priority,
        weight: transitionType === 'probabilistic' ? probabilisticConfig.weight : 1,
        // TODO: Store type-specific config
      });
    } else {
      addTransition({
        from: fromState,
        to: toState,
        name: transitionName,
        condition: finalCondition,
        body,
        priority,
        weight: transitionType === 'probabilistic' ? probabilisticConfig.weight : 1,
      });
    }
    
    onClose();
  };
  
  const handleDelete = () => {
    if (editTransitionId && confirm('Delete this transition?')) {
      deleteTransition(editTransitionId);
      onClose();
    }
  };
  
  if (!isOpen) return null;
  
  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div 
        className="dialog enhanced-transition-dialog" 
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 500, width: '90vw' }}
      >
        <div className="dialog-header">
          <h2>{editTransitionId ? 'Edit Transition' : 'Create Transition'}</h2>
          <button className="dialog-close" onClick={onClose}>
            <IconClose />
          </button>
        </div>
        
        <form onSubmit={handleSubmit}>
          <div className="dialog-body">
            {/* Type selector */}
            <div style={{ 
              display: 'flex', 
              gap: 'var(--spacing-2)', 
              marginBottom: 'var(--spacing-4)',
              flexWrap: 'wrap',
              justifyContent: 'center',
            }}>
              <TypeTab
                type="classic"
                label="Guard"
                shortcut="G"
                icon={<GuardIcon size={20} />}
                isActive={transitionType === 'classic'}
                onClick={() => setTransitionType('classic')}
              />
              <TypeTab
                type="timed"
                label="Timed"
                shortcut="A"
                icon={<TimerIcon size={20} />}
                isActive={transitionType === 'timed'}
                onClick={() => setTransitionType('timed')}
              />
              <TypeTab
                type="event"
                label="Event"
                shortcut="I"
                icon={<SignalIcon size={20} />}
                isActive={transitionType === 'event'}
                onClick={() => setTransitionType('event')}
              />
              <TypeTab
                type="probabilistic"
                label="Random"
                shortcut="P"
                icon={<DiceIcon size={20} />}
                isActive={transitionType === 'probabilistic'}
                onClick={() => setTransitionType('probabilistic')}
              />
              <TypeTab
                type="immediate"
                label="Immediate"
                shortcut="E"
                icon={<LightningIcon size={20} />}
                isActive={transitionType === 'immediate'}
                onClick={() => setTransitionType('immediate')}
              />
            </div>
            
            {/* State selection */}
            <div className="transition-states-row" style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)', marginBottom: 'var(--spacing-3)' }}>
              <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                <label htmlFor="fromState">From</label>
                <select
                  id="fromState"
                  value={fromState}
                  onChange={(e) => setFromState(e.target.value)}
                  required
                >
                  {states.map((state) => (
                    <option key={state.id} value={state.id}>
                      {state.name}
                    </option>
                  ))}
                </select>
              </div>
              
              <div style={{ marginTop: 20 }}>
                <IconArrowRight />
              </div>
              
              <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                <label htmlFor="toState">To</label>
                <select
                  id="toState"
                  value={toState}
                  onChange={(e) => setToState(e.target.value)}
                  required
                >
                  {states.map((state) => (
                    <option key={state.id} value={state.id}>
                      {state.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            
            {/* Name */}
            <div className="form-group">
              <label htmlFor="transitionName">Name</label>
              <input
                id="transitionName"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={`${getStateName(fromState)} → ${getStateName(toState)}`}
              />
            </div>
            
            {/* Type-specific editor */}
            {transitionType === 'classic' && (
              <div className="form-group">
                <label htmlFor="condition">Guard Condition (Lua)</label>
                <input
                  id="condition"
                  type="text"
                  value={condition}
                  onChange={(e) => setCondition(e.target.value)}
                  placeholder="e.g., check('input1') and value('temp') > 30"
                />
                <span className="form-hint">Expression that must return true for transition to fire</span>
              </div>
            )}
            
            {transitionType === 'timed' && (
              <TimerEditor config={timedConfig} onChange={setTimedConfig} />
            )}
            
            {transitionType === 'event' && (
              <EventEditor
                config={eventConfig}
                onChange={setEventConfig}
                availableSignals={availableSignals}
              />
            )}
            
            {transitionType === 'probabilistic' && (
              <ProbabilisticEditor
                config={probabilisticConfig}
                onChange={setProbabilisticConfig}
                siblingWeights={siblingWeights}
              />
            )}
            
            {transitionType === 'immediate' && (
              <div style={{
                marginTop: 'var(--spacing-3)',
                padding: 'var(--spacing-3)',
                backgroundColor: 'var(--color-bg-tertiary)',
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--font-size-sm)',
                color: 'var(--color-text-secondary)',
              }}>
                <strong>ε-transition:</strong> This transition fires immediately when the source state is entered, with no guard condition.
              </div>
            )}
            
            {/* Priority */}
            <div className="form-group" style={{ marginTop: 'var(--spacing-3)' }}>
              <label htmlFor="priority">Priority: {priority}</label>
              <input
                type="range"
                id="priority"
                min={-10}
                max={10}
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
                style={{ width: '100%' }}
              />
              <span className="form-hint">Lower values = higher priority. Used when multiple transitions are valid.</span>
            </div>
          </div>
          
          <div className="dialog-footer" style={{ display: 'flex', justifyContent: 'space-between', padding: 'var(--spacing-3)', borderTop: '1px solid var(--color-border)' }}>
            <div>
              {editTransitionId && (
                <button type="button" className="btn btn-danger" onClick={handleDelete}>
                  Delete
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 'var(--spacing-2)' }}>
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                {editTransitionId ? 'Save' : 'Create'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
