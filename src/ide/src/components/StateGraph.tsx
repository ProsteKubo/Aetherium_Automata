import { useCallback, useMemo } from 'react';
import { 
  ReactFlow, 
  Background, 
  Controls, 
  MiniMap, 
  Handle, 
  Position,
  Node,
  Connection,
  NodeChange,
  EdgeChange,
  NodeProps,
  BackgroundVariant,
  useReactFlow,
  ReactFlowProvider,
  MarkerType
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { State, Transition } from './AutomataIDE';

type StateGraphProps = {
  states: Record<string, State>;
  transitions: Record<string, Transition>;
  selectedState: string | null;
  selectedTransition: string | null;
  onStateSelect: (id: string | null) => void;
  onTransitionSelect: (id: string | null) => void;
  onStateUpdate: (stateId: string, updates: Partial<State>) => void;
  onTransitionUpdate: (transitionId: string, updates: Partial<Transition>) => void;
  onStateCreate: (state: State) => void;
  onTransitionCreate: (transition: Transition) => void;
};

const StateNode = ({ data, selected }: NodeProps<Node<State>>) => {
  return (
    <div className={`relative w-[80px] h-[80px] rounded-full flex items-center justify-center transition-all group ${
      selected 
        ? 'bg-[#252526] ring-2 ring-[#007acc] shadow-lg shadow-[#007acc]/20' 
        : 'bg-[#1e1e1e] border border-[#3e3e42] hover:border-[#505055]'
    }`}>
      <Handle 
        type="target" 
        position={Position.Left} 
        className="!bg-[#16825d] !w-2.5 !h-2.5 !border-[#1e1e1e] transition-transform group-hover:scale-125" 
      />
      
      <div className="text-center px-1 pointer-events-none overflow-hidden">
        <div className="text-[#e1e1e1] text-xs font-medium truncate max-w-[70px]" title={data.name}>
          {data.name}
        </div>
      </div>

      <Handle 
        type="source" 
        position={Position.Right} 
        className="!bg-[#c586c0] !w-2.5 !h-2.5 !border-[#1e1e1e] transition-transform group-hover:scale-125" 
      />
    </div>
  );
};

const nodeTypes = {
  state: StateNode,
};

function StateGraphContent({
  states,
  transitions,
  selectedState,
  selectedTransition,
  onStateSelect,
  onTransitionSelect,
  onStateUpdate,
  onStateCreate,
  onTransitionCreate
}: StateGraphProps) {
  const { screenToFlowPosition } = useReactFlow();

  const nodes = useMemo(() => Object.values(states).map(s => ({
    id: s.id,
    type: 'state',
    position: { x: s.x, y: s.y },
    data: s,
    selected: selectedState === s.id
  })), [states, selectedState]);

  const edges = useMemo(() => Object.values(transitions).map(t => ({
    id: t.id,
    source: t.from,
    target: t.to,
    label: t.name,
    type: 'default',
    animated: false,
    style: { 
      stroke: selectedTransition === t.id ? '#007acc' : '#666', 
      strokeWidth: selectedTransition === t.id ? 3 : 2 
    },
    labelStyle: { fill: '#cccccc', fontSize: 12 },
    markerEnd: { type: MarkerType.ArrowClosed, color: selectedTransition === t.id ? '#007acc' : '#666' },
    selected: selectedTransition === t.id
  })), [transitions, selectedTransition]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    changes.forEach(change => {
      if (change.type === 'position' && change.position && change.dragging) {
        onStateUpdate(change.id, { x: change.position.x, y: change.position.y });
      }
      if (change.type === 'select') {
        if (change.selected) {
            onStateSelect(change.id);
        } else if (selectedState === change.id) {
            // Only deselect if it was the selected one
             onStateSelect(null);
        }
      }
    });
  }, [onStateUpdate, onStateSelect, selectedState]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
      changes.forEach(change => {
          if (change.type === 'select') {
              if (change.selected) {
                  onTransitionSelect(change.id);
              } else if (selectedTransition === change.id) {
                  onTransitionSelect(null);
              }
          }
      });
  }, [onTransitionSelect, selectedTransition]);

  const onConnect = useCallback((connection: Connection) => {
    if (connection.source && connection.target) {
      const fromState = states[connection.source];
      const toState = states[connection.target];
      const transitionId = `Transition_${Date.now()}`;
      
      const newTransition: Transition = {
        id: transitionId,
        name: `${fromState.name} → ${toState.name}`,
        from: connection.source,
        to: connection.target,
        condition: 'true',
        priority: 0
      };
      
      onTransitionCreate(newTransition);
    }
  }, [states, onTransitionCreate]);

  const onPaneClick = useCallback(() => {
      onStateSelect(null);
      onTransitionSelect(null);
  }, [onStateSelect, onTransitionSelect]);

  const onDoubleClick = useCallback((event: React.MouseEvent) => {
      const position = screenToFlowPosition({
          x: event.clientX,
          y: event.clientY,
      });

      const stateId = `State_${Date.now()}`;
      const newState: State = {
        id: stateId,
        name: `State ${Object.keys(states).length + 1}`,
        inputs: [],
        outputs: [],
        variables: [],
        code: '',
        x: position.x,
        y: position.y
      };
  
      onStateCreate(newState);
      onStateSelect(stateId);
  }, [states, onStateCreate, onStateSelect, screenToFlowPosition]);

  return (
    <div className="h-full w-full bg-[#1e1e1e]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        onPaneClick={onPaneClick}
        onDoubleClick={onDoubleClick}
        fitView
        minZoom={0.1}
        maxZoom={4}
        defaultEdgeOptions={{ type: 'smoothstep', animated: true }}
        snapToGrid={true}
        snapGrid={[15, 15]}
        panOnScroll={true}
        selectionOnDrag={true}
      >
        <Background color="#333" gap={20} variant={BackgroundVariant.Dots} size={1} />
        <Controls className="bg-[#252526] border-[#3e3e42] text-white fill-white" />
        <MiniMap 
            nodeColor={(n) => {
                return n.selected ? '#007acc' : '#3e3e42';
            }}
            maskColor="#1e1e1e"
            className="bg-[#252526] border border-[#3e3e42] !bottom-4 !right-4"
        />
      </ReactFlow>
    </div>
  );
}

export function StateGraph(props: StateGraphProps) {
    return (
        <ReactFlowProvider>
            <StateGraphContent {...props} />
        </ReactFlowProvider>
    );
}
