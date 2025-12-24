/**
 * Aetherium Automata - State Node Component
 * 
 * Custom ReactFlow node for automata states with futuristic styling.
 */

import { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { State } from '../../types';
import { IconState, IconPlay, IconCheck } from '../common/Icons';

interface StateNodeData extends State {
  isExecuting?: boolean;
  isInitial?: boolean;  // Marked as initial state
  isFinal?: boolean;    // Marked as final state
  onDoubleClick?: (stateId: string) => void;
}

export const StateNode = memo<NodeProps<StateNodeData>>(({ data, selected }) => {
  const getNodeClass = () => {
    let className = 'state-node';
    if (selected) className += ' selected';
    if (data.isActive) className += ' active';
    if (data.isExecuting) className += ' executing';
    if (data.isInitial) className += ' initial';
    if (data.isFinal) className += ' final';
    if (data.isComposite) className += ' composite';
    return className;
  };
  
  const getTypeIcon = () => {
    if (data.isInitial) {
      return <IconPlay size={12} />;
    }
    if (data.isFinal) {
      return <IconCheck size={12} />;
    }
    if (data.isComposite) {
      return <IconState size={12} />;
    }
    return null;
  };
  
  // Check if state has any code
  const hasCode = data.code || data.hooks?.onEnter || data.hooks?.onExit || data.hooks?.onTick;
  
  return (
    <div 
      className={getNodeClass()}
      onDoubleClick={() => data.onDoubleClick?.(data.id)}
    >
      {/* Input handle */}
      <Handle
        type="target"
        position={Position.Top}
        className="state-handle"
        id="target-top"
      />
      <Handle
        type="target"
        position={Position.Left}
        className="state-handle"
        id="target-left"
      />
      
      {/* Node content */}
      <div className="state-node-header">
        {getTypeIcon()}
        <span className="state-node-name">{data.name}</span>
      </div>
      
      {data.description && (
        <div className="state-node-description">
          {data.description}
        </div>
      )}
      
      {/* Code indicator */}
      {hasCode && (
        <div className="state-node-code-indicator">
          <span className="code-dot" title="Has Lua code" />
        </div>
      )}
      
      {/* Execution indicator */}
      {data.isExecuting && (
        <div className="state-node-execution">
          <div className="pulse-ring" />
        </div>
      )}
      
      {/* Output handle */}
      <Handle
        type="source"
        position={Position.Bottom}
        className="state-handle"
        id="source-bottom"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="state-handle"
        id="source-right"
      />
    </div>
  );
});

StateNode.displayName = 'StateNode';
