/**
 * Aetherium Automata - Visual Editor Component
 * 
 * ReactFlow-based visual editor for automata states and transitions.
 */

import React, { useCallback, useMemo, useRef, useEffect, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Panel,
  useNodesState,
  useEdgesState,
  MarkerType,
  BackgroundVariant,
  Node,
  Edge,
  NodeChange,
  EdgeChange,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { StateNode } from './StateNode';
import { TransitionEdge } from './TransitionEdge';
import { TransitionDialog } from './TransitionDialog';
import { useAutomataStore, useUIStore } from '../../stores';
import {
  IconPlus,
  IconLock,
  IconUnlock,
  IconTransition,
} from '../common/Icons';

// Node types registration
const nodeTypes = {
  stateNode: StateNode,
};

// Edge types registration
const edgeTypes = {
  transitionEdge: TransitionEdge,
};

interface AutomataEditorProps {
  automataId: string;
}

export const AutomataEditor: React.FC<AutomataEditorProps> = ({ automataId }) => {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [showTransitionDialog, setShowTransitionDialog] = useState(false);
  const [editingTransitionId, setEditingTransitionId] = useState<string | undefined>(undefined);
  
  // Store hooks - select specific parts to ensure reactivity
  const automata = useAutomataStore((state) => state.automata.get(automataId));
  // Force re-render when states or transitions change by selecting their keys
  const stateKeys = automata ? Object.keys(automata.states) : [];
  const transitionKeys = automata ? Object.keys(automata.transitions) : [];
  
  const selectedStateIds = useAutomataStore((state) => state.selectedStateIds);
  const selectedTransitionIds = useAutomataStore((state) => state.selectedTransitionIds);
  const setSelectedStates = useAutomataStore((state) => state.setSelectedStates);
  const setSelectedTransitions = useAutomataStore((state) => state.setSelectedTransitions);
  const addState = useAutomataStore((state) => state.addState);
  const updateState = useAutomataStore((state) => state.updateState);
  const setActiveAutomata = useAutomataStore((state) => state.setActiveAutomata);
  const openTab = useUIStore((state) => state.openTab);
  
  // Ensure this automata is active when the editor is displayed
  useEffect(() => {
    setActiveAutomata(automataId);
  }, [automataId, setActiveAutomata]);
  
  // Keyboard shortcut for creating transitions (T key)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 't' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Don't trigger if typing in an input
        if (document.activeElement?.tagName === 'INPUT' || 
            document.activeElement?.tagName === 'TEXTAREA') {
          return;
        }
        setEditingTransitionId(undefined);
        setShowTransitionDialog(true);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
  
  // Handler for clicking on transition label to edit
  const handleTransitionClick = useCallback((transitionId: string) => {
    setSelectedTransitions([transitionId]);
    setEditingTransitionId(transitionId);
    setShowTransitionDialog(true);
  }, [setSelectedTransitions]);
  
  // Convert automata states to ReactFlow nodes
  const initialNodes = useMemo((): Node[] => {
    if (!automata) return [];
    
    return Object.values(automata.states).map((state) => ({
      id: state.id,
      type: 'stateNode',
      position: state.position,
      data: {
        ...state,
        isActive: false, // TODO: Check execution state
        isExecuting: false,
        onDoubleClick: (stateId: string) => {
          // Open code editor for this state
          openTab({
            type: 'code',
            targetId: stateId,
            name: `${state.name}.lua`,
            isDirty: false,
          });
        },
      },
      selected: selectedStateIds.includes(state.id),
    }));
  }, [automata, selectedStateIds, openTab, stateKeys.join(',')]);
  
  // Convert automata transitions to ReactFlow edges
  const initialEdges = useMemo((): Edge[] => {
    if (!automata) return [];
    
    return Object.values(automata.transitions).map((transition) => ({
      id: transition.id,
      source: transition.from,
      target: transition.to,
      type: 'transitionEdge',
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 20,
        height: 20,
        color: '#00d4ff',
      },
      style: {
        stroke: '#00d4ff',
      },
      data: {
        name: transition.name,
        condition: transition.condition,
        body: transition.body,
        priority: transition.priority,
        fuzzyGuard: transition.fuzzyGuard,
        probabilistic: transition.probabilistic,
        pathOffset: transition.pathOffset,
        controlPoint: transition.controlPoint,
        isActive: false,
        isAnimating: false,
        onClick: handleTransitionClick,
      },
      selected: selectedTransitionIds.includes(transition.id),
    }));
  }, [automata, selectedTransitionIds, handleTransitionClick, transitionKeys.join(',')]);
  
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const updateEdgeData = useCallback((edgeId: string, updates: Record<string, unknown>) => {
    setEdges((prev) =>
      prev.map((e) => {
        if (e.id !== edgeId) return e;
        return {
          ...e,
          data: {
            ...(e.data ?? {}),
            ...updates,
          },
        };
      }),
    );
  }, [setEdges]);
  
  // Sync nodes/edges when automata changes
  useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes, setNodes]);
  
  useEffect(() => {
    // Keep edges in sync with store, but preserve transient UI-only edge state
    // (e.g. interactive placement) so it isn't wiped by selection rerenders.
    setEdges((prev) => {
      const prevById = new Map(prev.map((e) => [e.id, e] as const));

      return initialEdges.map((next) => {
        const prevEdge = prevById.get(next.id);
        const prevData: any = prevEdge?.data;

        const mergedData: any = {
          ...(next.data ?? {}),
          setEdgeData: updateEdgeData,
        };

        if (prevData?.__placing) {
          mergedData.__placing = true;
          mergedData.controlPoint = prevData.controlPoint;
          mergedData.pathOffset = prevData.pathOffset;
        }

        return {
          ...next,
          data: mergedData,
        };
      });
    });
  }, [initialEdges, setEdges, updateEdgeData]);
  
  // Handle node changes (position, selection)
  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    if (isLocked) {
      // Only allow selection changes when locked
      changes = changes.filter((c) => c.type === 'select');
    }
    
    onNodesChange(changes);
    
    // Sync position changes back to store
    changes.forEach((change) => {
      if (change.type === 'position' && change.position) {
        updateState(change.id, { position: change.position });
      }
      if (change.type === 'select') {
        const selectedNodes = nodes.filter((n) => n.selected).map((n) => n.id);
        if (change.selected) {
          setSelectedStates([...selectedNodes, change.id]);
        } else {
          setSelectedStates(selectedNodes.filter((id) => id !== change.id));
        }
      }
    });
  }, [isLocked, onNodesChange, automataId, updateState, nodes, setSelectedStates]);
  
  // Handle edge changes (selection)
  const handleEdgesChange = useCallback((changes: EdgeChange[]) => {
    onEdgesChange(changes);
    
    changes.forEach((change) => {
      if (change.type === 'select') {
        const selectedEdges = edges.filter((e) => e.selected).map((e) => e.id);
        if (change.selected) {
          setSelectedTransitions([...selectedEdges, change.id]);
        } else {
          setSelectedTransitions(selectedEdges.filter((id) => id !== change.id));
        }
      }
    });
  }, [onEdgesChange, edges, setSelectedTransitions]);
  
  // Add new state at center
  const handleAddState = useCallback(() => {
    const wrapper = reactFlowWrapper.current;
    const bounds = wrapper?.getBoundingClientRect();
    
    const position = {
      x: (bounds?.width || 400) / 2 - 75,
      y: (bounds?.height || 300) / 2 - 30,
    };
    
    const stateCount = automata ? Object.keys(automata.states).length : 0;
    
    addState({
      name: `State ${stateCount + 1}`,
      inputs: [],
      outputs: [],
      variables: [],
      code: '',
      hooks: {},
      isComposite: false,
      position,
    });
  }, [addState, automata]);
  
  if (!automata) {
    return (
      <div className="editor-empty">
        <p>Automata not found</p>
      </div>
    );
  }
  
  return (
    <div className="automata-editor" ref={reactFlowWrapper}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectOnClick={false}
        nodesConnectable={false}
        fitView
        snapToGrid
        snapGrid={[16, 16]}
        defaultEdgeOptions={{
          type: 'transitionEdge',
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 20,
            height: 20,
          },
        }}
        proOptions={{ hideAttribution: true }}
      >
        {/* Background grid */}
        <Background
          variant={BackgroundVariant.Dots}
          gap={16}
          size={1}
          color="var(--color-border)"
        />
        
        {/* Minimap */}
        <MiniMap
          className="editor-minimap"
          nodeColor={(node) => {
            if (node.selected) return 'var(--color-primary)';
            return 'var(--color-surface-elevated)';
          }}
          maskColor="rgba(0, 0, 0, 0.8)"
        />
        
        {/* Controls */}
        <Controls
          className="editor-controls"
          showInteractive={false}
        />
        
        {/* Custom toolbar */}
        <Panel position="top-left" className="editor-toolbar">
          <button
            className="btn btn-ghost btn-icon"
            onClick={handleAddState}
            title="Add State (S)"
          >
            <IconPlus size={16} />
          </button>
          <button
            className="btn btn-ghost btn-icon"
            onClick={() => {
              setEditingTransitionId(undefined);
              setShowTransitionDialog(true);
            }}
            title="Add Transition (T)"
          >
            <IconTransition size={16} />
          </button>
          <div className="toolbar-divider" />
          <button
            className={`btn btn-ghost btn-icon ${isLocked ? 'active' : ''}`}
            onClick={() => setIsLocked(!isLocked)}
            title={isLocked ? 'Unlock editing' : 'Lock editing'}
          >
            {isLocked ? <IconLock size={16} /> : <IconUnlock size={16} />}
          </button>
        </Panel>
        
        {/* Info panel */}
        <Panel position="top-right" className="editor-info">
          <div className="info-stat">
            <span className="info-label">States:</span>
            <span className="info-value">{Object.keys(automata.states).length}</span>
          </div>
          <div className="info-stat">
            <span className="info-label">Transitions:</span>
            <span className="info-value">{Object.keys(automata.transitions).length}</span>
          </div>
        </Panel>
      </ReactFlow>
      
      {/* Transition Dialog */}
      <TransitionDialog
        automataId={automataId}
        isOpen={showTransitionDialog}
        onClose={() => {
          setShowTransitionDialog(false);
          setEditingTransitionId(undefined);
        }}
        editTransitionId={editingTransitionId}
      />
    </div>
  );
};
