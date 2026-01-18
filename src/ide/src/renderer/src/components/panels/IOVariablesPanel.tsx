/**
 * Aetherium Automata - I/O Variables Panel
 * 
 * Displays and manages inputs, outputs, and variables for the active state.
 * Provides quick access for building guard conditions.
 */

import React, { useState, useCallback } from 'react';
import { useAutomataStore } from '../../stores';
import { IconPlus, IconMinus, IconRefresh } from '../common/Icons';

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
    <path d="M10 3L6 8L10 13V10H15V6H10V3Z" transform="rotate(180 8 8)" />
    <rect x="1" y="3" width="4" height="10" rx="1" />
  </svg>
);

const VariableIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <path d="M4 2L6 14M10 2L12 14M2 5H14M2 11H14" stroke="currentColor" strokeWidth="1.5" fill="none" />
  </svg>
);

const CopyIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <rect x="4" y="4" width="8" height="10" rx="1" stroke="currentColor" fill="none" />
    <path d="M6 4V2.5C6 2.22386 6.22386 2 6.5 2H13.5C13.7761 2 14 2.22386 14 2.5V11.5C14 11.7761 13.7761 12 13.5 12H12" stroke="currentColor" fill="none" />
  </svg>
);

// ============================================================================
// Types
// ============================================================================

interface IOItem {
  name: string;
  type: 'input' | 'output' | 'variable';
  dataType?: string;
  value?: unknown;
  description?: string;
}

// ============================================================================
// IO Item Row Component
// ============================================================================

interface IOItemRowProps {
  item: IOItem;
  onCopyGuard: (guard: string) => void;
  onDelete: () => void;
}

const IOItemRow: React.FC<IOItemRowProps> = ({ item, onCopyGuard, onDelete }) => {
  const [showActions, setShowActions] = useState(false);
  
  const getGuardExpression = useCallback(() => {
    switch (item.type) {
      case 'input':
        return `check('${item.name}')`;
      case 'output':
        return `output('${item.name}')`;
      case 'variable':
        return `value('${item.name}')`;
    }
  }, [item]);
  
  const getIcon = () => {
    switch (item.type) {
      case 'input': return <InputIcon />;
      case 'output': return <OutputIcon />;
      case 'variable': return <VariableIcon />;
    }
  };
  
  const getTypeColor = () => {
    switch (item.type) {
      case 'input': return 'var(--color-success)';
      case 'output': return 'var(--color-warning)';
      case 'variable': return 'var(--color-info)';
    }
  };
  
  return (
    <div
      className="io-item-row"
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: 'var(--spacing-2)',
        borderRadius: 'var(--radius-sm)',
        backgroundColor: showActions ? 'var(--color-bg-tertiary)' : 'transparent',
        transition: 'background-color 0.15s ease',
      }}
    >
      <span style={{ color: getTypeColor(), marginRight: 'var(--spacing-2)' }}>
        {getIcon()}
      </span>
      
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ 
          fontWeight: 500,
          fontSize: 'var(--font-size-sm)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {item.name}
        </div>
        {item.dataType && (
          <div style={{ 
            fontSize: 'var(--font-size-xs)',
            color: 'var(--color-text-tertiary)',
          }}>
            {item.dataType}
          </div>
        )}
      </div>
      
      {showActions && (
        <div style={{ display: 'flex', gap: 'var(--spacing-1)' }}>
          <button
            className="btn btn-ghost btn-icon btn-xs"
            onClick={() => onCopyGuard(getGuardExpression())}
            title="Copy guard expression"
          >
            <CopyIcon size={12} />
          </button>
          <button
            className="btn btn-ghost btn-icon btn-xs"
            onClick={onDelete}
            title="Remove"
          >
            <IconMinus size={12} />
          </button>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// Add IO Form Component
// ============================================================================

interface AddIOFormProps {
  type: 'input' | 'output' | 'variable';
  onAdd: (name: string, dataType?: string) => void;
  onCancel: () => void;
}

const AddIOForm: React.FC<AddIOFormProps> = ({ type, onAdd, onCancel }) => {
  const [name, setName] = useState('');
  const [dataType, setDataType] = useState('boolean');
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onAdd(name.trim(), dataType);
      setName('');
    }
  };
  
  return (
    <form onSubmit={handleSubmit} style={{ padding: 'var(--spacing-2)' }}>
      <div style={{ marginBottom: 'var(--spacing-2)' }}>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={`New ${type} name...`}
          autoFocus
          style={{
            width: '100%',
            padding: 'var(--spacing-1) var(--spacing-2)',
            fontSize: 'var(--font-size-sm)',
          }}
        />
      </div>
      {type === 'variable' && (
        <div style={{ marginBottom: 'var(--spacing-2)' }}>
          <select
            value={dataType}
            onChange={(e) => setDataType(e.target.value)}
            style={{
              width: '100%',
              padding: 'var(--spacing-1) var(--spacing-2)',
              fontSize: 'var(--font-size-sm)',
            }}
          >
            <option value="boolean">Boolean</option>
            <option value="number">Number</option>
            <option value="string">String</option>
            <option value="table">Table</option>
          </select>
        </div>
      )}
      <div style={{ display: 'flex', gap: 'var(--spacing-2)' }}>
        <button type="submit" className="btn btn-primary btn-sm" style={{ flex: 1 }}>
          Add
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
};

// ============================================================================
// Section Component
// ============================================================================

interface IOSectionProps {
  title: string;
  type: 'input' | 'output' | 'variable';
  items: IOItem[];
  onAdd: (name: string, dataType?: string) => void;
  onDelete: (name: string) => void;
  onCopyGuard: (guard: string) => void;
  icon: React.ReactNode;
}

const IOSection: React.FC<IOSectionProps> = ({ 
  title, 
  type,
  items, 
  onAdd, 
  onDelete, 
  onCopyGuard,
  icon,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  
  return (
    <div className="io-section" style={{ marginBottom: 'var(--spacing-3)' }}>
      <div 
        className="section-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: 'var(--spacing-2)',
          cursor: 'pointer',
          userSelect: 'none',
        }}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span style={{ 
          transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
          transition: 'transform 0.15s ease',
          marginRight: 'var(--spacing-1)',
        }}>
          ▶
        </span>
        <span style={{ marginRight: 'var(--spacing-2)' }}>{icon}</span>
        <span style={{ flex: 1, fontWeight: 500, fontSize: 'var(--font-size-sm)' }}>
          {title}
        </span>
        <span style={{ 
          fontSize: 'var(--font-size-xs)',
          color: 'var(--color-text-tertiary)',
          marginRight: 'var(--spacing-2)',
        }}>
          {items.length}
        </span>
        <button
          className="btn btn-ghost btn-icon btn-xs"
          onClick={(e) => {
            e.stopPropagation();
            setIsAdding(true);
            setIsExpanded(true);
          }}
          title={`Add ${type}`}
        >
          <IconPlus size={12} />
        </button>
      </div>
      
      {isExpanded && (
        <div className="section-content" style={{ paddingLeft: 'var(--spacing-3)' }}>
          {items.map((item) => (
            <IOItemRow
              key={item.name}
              item={item}
              onCopyGuard={onCopyGuard}
              onDelete={() => onDelete(item.name)}
            />
          ))}
          
          {items.length === 0 && !isAdding && (
            <div style={{ 
              padding: 'var(--spacing-2)',
              fontSize: 'var(--font-size-xs)',
              color: 'var(--color-text-tertiary)',
              fontStyle: 'italic',
            }}>
              No {type}s defined
            </div>
          )}
          
          {isAdding && (
            <AddIOForm
              type={type}
              onAdd={(name, dataType) => {
                onAdd(name, dataType);
                setIsAdding(false);
              }}
              onCancel={() => setIsAdding(false)}
            />
          )}
        </div>
      )}
    </div>
  );
};

// ============================================================================
// Main Panel Component
// ============================================================================

interface IOVariablesPanelProps {
  embedded?: boolean; // When true, renders without panel wrapper
}

export const IOVariablesPanel: React.FC<IOVariablesPanelProps> = ({ embedded = false }) => {
  const activeAutomata = useAutomataStore((state) => {
    const id = state.activeAutomataId;
    return id ? state.automata.get(id) : undefined;
  });
  const updateAutomataIO = useAutomataStore((state) => state.updateAutomataIO);
  
  // Copy guard to clipboard
  const handleCopyGuard = useCallback((guard: string) => {
    navigator.clipboard.writeText(guard);
    // TODO: Show toast notification
  }, []);
  
  // Add handlers - now at automata level
  const handleAddInput = useCallback((name: string) => {
    if (!activeAutomata) return;
    const inputs = [...(activeAutomata.inputs || []), name];
    updateAutomataIO(activeAutomata.id, { inputs });
  }, [activeAutomata, updateAutomataIO]);
  
  const handleAddOutput = useCallback((name: string) => {
    if (!activeAutomata) return;
    const outputs = [...(activeAutomata.outputs || []), name];
    updateAutomataIO(activeAutomata.id, { outputs });
  }, [activeAutomata, updateAutomataIO]);
  
  const handleAddVariable = useCallback((name: string, dataType?: string) => {
    if (!activeAutomata) return;
    // Map form dataType to VariableType
    const varType = dataType === 'number' ? 'number' 
      : dataType === 'string' ? 'string' 
      : dataType === 'boolean' ? 'bool' 
      : 'any';
    const defaultVal = varType === 'number' ? 0 : varType === 'string' ? '' : false;
    const newVar = { 
      name, 
      type: varType as 'number' | 'string' | 'bool' | 'any' | 'table', 
      default: defaultVal 
    };
    // Store automata-level variables in a separate field (we'll add this)
    // For now, just log - you'd need to add automataVariables to Automata type
    console.log('Add automata variable:', newVar);
  }, [activeAutomata]);
  
  // Delete handlers - now at automata level
  const handleDeleteInput = useCallback((name: string) => {
    if (!activeAutomata) return;
    const inputs = (activeAutomata.inputs || []).filter((i) => i !== name);
    updateAutomataIO(activeAutomata.id, { inputs });
  }, [activeAutomata, updateAutomataIO]);
  
  const handleDeleteOutput = useCallback((name: string) => {
    if (!activeAutomata) return;
    const outputs = (activeAutomata.outputs || []).filter((o) => o !== name);
    updateAutomataIO(activeAutomata.id, { outputs });
  }, [activeAutomata, updateAutomataIO]);
  
  const handleDeleteVariable = useCallback((name: string) => {
    // TODO: Implement when automata-level variables are added
    console.log('Delete automata variable:', name);
  }, []);
  
  // Convert to IOItem format - from automata level
  const inputs: IOItem[] = (activeAutomata?.inputs || []).map((name) => ({
    name: String(name),
    type: 'input' as const,
    dataType: 'signal',
  })) || [];
  
  const outputs: IOItem[] = (activeAutomata?.outputs || []).map((name) => ({
    name: String(name),
    type: 'output' as const,
    dataType: 'signal',
  })) || [];
  
  // Variables are currently not stored at automata level - this is a placeholder
  const variables: IOItem[] = [];
  
  // Show help when no automata is active
  if (!activeAutomata) {
    // In embedded mode, show compact help
    if (embedded) {
      return (
        <div style={{ padding: 'var(--spacing-2)' }}>
          <div style={{ 
            display: 'flex',
            alignItems: 'center',
            marginBottom: 'var(--spacing-2)',
            gap: 'var(--spacing-2)',
          }}>
            <VariableIcon size={14} />
            <span style={{ fontWeight: 500, fontSize: 'var(--font-size-sm)' }}>I/O & Variables</span>
          </div>
          <div style={{ 
            fontSize: 'var(--font-size-xs)',
            color: 'var(--color-text-tertiary)',
          }}>
            Open an automata to manage its I/O.
          </div>
        </div>
      );
    }
    
    return (
      <div className="io-panel" style={{ padding: 'var(--spacing-3)' }}>
        <div className="panel-header" style={{ marginBottom: 'var(--spacing-3)' }}>
          <VariableIcon size={16} />
          <span style={{ marginLeft: 'var(--spacing-2)', fontWeight: 500 }}>I/O & Variables</span>
        </div>
        
        <div style={{ 
          padding: 'var(--spacing-4)',
          textAlign: 'center',
          color: 'var(--color-text-tertiary)',
        }}>
          <p style={{ marginBottom: 'var(--spacing-2)' }}>
            Open an automata to manage its inputs, outputs, and variables.
          </p>
          <p style={{ fontSize: 'var(--font-size-xs)' }}>
            These are automata-level I/O for inter-automata communication.
          </p>
        </div>
        
        {/* Guard expression examples */}
        <div style={{ 
          marginTop: 'var(--spacing-4)',
          padding: 'var(--spacing-3)',
          backgroundColor: 'var(--color-bg-tertiary)',
          borderRadius: 'var(--radius-md)',
        }}>
          <div style={{ 
            fontWeight: 500, 
            marginBottom: 'var(--spacing-2)',
            fontSize: 'var(--font-size-sm)',
          }}>
            Guard Expression Examples:
          </div>
          <code style={{ 
            display: 'block',
            fontSize: 'var(--font-size-xs)',
            fontFamily: 'var(--font-mono)',
            whiteSpace: 'pre-wrap',
            color: 'var(--color-text-secondary)',
          }}>
{`check('input1') and value('temp') > 30
output('alarm') or value('count') >= 5
not check('button') and value('state') == "ready"`}
          </code>
        </div>
      </div>
    );
  }
  
  // Render content (with or without panel wrapper)
  const content = (
    <>
      <IOSection
        title="Inputs"
        type="input"
        items={inputs}
        icon={<InputIcon />}
        onAdd={handleAddInput}
        onDelete={handleDeleteInput}
        onCopyGuard={handleCopyGuard}
      />
      
      <IOSection
        title="Outputs"
        type="output"
        items={outputs}
        icon={<OutputIcon />}
        onAdd={handleAddOutput}
        onDelete={handleDeleteOutput}
        onCopyGuard={handleCopyGuard}
      />
      
      <IOSection
        title="Variables"
        type="variable"
        items={variables}
        icon={<VariableIcon />}
        onAdd={handleAddVariable}
        onDelete={handleDeleteVariable}
        onCopyGuard={handleCopyGuard}
      />
    </>
  );
  
  if (embedded) {
    return (
      <div style={{ padding: 'var(--spacing-1)' }}>
        <div style={{ 
          display: 'flex',
          alignItems: 'center',
          marginBottom: 'var(--spacing-2)',
          gap: 'var(--spacing-2)',
        }}>
          <VariableIcon size={14} />
          <span style={{ fontWeight: 500, fontSize: 'var(--font-size-sm)' }}>
            {activeAutomata.config.name} - I/O
          </span>
        </div>
        {content}
      </div>
    );
  }
  
  return (
    <div className="io-panel" style={{ padding: 'var(--spacing-2)' }}>
      <div className="panel-header" style={{ 
        display: 'flex', 
        alignItems: 'center',
        padding: 'var(--spacing-2)',
        marginBottom: 'var(--spacing-2)',
        borderBottom: '1px solid var(--color-border)',
      }}>
        <VariableIcon size={16} />
        <span style={{ marginLeft: 'var(--spacing-2)', fontWeight: 500, flex: 1 }}>
          {activeAutomata.config.name} - I/O
        </span>
        <button
          className="btn btn-ghost btn-icon btn-xs"
          title="Refresh"
        >
          <IconRefresh size={14} />
        </button>
      </div>
      
      {content}
    </div>
  );
};
