/**
 * Aetherium Automata - Weighted Transition Group Component
 * 
 * Visual overlay for the editor canvas that groups weighted/probabilistic
 * transitions sharing the same source state and condition. Shows weight
 * distribution as a pie chart or bar attached to the source state.
 */

import React, { useMemo, useState } from 'react';
import type { Transition, State } from '../../types';

// ============================================================================
// Types
// ============================================================================

export interface WeightedTransitionGroupData {
  id: string;
  sourceStateId: string;
  transitions: Transition[];
  condition?: string;
  totalWeight: number;
  sourcePosition: { x: number; y: number };
}

interface WeightedTransitionGroupProps {
  group: WeightedTransitionGroupData;
  states: Record<string, State>;
  isSelected: boolean;
  onSelect: () => void;
  onWeightChange: (transitionId: string, weight: number) => void;
  onNormalize: () => void;
}

// ============================================================================
// Colors
// ============================================================================

const TRANSITION_COLORS = [
  '#60a5fa', // blue
  '#34d399', // green  
  '#fbbf24', // yellow
  '#f87171', // red
  '#a78bfa', // purple
  '#fb923c', // orange
  '#2dd4bf', // teal
  '#f472b6', // pink
];

// ============================================================================
// Pie Chart Slice
// ============================================================================

interface PieSliceProps {
  cx: number;
  cy: number;
  radius: number;
  startAngle: number;
  endAngle: number;
  color: string;
  label?: string;
  percentage: number;
  isHovered: boolean;
  onHover: () => void;
  onLeave: () => void;
  onClick: () => void;
}

const PieSlice: React.FC<PieSliceProps> = ({
  cx,
  cy,
  radius,
  startAngle,
  endAngle,
  color,
  percentage,
  isHovered,
  onHover,
  onLeave,
  onClick,
}) => {
  const scale = isHovered ? 1.1 : 1;
  const r = radius * scale;
  
  // Calculate arc path
  const x1 = cx + r * Math.cos(startAngle);
  const y1 = cy + r * Math.sin(startAngle);
  const x2 = cx + r * Math.cos(endAngle);
  const y2 = cy + r * Math.sin(endAngle);
  
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  
  const pathData = [
    `M ${cx} ${cy}`,
    `L ${x1} ${y1}`,
    `A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`,
    'Z',
  ].join(' ');
  
  // Label position at middle of arc
  const midAngle = (startAngle + endAngle) / 2;
  const labelRadius = radius * 0.7;
  const labelX = cx + labelRadius * Math.cos(midAngle);
  const labelY = cy + labelRadius * Math.sin(midAngle);
  
  return (
    <g
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      onClick={onClick}
      style={{ cursor: 'pointer' }}
    >
      <path
        d={pathData}
        fill={color}
        stroke="var(--color-bg-primary)"
        strokeWidth={2}
        style={{
          transition: 'transform 0.15s ease',
          transformOrigin: `${cx}px ${cy}px`,
          transform: isHovered ? 'scale(1.05)' : 'scale(1)',
        }}
      />
      {percentage > 10 && (
        <text
          x={labelX}
          y={labelY}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="var(--color-text-primary)"
          fontSize={10}
          fontWeight={600}
          style={{
            textShadow: '0 1px 2px rgba(0,0,0,0.5)',
            pointerEvents: 'none',
          }}
        >
          {percentage.toFixed(0)}%
        </text>
      )}
    </g>
  );
};

// ============================================================================
// Pie Chart
// ============================================================================

interface PieChartProps {
  x: number;
  y: number;
  radius: number;
  segments: Array<{
    id: string;
    weight: number;
    color: string;
    label: string;
  }>;
  totalWeight: number;
  hoveredId: string | null;
  onHoverSegment: (id: string | null) => void;
  onClickSegment: (id: string) => void;
}

const PieChart: React.FC<PieChartProps> = ({
  x,
  y,
  radius,
  segments,
  totalWeight,
  hoveredId,
  onHoverSegment,
  onClickSegment,
}) => {
  let currentAngle = -Math.PI / 2; // Start from top
  
  if (totalWeight === 0) {
    return (
      <circle
        cx={x}
        cy={y}
        r={radius}
        fill="var(--color-bg-tertiary)"
        stroke="var(--color-border)"
        strokeWidth={2}
      />
    );
  }
  
  return (
    <g>
      {/* Background circle */}
      <circle
        cx={x}
        cy={y}
        r={radius + 4}
        fill="none"
        stroke="var(--color-border)"
        strokeWidth={1}
        strokeDasharray="4 2"
        opacity={0.5}
      />
      
      {/* Slices */}
      {segments.map((seg) => {
        const percentage = (seg.weight / totalWeight) * 100;
        const angleSpan = (seg.weight / totalWeight) * 2 * Math.PI;
        const startAngle = currentAngle;
        const endAngle = currentAngle + angleSpan;
        currentAngle = endAngle;
        
        return (
          <PieSlice
            key={seg.id}
            cx={x}
            cy={y}
            radius={radius}
            startAngle={startAngle}
            endAngle={endAngle}
            color={seg.color}
            label={seg.label}
            percentage={percentage}
            isHovered={hoveredId === seg.id}
            onHover={() => onHoverSegment(seg.id)}
            onLeave={() => onHoverSegment(null)}
            onClick={() => onClickSegment(seg.id)}
          />
        );
      })}
      
      {/* Center circle with dice icon */}
      <circle
        cx={x}
        cy={y}
        r={radius * 0.35}
        fill="var(--color-bg-primary)"
        stroke="var(--color-border)"
        strokeWidth={1}
      />
      <text
        x={x}
        y={y}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={12}
      >
        🎲
      </text>
    </g>
  );
};

// ============================================================================
// Connector Lines
// ============================================================================

interface ConnectorLinesProps {
  sourceX: number;
  sourceY: number;
  pieX: number;
  pieY: number;
  pieRadius: number;
  segments: Array<{
    id: string;
    weight: number;
    color: string;
    targetPosition: { x: number; y: number };
  }>;
  totalWeight: number;
  hoveredId: string | null;
}

const ConnectorLines: React.FC<ConnectorLinesProps> = ({
  pieX,
  pieY,
  pieRadius,
  segments,
  totalWeight,
  hoveredId,
}) => {
  let currentAngle = -Math.PI / 2;
  
  return (
    <g>
      {segments.map((seg) => {
        const angleSpan = (seg.weight / totalWeight) * 2 * Math.PI;
        const midAngle = currentAngle + angleSpan / 2;
        currentAngle += angleSpan;
        
        // Line starts from pie edge
        const startX = pieX + pieRadius * Math.cos(midAngle);
        const startY = pieY + pieRadius * Math.sin(midAngle);
        
        // End at target (simplified - just extends outward)
        const endX = pieX + (pieRadius + 40) * Math.cos(midAngle);
        const endY = pieY + (pieRadius + 40) * Math.sin(midAngle);
        
        const isHovered = hoveredId === seg.id;
        
        return (
          <g key={seg.id}>
            {/* Connector line */}
            <line
              x1={startX}
              y1={startY}
              x2={endX}
              y2={endY}
              stroke={seg.color}
              strokeWidth={isHovered ? 3 : 2}
              strokeDasharray={isHovered ? undefined : '4 2'}
              markerEnd="url(#weighted-arrow)"
              opacity={isHovered ? 1 : 0.6}
              style={{ transition: 'all 0.15s ease' }}
            />
          </g>
        );
      })}
    </g>
  );
};

// ============================================================================
// Tooltip
// ============================================================================

interface TooltipProps {
  x: number;
  y: number;
  transitionName: string;
  targetName: string;
  weight: number;
  percentage: number;
  color: string;
}

const Tooltip: React.FC<TooltipProps> = ({
  x,
  y,
  targetName,
  weight,
  percentage,
  color,
}) => {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect
        x={-80}
        y={-40}
        width={160}
        height={36}
        rx={4}
        fill="var(--color-bg-primary)"
        stroke="var(--color-border)"
        strokeWidth={1}
        style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.2))' }}
      />
      <rect
        x={-80}
        y={-40}
        width={4}
        height={36}
        rx={2}
        fill={color}
      />
      <text
        x={-70}
        y={-26}
        fontSize={11}
        fontWeight={600}
        fill="var(--color-text-primary)"
      >
        → {targetName}
      </text>
      <text
        x={-70}
        y={-12}
        fontSize={10}
        fill="var(--color-text-secondary)"
      >
        Weight: {weight} ({percentage.toFixed(1)}%)
      </text>
    </g>
  );
};

// ============================================================================
// Main Component
// ============================================================================

export const WeightedTransitionGroup: React.FC<WeightedTransitionGroupProps> = ({
  group,
  states,
  isSelected,
  onSelect,
}) => {
  const [hoveredTransitionId, setHoveredTransitionId] = useState<string | null>(null);
  
  // Build segment data
  const segments = useMemo(() => {
    return group.transitions.map((t, i) => {
      const targetState = states[t.to];
      const weight = t.probabilistic?.weight ?? 1;
      return {
        id: t.id,
        weight,
        color: TRANSITION_COLORS[i % TRANSITION_COLORS.length],
        label: targetState?.name ?? t.to,
        targetPosition: targetState?.position ?? { x: 0, y: 0 },
      };
    });
  }, [group.transitions, states]);
  
  // Calculate pie position (offset from source state)
  const pieX = group.sourcePosition.x + 80;
  const pieY = group.sourcePosition.y;
  const pieRadius = 28;
  
  const hoveredSegment = segments.find((s) => s.id === hoveredTransitionId);
  
  return (
    <g
      className="weighted-transition-group"
      onClick={onSelect}
      style={{ cursor: 'pointer' }}
    >
      {/* Selection ring */}
      {isSelected && (
        <circle
          cx={pieX}
          cy={pieY}
          r={pieRadius + 8}
          fill="none"
          stroke="var(--color-primary)"
          strokeWidth={2}
          strokeDasharray="4 2"
          opacity={0.5}
        />
      )}
      
      {/* Connection from source state to pie */}
      <line
        x1={group.sourcePosition.x + 30} // Assuming state node width ~60
        y1={group.sourcePosition.y}
        x2={pieX - pieRadius - 4}
        y2={pieY}
        stroke="var(--color-border)"
        strokeWidth={2}
        strokeDasharray="4 2"
      />
      
      {/* Arrow marker definition */}
      <defs>
        <marker
          id="weighted-arrow"
          markerWidth="8"
          markerHeight="6"
          refX="7"
          refY="3"
          orient="auto"
        >
          <polygon points="0 0, 8 3, 0 6" fill="var(--color-text-tertiary)" />
        </marker>
      </defs>
      
      {/* Connector lines to targets */}
      <ConnectorLines
        sourceX={group.sourcePosition.x}
        sourceY={group.sourcePosition.y}
        pieX={pieX}
        pieY={pieY}
        pieRadius={pieRadius}
        segments={segments}
        totalWeight={group.totalWeight}
        hoveredId={hoveredTransitionId}
      />
      
      {/* Pie chart */}
      <PieChart
        x={pieX}
        y={pieY}
        radius={pieRadius}
        segments={segments}
        totalWeight={group.totalWeight}
        hoveredId={hoveredTransitionId}
        onHoverSegment={setHoveredTransitionId}
        onClickSegment={(id) => {
          console.log('Clicked transition:', id);
        }}
      />
      
      {/* Condition label */}
      {group.condition && (
        <g transform={`translate(${pieX}, ${pieY + pieRadius + 16})`}>
          <rect
            x={-40}
            y={-8}
            width={80}
            height={16}
            rx={4}
            fill="var(--color-bg-tertiary)"
            stroke="var(--color-border)"
          />
          <text
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={9}
            fill="var(--color-text-secondary)"
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {group.condition.length > 12 
              ? group.condition.slice(0, 10) + '...' 
              : group.condition
            }
          </text>
        </g>
      )}
      
      {/* Tooltip */}
      {hoveredSegment && (
        <Tooltip
          x={pieX}
          y={pieY - pieRadius - 50}
          transitionName={hoveredTransitionId || ''}
          targetName={hoveredSegment.label}
          weight={hoveredSegment.weight}
          percentage={(hoveredSegment.weight / group.totalWeight) * 100}
          color={hoveredSegment.color}
        />
      )}
    </g>
  );
};

// ============================================================================
// Container for all weighted groups in editor
// ============================================================================

interface WeightedTransitionGroupsOverlayProps {
  transitions: Transition[];
  states: Record<string, State>;
  selectedGroupId: string | null;
  onSelectGroup: (groupId: string | null) => void;
  onWeightChange: (transitionId: string, weight: number) => void;
  onNormalize: (sourceStateId: string) => void;
}

export const WeightedTransitionGroupsOverlay: React.FC<WeightedTransitionGroupsOverlayProps> = ({
  transitions,
  states,
  selectedGroupId,
  onSelectGroup,
  onWeightChange,
  onNormalize,
}) => {
  // Group probabilistic transitions by source state
  const groups = useMemo(() => {
    const groupMap = new Map<string, WeightedTransitionGroupData>();
    
    const probabilisticTransitions = transitions.filter(
      (t) => t.type === 'probabilistic' || t.probabilistic
    );
    
    for (const t of probabilisticTransitions) {
      const key = t.from;
      
      if (!groupMap.has(key)) {
        const sourceState = states[t.from];
        if (!sourceState) continue;
        
        groupMap.set(key, {
          id: `weighted-group-${key}`,
          sourceStateId: key,
          transitions: [],
          condition: t.condition,
          totalWeight: 0,
          sourcePosition: sourceState.position ?? { x: 0, y: 0 },
        });
      }
      
      const group = groupMap.get(key)!;
      group.transitions.push(t);
      group.totalWeight += t.probabilistic?.weight ?? 1;
    }
    
    // Only return groups with multiple transitions
    return Array.from(groupMap.values()).filter((g) => g.transitions.length >= 2);
  }, [transitions, states]);
  
  if (groups.length === 0) {
    return null;
  }
  
  return (
    <svg
      className="weighted-groups-overlay"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        overflow: 'visible',
      }}
    >
      <g style={{ pointerEvents: 'auto' }}>
        {groups.map((group) => (
          <WeightedTransitionGroup
            key={group.id}
            group={group}
            states={states}
            isSelected={selectedGroupId === group.id}
            onSelect={() => onSelectGroup(group.id)}
            onWeightChange={onWeightChange}
            onNormalize={() => onNormalize(group.sourceStateId)}
          />
        ))}
      </g>
    </svg>
  );
};

export default WeightedTransitionGroup;
