/**
 * Aetherium Automata - Properties Panel Component
 * 
 * Shows and edits properties of selected automata, states, or transitions.
 */

import React from 'react';
import { useAutomataStore } from '../../stores';
import { IconSettings, IconAutomata, IconState, IconTransition } from '../common/Icons';
import type { State, Transition } from '../../types';

export const PropertiesPanel: React.FC = () => {
  const activeAutomata = useAutomataStore((state) => {
    const id = state.activeAutomataId;
    return id ? state.automata.get(id) : undefined;
  });
  const selectedStateIds = useAutomataStore((state) => state.selectedStateIds);
  const selectedTransitionIds = useAutomataStore((state) => state.selectedTransitionIds);
  const updateState = useAutomataStore((state) => state.updateState);
  const updateTransition = useAutomataStore((state) => state.updateTransition);
  
  // Get selected items from Record
  const selectedState: State | undefined = activeAutomata && selectedStateIds.length === 1
    ? activeAutomata.states[selectedStateIds[0]]
    : undefined;
  
  const selectedTransition: Transition | undefined = activeAutomata && selectedTransitionIds.length === 1
    ? activeAutomata.transitions[selectedTransitionIds[0]]
    : undefined;
  
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
    
    return (
      <div className="properties-panel">
        <div className="panel-header">
          <IconTransition size={14} />
          <span>Transition Properties</span>
        </div>
        
        <div className="properties-content">
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
          
          <div className="property-group">
            <label className="property-label">Priority</label>
            <input
              type="number"
              className="property-input"
              value={selectedTransition.priority || 0}
              min={0}
              onChange={(e) => updateTransition(selectedTransition.id, { 
                priority: parseInt(e.target.value) || 0 
              })}
            />
          </div>
          
          <div className="property-group">
            <label className="property-label">Weight (Probabilistic)</label>
            <input
              type="number"
              className="property-input"
              value={selectedTransition.weight || 1}
              min={0}
              max={1}
              step={0.1}
              onChange={(e) => updateTransition(selectedTransition.id, { 
                weight: parseFloat(e.target.value) || 1 
              })}
            />
          </div>
          
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
