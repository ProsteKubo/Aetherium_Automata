/**
 * Aetherium Automata - Transition Edge Component
 * 
 * Custom ReactFlow edge for transitions with animations and labels.
 */

import { memo, useMemo, useState, useCallback, useEffect, useRef } from 'react';
import {
  EdgeProps,
  getBezierPath,
  EdgeLabelRenderer,
  Position,
  useReactFlow,
  useStore,
} from 'reactflow';
import { Transition } from '../../types';
import { useAutomataStore, useLogStore } from '../../stores';

interface TransitionEdgeData extends Omit<Transition, 'id' | 'from' | 'to'> {
  isActive?: boolean;
  isAnimating?: boolean;
  onClick?: (transitionId: string) => void;
  pathOffset?: number;
  controlPoint?: { x: number; y: number };
  // UI-only state (not persisted to automata)
  __placing?: boolean;
  // Provided by AutomataEditor in controlled mode
  setEdgeData?: (edgeId: string, updates: Record<string, unknown>) => void;
  // Probabilistic group info (computed by parent)
  probabilisticInfo?: {
    isInGroup: boolean;
    groupSize: number;
    normalizedWeight: number; // 0-1
    groupColor: string;
  };
}

// Dice icon for probabilistic transitions
const DiceIcon: React.FC<{ size?: number }> = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <path d="M2 2h12v12H2V2zm1 1v10h10V3H3z"/>
    <circle cx="5" cy="5" r="1"/>
    <circle cx="11" cy="5" r="1"/>
    <circle cx="8" cy="8" r="1"/>
    <circle cx="5" cy="11" r="1"/>
    <circle cx="11" cy="11" r="1"/>
  </svg>
);

// NOTE: ReactFlow may remount edge components during selection updates.
// Keep double-click tracking outside component so it survives remounts.
const lastEdgeLabelMouseDownById = new Map<string, { ts: number; x: number; y: number }>();
const originalPlacementByEdgeId = new Map<string, {
  pathOffset: number | null;
  controlPoint: { x: number; y: number } | null;
}>();
const ignoreNextPlaceMouseDownByEdgeId = new Map<string, boolean>();

// Helper to get handle direction vector
const getHandleDirection = (position: Position) => {
  switch (position) {
    case Position.Top: return { x: 0, y: -1 };
    case Position.Right: return { x: 1, y: 0 };
    case Position.Bottom: return { x: 0, y: 1 };
    case Position.Left: return { x: -1, y: 0 };
  }
  return { x: 0, y: -1 };
};

// Generate a self-loop path for when source === target
const getSelfLoopPath = (
  x: number, 
  y: number,
  position: Position,
  loopSize: number = 60
): [string, number, number] => {
  // Create a loop that extends from the node handle
  let c1x, c1y, c2x, c2y;
  
  if (position === Position.Top || position === Position.Bottom) {
    const sign = position === Position.Top ? -1 : 1;
    c1x = x - loopSize / 2;
    c1y = y + sign * loopSize;
    c2x = x + loopSize / 2;
    c2y = y + sign * loopSize;
  } else {
    const sign = position === Position.Left ? -1 : 1;
    c1x = x + sign * loopSize;
    c1y = y - loopSize / 2;
    c2x = x + sign * loopSize;
    c2y = y + loopSize / 2;
  }
  
  const path = `M ${x} ${y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x} ${y}`;
  
  // Label position at the top of the loop (approximate midpoint of bezier)
  const labelX = 0.25 * x + 0.375 * (c1x + c2x);
  const labelY = 0.25 * y + 0.375 * (c1y + c2y);
  
  return [path, labelX, labelY];
};

const getCurvedPath = (
  sx: number, sy: number, sourcePos: Position,
  tx: number, ty: number, targetPos: Position,
  offset: number
): [string, number, number] => {
  const dist = Math.sqrt((tx - sx) ** 2 + (ty - sy) ** 2);
  // Use a factor relative to distance for control points
  const factor = 0.25 * dist;
  
  const dS = getHandleDirection(sourcePos);
  const dT = getHandleDirection(targetPos);
  
  // Initial control points
  let cp1x = sx + dS.x * factor;
  let cp1y = sy + dS.y * factor;
  let cp2x = tx + dT.x * factor;
  let cp2y = ty + dT.y * factor;
  
  // Calculate normal vector to the chord for offset
  const dx = tx - sx;
  const dy = ty - sy;
  let nx = -dy;
  let ny = dx;
  const len = Math.sqrt(nx * nx + ny * ny);
  if (len > 0) {
    nx /= len;
    ny /= len;
  }
  
  // Apply offset to control points to curve the path
  cp1x += nx * offset;
  cp1y += ny * offset;
  cp2x += nx * offset;
  cp2y += ny * offset;
  
  const path = `M ${sx} ${sy} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${tx} ${ty}`;
  
  // Label position at t=0.5
  const t = 0.5;
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  
  const labelX = mt * mt2 * sx + 3 * mt2 * t * cp1x + 3 * mt * t2 * cp2x + t * t2 * tx;
  const labelY = mt * mt2 * sy + 3 * mt2 * t * cp1y + 3 * mt * t2 * cp2y + t * t2 * ty;
  
  return [path, labelX, labelY];
};

const getPathThroughControlPoint = (
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  cx: number,
  cy: number,
): [string, number, number] => {
  // Quadratic -> cubic conversion so the curve is strongly influenced by the control point.
  // cp1 = S + 2/3 (C - S), cp2 = T + 2/3 (C - T)
  const cp1x = sx + (2 / 3) * (cx - sx);
  const cp1y = sy + (2 / 3) * (cy - sy);
  const cp2x = tx + (2 / 3) * (cx - tx);
  const cp2y = ty + (2 / 3) * (cy - ty);

  const path = `M ${sx} ${sy} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${tx} ${ty}`;

  // Label should be exactly where the user placed it.
  return [path, cx, cy];
};

export const TransitionEdge = memo<EdgeProps<TransitionEdgeData>>(({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  style = {},
  markerEnd,
  selected,
}) => {
  const { setEdges, screenToFlowPosition } = useReactFlow();
  const updateTransition = useAutomataStore((state) => state.updateTransition);
  const selectTransition = useAutomataStore((state) => state.selectTransition);
  const addLog = useLogStore((state) => state.addLog);

  const setEdgeData = useCallback((updates: Record<string, unknown>) => {
    if (data?.setEdgeData) {
      data.setEdgeData(id, updates);
      return;
    }

    // Fallback for uncontrolled mode
    setEdges((edges) =>
      edges.map((e) => {
        if (e.id !== id) return e;
        return {
          ...e,
          data: {
            ...(e.data ?? {}),
            ...updates,
          },
        };
      }),
    );
  }, [data?.setEdgeData, id, setEdges]);
  
  const [isDragging, setIsDragging] = useState(false);
  // Use refs for drag state to avoid stale closures and dependency issues
  const dragStartRef = useRef<{ x: number, y: number, offset: number } | null>(null);
  const currentOffsetRef = useRef<number>(0);
  const justStoppedDraggingRef = useRef<boolean>(false);
  const hasDragged = useRef(false);
  const currentControlPointRef = useRef<{ x: number; y: number } | null>(null);
  const lastPlaceMoveLogAtRef = useRef<number>(0);
  const hasLoggedPlacingActiveRef = useRef(false);

  // Check if this is a self-loop
  const isSelfLoop = source === target;

  const isPlacing = Boolean(data?.__placing);

  const hasReverseEdge = useStore(
    useCallback(
      (state) => state.edges.some((e) => e.id !== id && e.source === target && e.target === source),
      [id, source, target],
    ),
  );

  const startPlacingAt = useCallback((clientX: number, clientY: number, reason: 'dblclick' | 'manual-dblclick') => {
    if (isSelfLoop) return;
    if (isDragging) return;

    addLog({
      level: 'debug',
      source: 'Editor.Edge',
      message: `start placing (${reason})`,
      data: { id, source, target, clientX, clientY },
    });

    const flowPos = screenToFlowPosition({ x: clientX, y: clientY });

    const isReversed = source > target;
    const defaultOffset = isReversed ? -30 : 30;
    const currentOffset = data?.pathOffset ?? defaultOffset;

    originalPlacementByEdgeId.set(id, {
      pathOffset: typeof data?.pathOffset === 'number' ? data.pathOffset : currentOffset,
      controlPoint: data?.controlPoint ?? null,
    });

    currentOffsetRef.current = currentOffset;
    currentControlPointRef.current = flowPos;
    hasDragged.current = false;

    // Avoid immediately committing due to the triggering mouse event.
    ignoreNextPlaceMouseDownByEdgeId.set(id, true);
    setTimeout(() => {
      ignoreNextPlaceMouseDownByEdgeId.set(id, false);
    }, 0);

    // Persist placing state on edge data so it survives remounts.
    setEdgeData({
      __placing: true,
      controlPoint: flowPos,
      pathOffset: undefined,
    });

    document.body.style.cursor = 'crosshair';
    document.documentElement.style.cursor = 'crosshair';
  }, [addLog, data?.controlPoint, data?.pathOffset, id, isDragging, isSelfLoop, screenToFlowPosition, setEdgeData, source, target]);

  const startPlacing = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    // Update edge first (so controlled edge sync can preserve it), then select.
    startPlacingAt(event.clientX, event.clientY, 'dblclick');
    selectTransition(id);
  }, [id, selectTransition, startPlacingAt]);

  useEffect(() => {
    if (!isPlacing) return;

    if (!hasLoggedPlacingActiveRef.current) {
      hasLoggedPlacingActiveRef.current = true;
      addLog({
        level: 'debug',
        source: 'Editor.Edge',
        message: 'placing mode active',
        data: { id },
      });
    }

    // Idle timeout - auto-commit if no activity for 5 seconds
    let idleTimeout: ReturnType<typeof setTimeout> | null = null;
    // Max timeout - force commit after 30 seconds regardless
    const maxTimeout = setTimeout(() => {
      addLog({
        level: 'info',
        source: 'Editor.Edge',
        message: 'placing mode max timeout reached, auto-committing',
        data: { id },
      });
      commitPlacing();
    }, 30000);

    const resetIdleTimeout = () => {
      if (idleTimeout) clearTimeout(idleTimeout);
      idleTimeout = setTimeout(() => {
        addLog({
          level: 'info',
          source: 'Editor.Edge',
          message: 'placing mode idle timeout, auto-committing',
          data: { id },
        });
        commitPlacing();
      }, 5000);
    };

    // Start idle timer immediately
    resetIdleTimeout();

    const commitPlacing = () => {
      if (idleTimeout) clearTimeout(idleTimeout);
      clearTimeout(maxTimeout);
      
      const latest = currentControlPointRef.current;
      if (latest) {
        addLog({
          level: 'debug',
          source: 'Editor.Edge',
          message: 'commit placing',
          data: { id, x: latest.x, y: latest.y },
        });
        updateTransition(id, { controlPoint: latest, pathOffset: undefined });
      } else {
        addLog({
          level: 'warn',
          source: 'Editor.Edge',
          message: 'commit placing without controlPoint (unexpected)',
          data: { id },
        });
        updateTransition(id, { controlPoint: undefined });
      }

      setEdgeData({ __placing: false });

      originalPlacementByEdgeId.delete(id);
      currentControlPointRef.current = null;
      document.body.style.cursor = '';
      document.documentElement.style.cursor = '';

      justStoppedDraggingRef.current = true;
      setTimeout(() => { justStoppedDraggingRef.current = false; }, 100);
    };

    const cancelPlacing = () => {
      if (idleTimeout) clearTimeout(idleTimeout);
      clearTimeout(maxTimeout);
      
      addLog({
        level: 'debug',
        source: 'Editor.Edge',
        message: 'cancel placing (escape)',
        data: { id },
      });
      const original = originalPlacementByEdgeId.get(id) ?? null;
      const originalOffset = original?.pathOffset ?? null;
      const originalControlPoint = original?.controlPoint ?? null;

      if (originalControlPoint) {
        setEdgeData({
          controlPoint: originalControlPoint,
          pathOffset: undefined,
          __placing: false,
        });
      } else if (typeof originalOffset === 'number') {
        setEdgeData({
          controlPoint: undefined,
          pathOffset: originalOffset,
          __placing: false,
        });
      }

      setEdgeData({ __placing: false });

      originalPlacementByEdgeId.delete(id);
      currentControlPointRef.current = null;
      document.body.style.cursor = '';
      document.documentElement.style.cursor = '';

      justStoppedDraggingRef.current = true;
      setTimeout(() => { justStoppedDraggingRef.current = false; }, 100);
    };

    const onMouseMove = (event: MouseEvent) => {
      // Reset idle timeout on mouse movement
      resetIdleTimeout();
      
      const mousePos = screenToFlowPosition({ x: event.clientX, y: event.clientY });

      currentControlPointRef.current = mousePos;

      const now = Date.now();
      if (now - lastPlaceMoveLogAtRef.current > 250) {
        lastPlaceMoveLogAtRef.current = now;
        addLog({
          level: 'trace',
          source: 'Editor.Edge',
          message: 'placing move',
          data: { id, x: Math.round(mousePos.x), y: Math.round(mousePos.y) },
        });
      }

      setEdgeData({
        controlPoint: mousePos,
        pathOffset: undefined,
        __placing: true,
      });
    };

    const onMouseDown = () => {
      if (ignoreNextPlaceMouseDownByEdgeId.get(id)) return;
      commitPlacing();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        commitPlacing();
      } else if (event.key === 'Escape') {
        cancelPlacing();
      }
    };
    
    // Handle visibility change (user switched tabs)
    const onVisibilityChange = () => {
      if (document.hidden) {
        addLog({
          level: 'info',
          source: 'Editor.Edge',
          message: 'tab hidden during placing mode, auto-committing',
          data: { id },
        });
        commitPlacing();
      }
    };
    
    // Handle window blur (user clicked outside browser)
    const onBlur = () => {
      addLog({
        level: 'info',
        source: 'Editor.Edge',
        message: 'window blur during placing mode, auto-committing',
        data: { id },
      });
      commitPlacing();
    };

    window.addEventListener('mousemove', onMouseMove);
    // Capture-phase so label handlers can't swallow the commit click.
    window.addEventListener('mousedown', onMouseDown, { capture: true });
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('blur', onBlur);

    return () => {
      if (idleTimeout) clearTimeout(idleTimeout);
      clearTimeout(maxTimeout);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mousedown', onMouseDown, { capture: true } as any);
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('blur', onBlur);
      document.body.style.cursor = '';
      document.documentElement.style.cursor = '';
      hasLoggedPlacingActiveRef.current = false;
    };
  }, [
    addLog,
    id,
    isPlacing,
    screenToFlowPosition,
    setEdgeData,
    sourceX,
    sourceY,
    targetX,
    targetY,
    updateTransition,
  ]);

  useEffect(() => {
    if (!isDragging) return;

    const onMouseMove = (event: MouseEvent) => {
      if (!dragStartRef.current) return;
      
      hasDragged.current = true;
      const { clientX, clientY } = event;
      const mousePos = screenToFlowPosition({ x: clientX, y: clientY });
      
      // Calculate offset from the chord (source -> target)
      const dx = targetX - sourceX;
      const dy = targetY - sourceY;
      
      // Normal vector (normalized)
      let nx = -dy;
      let ny = dx;
      const len = Math.sqrt(nx * nx + ny * ny);
      
      if (len === 0) return; 
      
      nx /= len;
      ny /= len;
      
      // Calculate movement projected onto normal
      const moveX = mousePos.x - dragStartRef.current.x;
      const moveY = mousePos.y - dragStartRef.current.y;
      const moveProj = moveX * nx + moveY * ny;
      
      // Scale to match the visual midpoint movement (approx 0.75 of offset)
      const newOffset = dragStartRef.current.offset + moveProj / 0.75;
      currentOffsetRef.current = newOffset;

      setEdges((edges) => 
        edges.map((e) => {
          if (e.id === id) {
            return {
              ...e,
              data: {
                ...e.data,
                pathOffset: newOffset
              }
            };
          }
          return e;
        })
      );
    };

    const stopDragging = (commit: boolean) => {
      if (commit) {
        addLog({
          level: 'debug',
          source: 'Editor.Edge',
          message: 'commit label-drag',
          data: { id, pathOffset: currentOffsetRef.current },
        });
        updateTransition(id, { pathOffset: currentOffsetRef.current });
      } else {
        addLog({
          level: 'debug',
          source: 'Editor.Edge',
          message: 'cancel label-drag (escape)',
          data: { id },
        });
        // Revert visual state
        if (dragStartRef.current) {
          const originalOffset = dragStartRef.current.offset;
          setEdges((edges) => 
            edges.map((e) => {
              if (e.id === id) {
                return {
                  ...e,
                  data: {
                    ...e.data,
                    pathOffset: originalOffset
                  }
                };
              }
              return e;
            })
          );
        }
      }
      
      setIsDragging(false);
      dragStartRef.current = null;
      document.body.style.cursor = '';
      
      // Prevent immediate re-trigger of drag start if clicking on the label
      justStoppedDraggingRef.current = true;
      setTimeout(() => { justStoppedDraggingRef.current = false; }, 100);
    };

    const onMouseDown = () => {
      // Click anywhere to commit
      stopDragging(true);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        stopDragging(true);
      } else if (event.key === 'Escape') {
        stopDragging(false);
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown);
    
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.cursor = '';
    };
  }, [addLog, isDragging, id, sourceX, sourceY, targetX, targetY, setEdges, screenToFlowPosition, updateTransition]);
  
  // Calculate path and label position
  const [edgePath, labelX, labelY] = useMemo(() => {
    if (isSelfLoop) {
      return getSelfLoopPath(sourceX, sourceY, sourcePosition as Position);
    }

    // Manual placement takes precedence.
    if (data?.controlPoint) {
      return getPathThroughControlPoint(
        sourceX,
        sourceY,
        targetX,
        targetY,
        data.controlPoint.x,
        data.controlPoint.y,
      );
    }

    // If user has manually adjusted, always use the curved path.
    if (typeof data?.pathOffset === 'number') {
      return getCurvedPath(
        sourceX,
        sourceY,
        sourcePosition as Position,
        targetX,
        targetY,
        targetPosition as Position,
        data.pathOffset,
      );
    }

    // Only auto-separate when there is a reverse edge (bidirectional).
    if (hasReverseEdge) {
      const isReversed = source > target;
      const defaultOffset = isReversed ? -45 : 45;

      return getCurvedPath(
        sourceX,
        sourceY,
        sourcePosition as Position,
        targetX,
        targetY,
        targetPosition as Position,
        defaultOffset,
      );
    }

    // Default single-direction edge: standard bezier.
    return getBezierPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
    });
  }, [
    data?.controlPoint,
    data?.pathOffset,
    hasReverseEdge,
    isSelfLoop,
    source,
    target,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  ]);
  
  // Check if this is a probabilistic edge
  const isProbabilistic = data?.probabilisticInfo?.isInGroup || 
    (data?.weight && data.weight !== 1) || 
    data?.probabilistic?.enabled;
  
  const getEdgeClass = () => {
    let className = 'transition-edge';
    if (selected) className += ' selected';
    if (data?.isActive) className += ' active';
    if (data?.isAnimating) className += ' animating';
    if (data?.fuzzyGuard) className += ' fuzzy';
    if (isProbabilistic) className += ' probabilistic';
    if (isSelfLoop) className += ' self-loop';
    return className;
  };
  
  // Calculate probability percentage for display
  const probabilityPercent = data?.probabilisticInfo?.normalizedWeight 
    ? Math.round(data.probabilisticInfo.normalizedWeight * 100)
    : data?.weight 
      ? Math.round(data.weight * 100) 
      : null;
  
  return (
    <>
      {/* Main edge path - using path element for className support */}
      <path
        id={id}
        d={edgePath}
        className={getEdgeClass()}
        style={{
          strokeWidth: selected ? 3 : isProbabilistic ? 2.5 : 2,
          fill: 'none',
          strokeDasharray: isProbabilistic ? '8,4' : undefined,
          stroke: data?.probabilisticInfo?.groupColor || undefined,
          ...style,
        }}
        markerEnd={typeof markerEnd === 'string' ? markerEnd : undefined}
        onDoubleClick={startPlacing}
        pointerEvents="stroke"
      />

      {/* Wide invisible hit-target for easier double-clicking on the edge */}
      {!isSelfLoop && (
        <path
          d={edgePath}
          style={{
            stroke: 'transparent',
            strokeWidth: 14,
            fill: 'none',
          }}
          onDoubleClick={startPlacing}
          pointerEvents="stroke"
        />
      )}
      
      {/* Animated flow indicator */}
      {data?.isAnimating && (
        <circle r="4" className="edge-flow-dot">
          <animateMotion
            dur="1s"
            repeatCount="indefinite"
            path={edgePath}
          />
        </circle>
      )}
      
      {/* Edge label */}
      <EdgeLabelRenderer>
        <div
          className={`transition-label ${selected ? 'selected' : ''}`}
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
            cursor: isSelfLoop ? 'pointer' : (isPlacing ? 'crosshair' : 'grab'),
          }}
          onMouseDown={(e) => {
            if (isSelfLoop) return;
            if (isPlacing) {
              // Let the global capture-phase handler commit.
              e.stopPropagation();
              return;
            }
            // Keep clicks from starting pan/selection on the canvas.
            e.stopPropagation();
            selectTransition(id);

            addLog({
              level: 'debug',
              source: 'Editor.Edge',
              message: 'label mousedown (select)',
              data: { id, clientX: e.clientX, clientY: e.clientY },
            });

            // Manual double-click detection (native dblclick is unreliable here).
            const now = Date.now();
            const prev = lastEdgeLabelMouseDownById.get(id) ?? null;
            lastEdgeLabelMouseDownById.set(id, { ts: now, x: e.clientX, y: e.clientY });

            if (prev) {
              const dt = now - prev.ts;
              const dx = e.clientX - prev.x;
              const dy = e.clientY - prev.y;
              const dist2 = (dx * dx + dy * dy);

              addLog({
                level: 'trace',
                source: 'Editor.Edge',
                message: 'label dblclick check',
                data: { id, dt, dist2 },
              });

              // 350ms window, 10px movement allowance.
              if (dt < 350 && dist2 < 100) {
                e.preventDefault();
                lastEdgeLabelMouseDownById.delete(id);
                startPlacingAt(e.clientX, e.clientY, 'manual-dblclick');
              }
            }
          }}
          onDoubleClick={startPlacing}
          onClick={(e) => {
            if (isPlacing) {
              e.stopPropagation();
              return;
            }

            // Let single-click open the transition editor.
            e.stopPropagation();
            data?.onClick?.(id);
          }}
        >
          {/* Probabilistic indicator - dice icon and percentage */}
          {isProbabilistic && probabilityPercent !== null && (
            <span 
              className="transition-probability-badge"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '2px',
                backgroundColor: data?.probabilisticInfo?.groupColor || 'var(--color-accent)',
                color: 'white',
                padding: '1px 4px',
                borderRadius: '8px',
                fontSize: '10px',
                fontWeight: 600,
                marginRight: '4px',
              }}
              title={`Probabilistic: ${probabilityPercent}% chance`}
            >
              <DiceIcon size={10} />
              {probabilityPercent}%
            </span>
          )}
          
          <span className="transition-event">{data?.label || data?.name || 'transition'}</span>
          
          {/* Show guard condition if exists */}
          {data?.condition && data?.condition !== 'true' && (
            <span className="transition-guard" title={`Condition: ${data.condition}`}>
              [C]
            </span>
          )}
          
          {/* Show fuzzy indicator */}
          {data?.fuzzyGuard && data?.fuzzyGuard.enabled && (
            <span className="transition-fuzzy" title="Fuzzy logic enabled">
              ~
            </span>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
});

TransitionEdge.displayName = 'TransitionEdge';
