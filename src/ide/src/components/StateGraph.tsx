import { useRef, useState, useEffect } from 'react';
import type { State, Transition } from './AutomataIDE';
import { Plus, Circle, ArrowRight, Link } from 'lucide-react';

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

export function StateGraph({
  states,
  transitions,
  selectedState,
  selectedTransition,
  onStateSelect,
  onTransitionSelect,
  onStateUpdate,
  onTransitionUpdate,
  onStateCreate,
  onTransitionCreate
}: StateGraphProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionStart, setConnectionStart] = useState<string | null>(null);
  const [connectionEnd, setConnectionEnd] = useState<{ x: number; y: number } | null>(null);
  const [hoveringState, setHoveringState] = useState<string | null>(null);

  const handleMouseDown = (e: React.MouseEvent, stateId: string) => {
    if (e.button !== 0) return; // Only left click
    e.stopPropagation();
    
    // Check if shift is held for connecting
    if (e.shiftKey) {
      setIsConnecting(true);
      setConnectionStart(stateId);
      const state = states[stateId];
      setConnectionEnd({ 
        x: state.x * zoom + pan.x, 
        y: state.y * zoom + pan.y 
      });
      return;
    }
    
    const state = states[stateId];
    setDragging(stateId);
    setOffset({
      x: e.clientX - state.x * zoom - pan.x,
      y: e.clientY - state.y * zoom - pan.y
    });
    onStateSelect(stateId);
  };

  const handleStateMouseUp = (e: React.MouseEvent, stateId: string) => {
    if (isConnecting && connectionStart && connectionStart !== stateId) {
      // Create transition
      const fromState = states[connectionStart];
      const toState = states[stateId];
      const transitionId = `Transition_${Date.now()}`;
      
      const newTransition: Transition = {
        id: transitionId,
        name: `${fromState.name} → ${toState.name}`,
        from: connectionStart,
        to: stateId,
        condition: 'true',
        priority: 0
      };
      
      onTransitionCreate(newTransition);
    }
    
    setIsConnecting(false);
    setConnectionStart(null);
    setConnectionEnd(null);
  };

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0) { // Left click on empty space
      onStateSelect(null);
      onTransitionSelect(null);
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleCanvasDoubleClick = (e: React.MouseEvent) => {
    // Create new state at click position
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = (e.clientX - rect.left - pan.x) / zoom;
    const y = (e.clientY - rect.top - pan.y) / zoom;

    const stateId = `State_${Date.now()}`;
    const newState: State = {
      id: stateId,
      name: `State ${Object.keys(states).length + 1}`,
      inputs: [],
      outputs: [],
      variables: [],
      code: '',
      x,
      y
    };

    onStateCreate(newState);
    onStateSelect(stateId);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (dragging) {
      const newX = (e.clientX - offset.x - pan.x) / zoom;
      const newY = (e.clientY - offset.y - pan.y) / zoom;
      onStateUpdate(dragging, { x: newX, y: newY });
    } else if (isPanning) {
      setPan({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y
      });
    } else if (isConnecting) {
      setConnectionEnd({ x: e.clientX, y: e.clientY });
    }
  };

  const handleMouseUp = () => {
    setDragging(null);
    setIsPanning(false);
    if (isConnecting && !hoveringState) {
      setIsConnecting(false);
      setConnectionStart(null);
      setConnectionEnd(null);
    }
  };

  useEffect(() => {
    if (dragging || isPanning || isConnecting) {
      const handleGlobalMouseUp = () => {
        setDragging(null);
        setIsPanning(false);
        if (isConnecting && !hoveringState) {
          setIsConnecting(false);
          setConnectionStart(null);
          setConnectionEnd(null);
        }
      };
      window.addEventListener('mouseup', handleGlobalMouseUp);
      return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
    }
  }, [dragging, isPanning, isConnecting, hoveringState]);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(prev => Math.max(0.1, Math.min(3, prev * delta)));
  };

  const getArrowPath = (from: State, to: State) => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    if (dist === 0) return '';
    
    const fromRadius = 60;
    const toRadius = 60;
    
    const startX = from.x + (dx / dist) * fromRadius;
    const startY = from.y + (dy / dist) * fromRadius;
    const endX = to.x - (dx / dist) * toRadius;
    const endY = to.y - (dy / dist) * toRadius;
    
    // Curved path for better visual
    const midX = (startX + endX) / 2;
    const midY = (startY + endY) / 2;
    const perpX = -dy / dist * 30;
    const perpY = dx / dist * 30;
    
    return `M ${startX} ${startY} Q ${midX + perpX} ${midY + perpY} ${endX} ${endY}`;
  };

  const getArrowheadTransform = (from: State, to: State) => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const toRadius = 60;
    
    const endX = to.x - (dx / dist) * toRadius;
    const endY = to.y - (dy / dist) * toRadius;
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    
    return `translate(${endX}, ${endY}) rotate(${angle})`;
  };

  return (
    <div className="relative h-full bg-[#1e1e1e] overflow-hidden">
      {/* Grid background */}
      <div 
        className="absolute inset-0"
        style={{
          backgroundImage: `
            linear-gradient(to right, #2a2a2a 1px, transparent 1px),
            linear-gradient(to bottom, #2a2a2a 1px, transparent 1px)
          `,
          backgroundSize: `${20 * zoom}px ${20 * zoom}px`,
          backgroundPosition: `${pan.x}px ${pan.y}px`
        }}
      />

      {/* Canvas */}
      <div
        ref={canvasRef}
        className="relative h-full cursor-grab active:cursor-grabbing"
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
        onDoubleClick={handleCanvasDoubleClick}
      >
        {/* SVG for transitions */}
        <svg
          ref={svgRef}
          className="absolute inset-0 pointer-events-none"
          style={{ width: '100%', height: '100%' }}
        >
          <defs>
            <marker
              id="arrowhead"
              markerWidth="10"
              markerHeight="10"
              refX="9"
              refY="3"
              orient="auto"
            >
              <polygon points="0 0, 10 3, 0 6" fill="#007acc" />
            </marker>
            <marker
              id="arrowhead-temp"
              markerWidth="10"
              markerHeight="10"
              refX="9"
              refY="3"
              orient="auto"
            >
              <polygon points="0 0, 10 3, 0 6" fill="#16825d" />
            </marker>
          </defs>
          
          {Object.values(transitions).map(transition => {
            const fromState = states[transition.from];
            const toState = states[transition.to];
            
            if (!fromState || !toState) return null;
            
            const path = getArrowPath(fromState, toState);
            const isSelected = selectedTransition === transition.id;
            
            return (
              <g key={transition.id} transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
                <path
                  d={path}
                  stroke={isSelected ? "#007acc" : "#666"}
                  strokeWidth={isSelected ? 3 : 2}
                  fill="none"
                  markerEnd="url(#arrowhead)"
                  className="pointer-events-auto cursor-pointer hover:stroke-[#007acc] transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    onTransitionSelect(transition.id);
                  }}
                />
                {/* Transition label */}
                <text
                  x={(fromState.x + toState.x) / 2}
                  y={(fromState.y + toState.y) / 2 - 10}
                  fill="#cccccc"
                  fontSize="12"
                  textAnchor="middle"
                  className="pointer-events-none"
                >
                  {transition.name}
                </text>
              </g>
            );
          })}

          {/* Temporary connection line */}
          {isConnecting && connectionStart && connectionEnd && (
            <g>
              <line
                x1={states[connectionStart].x * zoom + pan.x}
                y1={states[connectionStart].y * zoom + pan.y}
                x2={connectionEnd.x}
                y2={connectionEnd.y}
                stroke="#16825d"
                strokeWidth="2"
                strokeDasharray="5,5"
                markerEnd="url(#arrowhead-temp)"
              />
            </g>
          )}
        </svg>

        {/* States */}
        {Object.values(states).map(state => {
          const isSelected = selectedState === state.id;
          const isHovering = hoveringState === state.id;
          const isConnectingTarget = isConnecting && connectionStart !== state.id;
          
          return (
            <div
              key={state.id}
              className={`absolute cursor-move select-none transition-all ${
                isSelected ? 'ring-2 ring-[#007acc] z-10' : ''
              } ${isConnectingTarget ? 'ring-2 ring-[#16825d] animate-pulse' : ''}`}
              style={{
                left: `${state.x * zoom + pan.x}px`,
                top: `${state.y * zoom + pan.y}px`,
                transform: 'translate(-50%, -50%)',
                width: `${120 * zoom}px`,
                height: `${120 * zoom}px`,
              }}
              onMouseDown={(e) => handleMouseDown(e, state.id)}
              onMouseUp={(e) => handleStateMouseUp(e, state.id)}
              onMouseEnter={() => setHoveringState(state.id)}
              onMouseLeave={() => setHoveringState(null)}
            >
              <div className="relative w-full h-full">
                {/* State circle */}
                <div className={`absolute inset-0 rounded-full flex items-center justify-center ${
                  isSelected 
                    ? 'bg-gradient-to-br from-[#0e639c] to-[#1177bb]' 
                    : 'bg-gradient-to-br from-[#2d2d30] to-[#252526]'
                } border-2 ${isSelected ? 'border-[#007acc]' : isConnectingTarget ? 'border-[#16825d]' : 'border-[#3e3e42]'}`}>
                  <div className="text-center px-2">
                    <div className="text-white text-sm" style={{ fontSize: `${14 * zoom}px` }}>
                      {state.name}
                    </div>
                    <div className="text-[#858585] text-xs mt-1" style={{ fontSize: `${10 * zoom}px` }}>
                      {state.inputs.length}in / {state.outputs.length}out
                    </div>
                  </div>
                </div>

                {/* Input/Output indicators */}
                <div className="absolute -left-2 top-1/2 -translate-y-1/2 flex flex-col gap-1">
                  {state.inputs.slice(0, 3).map((input, i) => (
                    <div
                      key={i}
                      className="w-3 h-3 rounded-full bg-[#16825d] border border-white"
                      title={input}
                    />
                  ))}
                </div>
                
                <div className="absolute -right-2 top-1/2 -translate-y-1/2 flex flex-col gap-1">
                  {state.outputs.slice(0, 3).map((output, i) => (
                    <div
                      key={i}
                      className="w-3 h-3 rounded-full bg-[#c586c0] border border-white"
                      title={output}
                    />
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Instructions overlay */}
      <div className="absolute top-4 left-4 bg-[#252526]/95 border border-[#3e3e42] rounded p-3 space-y-2 backdrop-blur-sm">
        <div className="text-[#cccccc] text-sm">Controls:</div>
        <div className="space-y-1 text-xs text-[#858585]">
          <div className="flex items-center gap-2">
            <Plus className="size-3" />
            <span>Double-click to create state</span>
          </div>
          <div className="flex items-center gap-2">
            <Link className="size-3" />
            <span>Shift + drag to connect states</span>
          </div>
        </div>
      </div>

      {/* Zoom controls */}
      <div className="absolute bottom-4 right-4 bg-[#252526] border border-[#3e3e42] rounded p-2 flex flex-col gap-2">
        <button
          className="px-3 py-1 text-white hover:bg-[#3e3e42] rounded transition-colors"
          onClick={() => setZoom(prev => Math.min(3, prev * 1.2))}
        >
          +
        </button>
        <div className="text-center text-[#cccccc] text-xs">
          {Math.round(zoom * 100)}%
        </div>
        <button
          className="px-3 py-1 text-white hover:bg-[#3e3e42] rounded transition-colors"
          onClick={() => setZoom(prev => Math.max(0.1, prev / 1.2))}
        >
          -
        </button>
        <button
          className="px-3 py-1 text-white hover:bg-[#3e3e42] rounded text-xs transition-colors"
          onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
        >
          Reset
        </button>
      </div>

      {/* Mini map */}
      <div className="absolute top-4 right-4 w-48 h-32 bg-[#252526]/90 border border-[#3e3e42] rounded overflow-hidden">
        <div className="relative w-full h-full">
          <svg className="w-full h-full" viewBox="0 0 800 600">
            {Object.values(states).map(state => (
              <circle
                key={state.id}
                cx={state.x}
                cy={state.y}
                r="20"
                fill={selectedState === state.id ? "#007acc" : "#3e3e42"}
                stroke="#666"
                strokeWidth="2"
              />
            ))}
          </svg>
        </div>
      </div>
    </div>
  );
}
