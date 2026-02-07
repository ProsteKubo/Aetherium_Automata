/**
 * Aetherium Automata - Transition Group Panel
 * 
 * Displays transitions grouped by source state, with special visualization
 * for weighted/probabilistic transitions. Allows weight editing and 
 * automatic normalization.
 */

import React, { useState, useMemo, useCallback } from 'react';
import { useAutomataStore } from '../../stores';
import type { Transition, State } from '../../types';
import {
  createTransitionGroup,
  analyzeTransitionGroup,
} from '../../types/connections';

// ============================================================================
// Icons
// ============================================================================

const DiceIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <path d="M2 2h12v12H2V2zm1 1v10h10V3H3z"/>
    <circle cx="5" cy="5" r="1"/>
    <circle cx="11" cy="5" r="1"/>
    <circle cx="8" cy="8" r="1"/>
    <circle cx="5" cy="11" r="1"/>
    <circle cx="11" cy="11" r="1"/>
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

const BalanceIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <path d="M8 1v2M2 5l6-2 6 2M3 5l2 6H1l2-6M13 5l2 6h-4l2-6M8 3v10M6 13h4" 
      stroke="currentColor" strokeWidth="1.2" fill="none"/>
  </svg>
);

// ============================================================================
// Types
// ============================================================================

interface TransitionGroupData {
  sourceState: State;
  transitions: Transition[];
  isProbabilistic: boolean;
  totalWeight: number;
  analysis: ReturnType<typeof analyzeTransitionGroup>;
}

type FilterMode = 'all' | 'probabilistic' | 'classic' | 'timed' | 'event';

// ============================================================================
// Weight Slider Component
// ============================================================================

interface WeightSliderProps {
  weight: number;
  normalizedWeight: number;
  onChange: (weight: number) => void;
  color: string;
  disabled?: boolean;
}

const WeightSlider: React.FC<WeightSliderProps> = ({
  weight,
  normalizedWeight,
  onChange,
  color,
  disabled = false,
}) => {
  return (
    <div className="weight-slider" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div
        className="weight-bar-container"
        style={{
          flex: 1,
          height: 8,
          backgroundColor: 'var(--color-bg-tertiary)',
          borderRadius: 4,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <div
          className="weight-bar"
          style={{
            width: `${normalizedWeight * 100}%`,
            height: '100%',
            backgroundColor: color,
            transition: 'width 0.2s ease',
          }}
        />
      </div>
      <input
        type="number"
        value={weight}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        disabled={disabled}
        min={0}
        max={100}
        step={1}
        style={{
          width: 50,
          padding: '2px 4px',
          fontSize: 'var(--font-size-xs)',
          backgroundColor: 'var(--color-bg-secondary)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--color-text-primary)',
          textAlign: 'right',
        }}
      />
      <span style={{ 
        fontSize: 'var(--font-size-xs)', 
        color: 'var(--color-text-tertiary)',
        width: 40,
      }}>
        {(normalizedWeight * 100).toFixed(1)}%
      </span>
    </div>
  );
};

// ============================================================================
// Weight Distribution Visualization
// ============================================================================

interface WeightDistributionProps {
  transitions: Transition[];
  states: Record<string, State>;
  totalWeight: number;
}

const WeightDistribution: React.FC<WeightDistributionProps> = ({
  transitions,
  states,
  totalWeight,
}) => {
  const colors = [
    '#60a5fa', // blue
    '#34d399', // green
    '#fbbf24', // yellow
    '#f87171', // red
    '#a78bfa', // purple
    '#fb923c', // orange
    '#2dd4bf', // teal
    '#f472b6', // pink
  ];

  if (totalWeight === 0) {
    return (
      <div style={{
        padding: 'var(--spacing-2)',
        textAlign: 'center',
        color: 'var(--color-text-tertiary)',
        fontSize: 'var(--font-size-xs)',
      }}>
        No weights defined
      </div>
    );
  }

  return (
    <div className="weight-distribution">
      {/* Visual bar */}
      <div
        style={{
          display: 'flex',
          height: 24,
          borderRadius: 'var(--radius-sm)',
          overflow: 'hidden',
          marginBottom: 'var(--spacing-2)',
        }}
      >
        {transitions.map((t, i) => {
          const weight = t.probabilistic?.weight ?? 1;
          const percent = (weight / totalWeight) * 100;
          const targetState = states[t.to];
          return (
            <div
              key={t.id}
              style={{
                width: `${percent}%`,
                height: '100%',
                backgroundColor: colors[i % colors.length],
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: percent > 5 ? 'auto' : 0,
                overflow: 'hidden',
              }}
              title={`${targetState?.name ?? t.to}: ${percent.toFixed(1)}%`}
            >
              {percent > 10 && (
                <span style={{ 
                  fontSize: 10, 
                  color: 'white', 
                  fontWeight: 600,
                  textShadow: '0 1px 2px rgba(0,0,0,0.3)',
                }}>
                  {percent.toFixed(0)}%
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-2)' }}>
        {transitions.map((t, i) => {
          const targetState = states[t.to];
          return (
            <div
              key={t.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 'var(--font-size-xs)',
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  backgroundColor: colors[i % colors.length],
                }}
              />
              <span style={{ color: 'var(--color-text-secondary)' }}>
                {targetState?.name ?? t.to}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ============================================================================
// Transition Group Row
// ============================================================================

interface TransitionGroupRowProps {
  group: TransitionGroupData;
  states: Record<string, State>;
  isExpanded: boolean;
  onToggle: () => void;
  onUpdateWeight: (transitionId: string, weight: number) => void;
  onNormalize: () => void;
  onSelectTransition: (transitionId: string) => void;
  selectedTransitionIds: string[];
}

const TransitionGroupRow: React.FC<TransitionGroupRowProps> = ({
  group,
  states,
  isExpanded,
  onToggle,
  onUpdateWeight,
  onNormalize,
  onSelectTransition,
  selectedTransitionIds,
}) => {
  const colors = [
    '#60a5fa', '#34d399', '#fbbf24', '#f87171', 
    '#a78bfa', '#fb923c', '#2dd4bf', '#f472b6',
  ];

  return (
    <div
      className="transition-group-row"
      style={{
        marginBottom: 'var(--spacing-2)',
        backgroundColor: 'var(--color-bg-secondary)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border)',
        overflow: 'hidden',
      }}
    >
      {/* Group header */}
      <div
        className="group-header"
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
        
        <div style={{ 
          marginLeft: 'var(--spacing-2)', 
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--spacing-2)',
        }}>
          <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>
            {group.sourceState.name}
          </span>
          
          {group.isProbabilistic && (
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 6px',
                backgroundColor: 'var(--color-primary-bg)',
                color: 'var(--color-primary)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--font-size-xs)',
              }}
            >
              <DiceIcon size={10} />
              Weighted
            </span>
          )}
          
          <span style={{ 
            color: 'var(--color-text-tertiary)',
            fontSize: 'var(--font-size-sm)',
          }}>
            {group.transitions.length} transition{group.transitions.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Mini weight bar in header */}
        {group.isProbabilistic && !isExpanded && (
          <div
            style={{
              width: 80,
              height: 6,
              display: 'flex',
              borderRadius: 3,
              overflow: 'hidden',
              backgroundColor: 'var(--color-bg-tertiary)',
            }}
          >
            {group.transitions.map((t, i) => {
              const weight = t.probabilistic?.weight ?? 1;
              const percent = group.totalWeight > 0 
                ? (weight / group.totalWeight) * 100 
                : 100 / group.transitions.length;
              return (
                <div
                  key={t.id}
                  style={{
                    width: `${percent}%`,
                    height: '100%',
                    backgroundColor: colors[i % colors.length],
                  }}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div style={{ padding: 'var(--spacing-3)' }}>
          {/* Weight distribution visualization */}
          {group.isProbabilistic && (
            <div style={{ marginBottom: 'var(--spacing-3)' }}>
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'space-between',
                marginBottom: 'var(--spacing-2)',
              }}>
                <span style={{ 
                  fontSize: 'var(--font-size-xs)', 
                  color: 'var(--color-text-tertiary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}>
                  Weight Distribution
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onNormalize();
                  }}
                  className="btn btn-ghost btn-xs"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '2px 8px',
                    fontSize: 'var(--font-size-xs)',
                  }}
                  title="Normalize weights to 100%"
                >
                  <BalanceIcon size={12} />
                  Normalize
                </button>
              </div>
              <WeightDistribution
                transitions={group.transitions}
                states={states}
                totalWeight={group.totalWeight}
              />
            </div>
          )}

          {/* Individual transitions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-2)' }}>
            {group.transitions.map((t, i) => {
              const targetState = states[t.to];
              const isSelected = selectedTransitionIds.includes(t.id);
              const weight = t.probabilistic?.weight ?? 1;
              const normalizedWeight = group.totalWeight > 0 
                ? weight / group.totalWeight 
                : 1 / group.transitions.length;
              
              return (
                <div
                  key={t.id}
                  onClick={() => onSelectTransition(t.id)}
                  style={{
                    padding: 'var(--spacing-2)',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: isSelected 
                      ? 'var(--color-primary-bg)' 
                      : 'var(--color-bg-tertiary)',
                    border: `1px solid ${isSelected ? 'var(--color-primary)' : 'transparent'}`,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: 'var(--spacing-2)',
                    marginBottom: group.isProbabilistic ? 'var(--spacing-2)' : 0,
                  }}>
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        backgroundColor: colors[i % colors.length],
                      }}
                    />
                    <span style={{ 
                      fontWeight: 500,
                      color: 'var(--color-text-primary)',
                    }}>
                      → {targetState?.name ?? t.to}
                    </span>
                    
                    {t.condition && (
                      <code style={{
                        flex: 1,
                        fontSize: 'var(--font-size-xs)',
                        color: 'var(--color-text-tertiary)',
                        backgroundColor: 'var(--color-bg-secondary)',
                        padding: '1px 4px',
                        borderRadius: 2,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {t.condition}
                      </code>
                    )}
                    
                    <span style={{
                      fontSize: 'var(--font-size-xs)',
                      color: 'var(--color-text-tertiary)',
                    }}>
                      P:{t.priority ?? 0}
                    </span>
                  </div>

                  {group.isProbabilistic && (
                    <WeightSlider
                      weight={weight}
                      normalizedWeight={normalizedWeight}
                      onChange={(newWeight) => onUpdateWeight(t.id, newWeight)}
                      color={colors[i % colors.length]}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {/* Group analysis */}
          {group.analysis && (
            <div style={{
              marginTop: 'var(--spacing-3)',
              padding: 'var(--spacing-2)',
              backgroundColor: 'var(--color-bg-tertiary)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--font-size-xs)',
            }}>
              <div style={{ 
                display: 'flex', 
                flexWrap: 'wrap', 
                gap: 'var(--spacing-3)',
                color: 'var(--color-text-secondary)',
              }}>
                <span>Targets: <strong>{group.analysis.targetCount}</strong></span>
                <span>Has Dead: <strong>{group.analysis.hasDeadWeight ? 'Yes' : 'No'}</strong></span>
                <span>Normalized: <strong>{group.analysis.isNormalized ? 'Yes' : 'No'}</strong></span>
                <span>Entropy: <strong>{group.analysis.entropyScore.toFixed(2)}</strong></span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ============================================================================
// Main Panel Component
// ============================================================================

export const TransitionGroupPanel: React.FC = () => {
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  
  const automata = useAutomataStore((state) => {
    const id = state.activeAutomataId;
    return id ? state.automata.get(id) : undefined;
  });
  const selectedTransitionIds = useAutomataStore((state) => state.selectedTransitionIds);
  const updateTransition = useAutomataStore((state) => state.updateTransition);
  const normalizeProbabilities = useAutomataStore((state) => state.normalizeProbabilities);
  const selectTransition = useAutomataStore((state) => state.selectTransition);
  
  // Group transitions by source state
  const groupedTransitions = useMemo(() => {
    if (!automata) return [];
    
    const groups = new Map<string, TransitionGroupData>();
    const states = automata.states;
    const transitions = Object.values(automata.transitions);
    
    // Filter transitions
    let filtered = transitions;
    
    if (filterMode !== 'all') {
      filtered = transitions.filter((t) => {
        if (filterMode === 'probabilistic') return t.type === 'probabilistic' || t.probabilistic;
        if (filterMode === 'classic') return !t.type || t.type === 'classic';
        if (filterMode === 'timed') return t.type === 'timed';
        if (filterMode === 'event') return t.type === 'event';
        return true;
      });
    }
    
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter((t) => {
        const sourceState = states[t.from];
        const targetState = states[t.to];
        return (
          sourceState?.name.toLowerCase().includes(q) ||
          targetState?.name.toLowerCase().includes(q) ||
          t.condition?.toLowerCase().includes(q) ||
          t.name?.toLowerCase().includes(q)
        );
      });
    }
    
    // Group by source state
    for (const t of filtered) {
      const key = t.from;
      if (!groups.has(key)) {
        const sourceState = states[key];
        if (!sourceState) continue;
        
        groups.set(key, {
          sourceState,
          transitions: [],
          isProbabilistic: false,
          totalWeight: 0,
          analysis: null as any,
        });
      }
      
      const group = groups.get(key)!;
      group.transitions.push(t);
      
      if (t.type === 'probabilistic' || t.probabilistic) {
        group.isProbabilistic = true;
        group.totalWeight += t.probabilistic?.weight ?? 1;
      }
    }
    
    // Analyze each group
    for (const group of groups.values()) {
      const transitionGroup = createTransitionGroup(
        group.sourceState.id,
        group.sourceState.name,
        'classic',
        group.transitions[0]?.condition || ''
      );
      transitionGroup.members = group.transitions.map(t => ({
        transitionId: t.id,
        targetStateId: t.to,
        targetStateName: '', // Will be filled by component
        weight: t.weight || 100,
        probability: 0,
        probabilityPercent: '',
        priority: t.priority || 0,
      }));
      group.analysis = analyzeTransitionGroup(transitionGroup);
    }
    
    return Array.from(groups.values()).sort((a, b) => 
      a.sourceState.name.localeCompare(b.sourceState.name)
    );
  }, [automata, filterMode, searchQuery]);
  
  const handleToggleGroup = useCallback((stateId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(stateId)) {
        next.delete(stateId);
      } else {
        next.add(stateId);
      }
      return next;
    });
  }, []);
  
  const handleUpdateWeight = useCallback((transitionId: string, weight: number) => {
    updateTransition(transitionId, {
      probabilistic: {
        weight: Math.max(0, Math.min(100, weight)),
      },
    });
  }, [updateTransition]);
  
  const handleNormalize = useCallback((sourceStateId: string) => {
    normalizeProbabilities(sourceStateId);
  }, [normalizeProbabilities]);
  
  const handleSelectTransition = useCallback((transitionId: string) => {
    selectTransition(transitionId, false);
  }, [selectTransition]);

  if (!automata) {
    return (
      <div className="transition-group-panel empty" style={{
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
    <div className="transition-group-panel" style={{ 
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
          gap: 'var(--spacing-2)',
          marginBottom: 'var(--spacing-2)',
        }}>
          <DiceIcon size={16} />
          <span style={{ 
            fontWeight: 600, 
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text-primary)',
          }}>
            Transition Groups
          </span>
        </div>
        
        {/* Search */}
        <input
          type="text"
          placeholder="Search transitions..."
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
            marginBottom: 'var(--spacing-2)',
          }}
        />
        
        {/* Filter tabs */}
        <div style={{ display: 'flex', gap: 'var(--spacing-1)', flexWrap: 'wrap' }}>
          {(['all', 'probabilistic', 'classic', 'timed', 'event'] as FilterMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setFilterMode(mode)}
              style={{
                padding: '2px 8px',
                fontSize: 'var(--font-size-xs)',
                backgroundColor: filterMode === mode 
                  ? 'var(--color-primary)' 
                  : 'var(--color-bg-secondary)',
                color: filterMode === mode 
                  ? 'white' 
                  : 'var(--color-text-secondary)',
                border: `1px solid ${filterMode === mode ? 'var(--color-primary)' : 'var(--color-border)'}`,
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                textTransform: 'capitalize',
              }}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>
      
      {/* Content */}
      <div style={{ 
        flex: 1, 
        overflow: 'auto', 
        padding: 'var(--spacing-3)',
      }}>
        {groupedTransitions.length === 0 ? (
          <div style={{
            textAlign: 'center',
            color: 'var(--color-text-tertiary)',
            fontSize: 'var(--font-size-sm)',
            padding: 'var(--spacing-4)',
          }}>
            No transitions match the current filter
          </div>
        ) : (
          groupedTransitions.map((group) => (
            <TransitionGroupRow
              key={group.sourceState.id}
              group={group}
              states={automata.states}
              isExpanded={expandedGroups.has(group.sourceState.id)}
              onToggle={() => handleToggleGroup(group.sourceState.id)}
              onUpdateWeight={handleUpdateWeight}
              onNormalize={() => handleNormalize(group.sourceState.id)}
              onSelectTransition={handleSelectTransition}
              selectedTransitionIds={selectedTransitionIds}
            />
          ))
        )}
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
        <span>
          {groupedTransitions.length} group{groupedTransitions.length !== 1 ? 's' : ''}
        </span>
        <span>
          {groupedTransitions.reduce((sum, g) => sum + g.transitions.length, 0)} transitions
        </span>
      </div>
    </div>
  );
};

export default TransitionGroupPanel;
