/**
 * Aetherium Automata - Visual Editor Component
 * 
 * ReactFlow-based visual editor for automata states and transitions.
 * Enhanced with keyboard shortcuts and quick creation tools.
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
  useReactFlow,
  ReactFlowProvider,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { StateNode } from './StateNode';
import { TransitionEdge } from './TransitionEdge';
import { TransitionDialog } from './TransitionDialog';
import { EnhancedTransitionDialog } from './EnhancedTransitionDialog';
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
  const [useEnhancedDialog, setUseEnhancedDialog] = useState(true); // Use new enhanced dialog
  const [editingTransitionId, setEditingTransitionId] = useState<string | undefined>(undefined);
  const [showGrid, setShowGrid] = useState(true);
  
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
  const deleteState = useAutomataStore((state) => state.deleteState);
  const deleteTransition = useAutomataStore((state) => state.deleteTransition);
  const setActiveAutomata = useAutomataStore((state) => state.setActiveAutomata);
  const openTab = useUIStore((state) => state.openTab);
  
  // Ensure this automata is active when the editor is displayed
  useEffect(() => {
    setActiveAutomata(automataId);
  }, [automataId, setActiveAutomata]);
  
  // Comprehensive keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if typing in an input
      if (document.activeElement?.tagName === 'INPUT' || 
          document.activeElement?.tagName === 'TEXTAREA') {
        return;
      }
      
      const isMod = e.metaKey || e.ctrlKey;
      
      // T - Create transition
      if (e.key === 't' && !isMod && !e.altKey) {
        setEditingTransitionId(undefined);
        setShowTransitionDialog(true);
        e.preventDefault();
      }
      
      // N - Create state
      if (e.key === 'n' && !isMod && !e.altKey && !e.shiftKey) {
        handleAddState('normal');
        e.preventDefault();
      }
      
      // Shift+N - Create initial state
      if (e.key === 'N' && e.shiftKey && !isMod && !e.altKey) {
        handleAddState('initial');
        e.preventDefault();
      }
      
      // Alt+N - Create final state
      if (e.key === 'n' && e.altKey && !isMod) {
        handleAddState('final');
        e.preventDefault();
      }
      
      // L - Toggle lock
      if (e.key === 'l' && !isMod && !e.altKey) {
        setIsLocked((prev) => !prev);
        e.preventDefault();
      }
      
      // # - Toggle grid
      if (e.key === '#' || (e.key === '3' && e.shiftKey)) {
        setShowGrid((prev) => !prev);
        e.preventDefault();
      }
      
      // Delete/Backspace - Delete selected elements
      if ((e.key === 'Delete' || e.key === 'Backspace') && !isMod) {
        if (selectedStateIds.length > 0) {
          selectedStateIds.forEach((id) => deleteState(id));
          setSelectedStates([]);
        }
        if (selectedTransitionIds.length > 0) {
          selectedTransitionIds.forEach((id) => deleteTransition(id));
          setSelectedTransitions([]);
        }
        e.preventDefault();
      }
      
      // Escape - Deselect all
      if (e.key === 'Escape') {
        setSelectedStates([]);
        setSelectedTransitions([]);
        setShowTransitionDialog(false);
        e.preventDefault();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedStateIds, selectedTransitionIds, deleteState, deleteTransition, setSelectedStates, setSelectedTransitions]);
  
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
  const handleAddState = useCallback((type: 'normal' | 'initial' | 'final' = 'normal') => {
    const wrapper = reactFlowWrapper.current;
    const bounds = wrapper?.getBoundingClientRect();
    
    // Add some randomness so multiple quick additions don't stack
    const offsetX = Math.random() * 100 - 50;
    const offsetY = Math.random() * 100 - 50;
    
    const position = {
      x: (bounds?.width || 400) / 2 - 75 + offsetX,
      y: (bounds?.height || 300) / 2 - 30 + offsetY,
    };
    
    const stateCount = automata ? Object.keys(automata.states).length : 0;
    const isInitial = type === 'initial';
    const isFinal = type === 'final';
    
    addState({
      name: isInitial ? 'Initial' : isFinal ? 'Final' : `State ${stateCount + 1}`,
      inputs: [],
      outputs: [],
      variables: [],
      code: '',
      hooks: {},
      isComposite: false,
      position,
      // Additional state properties for initial/final could be added here
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
        {showGrid && (
          <Background
            variant={BackgroundVariant.Dots}
            gap={16}
            size={1}
            color="var(--color-border)"
          />
        )}
        
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
            onClick={() => handleAddState('normal')}
            title="Add State (N)"
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
            title={isLocked ? 'Unlock editing (L)' : 'Lock editing (L)'}
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
      
      {/* Transition Dialog - Use Enhanced or Basic based on preference */}
      {useEnhancedDialog ? (
        <EnhancedTransitionDialog
          automataId={automataId}
          isOpen={showTransitionDialog}
          onClose={() => {
            setShowTransitionDialog(false);
            setEditingTransitionId(undefined);
          }}
          editTransitionId={editingTransitionId}
        />
      ) : (
        <TransitionDialog
          automataId={automataId}
          isOpen={showTransitionDialog}
          onClose={() => {
            setShowTransitionDialog(false);
            setEditingTransitionId(undefined);
          }}
          editTransitionId={editingTransitionId}
        />
      )}
    </div>
  );
};
