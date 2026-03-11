/**
 * Aetherium Automata - Automata Connections Panel
 * 
 * Shows explicit override routes between automata.
 * Same-name topics propagate automatically; this panel is for manual routes only.
 */

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useAutomataStore, useUIStore, useGatewayStore } from '../../stores';
import type { Automata } from '../../types';
import type { AutomataBinding } from '../../types/connections';

// ============================================================================
// Icons
// ============================================================================

const LinkIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <path d="M6 10L10 6M8 4l2-2a2.83 2.83 0 014 4l-2 2M8 12l-2 2a2.83 2.83 0 01-4-4l2-2" 
      stroke="currentColor" strokeWidth="1.5" fill="none"/>
  </svg>
);

const NetworkIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <circle cx="8" cy="3" r="2" stroke="currentColor" fill="none"/>
    <circle cx="3" cy="13" r="2" stroke="currentColor" fill="none"/>
    <circle cx="13" cy="13" r="2" stroke="currentColor" fill="none"/>
    <path d="M8 5v3M5.5 11.5L7 8M10.5 11.5L9 8" stroke="currentColor" strokeWidth="1.2" fill="none"/>
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

const ArrowRightIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <path d="M2 8h12M10 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" fill="none"/>
  </svg>
);

const AutomataIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" fill="none"/>
    <circle cx="5" cy="8" r="2" fill="currentColor"/>
    <circle cx="11" cy="8" r="2" stroke="currentColor" fill="none"/>
    <path d="M7 8h2" stroke="currentColor" strokeWidth="1"/>
  </svg>
);

const DeviceIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <rect x="3" y="1" width="10" height="14" rx="1" stroke="currentColor" fill="none"/>
    <circle cx="8" cy="12" r="1" fill="currentColor"/>
  </svg>
);

// ============================================================================
// Types
// ============================================================================

interface AutomataNodeData {
  automata: Automata;
  deviceId?: string;
  deviceName?: string;
  outgoingBindings: AutomataBinding[];
  incomingBindings: AutomataBinding[];
}

type ViewMode = 'list' | 'graph';

// ============================================================================
// Connection Row Component
// ============================================================================

interface ConnectionRowProps {
  binding: AutomataBinding;
  automataMap: Map<string, Automata>;
  onDelete: () => void;
  onNavigate: (automataId: string) => void;
}

const ConnectionRow: React.FC<ConnectionRowProps> = ({
  binding,
  automataMap,
  onDelete,
  onNavigate,
}) => {
  const sourceAutomata = automataMap.get(binding.sourceAutomataId);
  const targetAutomata = automataMap.get(binding.targetAutomataId);
  
  const getBindingTypeColor = () => {
    // bindingType was removed from AutomataBinding interface
    return 'var(--color-success)';
  };

  return (
    <div
      className="connection-row"
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: 'var(--spacing-2)',
        backgroundColor: 'var(--color-bg-secondary)',
        borderRadius: 'var(--radius-sm)',
        marginBottom: 'var(--spacing-1)',
        gap: 'var(--spacing-2)',
      }}
    >
      {/* Source */}
      <button
        onClick={() => onNavigate(binding.sourceAutomataId)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '2px 6px',
          backgroundColor: 'var(--color-bg-tertiary)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          fontSize: 'var(--font-size-xs)',
          color: 'var(--color-text-primary)',
          cursor: 'pointer',
        }}
      >
        <AutomataIcon size={10} />
        {sourceAutomata?. config.name || binding.sourceAutomataId}
      </button>
      
      <code style={{
        fontSize: 'var(--font-size-xs)',
        color: 'var(--color-warning)',
        backgroundColor: 'var(--color-bg-tertiary)',
        padding: '1px 4px',
        borderRadius: 2,
      }}>
        .{binding.sourceOutputName}
      </code>
      
      {/* Arrow */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        padding: '2px 6px',
        backgroundColor: `${getBindingTypeColor()}20`,
        borderRadius: 10,
      }}>
        <ArrowRightIcon size={10} />
      </div>
      
      {/* Target */}
      <code style={{
        fontSize: 'var(--font-size-xs)',
        color: 'var(--color-success)',
        backgroundColor: 'var(--color-bg-tertiary)',
        padding: '1px 4px',
        borderRadius: 2,
      }}>
        .{binding.targetInputName}
      </code>
      
      <button
        onClick={() => onNavigate(binding.targetAutomataId)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '2px 6px',
          backgroundColor: 'var(--color-bg-tertiary)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          fontSize: 'var(--font-size-xs)',
          color: 'var(--color-text-primary)',
          cursor: 'pointer',
        }}
      >
        <AutomataIcon size={10} />
        {targetAutomata?. config.name || binding.targetAutomataId}
      </button>
      
      <div style={{ flex: 1 }} />
      
      {/* Delete */}
      <button
        onClick={onDelete}
        className="btn btn-ghost btn-icon btn-xs"
        style={{ opacity: 0.5 }}
      >
        <TrashIcon size={12} />
      </button>
    </div>
  );
};

// ============================================================================
// Automata Node Card (for graph view)
// ============================================================================

interface AutomataNodeCardProps {
  data: AutomataNodeData;
  isExpanded: boolean;
  isSelected: boolean;
  onToggle: () => void;
  onClick: () => void;
  onNavigate: (automataId: string) => void;
}

const AutomataNodeCard: React.FC<AutomataNodeCardProps> = ({
  data,
  isExpanded,
  isSelected,
  onToggle,
  onClick,
  onNavigate,
}) => {
  const totalConnections = data.outgoingBindings.length + data.incomingBindings.length;
  
  return (
    <div
      className="automata-node-card"
      style={{
        backgroundColor: 'var(--color-bg-secondary)',
        borderRadius: 'var(--radius-md)',
        border: `2px solid ${isSelected ? 'var(--color-primary)' : 'var(--color-border)'}`,
        marginBottom: 'var(--spacing-2)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        onClick={onClick}
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: 'var(--spacing-2) var(--spacing-3)',
          cursor: 'pointer',
          backgroundColor: isExpanded ? 'var(--color-bg-tertiary)' : 'transparent',
        }}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            display: 'flex',
          }}
        >
          <ChevronIcon expanded={isExpanded} />
        </button>
        
        <AutomataIcon size={16} />
        
        <div style={{ marginLeft: 'var(--spacing-2)', flex: 1 }}>
          <div style={{ 
            fontWeight: 600, 
            color: 'var(--color-text-primary)',
            fontSize: 'var(--font-size-sm)',
          }}>
            {data.automata.config.name}
          </div>
          {data.deviceName && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 'var(--font-size-xs)',
              color: 'var(--color-text-tertiary)',
            }}>
              <DeviceIcon size={10} />
              {data.deviceName}
            </div>
          )}
        </div>
        
        {/* Connection counts */}
        <div style={{
          display: 'flex',
          gap: 'var(--spacing-2)',
          fontSize: 'var(--font-size-xs)',
        }}>
          {data.incomingBindings.length > 0 && (
            <span style={{ 
              color: 'var(--color-success)',
              display: 'flex',
              alignItems: 'center',
              gap: 2,
            }}>
              ← {data.incomingBindings.length}
            </span>
          )}
          {data.outgoingBindings.length > 0 && (
            <span style={{ 
              color: 'var(--color-warning)',
              display: 'flex',
              alignItems: 'center',
              gap: 2,
            }}>
              {data.outgoingBindings.length} →
            </span>
          )}
        </div>
      </div>
      
      {/* Expanded content */}
      {isExpanded && (
        <div style={{ padding: 'var(--spacing-2) var(--spacing-3)' }}>
          {/* Inputs */}
          <div style={{ marginBottom: 'var(--spacing-2)' }}>
            <div style={{
              fontSize: 'var(--font-size-xs)',
              color: 'var(--color-text-tertiary)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: 4,
            }}>
              Inputs ({data.automata.inputs?.length || 0})
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {(data.automata.inputs || []).map((input) => {
                const hasBinding = data.incomingBindings.some((b) => b.targetInputName === input);
                return (
                  <span
                    key={input}
                    style={{
                      padding: '2px 6px',
                      fontSize: 'var(--font-size-xs)',
                      backgroundColor: hasBinding 
                        ? 'var(--color-success-bg)' 
                        : 'var(--color-bg-tertiary)',
                      color: hasBinding 
                        ? 'var(--color-success)' 
                        : 'var(--color-text-secondary)',
                      borderRadius: 'var(--radius-sm)',
                      border: hasBinding 
                        ? '1px solid var(--color-success)' 
                        : '1px solid var(--color-border)',
                    }}
                  >
                    {input}
                  </span>
                );
              })}
              {(!data.automata.inputs || data.automata.inputs.length === 0) && (
                <span style={{ 
                  fontSize: 'var(--font-size-xs)', 
                  color: 'var(--color-text-tertiary)',
                  fontStyle: 'italic',
                }}>
                  None
                </span>
              )}
            </div>
          </div>
          
          {/* Outputs */}
          <div style={{ marginBottom: 'var(--spacing-2)' }}>
            <div style={{
              fontSize: 'var(--font-size-xs)',
              color: 'var(--color-text-tertiary)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: 4,
            }}>
              Outputs ({data.automata.outputs?.length || 0})
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {(data.automata.outputs || []).map((output) => {
                const hasBinding = data.outgoingBindings.some((b) => b.sourceOutputName === output);
                return (
                  <span
                    key={output}
                    style={{
                      padding: '2px 6px',
                      fontSize: 'var(--font-size-xs)',
                      backgroundColor: hasBinding 
                        ? 'var(--color-warning-bg)' 
                        : 'var(--color-bg-tertiary)',
                      color: hasBinding 
                        ? 'var(--color-warning)' 
                        : 'var(--color-text-secondary)',
                      borderRadius: 'var(--radius-sm)',
                      border: hasBinding 
                        ? '1px solid var(--color-warning)' 
                        : '1px solid var(--color-border)',
                    }}
                  >
                    {output}
                  </span>
                );
              })}
              {(!data.automata.outputs || data.automata.outputs.length === 0) && (
                <span style={{ 
                  fontSize: 'var(--font-size-xs)', 
                  color: 'var(--color-text-tertiary)',
                  fontStyle: 'italic',
                }}>
                  None
                </span>
              )}
            </div>
          </div>
          
          {/* Connected automata list */}
          {totalConnections > 0 && (
            <div style={{
              backgroundColor: 'var(--color-bg-tertiary)',
              borderRadius: 'var(--radius-sm)',
              padding: 'var(--spacing-2)',
            }}>
              <div style={{
                fontSize: 'var(--font-size-xs)',
                color: 'var(--color-text-tertiary)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                marginBottom: 4,
              }}>
                Connections
              </div>
              
              {/* Incoming */}
              {data.incomingBindings.map((b) => (
                <div
                  key={b.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: 'var(--font-size-xs)',
                    marginBottom: 2,
                  }}
                >
                  <span style={{ color: 'var(--color-success)' }}>←</span>
                  <button
                    onClick={() => onNavigate(b.sourceAutomataId)}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      color: 'var(--color-primary)',
                      cursor: 'pointer',
                      textDecoration: 'underline',
                    }}
                  >
                    {b.sourceAutomataId}
                  </button>
                  <code style={{ color: 'var(--color-text-tertiary)' }}>
                    .{b.sourceOutputName} → .{b.targetInputName}
                  </code>
                </div>
              ))}
              
              {/* Outgoing */}
              {data.outgoingBindings.map((b) => (
                <div
                  key={b.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: 'var(--font-size-xs)',
                    marginBottom: 2,
                  }}
                >
                  <span style={{ color: 'var(--color-warning)' }}>→</span>
                  <code style={{ color: 'var(--color-text-tertiary)' }}>
                    .{b.sourceOutputName} → .{b.targetInputName}
                  </code>
                  <button
                    onClick={() => onNavigate(b.targetAutomataId)}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      color: 'var(--color-primary)',
                      cursor: 'pointer',
                      textDecoration: 'underline',
                    }}
                  >
                    {b.targetAutomataId}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ============================================================================
// Add Binding Dialog
// ============================================================================

interface AddBindingDialogProps {
  automataList: Automata[];
  onAdd: (binding: Omit<AutomataBinding, 'id'>) => void;
  onClose: () => void;
}

const AddBindingDialog: React.FC<AddBindingDialogProps> = ({ automataList, onAdd, onClose }) => {
  const [sourceId, setSourceId] = useState('');
  const [sourceOutputName, setSourceOutput] = useState('');
  const [targetId, setTargetId] = useState('');
  const [targetInputName, setTargetInput] = useState('');
  
  const sourceAutomata = automataList.find((a) => a.id === sourceId);
  const targetAutomata = automataList.find((a) => a.id === targetId);
  
  const handleAdd = () => {
    if (!sourceId || !sourceOutputName || !targetId || !targetInputName) return;
    onAdd({
      sourceAutomataId: sourceId,
      sourceOutputId: sourceOutputName,
      sourceOutputName: sourceOutputName,
      targetAutomataId: targetId,
      targetInputId: targetInputName,
      targetInputName: targetInputName,
      sourceType: 'any',
      targetType: 'any',
      enabled: true,
      createdAt: Date.now(),
      modifiedAt: Date.now(),
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
        width: 400,
        boxShadow: 'var(--shadow-lg)',
      }}>
        <h3 style={{ 
          fontSize: 'var(--font-size-md)', 
          marginBottom: 'var(--spacing-3)',
          color: 'var(--color-text-primary)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--spacing-2)',
        }}>
          <LinkIcon size={16} />
          Add Explicit Route
        </h3>
        
        {/* Source */}
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: '1fr 1fr', 
          gap: 'var(--spacing-2)',
          marginBottom: 'var(--spacing-3)',
        }}>
          <div className="form-group">
            <label>Source Automata</label>
            <select
              value={sourceId}
              onChange={(e) => {
                setSourceId(e.target.value);
                setSourceOutput('');
              }}
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
              <option value="">Select...</option>
              {automataList.map((a) => (
                <option key={a.id} value={a.id}>{a.config.name}</option>
              ))}
            </select>
          </div>
          
          <div className="form-group">
            <label>Output</label>
            <select
              value={sourceOutputName}
              onChange={(e) => setSourceOutput(e.target.value)}
              disabled={!sourceAutomata}
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
              <option value="">Select...</option>
              {(sourceAutomata?.outputs || []).map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </div>
        </div>
        
        {/* Arrow */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 'var(--spacing-2)',
          marginBottom: 'var(--spacing-3)',
        }}>
          <div style={{
            width: 40,
            height: 1,
            backgroundColor: 'var(--color-border)',
          }} />
          
          <ArrowRightIcon />
          
          <div style={{
            width: 40,
            height: 1,
            backgroundColor: 'var(--color-border)',
          }} />
        </div>
        
        {/* Target */}
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: '1fr 1fr', 
          gap: 'var(--spacing-2)',
          marginBottom: 'var(--spacing-3)',
        }}>
          <div className="form-group">
            <label>Target Automata</label>
            <select
              value={targetId}
              onChange={(e) => {
                setTargetId(e.target.value);
                setTargetInput('');
              }}
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
              <option value="">Select...</option>
              {automataList.map((a) => (
                <option key={a.id} value={a.id}>{a.config.name}</option>
              ))}
            </select>
          </div>
          
          <div className="form-group">
            <label>Input</label>
            <select
              value={targetInputName}
              onChange={(e) => setTargetInput(e.target.value)}
              disabled={!targetAutomata}
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
              <option value="">Select...</option>
              {(targetAutomata?.inputs || []).map((i) => (
                <option key={i} value={i}>{i}</option>
              ))}
            </select>
          </div>
        </div>
        
        <div style={{ 
          display: 'flex', 
          justifyContent: 'flex-end', 
          gap: 'var(--spacing-2)',
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
            disabled={!sourceId || !sourceOutputName || !targetId || !targetInputName}
            style={{ padding: 'var(--spacing-2) var(--spacing-3)' }}
          >
            Add Route
          </button>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// Network Graph Visualization (Simple SVG)
// ============================================================================

interface NetworkGraphProps {
  nodes: AutomataNodeData[];
  bindings: AutomataBinding[];
  selectedId: string | null;
  onSelectNode: (id: string) => void;
}

const NetworkGraph: React.FC<NetworkGraphProps> = ({
  nodes,
  bindings,
  selectedId,
  onSelectNode,
}) => {
  // Simple circular layout
  const nodePositions = useMemo(() => {
    const positions: Record<string, { x: number; y: number }> = {};
    const radius = 120;
    const centerX = 200;
    const centerY = 150;
    
    nodes.forEach((node, i) => {
      const angle = (i / nodes.length) * 2 * Math.PI - Math.PI / 2;
      positions[node.automata.id] = {
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
      };
    });
    
    return positions;
  }, [nodes]);
  
  return (
    <svg
      width="100%"
      height={300}
      style={{ backgroundColor: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)' }}
    >
      {/* Connections */}
      {bindings.map((b) => {
        const sourcePos = nodePositions[b.sourceAutomataId];
        const targetPos = nodePositions[b.targetAutomataId];
        if (!sourcePos || !targetPos) return null;
        
        return (
          <g key={b.id}>
            <line
              x1={sourcePos.x}
              y1={sourcePos.y}
              x2={targetPos.x}
              y2={targetPos.y}
              stroke="var(--color-border)"
              strokeWidth={2}
              markerEnd="url(#arrowhead)"
            />
          </g>
        );
      })}
      
      {/* Arrow marker */}
      <defs>
        <marker
          id="arrowhead"
          markerWidth="10"
          markerHeight="7"
          refX="9"
          refY="3.5"
          orient="auto"
        >
          <polygon
            points="0 0, 10 3.5, 0 7"
            fill="var(--color-text-tertiary)"
          />
        </marker>
      </defs>
      
      {/* Nodes */}
      {nodes.map((node) => {
        const pos = nodePositions[node.automata.id];
        if (!pos) return null;
        
        const isSelected = selectedId === node.automata.id;
        
        return (
          <g
            key={node.automata.id}
            onClick={() => onSelectNode(node.automata.id)}
            style={{ cursor: 'pointer' }}
          >
            <circle
              cx={pos.x}
              cy={pos.y}
              r={30}
              fill={isSelected ? 'var(--color-primary)' : 'var(--color-bg-tertiary)'}
              stroke={isSelected ? 'var(--color-primary)' : 'var(--color-border)'}
              strokeWidth={2}
            />
            <text
              x={pos.x}
              y={pos.y}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={isSelected ? 'white' : 'var(--color-text-primary)'}
              fontSize={10}
              fontWeight={600}
            >
              {node.automata.config.name.slice(0, 8)}
            </text>
            {/* Connection count badge */}
            {(node.incomingBindings.length + node.outgoingBindings.length) > 0 && (
              <>
                <circle
                  cx={pos.x + 22}
                  cy={pos.y - 22}
                  r={10}
                  fill="var(--color-warning)"
                />
                <text
                  x={pos.x + 22}
                  y={pos.y - 22}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="var(--color-text-primary)"
                  fontSize={9}
                  fontWeight={600}
                >
                  {node.incomingBindings.length + node.outgoingBindings.length}
                </text>
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
};

// ============================================================================
// Main Panel Component
// ============================================================================

export const AutomataConnectionsPanel: React.FC = () => {
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [bindings, setBindings] = useState<AutomataBinding[]>([]);
  const [bindingsBusy, setBindingsBusy] = useState(false);
  
  const automataMap = useAutomataStore((state) => state.automata);
  const setActiveAutomata = useAutomataStore((state) => state.setActiveAutomata);
  const openTab = useUIStore((state) => state.openTab);
  const addNotification = useUIStore((state) => state.addNotification);
  const gatewayService = useGatewayStore((state) => state.service);
  const gatewayStatus = useGatewayStore((state) => state.status);
  
  const automataList = useMemo(() => Array.from(automataMap.values()), [automataMap]);

  const refreshBindings = useCallback(async () => {
    if (gatewayStatus !== 'connected') {
      setBindings([]);
      return;
    }

    setBindingsBusy(true);
    try {
      const next = await gatewayService.listConnections();
      setBindings(next);
    } catch (error) {
      addNotification(
        'error',
        'Connections',
        error instanceof Error ? error.message : 'Failed to load connections',
      );
    } finally {
      setBindingsBusy(false);
    }
  }, [addNotification, gatewayService, gatewayStatus]);

  useEffect(() => {
    void refreshBindings();
  }, [refreshBindings]);

  useEffect(() => {
    if (gatewayStatus !== 'connected') {
      setBindings([]);
      return;
    }

    const unsubscribe = gatewayService.on('onConnectionList', (event) => {
      setBindings(((event.connections as unknown) as AutomataBinding[]) ?? []);
    });

    return unsubscribe;
  }, [gatewayService, gatewayStatus]);
  
  // Build node data with bindings
  const nodeDataList = useMemo(() => {
    return automataList.map((automata): AutomataNodeData => ({
      automata,
      outgoingBindings: bindings.filter((b) => b.sourceAutomataId === automata.id),
      incomingBindings: bindings.filter((b) => b.targetAutomataId === automata.id),
    }));
  }, [automataList, bindings]);
  
  // Filter nodes
  const filteredNodes = useMemo(() => {
    if (!searchQuery) return nodeDataList;
    
    const q = searchQuery.toLowerCase();
    return nodeDataList.filter((node) =>
      node.automata.config.name.toLowerCase().includes(q) ||
      node.automata.config.description?.toLowerCase().includes(q)
    );
  }, [nodeDataList, searchQuery]);
  
  const handleToggleNode = useCallback((nodeId: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);
  
  const handleNavigateToAutomata = useCallback((automataId: string) => {
    setActiveAutomata(automataId);
    openTab({
      type: 'automata',
      targetId: automataId,
      name: automataMap.get(automataId)?. config.name || automataId,
      isDirty: false,
    });
  }, [setActiveAutomata, openTab, automataMap]);
  
  const handleAddBinding = useCallback(async (binding: Omit<AutomataBinding, 'id'>) => {
    if (gatewayStatus !== 'connected') {
      addNotification('warning', 'Connections', 'Connect to the gateway before creating bindings.');
      return;
    }

    try {
      await gatewayService.createConnection(binding);
      addNotification('success', 'Connections', 'Binding created.');
      await refreshBindings();
    } catch (error) {
      addNotification(
        'error',
        'Connections',
        error instanceof Error ? error.message : 'Failed to create binding',
      );
    }
  }, [addNotification, gatewayService, gatewayStatus, refreshBindings]);
  
  const handleDeleteBinding = useCallback(async (bindingId: string) => {
    if (gatewayStatus !== 'connected') {
      addNotification('warning', 'Connections', 'Connect to the gateway before deleting bindings.');
      return;
    }

    try {
      await gatewayService.deleteConnection(bindingId);
      addNotification('success', 'Connections', 'Binding removed.');
      await refreshBindings();
    } catch (error) {
      addNotification(
        'error',
        'Connections',
        error instanceof Error ? error.message : 'Failed to delete binding',
      );
    }
  }, [addNotification, gatewayService, gatewayStatus, refreshBindings]);

  return (
    <div className="automata-connections-panel" style={{ 
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
            <NetworkIcon size={16} />
            <span style={{ 
              fontWeight: 600, 
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-text-primary)',
            }}>
              Explicit Routes
            </span>
          </div>
          
          <div style={{
            fontSize: 'var(--font-size-xs)',
            color: 'var(--color-text-tertiary)',
          }}>
            Same-name topics flow automatically. Use routes only for explicit overrides.
          </div>
          
          <div style={{ display: 'flex', gap: 'var(--spacing-1)' }}>
            {/* View mode toggle */}
            <button
              onClick={() => setViewMode('list')}
              className={`btn btn-ghost btn-xs ${viewMode === 'list' ? 'active' : ''}`}
              style={{
                backgroundColor: viewMode === 'list' ? 'var(--color-primary)' : undefined,
                color: viewMode === 'list' ? 'white' : undefined,
              }}
            >
              List
            </button>
            <button
              onClick={() => setViewMode('graph')}
              className={`btn btn-ghost btn-xs ${viewMode === 'graph' ? 'active' : ''}`}
              style={{
                backgroundColor: viewMode === 'graph' ? 'var(--color-primary)' : undefined,
                color: viewMode === 'graph' ? 'white' : undefined,
              }}
            >
              Graph
            </button>
            
            <button
              onClick={() => void refreshBindings()}
              className="btn btn-ghost btn-sm"
              disabled={bindingsBusy || gatewayStatus !== 'connected'}
              style={{ marginLeft: 'var(--spacing-1)' }}
            >
              Refresh
            </button>
            <button
              onClick={() => setShowAddDialog(true)}
              className="btn btn-primary btn-sm"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '4px 8px',
                marginLeft: 'var(--spacing-2)',
              }}
            >
              <PlusIcon size={12} />
              Add
            </button>
          </div>
        </div>
        
        {/* Search */}
        <input
          type="text"
          placeholder="Search automata..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
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
      
      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: 'var(--spacing-3)' }}>
        {viewMode === 'graph' && (
          <NetworkGraph
            nodes={filteredNodes}
            bindings={bindings}
            selectedId={selectedNodeId}
            onSelectNode={(id) => {
              setSelectedNodeId(id);
              handleToggleNode(id);
            }}
          />
        )}
        
        {/* All bindings list */}
        {bindings.length > 0 && viewMode === 'list' && (
          <div style={{ marginBottom: 'var(--spacing-3)' }}>
            <div style={{
              fontSize: 'var(--font-size-xs)',
              color: 'var(--color-text-tertiary)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: 'var(--spacing-2)',
            }}>
              Explicit Routes ({bindings.length})
            </div>
            {bindings.map((b) => (
              <ConnectionRow
                key={b.id}
                binding={b}
                automataMap={automataMap}
                onDelete={() => handleDeleteBinding(b.id)}
                onNavigate={handleNavigateToAutomata}
              />
            ))}
          </div>
        )}
        
        {/* Automata cards */}
        <div style={{ marginBottom: 'var(--spacing-2)' }}>
          <div style={{
            fontSize: 'var(--font-size-xs)',
            color: 'var(--color-text-tertiary)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            marginBottom: 'var(--spacing-2)',
          }}>
            Automata ({filteredNodes.length})
          </div>
          
          {filteredNodes.length === 0 ? (
            <div style={{
              textAlign: 'center',
              color: 'var(--color-text-tertiary)',
              fontSize: 'var(--font-size-sm)',
              padding: 'var(--spacing-4)',
            }}>
              {searchQuery ? 'No automata match the search' : 'No automata in project'}
            </div>
          ) : (
            filteredNodes.map((node) => (
              <AutomataNodeCard
                key={node.automata.id}
                data={node}
                isExpanded={expandedNodes.has(node.automata.id)}
                isSelected={selectedNodeId === node.automata.id}
                onToggle={() => handleToggleNode(node.automata.id)}
                onClick={() => setSelectedNodeId(node.automata.id)}
                onNavigate={handleNavigateToAutomata}
              />
            ))
          )}
        </div>
      </div>
      
      {/* Summary footer */}
      <div style={{
        padding: 'var(--spacing-2) var(--spacing-3)',
        borderTop: '1px solid var(--color-border)',
        fontSize: 'var(--font-size-xs)',
        color: 'var(--color-text-tertiary)',
        display: 'flex',
        justifyContent: 'space-between',
      }}>
        <span>{automataList.length} automata</span>
        <span>{bindings.length} explicit routes{bindingsBusy ? ' · syncing' : ''}</span>
      </div>
      
      {/* Add dialog */}
      {showAddDialog && (
        <AddBindingDialog
          automataList={automataList}
          onAdd={handleAddBinding}
          onClose={() => setShowAddDialog(false)}
        />
      )}
    </div>
  );
};

export default AutomataConnectionsPanel;
