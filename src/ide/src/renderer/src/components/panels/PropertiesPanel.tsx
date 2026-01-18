/**
 * Aetherium Automata - Properties Panel Component
 * 
 * Shows and edits properties of selected automata, states, or transitions.
 * Includes full transition type information and probabilistic grouping.
 */

import React, { useMemo, useState } from 'react';
import { useAutomataStore } from '../../stores';
import { IconSettings, IconAutomata, IconState, IconTransition } from '../common/Icons';
import { IOVariablesPanel } from './IOVariablesPanel';
import type { State, Transition } from '../../types';

// ============================================================================
// Transition Type Icons
// ============================================================================

const GuardIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <path d="M8 1L2 3v5c0 4 2.5 6 6 7 3.5-1 6-3 6-7V3L8 1zm0 1.3l5 1.6v4.6c0 3.2-2 4.8-5 5.8-3-.9-5-2.6-5-5.8V3.9l5-1.6z"/>
  </svg>
);

const TimerIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <path d="M8 2a6 6 0 100 12A6 6 0 008 2zM1 8a7 7 0 1114 0A7 7 0 011 8z"/>
    <path d="M8 4v4.5l3 1.5-.5 1L7 9V4h1z"/>
  </svg>
);

const EventIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <path d="M1 8h2l2-4 2 8 2-4 2 2 2-1 2 1V8h1v2l-3 1-2-2-2 4-2-8-2 4H1V8z"/>
  </svg>
);

const DiceIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <path d="M2 2h12v12H2V2zm1 1v10h10V3H3z"/>
    <circle cx="5" cy="5" r="1"/>
    <circle cx="11" cy="5" r="1"/>
    <circle cx="8" cy="8" r="1"/>
    <circle cx="5" cy="11" r="1"/>
    <circle cx="11" cy="11" r="1"/>
  </svg>
);

const LightningIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <path d="M9 1L3 9h4l-1 6 6-8H8l1-6z"/>
  </svg>
);

// ============================================================================
// Helper Functions
// ============================================================================

type TransitionTypeLabel = 'classic' | 'timed' | 'event' | 'probabilistic' | 'immediate';

function inferTransitionType(transition: Transition): TransitionTypeLabel {
  if (transition.condition === 'true' || transition.condition === '') {
    return 'immediate';
  }
  if (transition.condition?.includes('after(') || 
      transition.condition?.includes('timeout(') ||
      transition.condition?.includes('elapsed(')) {
    return 'timed';
  }
  if (transition.condition?.includes('check(') ||
      transition.condition?.includes('input(') ||
      transition.condition?.includes('signal(')) {
    return 'event';
  }
  if (transition.probabilistic?.enabled || (transition.weight && transition.weight !== 1)) {
    return 'probabilistic';
  }
  return 'classic';
}

function getTransitionTypeColor(type: TransitionTypeLabel): string {
  switch (type) {
    case 'classic': return 'var(--color-success)';
    case 'timed': return 'var(--color-info)';
    case 'event': return 'var(--color-warning)';
    case 'probabilistic': return 'var(--color-accent)';
    case 'immediate': return 'var(--color-danger)';
  }
}

function getTransitionTypeIcon(type: TransitionTypeLabel): React.ReactNode {
  switch (type) {
    case 'classic': return <GuardIcon />;
    case 'timed': return <TimerIcon />;
    case 'event': return <EventIcon />;
    case 'probabilistic': return <DiceIcon />;
    case 'immediate': return <LightningIcon />;
  }
}

// ============================================================================
// Probabilistic Group Component
// ============================================================================

interface ProbabilisticGroupProps {
  transitions: Transition[];
  selectedTransitionId: string;
  stateNames: Record<string, string>;
}

const ProbabilisticGroup: React.FC<ProbabilisticGroupProps> = ({ 
  transitions, 
  selectedTransitionId,
  stateNames,
}) => {
  const totalWeight = transitions.reduce((sum, t) => sum + (t.weight || 1), 0);
  
  return (
    <div style={{
      marginTop: 'var(--spacing-3)',
      padding: 'var(--spacing-3)',
      backgroundColor: 'var(--color-bg-tertiary)',
      borderRadius: 'var(--radius-md)',
      border: '1px solid var(--color-accent)',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        marginBottom: 'var(--spacing-2)',
        gap: 'var(--spacing-2)',
      }}>
        <DiceIcon size={14} />
        <span style={{ fontWeight: 500, fontSize: 'var(--font-size-sm)' }}>
          Probabilistic Group
        </span>
        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>
          ({transitions.length} transitions)
        </span>
      </div>
      
      <div style={{
        display: 'flex',
        height: 20,
        borderRadius: 'var(--radius-sm)',
        overflow: 'hidden',
        marginBottom: 'var(--spacing-2)',
      }}>
        {transitions.map((t, i) => {
          const weight = t.weight || 1;
          const percent = totalWeight > 0 ? (weight / totalWeight) * 100 : 0;
          const isSelected = t.id === selectedTransitionId;
          
          return (
            <div
              key={t.id}
              style={{
                width: `${percent}%`,
                backgroundColor: isSelected ? 'var(--color-primary)' : `hsl(${i * 60}, 60%, 50%)`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 'var(--font-size-xs)',
                color: 'white',
                fontWeight: 500,
                borderRight: i < transitions.length - 1 ? '1px solid var(--color-bg-primary)' : 'none',
              }}
              title={`${t.name}: ${percent.toFixed(1)}%`}
            >
              {percent >= 10 ? `${percent.toFixed(0)}%` : ''}
            </div>
          );
        })}
      </div>
      
      <div style={{ fontSize: 'var(--font-size-xs)' }}>
        {transitions.map((t, i) => {
          const weight = t.weight || 1;
          const percent = totalWeight > 0 ? (weight / totalWeight) * 100 : 0;
          const isSelected = t.id === selectedTransitionId;
          
          return (
            <div
              key={t.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: 'var(--spacing-1) 0',
                opacity: isSelected ? 1 : 0.7,
                fontWeight: isSelected ? 500 : 400,
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  backgroundColor: isSelected ? 'var(--color-primary)' : `hsl(${i * 60}, 60%, 50%)`,
                  marginRight: 'var(--spacing-2)',
                }}
              />
              <span style={{ flex: 1 }}>→ {stateNames[t.to] || t.to}</span>
              <span style={{ color: 'var(--color-text-tertiary)' }}>{percent.toFixed(1)}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ============================================================================
// Transition Type Badge
// ============================================================================

const TransitionTypeBadge: React.FC<{ type: TransitionTypeLabel }> = ({ type }) => (
  <div style={{
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--spacing-1)',
    padding: 'var(--spacing-1) var(--spacing-2)',
    backgroundColor: getTransitionTypeColor(type),
    borderRadius: 'var(--radius-sm)',
    fontSize: 'var(--font-size-xs)',
    color: 'white',
    fontWeight: 500,
    textTransform: 'capitalize',
  }}>
    {getTransitionTypeIcon(type)}
    <span>{type}</span>
  </div>
);

// ============================================================================
// Main Panel Component
// ============================================================================

export const PropertiesPanel: React.FC = () => {
  const activeAutomata = useAutomataStore((state) => {
    const id = state.activeAutomataId;
    return id ? state.automata.get(id) : undefined;
  });
  const selectedStateIds = useAutomataStore((state) => state.selectedStateIds);
  const selectedTransitionIds = useAutomataStore((state) => state.selectedTransitionIds);
  const updateState = useAutomataStore((state) => state.updateState);
  const updateTransition = useAutomataStore((state) => state.updateTransition);
  const normalizeProbabilities = useAutomataStore((state) => state.normalizeProbabilities);
  
  const selectedState: State | undefined = activeAutomata && selectedStateIds.length === 1
    ? activeAutomata.states[selectedStateIds[0]]
    : undefined;
  
  const selectedTransition: Transition | undefined = activeAutomata && selectedTransitionIds.length === 1
    ? activeAutomata.transitions[selectedTransitionIds[0]]
    : undefined;
  
  // Get probabilistic group for selected transition
  const probabilisticGroup = useMemo(() => {
    if (!activeAutomata || !selectedTransition) return null;
    const siblings = Object.values(activeAutomata.transitions).filter(
      (t) => t.from === selectedTransition.from
    );
    const hasProbabilistic = siblings.some(
      (t) => t.probabilistic?.enabled || (t.weight && t.weight !== 1)
    );
    if (hasProbabilistic && siblings.length > 1) {
      return siblings;
    }
    return null;
  }, [activeAutomata, selectedTransition]);
  
  const stateNames = useMemo(() => {
    if (!activeAutomata) return {};
    const names: Record<string, string> = {};
    Object.values(activeAutomata.states).forEach((s) => {
      names[s.id] = s.name;
    });
    return names;
  }, [activeAutomata]);
  
  // Show state properties
  if (selectedState && activeAutomata) {
    return (
      <div className="properties-panel">
        <div className="panel-header">
          <IconState size={14} />
          <span>State Properties</span>
        </div>
        
        <div className="properties-content">
          <div className="property-group">
            <label className="property-label">Name</label>
            <input
              type="text"
              className="property-input"
              value={selectedState.name}
              onChange={(e) => updateState(selectedState.id, { name: e.target.value })}
            />
          </div>
          
          <div className="property-group">
            <label className="property-label">Composite</label>
            <select
              className="property-select"
              value={selectedState.isComposite ? 'yes' : 'no'}
              onChange={(e) => updateState(selectedState.id, { isComposite: e.target.value === 'yes' })}
            >
              <option value="no">Normal State</option>
              <option value="yes">Composite (Nested)</option>
            </select>
          </div>
          
          <div className="property-group">
            <label className="property-label">Description</label>
            <textarea
              className="property-textarea"
              value={selectedState.description || ''}
              onChange={(e) => updateState(selectedState.id, { description: e.target.value })}
              rows={3}
            />
          </div>
          
          <div className="property-group">
            <label className="property-label">Position</label>
            <div style={{ display: 'flex', gap: 'var(--spacing-2)' }}>
              <div style={{ flex: 1 }}>
                <label className="property-sublabel">X</label>
                <input
                  type="number"
                  className="property-input"
                  value={selectedState.position.x}
                  onChange={(e) => updateState(selectedState.id, {
                    position: { ...selectedState.position, x: parseFloat(e.target.value) || 0 }
                  })}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label className="property-sublabel">Y</label>
                <input
                  type="number"
                  className="property-input"
                  value={selectedState.position.y}
                  onChange={(e) => updateState(selectedState.id, {
                    position: { ...selectedState.position, y: parseFloat(e.target.value) || 0 }
                  })}
                />
              </div>
            </div>
          </div>
          
          <div className="property-group">
            <label className="property-label">Lua Code</label>
            <div className="property-code-hint">
              Double-click state in editor to edit Lua code
            </div>
          </div>
          
          {selectedState.color && (
            <div className="property-group">
              <label className="property-label">Color</label>
              <input
                type="color"
                className="property-input"
                value={selectedState.color}
                onChange={(e) => updateState(selectedState.id, { color: e.target.value })}
              />
            </div>
          )}
        </div>
      </div>
    );
  }
  
  // Show transition properties
  if (selectedTransition && activeAutomata) {
    const stateEntries = Object.entries(activeAutomata.states);
    const transitionType = inferTransitionType(selectedTransition);
    
    return (
      <div className="properties-panel">
        <div className="panel-header">
          <IconTransition size={14} />
          <span>Transition Properties</span>
        </div>
        
        <div className="properties-content">
          {/* Transition Type Badge */}
          <div className="property-group">
            <TransitionTypeBadge type={transitionType} />
          </div>
          
          <div className="property-group">
            <label className="property-label">Name</label>
            <input
              type="text"
              className="property-input"
              value={selectedTransition.name}
              onChange={(e) => updateTransition(selectedTransition.id, { name: e.target.value })}
            />
          </div>
          
          <div className="property-group">
            <label className="property-label">From State</label>
            <select
              className="property-select"
              value={selectedTransition.from}
              onChange={(e) => updateTransition(selectedTransition.id, { from: e.target.value })}
            >
              {stateEntries.map(([id, s]) => (
                <option key={id} value={id}>{s.name}</option>
              ))}
            </select>
          </div>
          
          <div className="property-group">
            <label className="property-label">To State</label>
            <select
              className="property-select"
              value={selectedTransition.to}
              onChange={(e) => updateTransition(selectedTransition.id, { to: e.target.value })}
            >
              {stateEntries.map(([id, s]) => (
                <option key={id} value={id}>{s.name}</option>
              ))}
            </select>
          </div>
          
          {/* Guard Condition */}
          <div className="property-group">
            <label className="property-label">Guard Condition</label>
            <textarea
              className="property-textarea"
              value={selectedTransition.condition || ''}
              onChange={(e) => updateTransition(selectedTransition.id, { condition: e.target.value })}
              rows={2}
              placeholder="e.g., check('input1') and value('temp') > 30"
              style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)' }}
            />
          </div>
          
          {/* Action Body */}
          <div className="property-group">
            <label className="property-label">Action (Lua)</label>
            <textarea
              className="property-textarea"
              value={selectedTransition.body || ''}
              onChange={(e) => updateTransition(selectedTransition.id, { body: e.target.value })}
              rows={3}
              placeholder="-- Code to execute on transition"
              style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)' }}
            />
          </div>
          
          <div className="property-group">
            <label className="property-label">Priority: {selectedTransition.priority || 0}</label>
            <input
              type="range"
              min={-10}
              max={10}
              value={selectedTransition.priority || 0}
              onChange={(e) => updateTransition(selectedTransition.id, { 
                priority: parseInt(e.target.value) || 0 
              })}
              style={{ width: '100%' }}
            />
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>
              Lower values = higher priority
            </span>
          </div>
          
          <div className="property-group">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <label className="property-label" style={{ marginBottom: 0 }}>
                Weight: {((selectedTransition.weight || 1) * 100).toFixed(0)}%
              </label>
              {probabilisticGroup && probabilisticGroup.length > 1 && (
                <button
                  className="btn btn-ghost btn-xs"
                  onClick={() => normalizeProbabilities(selectedTransition.from)}
                  title="Normalize all weights from this state to 100%"
                  style={{ fontSize: 'var(--font-size-xs)' }}
                >
                  Normalize to 100%
                </button>
              )}
            </div>
            <input
              type="range"
              min={1}
              max={100}
              value={Math.round((selectedTransition.weight || 1) * 100)}
              onChange={(e) => updateTransition(selectedTransition.id, { 
                weight: parseInt(e.target.value) / 100
              })}
              style={{ width: '100%' }}
            />
            {probabilisticGroup && probabilisticGroup.length > 1 && (
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>
                Total from this state: {Math.round(probabilisticGroup.reduce((sum, t) => sum + (t.weight || 1), 0) * 100)}%
              </span>
            )}
          </div>
          
          {/* Probabilistic Group Visualization */}
          {probabilisticGroup && (
            <ProbabilisticGroup
              transitions={probabilisticGroup}
              selectedTransitionId={selectedTransition.id}
              stateNames={stateNames}
            />
          )}
          
          <div className="property-group">
            <label className="property-label">Description</label>
            <textarea
              className="property-textarea"
              value={selectedTransition.description || ''}
              onChange={(e) => updateTransition(selectedTransition.id, { description: e.target.value })}
              rows={3}
            />
          </div>
          
          {/* Fuzzy Logic Guard */}
          <div className="property-group">
            <label className="property-label">
              <span>Fuzzy Guard</span>
              <span className="property-badge">Optional</span>
            </label>
            {selectedTransition.fuzzyGuard?.enabled ? (
              <div className="property-fuzzy">
                <div className="fuzzy-expression">Fuzzy logic enabled</div>
              </div>
            ) : (
              <button className="btn btn-ghost btn-sm">+ Add Fuzzy Guard</button>
            )}
          </div>
          
          {/* Probabilistic Weight */}
          <div className="property-group">
            <label className="property-label">
              <span>Probabilistic Selection</span>
              <span className="property-badge">Markov</span>
            </label>
            {selectedTransition.probabilistic?.enabled ? (
              <div className="property-probability">
                <div>Weight: {selectedTransition.probabilistic.weight}</div>
                {selectedTransition.probabilistic.condition && (
                  <div className="probability-condition">
                    Condition: {selectedTransition.probabilistic.condition}
                  </div>
                )}
              </div>
            ) : (
              <button className="btn btn-ghost btn-sm">+ Enable Probabilistic</button>
            )}
          </div>
        </div>
      </div>
    );
  }
  
  // Show automata properties
  if (activeAutomata) {
    const stateCount = Object.keys(activeAutomata.states).length;
    const transitionCount = Object.keys(activeAutomata.transitions).length;
    
    return (
      <div className="properties-panel">
        <div className="panel-header">
          <IconAutomata size={14} />
          <span>Automata Properties</span>
        </div>
        
        <div className="properties-content">
          <div className="property-group">
            <label className="property-label">Name</label>
            <input
              type="text"
              className="property-input"
              value={activeAutomata.config.name}
              readOnly
            />
          </div>
          
          <div className="property-group">
            <label className="property-label">Version</label>
            <input
              type="text"
              className="property-input"
              value={activeAutomata.config.version}
              readOnly
            />
          </div>
          
          <div className="property-group">
            <label className="property-label">Description</label>
            <textarea
              className="property-textarea"
              value={activeAutomata.config.description || ''}
              readOnly
              rows={3}
            />
          </div>
          
          <div className="property-group">
            <label className="property-label">Author</label>
            <input
              type="text"
              className="property-input"
              value={activeAutomata.config.author || ''}
              readOnly
            />
          </div>
          
          <div className="property-info">
            <div className="info-row">
              <span className="info-label">States:</span>
              <span className="info-value">{stateCount}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Transitions:</span>
              <span className="info-value">{transitionCount}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Created:</span>
              <span className="info-value">
                {new Date(activeAutomata.config.created || Date.now()).toLocaleDateString()}
              </span>
            </div>
            <div className="info-row">
              <span className="info-label">Modified:</span>
              <span className="info-value">
                {new Date(activeAutomata.config.modified || Date.now()).toLocaleDateString()}
              </span>
            </div>
          </div>
          
          {/* Integrated I/O & Variables Section */}
          <div style={{ 
            marginTop: 'var(--spacing-4)',
            borderTop: '1px solid var(--color-border)',
            paddingTop: 'var(--spacing-3)',
          }}>
            <IOVariablesPanel embedded />
          </div>
        </div>
      </div>
    );
  }
  
  // Empty state
  return (
    <div className="properties-panel">
      <div className="panel-header">
        <IconSettings size={14} />
        <span>Properties</span>
      </div>
      
      <div className="properties-empty">
        <p>Select an automata, state, or transition to view its properties.</p>
      </div>
    </div>
  );
};
