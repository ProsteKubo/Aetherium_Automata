/**
 * Aetherium Automata - Variable Management Panel
 * 
 * Unified panel for managing all variables (inputs, outputs, internal)
 * with usage tracking across states and transitions.
 */

import React, { useState, useMemo, useCallback } from 'react';
import { useAutomataStore } from '../../stores';
import type { State, Transition, VariableDefinition, VariableType } from '../../types';
import {
  trackVariableUsage,
  type VariableUsage,
  type VariableUsageLocation,
} from '../../types/connections';

// ============================================================================
// Icons
// ============================================================================

const InputIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <path d="M6 3L10 8L6 13V10H1V6H6V3Z" />
    <rect x="11" y="3" width="4" height="10" rx="1" />
  </svg>
);

const OutputIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <path d="M10 3L14 8L10 13V10H5V6H10V3Z" />
    <rect x="1" y="3" width="4" height="10" rx="1" />
  </svg>
);

const VariableIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <path d="M4 2L6 14M10 2L12 14M2 5H14M2 11H14" stroke="currentColor" strokeWidth="1.5" fill="none" />
  </svg>
);

const ChevronIcon: React.FC<{ size?: number; expanded?: boolean }> = ({ size = 14, expanded = false }) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 16 16" 
    fill="currentColor"
    style={{ 
      transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
      transition: 'transform 0.15s ease',
    }}
  >
    <path d="M6 4l4 4-4 4V4z"/>
  </svg>
);

const PlusIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="1.5" fill="none"/>
  </svg>
);

const TrashIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <path d="M5 2V1h6v1h4v2H1V2h4zM3 5h10l-1 10H4L3 5z" stroke="currentColor" strokeWidth="1" fill="none"/>
  </svg>
);

const SearchIcon: React.FC<{ size?: number; style?: React.CSSProperties }> = ({ size = 14, style }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" style={style}>
    <circle cx="6" cy="6" r="5" stroke="currentColor" fill="none" strokeWidth="1.5"/>
    <path d="M10 10l4 4" stroke="currentColor" strokeWidth="1.5"/>
  </svg>
);

const LinkIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <path d="M6 10L10 6M8 4l2-2a2.83 2.83 0 014 4l-2 2M8 12l-2 2a2.83 2.83 0 01-4-4l2-2" 
      stroke="currentColor" strokeWidth="1.5" fill="none"/>
  </svg>
);

// ============================================================================
// Types
// ============================================================================

type VariableDirection = 'input' | 'output' | 'internal' | 'all';
type SortBy = 'name' | 'type' | 'usage' | 'direction';

interface VariableWithUsage extends VariableDefinition {
  usage: VariableUsage;
}

// ============================================================================
// Usage Badge Component
// ============================================================================

// ============================================================================
// Variable Row Component
// ============================================================================

interface VariableRowProps {
  variable: VariableWithUsage;
  isExpanded: boolean;
  onToggle: () => void;
  onUpdate: (updates: Partial<VariableDefinition>) => void;
  onDelete: () => void;
  onNavigate: (location: VariableUsageLocation) => void;
  states: Record<string, State>;
  transitions: Record<string, Transition>;
}

const VariableRow: React.FC<VariableRowProps> = ({
  variable,
  isExpanded,
  onToggle,
  onUpdate,
  onDelete,
  onNavigate,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(variable.name);
  
  const getDirectionIcon = () => {
    switch (variable.direction) {
      case 'input': return <InputIcon />;
      case 'output': return <OutputIcon />;
      default: return <VariableIcon />;
    }
  };
  
  const getDirectionColor = () => {
    switch (variable.direction) {
      case 'input': return 'var(--color-success)';
      case 'output': return 'var(--color-warning)';
      default: return 'var(--color-info)';
    }
  };
  
  const getTypeLabel = (type: string): string => {
    const labels: Record<string, string> = {
      bool: 'Boolean',
      int: 'Integer',
      float: 'Float',
      string: 'String',
      binary: 'Binary',
    };
    return labels[type] || type;
  };
  
  const handleSaveName = () => {
    if (editName && editName !== variable.name) {
      onUpdate({ name: editName });
    }
    setIsEditing(false);
  };
  
  const totalUsage = 
    variable.usage.reads.length + 
    variable.usage.writes.length + 
    variable.usage.conditions.length;

  return (
    <div
      className="variable-row"
      style={{
        marginBottom: 'var(--spacing-2)',
        backgroundColor: 'var(--color-bg-secondary)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border)',
        overflow: 'hidden',
      }}
    >
      {/* Variable header */}
      <div
        className="variable-header"
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: 'var(--spacing-2) var(--spacing-3)',
          cursor: 'pointer',
          backgroundColor: isExpanded ? 'var(--color-bg-tertiary)' : 'transparent',
          transition: 'background-color 0.15s ease',
        }}
      >
        <ChevronIcon expanded={isExpanded} />
        
        <span style={{ 
          marginLeft: 'var(--spacing-2)', 
          color: getDirectionColor(),
        }}>
          {getDirectionIcon()}
        </span>
        
        <div style={{ 
          marginLeft: 'var(--spacing-2)', 
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--spacing-2)',
        }}>
          {isEditing ? (
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={handleSaveName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveName();
                if (e.key === 'Escape') {
                  setEditName(variable.name);
                  setIsEditing(false);
                }
              }}
              onClick={(e) => e.stopPropagation()}
              autoFocus
              style={{
                padding: '2px 6px',
                fontSize: 'var(--font-size-sm)',
                fontWeight: 600,
                backgroundColor: 'var(--color-bg-primary)',
                border: '1px solid var(--color-primary)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--color-text-primary)',
                outline: 'none',
              }}
            />
          ) : (
            <span 
              style={{ 
                fontWeight: 600, 
                color: 'var(--color-text-primary)',
                cursor: 'text',
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setIsEditing(true);
              }}
            >
              {variable.name}
            </span>
          )}
          
          <span style={{
            padding: '1px 6px',
            backgroundColor: 'var(--color-bg-tertiary)',
            color: 'var(--color-text-tertiary)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--font-size-xs)',
          }}>
            {getTypeLabel(variable.type)}
          </span>
        </div>
        
        {/* Usage count */}
        {totalUsage > 0 && (
          <span style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 'var(--font-size-xs)',
            color: 'var(--color-text-tertiary)',
          }}>
            <LinkIcon size={10} />
            {totalUsage}
          </span>
        )}
        
        {/* Delete button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="btn btn-ghost btn-icon btn-xs"
          style={{
            marginLeft: 'var(--spacing-2)',
            opacity: 0.5,
          }}
        >
          <TrashIcon size={12} />
        </button>
      </div>
      
      {/* Expanded content */}
      {isExpanded && (
        <div style={{ padding: 'var(--spacing-3)' }}>
          {/* Variable properties */}
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(2, 1fr)', 
            gap: 'var(--spacing-2)',
            marginBottom: 'var(--spacing-3)',
          }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label style={{ fontSize: 'var(--font-size-xs)', marginBottom: 4 }}>Direction</label>
              <select
                value={variable.direction || 'internal'}
                onChange={(e) => onUpdate({ direction: e.target.value as 'input' | 'output' | 'internal' })}
                style={{
                  width: '100%',
                  padding: 'var(--spacing-1) var(--spacing-2)',
                  fontSize: 'var(--font-size-sm)',
                  backgroundColor: 'var(--color-bg-tertiary)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--color-text-primary)',
                }}
              >
                <option value="input">Input</option>
                <option value="output">Output</option>
                <option value="internal">Internal</option>
              </select>
            </div>
            
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label style={{ fontSize: 'var(--font-size-xs)', marginBottom: 4 }}>Type</label>
              <select
                value={variable.type}
                onChange={(e) => onUpdate({ type: e.target.value as VariableType })}
                style={{
                  width: '100%',
                  padding: 'var(--spacing-1) var(--spacing-2)',
                  fontSize: 'var(--font-size-sm)',
                  backgroundColor: 'var(--color-bg-tertiary)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--color-text-primary)',
                }}
              >
                <option value="bool">Boolean</option>
                <option value="int">Integer</option>
                <option value="float">Float</option>
                <option value="string">String</option>
                <option value="binary">Binary</option>
              </select>
            </div>
            
            <div className="form-group" style={{ marginBottom: 0, gridColumn: 'span 2' }}>
              <label style={{ fontSize: 'var(--font-size-xs)', marginBottom: 4 }}>Default Value</label>
              <input
                type="text"
                value={variable.default?.toString() ?? ''}
                onChange={(e) => onUpdate({ default: e.target.value })}
                placeholder="No default"
                style={{
                  width: '100%',
                  padding: 'var(--spacing-1) var(--spacing-2)',
                  fontSize: 'var(--font-size-sm)',
                  backgroundColor: 'var(--color-bg-tertiary)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--color-text-primary)',
                }}
              />
            </div>
            
            <div className="form-group" style={{ marginBottom: 0, gridColumn: 'span 2' }}>
              <label style={{ fontSize: 'var(--font-size-xs)', marginBottom: 4 }}>Description</label>
              <input
                type="text"
                value={variable.description || ''}
                onChange={(e) => onUpdate({ description: e.target.value })}
                placeholder="Optional description"
                style={{
                  width: '100%',
                  padding: 'var(--spacing-1) var(--spacing-2)',
                  fontSize: 'var(--font-size-sm)',
                  backgroundColor: 'var(--color-bg-tertiary)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--color-text-primary)',
                }}
              />
            </div>
          </div>
          
          {/* Usage locations */}
          <div style={{
            backgroundColor: 'var(--color-bg-tertiary)',
            borderRadius: 'var(--radius-sm)',
            padding: 'var(--spacing-2)',
          }}>
            <div style={{
              fontSize: 'var(--font-size-xs)',
              color: 'var(--color-text-tertiary)',
              marginBottom: 'var(--spacing-2)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}>
              Usage Locations
            </div>
            
            {totalUsage === 0 ? (
              <div style={{
                fontSize: 'var(--font-size-sm)',
                color: 'var(--color-text-tertiary)',
                fontStyle: 'italic',
              }}>
                Not used anywhere
              </div>
            ) : (
              <>
                {/* Reads */}
                {variable.usage.reads.length > 0 && (
                  <div style={{ marginBottom: 'var(--spacing-2)' }}>
                    <div style={{ 
                      fontSize: 'var(--font-size-xs)', 
                      color: 'var(--color-success)',
                      marginBottom: 4,
                    }}>
                      Reads ({variable.usage.reads.length})
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {variable.usage.reads.map((loc, i) => (
                        <button
                          key={i}
                          onClick={() => onNavigate(loc)}
                          style={{
                            padding: '2px 6px',
                            fontSize: 'var(--font-size-xs)',
                            backgroundColor: 'var(--color-bg-secondary)',
                            border: '1px solid var(--color-border)',
                            borderRadius: 'var(--radius-sm)',
                            color: 'var(--color-text-secondary)',
                            cursor: 'pointer',
                          }}
                        >
                          {loc.type.replace('_', ' ')}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                
                {/* Writes */}
                {variable.usage.writes.length > 0 && (
                  <div style={{ marginBottom: 'var(--spacing-2)' }}>
                    <div style={{ 
                      fontSize: 'var(--font-size-xs)', 
                      color: 'var(--color-warning)',
                      marginBottom: 4,
                    }}>
                      Writes ({variable.usage.writes.length})
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {variable.usage.writes.map((loc, i) => (
                        <button
                          key={i}
                          onClick={() => onNavigate(loc)}
                          style={{
                            padding: '2px 6px',
                            fontSize: 'var(--font-size-xs)',
                            backgroundColor: 'var(--color-bg-secondary)',
                            border: '1px solid var(--color-border)',
                            borderRadius: 'var(--radius-sm)',
                            color: 'var(--color-text-secondary)',
                            cursor: 'pointer',
                          }}
                        >
                          {loc.type.replace('_', ' ')}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                
                {/* Conditions */}
                {variable.usage.conditions.length > 0 && (
                  <div>
                    <div style={{ 
                      fontSize: 'var(--font-size-xs)', 
                      color: 'var(--color-info)',
                      marginBottom: 4,
                    }}>
                      Conditions ({variable.usage.conditions.length})
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {variable.usage.conditions.map((loc, i) => (
                        <button
                          key={i}
                          onClick={() => onNavigate(loc)}
                          style={{
                            padding: '2px 6px',
                            fontSize: 'var(--font-size-xs)',
                            backgroundColor: 'var(--color-bg-secondary)',
                            border: '1px solid var(--color-border)',
                            borderRadius: 'var(--radius-sm)',
                            color: 'var(--color-text-secondary)',
                            cursor: 'pointer',
                          }}
                        >
                          {loc.type.replace('_', ' ')}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// Add Variable Dialog
// ============================================================================

interface AddVariableDialogProps {
  onAdd: (variable: Omit<VariableDefinition, 'id'>) => void;
  onClose: () => void;
}

const AddVariableDialog: React.FC<AddVariableDialogProps> = ({ onAdd, onClose }) => {
  const [name, setName] = useState('');
  const [varType, setVarType] = useState<VariableType>('number');
  const [direction, setDirection] = useState<'input' | 'output' | 'internal'>('internal');
  const [defaultValue, setDefaultValue] = useState('');
  
  const handleAdd = () => {
    if (!name.trim()) return;
    onAdd({
      name: name.trim(),
      type: varType,
      direction,
      default: defaultValue || undefined,
    });
    onClose();
  };
  
  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
    }}>
      <div style={{
        backgroundColor: 'var(--color-bg-primary)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--color-border)',
        padding: 'var(--spacing-4)',
        width: 320,
        boxShadow: 'var(--shadow-lg)',
      }}>
        <h3 style={{ 
          fontSize: 'var(--font-size-md)', 
          marginBottom: 'var(--spacing-3)',
          color: 'var(--color-text-primary)',
        }}>
          Add Variable
        </h3>
        
        <div className="form-group">
          <label>Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="variable_name"
            autoFocus
            style={{
              width: '100%',
              padding: 'var(--spacing-2)',
              fontSize: 'var(--font-size-sm)',
              backgroundColor: 'var(--color-bg-secondary)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--color-text-primary)',
            }}
          />
        </div>
        
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-2)' }}>
          <div className="form-group">
            <label>Direction</label>
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value as 'input' | 'output' | 'internal')}
              style={{
                width: '100%',
                padding: 'var(--spacing-2)',
                fontSize: 'var(--font-size-sm)',
                backgroundColor: 'var(--color-bg-secondary)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--color-text-primary)',
              }}
            >
              <option value="input">Input</option>
              <option value="output">Output</option>
              <option value="internal">Internal</option>
            </select>
          </div>
          
          <div className="form-group">
            <label>Type</label>
            <select
              value={varType}
              onChange={(e) => setVarType(e.target.value as VariableType)}
              style={{
                width: '100%',
                padding: 'var(--spacing-2)',
                fontSize: 'var(--font-size-sm)',
                backgroundColor: 'var(--color-bg-secondary)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--color-text-primary)',
              }}
            >
              <option value="bool">Boolean</option>
              <option value="number">Number</option>
              <option value="string">String</option>
              <option value="any">Any</option>
              <option value="table">Table</option>
            </select>
          </div>
        </div>
        
        <div className="form-group">
          <label>Default Value</label>
          <input
            type="text"
            value={defaultValue}
            onChange={(e) => setDefaultValue(e.target.value)}
            placeholder="Optional"
            style={{
              width: '100%',
              padding: 'var(--spacing-2)',
              fontSize: 'var(--font-size-sm)',
              backgroundColor: 'var(--color-bg-secondary)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--color-text-primary)',
            }}
          />
        </div>
        
        <div style={{ 
          display: 'flex', 
          justifyContent: 'flex-end', 
          gap: 'var(--spacing-2)',
          marginTop: 'var(--spacing-3)',
        }}>
          <button
            onClick={onClose}
            className="btn btn-ghost"
            style={{ padding: 'var(--spacing-2) var(--spacing-3)' }}
          >
            Cancel
          </button>
          <button
            onClick={handleAdd}
            className="btn btn-primary"
            disabled={!name.trim()}
            style={{ padding: 'var(--spacing-2) var(--spacing-3)' }}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// Main Panel Component
// ============================================================================

export const VariableManagementPanel: React.FC = () => {
  const [filterDirection, setFilterDirection] = useState<VariableDirection>('all');
  const [sortBy, setSortBy] = useState<SortBy>('name');
  const [expandedVars, setExpandedVars] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddDialog, setShowAddDialog] = useState(false);
  
  const automata = useAutomataStore((state) => {
    const id = state.activeAutomataId;
    return id ? state.automata.get(id) : undefined;
  });
  const updateAutomataIO = useAutomataStore((state) => state.updateAutomataIO);
  
  // Build variables with usage data
  const variablesWithUsage = useMemo(() => {
    if (!automata) return [];
    
    const variables: VariableWithUsage[] = [];
    const allVars = automata.variables || [];
    const states = automata.states;
    const transitions = automata.transitions;
    
    for (const v of allVars) {
      const usageData = trackVariableUsage(v.name, Object.values(states), Object.values(transitions));
      const usage: VariableUsage = {
        variableName: v.name,
        variableType: v.type,
        direction: v.direction || 'internal',
        usedInStates: [],
        usedInTransitions: [],
        reads: usageData.reads,
        writes: usageData.writes,
        conditions: usageData.conditions,
        totalReads: usageData.reads.length,
        totalWrites: usageData.writes.length,
        isUnused: usageData.reads.length === 0 && usageData.writes.length === 0 && usageData.conditions.length === 0,
      };
      variables.push({ ...v, usage });
    }
    
    // Filter
    let filtered = variables;
    
    if (filterDirection !== 'all') {
      filtered = filtered.filter((v) => v.direction === filterDirection);
    }
    
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter((v) =>
        v.name.toLowerCase().includes(q) ||
        v.description?.toLowerCase().includes(q)
      );
    }
    
    // Sort
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'type':
          return a.type.localeCompare(b.type);
        case 'usage': {
          const usageA = a.usage.reads.length + a.usage.writes.length + a.usage.conditions.length;
          const usageB = b.usage.reads.length + b.usage.writes.length + b.usage.conditions.length;
          return usageB - usageA; // Higher usage first
        }
        case 'direction':
          return (a.direction || 'internal').localeCompare(b.direction || 'internal');
        default:
          return 0;
      }
    });
    
    return filtered;
  }, [automata, filterDirection, sortBy, searchQuery]);
  
  // Statistics
  const stats = useMemo(() => {
    if (!automata) return { inputs: 0, outputs: 0, internal: 0, total: 0 };
    
    const vars = automata.variables || [];
    return {
      inputs: vars.filter((v) => v.direction === 'input').length,
      outputs: vars.filter((v) => v.direction === 'output').length,
      internal: vars.filter((v) => !v.direction || v.direction === 'internal').length,
      total: vars.length,
    };
  }, [automata]);
  
  const handleToggleVar = useCallback((varId: string) => {
    setExpandedVars((prev) => {
      const next = new Set(prev);
      if (next.has(varId)) {
        next.delete(varId);
      } else {
        next.add(varId);
      }
      return next;
    });
  }, []);
  
  const handleUpdateVariable = useCallback((varId: string, updates: Partial<VariableDefinition>) => {
    if (!automata) return;
    
    const vars = (automata.variables || []).map((v) =>
      v.id === varId ? { ...v, ...updates } as VariableDefinition : v
    );
    updateAutomataIO(automata.id, { variables: vars });
  }, [automata, updateAutomataIO]);
  
  const handleDeleteVariable = useCallback((varId: string) => {
    if (!automata) return;
    
    const vars = (automata.variables || []).filter((v) => v.id !== varId);
    updateAutomataIO(automata.id, { variables: vars });
  }, [automata, updateAutomataIO]);
  
  const handleAddVariable = useCallback((variable: Omit<VariableDefinition, 'id'>) => {
    if (!automata) return;
    
    const newVar: VariableDefinition = {
      ...variable,
      id: `var-${Date.now()}`,
    };
    const vars = [...(automata.variables || []), newVar];
    updateAutomataIO(automata.id, { variables: vars });
  }, [automata, updateAutomataIO]);
  
  const handleNavigate = useCallback((location: VariableUsageLocation) => {
    console.log('Navigate to:', location.type);
  }, []);

  if (!automata) {
    return (
      <div className="variable-management-panel empty" style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: 'var(--color-text-tertiary)',
        fontSize: 'var(--font-size-sm)',
      }}>
        No automata selected
      </div>
    );
  }

  return (
    <div className="variable-management-panel" style={{ 
      height: '100%', 
      display: 'flex', 
      flexDirection: 'column',
      backgroundColor: 'var(--color-bg-primary)',
    }}>
      {/* Header */}
      <div style={{
        padding: 'var(--spacing-3)',
        borderBottom: '1px solid var(--color-border)',
      }}>
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between',
          marginBottom: 'var(--spacing-2)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)' }}>
            <VariableIcon size={16} />
            <span style={{ 
              fontWeight: 600, 
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-text-primary)',
            }}>
              Variables
            </span>
          </div>
          
          <button
            onClick={() => setShowAddDialog(true)}
            className="btn btn-primary btn-sm"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 8px',
            }}
          >
            <PlusIcon size={12} />
            Add
          </button>
        </div>
        
        {/* Stats bar */}
        <div style={{
          display: 'flex',
          gap: 'var(--spacing-3)',
          marginBottom: 'var(--spacing-2)',
          fontSize: 'var(--font-size-xs)',
        }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ color: 'var(--color-success)' }}>●</span>
            {stats.inputs} inputs
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ color: 'var(--color-warning)' }}>●</span>
            {stats.outputs} outputs
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ color: 'var(--color-info)' }}>●</span>
            {stats.internal} internal
          </span>
        </div>
        
        {/* Search */}
        <div style={{ position: 'relative', marginBottom: 'var(--spacing-2)' }}>
          <SearchIcon 
            size={14} 
            style={{
              position: 'absolute',
              left: 8,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--color-text-tertiary)',
            } as React.CSSProperties}
          />
          <input
            type="text"
            placeholder="Search variables..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              padding: 'var(--spacing-2) var(--spacing-2) var(--spacing-2) 28px',
              fontSize: 'var(--font-size-sm)',
              backgroundColor: 'var(--color-bg-secondary)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--color-text-primary)',
            }}
          />
        </div>
        
        {/* Filters */}
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <div style={{ display: 'flex', gap: 'var(--spacing-1)' }}>
            {(['all', 'input', 'output', 'internal'] as VariableDirection[]).map((dir) => (
              <button
                key={dir}
                onClick={() => setFilterDirection(dir)}
                style={{
                  padding: '2px 8px',
                  fontSize: 'var(--font-size-xs)',
                  backgroundColor: filterDirection === dir 
                    ? 'var(--color-primary)' 
                    : 'var(--color-bg-secondary)',
                  color: filterDirection === dir 
                    ? 'white' 
                    : 'var(--color-text-secondary)',
                  border: `1px solid ${filterDirection === dir ? 'var(--color-primary)' : 'var(--color-border)'}`,
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  textTransform: 'capitalize',
                }}
              >
                {dir}
              </button>
            ))}
          </div>
          
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            style={{
              padding: '2px 6px',
              fontSize: 'var(--font-size-xs)',
              backgroundColor: 'var(--color-bg-secondary)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--color-text-secondary)',
            }}
          >
            <option value="name">Sort: Name</option>
            <option value="type">Sort: Type</option>
            <option value="usage">Sort: Usage</option>
            <option value="direction">Sort: Direction</option>
          </select>
        </div>
      </div>
      
      {/* Content */}
      <div style={{ 
        flex: 1, 
        overflow: 'auto', 
        padding: 'var(--spacing-3)',
      }}>
        {variablesWithUsage.length === 0 ? (
          <div style={{
            textAlign: 'center',
            color: 'var(--color-text-tertiary)',
            fontSize: 'var(--font-size-sm)',
            padding: 'var(--spacing-4)',
          }}>
            {searchQuery || filterDirection !== 'all'
              ? 'No variables match the current filter'
              : 'No variables defined. Click "Add" to create one.'
            }
          </div>
        ) : (
          variablesWithUsage.map((variable) => {
            const varId = variable.id || variable.name;
            return (
              <VariableRow
                key={varId}
                variable={variable}
                isExpanded={expandedVars.has(varId)}
                onToggle={() => handleToggleVar(varId)}
                onUpdate={(updates) => handleUpdateVariable(varId, updates)}
                onDelete={() => handleDeleteVariable(varId)}
                onNavigate={handleNavigate}
                states={automata.states}
                transitions={automata.transitions}
              />
            )
          })
        )}
      </div>
      
      {/* Add dialog */}
      {showAddDialog && (
        <AddVariableDialog
          onAdd={handleAddVariable}
          onClose={() => setShowAddDialog(false)}
        />
      )}
    </div>
  );
};

export default VariableManagementPanel;
