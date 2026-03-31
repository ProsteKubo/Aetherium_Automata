/**
 * Aetherium Automata - Properties Panel Component
 *
 * Implemented-only property editors for automata, state, and transition entities.
 */

import React, { useCallback, useEffect, useMemo } from 'react';
import { useAutomataStore, useUIStore } from '../../stores';
import { IconSettings, IconAutomata, IconState, IconTransition } from '../common/Icons';
import { IOVariablesPanel } from './IOVariablesPanel';
import type {
  BlackBoxContract,
  EventTransitionRuntimeConfig,
  State,
  Transition,
} from '../../types';

type TransitionType = NonNullable<Transition['type']>;

function inferTransitionType(transition: Transition): TransitionType {
  if (transition.type) return transition.type;
  if (transition.timed) return 'timed';
  if (transition.event) return 'event';
  if (transition.probabilistic?.enabled || (transition.weight ?? 1) !== 1) return 'probabilistic';
  if ((transition.condition || '').trim() === 'true') return 'immediate';
  return 'classic';
}

function toSeconds(ms: unknown, fallback = 1): number {
  if (typeof ms === 'number' && Number.isFinite(ms)) return Math.max(0.001, ms / 1000);
  if (typeof ms === 'string') {
    const parsed = Number(ms);
    if (!Number.isNaN(parsed) && Number.isFinite(parsed)) return Math.max(0.001, parsed / 1000);
  }
  return fallback;
}

function toMs(seconds: number): number {
  if (!Number.isFinite(seconds)) return 1000;
  return Math.max(1, Math.round(seconds * 1000));
}

function parseValue(raw: string): string | number | boolean {
  const trimmed = raw.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;

  const numeric = Number(trimmed);
  if (!Number.isNaN(numeric) && trimmed !== '') return numeric;
  return raw;
}

function BlackBoxContractSection({
  blackBox,
  onOpenWorkspace,
}: {
  blackBox: BlackBoxContract;
  onOpenWorkspace: () => void;
}) {
  return (
    <div style={{ marginTop: 'var(--spacing-4)', borderTop: '1px solid var(--color-border)', paddingTop: 'var(--spacing-3)' }}>
      <div className="property-group">
        <label className="property-label">Black Box Contract</label>
        <div className="property-sublabel">
          External-facing contract only. The gateway can interact with the interface, not own the internals.
        </div>
        <div style={{ marginTop: 'var(--spacing-2)' }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onOpenWorkspace}>
            Open Black Boxes Workspace
          </button>
        </div>
      </div>

      <div className="property-info">
        <div className="info-row">
          <span className="info-label">Ports</span>
          <span className="info-value">{blackBox.ports.length}</span>
        </div>
        <div className="info-row">
          <span className="info-label">Resources</span>
          <span className="info-value">{blackBox.resources.length}</span>
        </div>
        <div className="info-row">
          <span className="info-label">Observable States</span>
          <span className="info-value">{blackBox.observableStates.length}</span>
        </div>
        <div className="info-row">
          <span className="info-label">Emitted Events</span>
          <span className="info-value">{blackBox.emittedEvents.length}</span>
        </div>
      </div>

      {blackBox.ports.length > 0 && (
        <div className="property-group">
          <label className="property-label">Ports</label>
          <div className="metadata-list">
            {blackBox.ports.map((port, index) => (
              <span key={`${port.direction}:${port.name}:${index}`} className="tag-item">
                {port.direction}: {port.name} ({port.type})
              </span>
            ))}
          </div>
        </div>
      )}

      {blackBox.resources.length > 0 && (
        <div className="property-group">
          <label className="property-label">Resources</label>
          <div className="metadata-list">
            {blackBox.resources.map((resource, index) => (
              <span key={`${resource.name}:${resource.kind}:${index}`} className="tag-item">
                {resource.name}: {resource.kind}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TransitionTypeEditor({
  transition,
  onChange,
}: {
  transition: Transition;
  onChange: (updates: Partial<Transition>) => void;
}) {
  const type = inferTransitionType(transition);

  const eventConfig: EventTransitionRuntimeConfig = transition.event || {
    triggers: [{ signalName: '', signalType: 'input', triggerType: 'onChange' }],
    debounceMs: 0,
    requireAll: false,
  };

  return (
    <>
      <div className="property-group">
        <label className="property-label">Type</label>
        <select
          className="property-select"
          value={type}
          onChange={(e) => {
            const next = e.target.value as TransitionType;
            if (next === 'immediate') {
              onChange({ type: next, condition: 'true' });
              return;
            }
            if (next === 'timed') {
              onChange({
                type: next,
                timed: transition.timed || { mode: 'after', delayMs: 1000, showCountdown: true },
                condition: transition.condition || '',
              });
              return;
            }
            if (next === 'event') {
              onChange({
                type: next,
                event: transition.event || {
                  triggers: [{ signalName: '', signalType: 'input', triggerType: 'onChange' }],
                  debounceMs: 0,
                  requireAll: false,
                },
                condition: transition.condition || '',
              });
              return;
            }
            if (next === 'probabilistic') {
              onChange({
                type: next,
                weight: transition.weight || 1,
                probabilistic: transition.probabilistic || {
                  enabled: true,
                  weight: transition.weight || 1,
                },
              });
              return;
            }
            onChange({ type: next });
          }}
        >
          <option value="classic">Classic</option>
          <option value="timed">Timed</option>
          <option value="event">Event</option>
          <option value="probabilistic">Probabilistic</option>
          <option value="immediate">Immediate</option>
        </select>
      </div>

      {type === 'classic' && (
        <div className="property-group">
          <label className="property-label">Guard Condition</label>
          <textarea
            className="property-textarea"
            value={transition.condition || ''}
            rows={2}
            onChange={(e) => onChange({ condition: e.target.value })}
            placeholder="e.g. check('input1') and value('temp') > 30"
          />
        </div>
      )}

      {type === 'timed' && (
        <>
          <div className="property-group">
            <label className="property-label">Timed Mode</label>
            <select
              className="property-select"
              value={transition.timed?.mode || 'after'}
              onChange={(e) =>
                onChange({
                  timed: {
                    ...(transition.timed || {}),
                    mode: e.target.value as 'after' | 'at' | 'every' | 'timeout' | 'window',
                  },
                })
              }
            >
              <option value="after">After</option>
              <option value="at">At</option>
              <option value="every">Every</option>
              <option value="timeout">Timeout</option>
              <option value="window">Window</option>
            </select>
          </div>

          <div className="property-group">
            <label className="property-label">Delay (seconds)</label>
            <input
              className="property-input"
              type="number"
              min={0.001}
              step={0.1}
              value={toSeconds(transition.timed?.delayMs ?? transition.timed?.delay_ms, 1)}
              onChange={(e) =>
                onChange({
                  timed: {
                    ...(transition.timed || {}),
                    delayMs: toMs(Number(e.target.value)),
                  },
                })
              }
            />
          </div>

          <div className="property-group">
            <label className="property-label">Jitter (seconds)</label>
            <input
              className="property-input"
              type="number"
              min={0}
              step={0.1}
              value={toSeconds(transition.timed?.jitterMs ?? transition.timed?.jitter_ms, 0)}
              onChange={(e) =>
                onChange({
                  timed: {
                    ...(transition.timed || {}),
                    jitterMs: toMs(Number(e.target.value || 0)),
                  },
                })
              }
            />
          </div>

          <div className="property-group">
            <label className="property-label">Repeat Count (every mode)</label>
            <input
              className="property-input"
              type="number"
              min={0}
              value={transition.timed?.repeatCount ?? 0}
              onChange={(e) =>
                onChange({
                  timed: {
                    ...(transition.timed || {}),
                    repeatCount: Number(e.target.value),
                  },
                })
              }
            />
          </div>

          <div className="property-group">
            <label className="property-label">Window End (seconds)</label>
            <input
              className="property-input"
              type="number"
              min={0}
              step={0.1}
              value={toSeconds(transition.timed?.windowEndMs, 0)}
              onChange={(e) =>
                onChange({
                  timed: {
                    ...(transition.timed || {}),
                    windowEndMs: toMs(Number(e.target.value || 0)),
                  },
                })
              }
            />
          </div>

          <div className="property-group">
            <label className="property-label">Additional Condition</label>
            <textarea
              className="property-textarea"
              rows={2}
              value={transition.timed?.additionalCondition || ''}
              onChange={(e) =>
                onChange({
                  timed: {
                    ...(transition.timed || {}),
                    additionalCondition: e.target.value,
                  },
                })
              }
            />
          </div>
        </>
      )}

      {type === 'event' && (
        <>
          <div className="property-group">
            <label className="property-label">Require All Triggers</label>
            <select
              className="property-select"
              value={eventConfig.requireAll ? 'yes' : 'no'}
              onChange={(e) =>
                onChange({
                  event: {
                    ...eventConfig,
                    requireAll: e.target.value === 'yes',
                  },
                })
              }
            >
              <option value="no">No (OR)</option>
              <option value="yes">Yes (AND)</option>
            </select>
          </div>

          <div className="property-group">
            <label className="property-label">Debounce (ms)</label>
            <input
              className="property-input"
              type="number"
              min={0}
              value={eventConfig.debounceMs || eventConfig.debounce_ms || 0}
              onChange={(e) =>
                onChange({
                  event: {
                    ...eventConfig,
                    debounceMs: Number(e.target.value || 0),
                  },
                })
              }
            />
          </div>

          {(eventConfig.triggers || []).map((trigger, index) => (
            <div key={`trigger-${index}`} className="property-group" style={{ border: '1px solid var(--color-border)', padding: 'var(--spacing-2)', borderRadius: 'var(--radius-sm)' }}>
              <label className="property-label">Trigger {index + 1}</label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-2)' }}>
                <input
                  className="property-input"
                  value={trigger.signalName || ''}
                  onChange={(e) => {
                    const triggers = [...(eventConfig.triggers || [])];
                    triggers[index] = { ...triggers[index], signalName: e.target.value };
                    onChange({ event: { ...eventConfig, triggers } });
                  }}
                  placeholder="signal name"
                />
                <select
                  className="property-select"
                  value={trigger.signalType || 'input'}
                  onChange={(e) => {
                    const triggers = [...(eventConfig.triggers || [])];
                    triggers[index] = {
                      ...triggers[index],
                      signalType: e.target.value as 'input' | 'output' | 'variable',
                    };
                    onChange({ event: { ...eventConfig, triggers } });
                  }}
                >
                  <option value="input">input</option>
                  <option value="output">output</option>
                  <option value="variable">variable</option>
                </select>
                <select
                  className="property-select"
                  value={trigger.triggerType || 'onChange'}
                  onChange={(e) => {
                    const triggers = [...(eventConfig.triggers || [])];
                    triggers[index] = {
                      ...triggers[index],
                      triggerType: e.target.value as 'onChange' | 'onRise' | 'onFall' | 'onThreshold' | 'onMatch',
                    };
                    onChange({ event: { ...eventConfig, triggers } });
                  }}
                >
                  <option value="onChange">onChange</option>
                  <option value="onRise">onRise</option>
                  <option value="onFall">onFall</option>
                  <option value="onThreshold">onThreshold</option>
                  <option value="onMatch">onMatch</option>
                </select>
                <input
                  className="property-input"
                  value={trigger.pattern || ''}
                  onChange={(e) => {
                    const triggers = [...(eventConfig.triggers || [])];
                    triggers[index] = { ...triggers[index], pattern: e.target.value };
                    onChange({ event: { ...eventConfig, triggers } });
                  }}
                  placeholder="pattern (onMatch)"
                />
              </div>

              {trigger.triggerType === 'onThreshold' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--spacing-2)', marginTop: 'var(--spacing-2)' }}>
                  <select
                    className="property-select"
                    value={trigger.threshold?.operator || '>'}
                    onChange={(e) => {
                      const triggers = [...(eventConfig.triggers || [])];
                      triggers[index] = {
                        ...triggers[index],
                        threshold: {
                          ...(trigger.threshold || {}),
                          operator: e.target.value as '>' | '<' | '>=' | '<=' | '==' | '!=',
                        },
                      };
                      onChange({ event: { ...eventConfig, triggers } });
                    }}
                  >
                    <option value=">">&gt;</option>
                    <option value="<">&lt;</option>
                    <option value=">=">&gt;=</option>
                    <option value="<=">&lt;=</option>
                    <option value="==">==</option>
                    <option value="!=">!=</option>
                  </select>
                  <input
                    className="property-input"
                    value={String(trigger.threshold?.value ?? '')}
                    onChange={(e) => {
                      const triggers = [...(eventConfig.triggers || [])];
                      triggers[index] = {
                        ...triggers[index],
                        threshold: {
                          ...(trigger.threshold || {}),
                          value: parseValue(e.target.value),
                        },
                      };
                      onChange({ event: { ...eventConfig, triggers } });
                    }}
                    placeholder="threshold"
                  />
                  <select
                    className="property-select"
                    value={trigger.threshold?.oneShot ? 'yes' : 'no'}
                    onChange={(e) => {
                      const triggers = [...(eventConfig.triggers || [])];
                      triggers[index] = {
                        ...triggers[index],
                        threshold: {
                          ...(trigger.threshold || {}),
                          oneShot: e.target.value === 'yes',
                        },
                      };
                      onChange({ event: { ...eventConfig, triggers } });
                    }}
                  >
                    <option value="no">repeat</option>
                    <option value="yes">one-shot</option>
                  </select>
                </div>
              )}

              <button
                className="btn btn-ghost btn-sm"
                type="button"
                onClick={() => {
                  const triggers = [...(eventConfig.triggers || [])];
                  triggers.splice(index, 1);
                  onChange({ event: { ...eventConfig, triggers } });
                }}
              >
                Remove Trigger
              </button>
            </div>
          ))}

          <div className="property-group">
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              onClick={() => {
                const triggers = [...(eventConfig.triggers || [])];
                triggers.push({ signalName: '', signalType: 'input', triggerType: 'onChange' });
                onChange({ event: { ...eventConfig, triggers } });
              }}
            >
              Add Trigger
            </button>
          </div>

          <div className="property-group">
            <label className="property-label">Additional Condition</label>
            <textarea
              className="property-textarea"
              rows={2}
              value={eventConfig.additionalCondition || ''}
              onChange={(e) =>
                onChange({
                  event: {
                    ...eventConfig,
                    additionalCondition: e.target.value,
                  },
                })
              }
            />
          </div>
        </>
      )}

      {type === 'probabilistic' && (
        <>
          <div className="property-group">
            <label className="property-label">Weight</label>
            <input
              className="property-input"
              type="number"
              min={0}
              step={0.01}
              value={transition.weight || transition.probabilistic?.weight || 1}
              onChange={(e) => {
                const weight = Number(e.target.value || 0);
                onChange({
                  weight,
                  probabilistic: {
                    ...(transition.probabilistic || { enabled: true }),
                    enabled: true,
                    weight,
                  },
                });
              }}
            />
          </div>

          <div className="property-group">
            <label className="property-label">Weight Condition (optional)</label>
            <textarea
              className="property-textarea"
              rows={2}
              value={transition.probabilistic?.condition || ''}
              onChange={(e) =>
                onChange({
                  probabilistic: {
                    ...(transition.probabilistic || { enabled: true, weight: transition.weight || 1 }),
                    condition: e.target.value,
                  },
                })
              }
            />
          </div>
        </>
      )}

      {type === 'immediate' && (
        <div className="property-group">
          <div className="property-code-hint">Immediate transitions fire without guard checks.</div>
        </div>
      )}
    </>
  );
}

export const PropertiesPanel: React.FC = () => {
  const activeAutomata = useAutomataStore((state) => {
    const id = state.activeAutomataId;
    return id ? state.automata.get(id) : undefined;
  });
  const selectedStateIds = useAutomataStore((state) => state.selectedStateIds);
  const selectedTransitionIds = useAutomataStore((state) => state.selectedTransitionIds);
  const updateAutomataMeta = useAutomataStore((state) => state.updateAutomataMeta);
  const updateState = useAutomataStore((state) => state.updateState);
  const updateTransition = useAutomataStore((state) => state.updateTransition);
  const normalizeProbabilities = useAutomataStore((state) => state.normalizeProbabilities);
  const openTab = useUIStore((state) => state.openTab);
  const layout = useUIStore((state) => state.layout);
  const togglePanel = useUIStore((state) => state.togglePanel);

  const openBlackBoxesWorkspace = useCallback(() => {
    if (!layout.panels.blackboxes?.isVisible) {
      togglePanel('blackboxes');
    }
  }, [layout.panels, togglePanel]);

  const selectedState: State | undefined =
    activeAutomata && selectedStateIds.length === 1 ? activeAutomata.states[selectedStateIds[0]] : undefined;

  const selectedTransition: Transition | undefined =
    activeAutomata && selectedTransitionIds.length === 1
      ? activeAutomata.transitions[selectedTransitionIds[0]]
      : undefined;

  useEffect(() => {
    if (!selectedTransition) return;
    if (selectedTransition.type) return;

    const inferred = inferTransitionType(selectedTransition);
    updateTransition(selectedTransition.id, { type: inferred });
  }, [selectedTransition, updateTransition]);

  const stateEntries = useMemo(() => {
    if (!activeAutomata) return [] as Array<[string, State]>;
    return Object.entries(activeAutomata.states);
  }, [activeAutomata]);

  if (selectedState && activeAutomata) {
    const hooks = selectedState.hooks || {};
    const availableHooks = [
      hooks.onEnter ? 'onEnter' : null,
      hooks.onExit ? 'onExit' : null,
      hooks.onTick ? 'onTick' : null,
      hooks.onError ? 'onError' : null,
    ].filter(Boolean) as string[];

    return (
      <div className="properties-panel">
        <div className="panel-header">
          <IconState size={14} />
          <span>State Properties</span>
        </div>

        <div className="properties-content">
          <div className="property-group">
            <label className="property-label">Name</label>
            <input
              type="text"
              className="property-input"
              value={selectedState.name}
              onChange={(e) => updateState(selectedState.id, { name: e.target.value })}
            />
          </div>

          <div className="property-group">
            <label className="property-label">Description</label>
            <textarea
              className="property-textarea"
              value={selectedState.description || ''}
              rows={3}
              onChange={(e) => updateState(selectedState.id, { description: e.target.value })}
            />
          </div>

          <div className="property-group">
            <label className="property-label">Composite</label>
            <select
              className="property-select"
              value={selectedState.isComposite ? 'yes' : 'no'}
              onChange={(e) => updateState(selectedState.id, { isComposite: e.target.value === 'yes' })}
            >
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
          </div>

          <div className="property-group">
            <label className="property-label">Position</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-2)' }}>
              <input
                type="number"
                className="property-input"
                value={selectedState.position.x}
                onChange={(e) =>
                  updateState(selectedState.id, {
                    position: {
                      ...selectedState.position,
                      x: Number(e.target.value || 0),
                    },
                  })
                }
              />
              <input
                type="number"
                className="property-input"
                value={selectedState.position.y}
                onChange={(e) =>
                  updateState(selectedState.id, {
                    position: {
                      ...selectedState.position,
                      y: Number(e.target.value || 0),
                    },
                  })
                }
              />
            </div>
          </div>

          <div className="property-group">
            <label className="property-label">Hooks</label>
            <div className="property-code-hint">
              {availableHooks.length > 0 ? availableHooks.join(', ') : 'No hooks defined'}
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() =>
                openTab({
                  type: 'code',
                  targetId: selectedState.id,
                  name: `${selectedState.name}.lua`,
                  isDirty: Boolean(activeAutomata.isDirty),
                })
              }
              style={{ marginTop: 'var(--spacing-2)' }}
            >
              Open Code
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (selectedTransition && activeAutomata) {
    return (
      <div className="properties-panel">
        <div className="panel-header">
          <IconTransition size={14} />
          <span>Transition Properties</span>
        </div>

        <div className="properties-content">
          <div className="property-group">
            <label className="property-label">Name</label>
            <input
              type="text"
              className="property-input"
              value={selectedTransition.name}
              onChange={(e) => updateTransition(selectedTransition.id, { name: e.target.value })}
            />
          </div>

          <div className="property-group">
            <label className="property-label">From State</label>
            <select
              className="property-select"
              value={selectedTransition.from}
              onChange={(e) => updateTransition(selectedTransition.id, { from: e.target.value })}
            >
              {stateEntries.map(([id, state]) => (
                <option key={id} value={id}>
                  {state.name}
                </option>
              ))}
            </select>
          </div>

          <div className="property-group">
            <label className="property-label">To State</label>
            <select
              className="property-select"
              value={selectedTransition.to}
              onChange={(e) => updateTransition(selectedTransition.id, { to: e.target.value })}
            >
              {stateEntries.map(([id, state]) => (
                <option key={id} value={id}>
                  {state.name}
                </option>
              ))}
            </select>
          </div>

          <div className="property-group">
            <label className="property-label">Priority (lower = higher)</label>
            <input
              type="number"
              className="property-input"
              value={selectedTransition.priority || 0}
              onChange={(e) => updateTransition(selectedTransition.id, { priority: Number(e.target.value || 0) })}
            />
          </div>

          <TransitionTypeEditor
            transition={selectedTransition}
            onChange={(updates) => updateTransition(selectedTransition.id, updates)}
          />

          <div className="property-group">
            <label className="property-label">Action Body (Lua)</label>
            <textarea
              className="property-textarea"
              rows={4}
              value={selectedTransition.body || ''}
              onChange={(e) => updateTransition(selectedTransition.id, { body: e.target.value })}
            />
          </div>

          <div className="property-group">
            <label className="property-label">Description</label>
            <textarea
              className="property-textarea"
              rows={3}
              value={selectedTransition.description || ''}
              onChange={(e) => updateTransition(selectedTransition.id, { description: e.target.value })}
            />
          </div>

          {inferTransitionType(selectedTransition) === 'probabilistic' && (
            <div className="property-group">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => normalizeProbabilities(selectedTransition.from)}>
                Normalize Sibling Weights
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (activeAutomata) {
    const stateCount = Object.keys(activeAutomata.states).length;
    const transitionCount = Object.keys(activeAutomata.transitions).length;

    return (
      <div className="properties-panel">
        <div className="panel-header">
          <IconAutomata size={14} />
          <span>Automata Properties</span>
        </div>

        <div className="properties-content">
          <div className="property-group">
            <label className="property-label">Name</label>
            <input
              className="property-input"
              type="text"
              value={activeAutomata.config.name}
              onChange={(e) => updateAutomataMeta(activeAutomata.id, { name: e.target.value })}
            />
          </div>

          <div className="property-group">
            <label className="property-label">Description</label>
            <textarea
              className="property-textarea"
              rows={3}
              value={activeAutomata.config.description || ''}
              onChange={(e) => updateAutomataMeta(activeAutomata.id, { description: e.target.value })}
            />
          </div>

          <div className="property-group">
            <label className="property-label">Tags (comma separated)</label>
            <input
              className="property-input"
              type="text"
              value={(activeAutomata.config.tags || []).join(', ')}
              onChange={(e) =>
                updateAutomataMeta(activeAutomata.id, {
                  tags: e.target.value
                    .split(',')
                    .map((tag) => tag.trim())
                    .filter(Boolean),
                })
              }
            />
          </div>

          <div className="property-group">
            <label className="property-label">Initial State</label>
            <select
              className="property-select"
              value={activeAutomata.initialState}
              onChange={(e) => updateAutomataMeta(activeAutomata.id, { initialState: e.target.value })}
            >
              {stateEntries.map(([id, state]) => (
                <option key={id} value={id}>
                  {state.name}
                </option>
              ))}
            </select>
          </div>

          <div className="property-info">
            <div className="info-row">
              <span className="info-label">States</span>
              <span className="info-value">{stateCount}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Transitions</span>
              <span className="info-value">{transitionCount}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Modified</span>
              <span className="info-value">
                {new Date(activeAutomata.config.modified || activeAutomata.config.created || Date.now()).toLocaleString()}
              </span>
            </div>
          </div>

          <div style={{ marginTop: 'var(--spacing-4)', borderTop: '1px solid var(--color-border)', paddingTop: 'var(--spacing-3)' }}>
            <IOVariablesPanel embedded />
          </div>

          {activeAutomata.blackBox ? (
            <BlackBoxContractSection
              blackBox={activeAutomata.blackBox}
              onOpenWorkspace={openBlackBoxesWorkspace}
            />
          ) : (
            <div style={{ marginTop: 'var(--spacing-4)', borderTop: '1px solid var(--color-border)', paddingTop: 'var(--spacing-3)' }}>
              <div className="property-group">
                <label className="property-label">Black Box</label>
                <div className="property-sublabel">
                  Mark this automaton as an external/interface-only participant. The network can talk to the contract,
                  but does not own the internals.
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={openBlackBoxesWorkspace}
                >
                  Open Black Boxes Workspace
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="properties-panel">
      <div className="panel-header">
        <IconSettings size={14} />
        <span>Properties</span>
      </div>
      <div className="properties-empty">
        <p>Select an automata, state, or transition to view its properties.</p>
      </div>
    </div>
  );
};
