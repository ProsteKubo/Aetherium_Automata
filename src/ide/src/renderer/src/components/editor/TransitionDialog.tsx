/**
 * Aetherium Automata - Transition Dialog Component
 * 
 * Modal dialog for creating and editing transitions between states.
 */

import React, { useState, useEffect, useRef } from 'react';
import { useAutomataStore } from '../../stores';
import { IconClose, IconArrowRight } from '../common/Icons';

interface TransitionDialogProps {
  automataId: string;
  isOpen: boolean;
  onClose: () => void;
  editTransitionId?: string; // If provided, edit existing transition
}

export const TransitionDialog: React.FC<TransitionDialogProps> = ({
  automataId,
  isOpen,
  onClose,
  editTransitionId,
}) => {
  const automata = useAutomataStore((state) => state.automata.get(automataId));
  const addTransition = useAutomataStore((state) => state.addTransition);
  const updateTransition = useAutomataStore((state) => state.updateTransition);
  const deleteTransition = useAutomataStore((state) => state.deleteTransition);
  
  const states = automata ? Object.values(automata.states) : [];
  const existingTransition = editTransitionId && automata 
    ? automata.transitions[editTransitionId] 
    : null;
  
  const [fromState, setFromState] = useState<string>('');
  const [toState, setToState] = useState<string>('');
  const [name, setName] = useState<string>('');
  const [condition, setCondition] = useState<string>('');
  const [priority, setPriority] = useState<number>(0);
  
  // Track if we've initialized for this dialog session
  const initializedRef = useRef<string | null>(null);
  
  // Reset form only when dialog opens fresh or editing a different transition
  useEffect(() => {
    if (!isOpen) {
      // Reset tracking when dialog closes
      initializedRef.current = null;
      return;
    }
    
    // Create a key for this dialog session
    const sessionKey = editTransitionId || 'new';
    
    // Only initialize if we haven't for this session
    if (initializedRef.current === sessionKey) {
      return;
    }
    
    initializedRef.current = sessionKey;
    
    if (existingTransition) {
      setFromState(existingTransition.from);
      setToState(existingTransition.to);
      setName(existingTransition.name);
      setCondition(existingTransition.condition || '');
      setPriority(existingTransition.priority || 0);
    } else {
      setFromState(states[0]?.id || '');
      setToState(states[1]?.id || states[0]?.id || '');
      setName('');
      setCondition('');
      setPriority(0);
    }
  }, [isOpen, editTransitionId]);
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!fromState || !toState) return;
    
    const transitionName = name.trim() || `${getStateName(fromState)} → ${getStateName(toState)}`;
    
    if (editTransitionId) {
      updateTransition(editTransitionId, {
        from: fromState,
        to: toState,
        name: transitionName,
        condition,
        priority,
      });
    } else {
      addTransition({
        from: fromState,
        to: toState,
        name: transitionName,
        condition,
        body: '',
        priority,
        weight: 1,
      });
    }
    
    onClose();
  };
  
  const handleDelete = () => {
    if (editTransitionId) {
      deleteTransition(editTransitionId);
      onClose();
    }
  };
  
  const getStateName = (stateId: string): string => {
    const state = states.find(s => s.id === stateId);
    return state?.name || stateId;
  };
  
  if (!isOpen) return null;
  
  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog transition-dialog" onClick={e => e.stopPropagation()}>
        <div className="dialog-header">
          <h2>{editTransitionId ? 'Edit Transition' : 'Create Transition'}</h2>
          <button className="dialog-close" onClick={onClose}>
            <IconClose />
          </button>
        </div>
        
        <form onSubmit={handleSubmit}>
          <div className="dialog-body">
            {states.length < 2 && !editTransitionId ? (
              <div className="dialog-warning">
                You need at least 2 states to create a transition.
              </div>
            ) : (
              <>
                <div className="transition-states-row">
                  <div className="form-group">
                    <label htmlFor="fromState">From State</label>
                    <select
                      id="fromState"
                      value={fromState}
                      onChange={e => setFromState(e.target.value)}
                      required
                    >
                      {states.map(state => (
                        <option key={state.id} value={state.id}>
                          {state.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  
                  <div className="transition-arrow">
                    <IconArrowRight />
                  </div>
                  
                  <div className="form-group">
                    <label htmlFor="toState">To State</label>
                    <select
                      id="toState"
                      value={toState}
                      onChange={e => setToState(e.target.value)}
                      required
                    >
                      {states.map(state => (
                        <option key={state.id} value={state.id}>
                          {state.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                
                <div className="form-group">
                  <label htmlFor="transitionName">
                    Name <span className="optional">(optional)</span>
                  </label>
                  <input
                    id="transitionName"
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder={`${getStateName(fromState)} → ${getStateName(toState)}`}
                  />
                </div>
                
                <div className="form-group">
                  <label htmlFor="condition">
                    Guard Condition <span className="optional">(optional)</span>
                  </label>
                  <input
                    id="condition"
                    type="text"
                    value={condition}
                    onChange={e => setCondition(e.target.value)}
                    placeholder="e.g., temperature > 30"
                  />
                  <span className="form-hint">Lua expression that must be true for transition</span>
                </div>
                
                <div className="form-group">
                  <label htmlFor="priority">Priority</label>
                  <input
                    id="priority"
                    type="number"
                    value={priority}
                    onChange={e => setPriority(parseInt(e.target.value) || 0)}
                    min={0}
                    max={100}
                  />
                  <span className="form-hint">Higher priority transitions are evaluated first</span>
                </div>
              </>
            )}
          </div>
          
          <div className="dialog-footer">
            {editTransitionId && (
              <button 
                type="button" 
                className="btn btn-danger"
                onClick={handleDelete}
              >
                Delete
              </button>
            )}
            <div className="dialog-actions">
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <button 
                type="submit" 
                className="btn btn-primary"
                disabled={states.length < 2 && !editTransitionId}
              >
                {editTransitionId ? 'Save' : 'Create'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
