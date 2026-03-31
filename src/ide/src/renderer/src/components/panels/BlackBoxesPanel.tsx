import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAutomataStore, useGatewayStore, useRuntimeViewStore, useUIStore } from '../../stores';
import type { Automata, BlackBoxContract, BlackBoxPort, BlackBoxResource } from '../../types';
import { deriveCompatibleBindingDrafts } from '../../utils/automataBindings';
import { IconAutomata, IconBlackBox, IconNetwork } from '../common/Icons';

const EMPTY_BLACK_BOX: BlackBoxContract = {
  ports: [],
  observableStates: [],
  emittedEvents: [],
  resources: [],
};

function splitCommaSeparated(raw: string): string[] {
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function sortAutomataByName(automata: Automata[]): Automata[] {
  return [...automata].sort((left, right) => left.config.name.localeCompare(right.config.name));
}

export const BlackBoxesPanel: React.FC = () => {
  const automataMap = useAutomataStore((state) => state.automata);
  const activeAutomataId = useAutomataStore((state) => state.activeAutomataId);
  const setActiveAutomata = useAutomataStore((state) => state.setActiveAutomata);
  const updateBlackBoxContract = useAutomataStore((state) => state.updateBlackBoxContract);
  const openTab = useUIStore((state) => state.openTab);
  const layout = useUIStore((state) => state.layout);
  const togglePanel = useUIStore((state) => state.togglePanel);
  const devicesMap = useGatewayStore((state) => state.devices);
  const deploymentsMap = useRuntimeViewStore((state) => state.deployments);

  const automataList = useMemo(() => sortAutomataByName(Array.from(automataMap.values())), [automataMap]);
  const blackBoxes = useMemo(() => automataList.filter((automata) => Boolean(automata.blackBox)), [automataList]);

  const [selectedAutomataId, setSelectedAutomataId] = useState<string | null>(null);

  useEffect(() => {
    if (selectedAutomataId && automataMap.has(selectedAutomataId)) {
      return;
    }

    if (activeAutomataId && automataMap.has(activeAutomataId)) {
      setSelectedAutomataId(activeAutomataId);
      return;
    }

    setSelectedAutomataId(blackBoxes[0]?.id ?? automataList[0]?.id ?? null);
  }, [activeAutomataId, automataMap, automataList, blackBoxes, selectedAutomataId]);

  const selectedAutomata = selectedAutomataId ? automataMap.get(selectedAutomataId) ?? null : null;
  const selectedBlackBox = selectedAutomata?.blackBox ?? null;
  const selectedDeployment = useMemo(
    () =>
      selectedAutomata
        ? Array.from(deploymentsMap.values()).find((deployment) => deployment.automataId === selectedAutomata.id) ?? null
        : null,
    [deploymentsMap, selectedAutomata],
  );
  const selectedDevice = selectedDeployment ? devicesMap.get(selectedDeployment.deviceId) ?? null : null;

  const derivedBindings = useMemo(() => deriveCompatibleBindingDrafts(automataList), [automataList]);
  const relatedBindings = useMemo(
    () =>
      selectedAutomata
        ? derivedBindings.filter(
            (binding) =>
              binding.sourceAutomataId === selectedAutomata.id ||
              binding.targetAutomataId === selectedAutomata.id,
          )
        : [],
    [derivedBindings, selectedAutomata],
  );

  const openAutomata = useCallback(
    (automataId: string | undefined) => {
      if (!automataId) return;
      const automata = automataMap.get(automataId);
      if (!automata) return;

      setActiveAutomata(automata.id);
      openTab({
        type: 'automata',
        targetId: automata.id,
        name: automata.config.name,
        isDirty: Boolean(automata.isDirty),
      });
      if (!layout.panels.automata?.isVisible) {
        togglePanel('automata');
      }
    },
    [automataMap, layout.panels, openTab, setActiveAutomata, togglePanel],
  );

  const openNetwork = useCallback(() => {
    if (!layout.panels.network?.isVisible) {
      togglePanel('network');
    }
  }, [layout.panels, togglePanel]);

  const updateSelectedBlackBox = (next: BlackBoxContract) => {
    if (!selectedAutomata) return;
    updateBlackBoxContract(selectedAutomata.id, next);
  };

  const updatePort = (index: number, updates: Partial<BlackBoxPort>) => {
    if (!selectedBlackBox) return;
    updateSelectedBlackBox({
      ...selectedBlackBox,
      ports: selectedBlackBox.ports.map((port, portIndex) =>
        portIndex === index ? { ...port, ...updates } : port,
      ),
    });
  };

  const updateResource = (index: number, updates: Partial<BlackBoxResource>) => {
    if (!selectedBlackBox) return;
    updateSelectedBlackBox({
      ...selectedBlackBox,
      resources: selectedBlackBox.resources.map((resource, resourceIndex) =>
        resourceIndex === index ? { ...resource, ...updates } : resource,
      ),
    });
  };

  return (
    <div className="blackbox-panel">
      <div className="blackbox-toolbar">
        <div>
          <div className="blackbox-title">Black Boxes</div>
          <div className="blackbox-subtitle">
            Workspace-level external participants. The network can talk to their contracts, not own their internals.
          </div>
        </div>
        <div className="petri-inline-list">
          <span className="petri-chip">
            <IconBlackBox size={12} />
            {blackBoxes.length} black boxes
          </span>
          <span className="petri-chip">
            <IconAutomata size={12} />
            {automataList.length} automata
          </span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={openNetwork}>
            <IconNetwork size={14} />
            Open Network
          </button>
        </div>
      </div>

      <div className="blackbox-body">
        <aside className="blackbox-list">
          <div className="blackbox-list-section">
            <div className="blackbox-list-header">Registered</div>
            {blackBoxes.length === 0 ? (
              <div className="petri-inspector-empty">No black boxes yet.</div>
            ) : (
              blackBoxes.map((automata) => (
                <button
                  key={automata.id}
                  type="button"
                  className={`blackbox-list-item ${selectedAutomataId === automata.id ? 'selected' : ''}`}
                  onClick={() => setSelectedAutomataId(automata.id)}
                >
                  <div className="blackbox-list-item-title">{automata.config.name}</div>
                  <div className="blackbox-list-item-meta">
                    {automata.blackBox?.ports.length ?? 0} ports · {automata.blackBox?.resources.length ?? 0} resources
                  </div>
                </button>
              ))
            )}
          </div>

          <div className="blackbox-list-section">
            <div className="blackbox-list-header">Available Automata</div>
            {automataList
              .filter((automata) => !automata.blackBox)
              .map((automata) => (
                <button
                  key={automata.id}
                  type="button"
                  className={`blackbox-list-item muted ${selectedAutomataId === automata.id ? 'selected' : ''}`}
                  onClick={() => setSelectedAutomataId(automata.id)}
                >
                  <div className="blackbox-list-item-title">{automata.config.name}</div>
                  <div className="blackbox-list-item-meta">regular automaton</div>
                </button>
              ))}
          </div>
        </aside>

        <section className="blackbox-editor">
          {!selectedAutomata ? (
            <div className="petri-empty">
              <div className="empty-state">
                <div className="empty-state-title">Black Boxes</div>
                <div className="empty-state-description">Select an automaton to configure it as a network participant.</div>
              </div>
            </div>
          ) : !selectedBlackBox ? (
            <div className="blackbox-empty-card">
              <div className="blackbox-title">{selectedAutomata.config.name}</div>
              <div className="blackbox-subtitle">
                This automaton is currently gateway-managed. Promote it to a black box when the network should only see
                its public contract.
              </div>
              <div className="petri-inline-list">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => updateBlackBoxContract(selectedAutomata.id, { ...EMPTY_BLACK_BOX })}
                >
                  Enable Black Box
                </button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => openAutomata(selectedAutomata.id)}>
                  Open Automata
                </button>
              </div>
            </div>
          ) : (
            <div className="blackbox-editor-scroll">
              <div className="blackbox-section">
                <div className="blackbox-section-header">
                  <div>
                    <div className="blackbox-title">{selectedAutomata.config.name}</div>
                    <div className="blackbox-subtitle">
                      External/interface-only participant. Multiple automata can bind to this public contract.
                    </div>
                  </div>
                  <div className="petri-inline-list">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => openAutomata(selectedAutomata.id)}>
                      Open Automata
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => updateBlackBoxContract(selectedAutomata.id, undefined)}
                    >
                      Disable Black Box
                    </button>
                  </div>
                </div>

                <div className="petri-inspector-grid">
                  <div>
                    <span className="petri-kv-label">Ownership</span>
                    <span>external interface only</span>
                  </div>
                  <div>
                    <span className="petri-kv-label">Gateway Control</span>
                    <span>public contract only</span>
                  </div>
                  <div>
                    <span className="petri-kv-label">Deployment</span>
                    <span>{selectedDevice ? selectedDevice.name : 'not deployed'}</span>
                  </div>
                  <div>
                    <span className="petri-kv-label">Public Links</span>
                    <span>{relatedBindings.length}</span>
                  </div>
                </div>
              </div>

              <div className="blackbox-section">
                <div className="blackbox-section-header">
                  <div className="petri-block-title">Ports</div>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() =>
                      updateSelectedBlackBox({
                        ...selectedBlackBox,
                        ports: [...selectedBlackBox.ports, { name: '', direction: 'input', type: 'bool' }],
                      })
                    }
                  >
                    Add Port
                  </button>
                </div>
                <div className="blackbox-edit-list">
                  {selectedBlackBox.ports.map((port, index) => (
                    <div key={`${port.name}:${index}`} className="blackbox-edit-row">
                      <input
                        className="property-input"
                        type="text"
                        value={port.name}
                        placeholder="port name"
                        onChange={(e) => updatePort(index, { name: e.target.value })}
                      />
                      <select
                        className="property-select"
                        value={port.direction}
                        onChange={(e) =>
                          updatePort(index, { direction: e.target.value as BlackBoxPort['direction'] })
                        }
                      >
                        <option value="input">input</option>
                        <option value="output">output</option>
                        <option value="internal">internal</option>
                      </select>
                      <select
                        className="property-select"
                        value={port.type}
                        onChange={(e) => updatePort(index, { type: e.target.value })}
                      >
                        <option value="bool">bool</option>
                        <option value="number">number</option>
                        <option value="string">string</option>
                        <option value="table">table</option>
                        <option value="any">any</option>
                      </select>
                      <label className="petri-toggle" style={{ margin: 0 }}>
                        <input
                          type="checkbox"
                          checked={port.observable === true}
                          onChange={(e) => updatePort(index, { observable: e.target.checked })}
                        />
                        <span>observable</span>
                      </label>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() =>
                          updateSelectedBlackBox({
                            ...selectedBlackBox,
                            ports: selectedBlackBox.ports.filter((_, portIndex) => portIndex !== index),
                          })
                        }
                      >
                        Remove
                      </button>
                      <input
                        className="property-input blackbox-span-full"
                        type="text"
                        value={port.description || ''}
                        placeholder="description"
                        onChange={(e) => updatePort(index, { description: e.target.value })}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="blackbox-section">
                <div className="blackbox-section-header">
                  <div className="petri-block-title">Resources</div>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() =>
                      updateSelectedBlackBox({
                        ...selectedBlackBox,
                        resources: [...selectedBlackBox.resources, { name: '', kind: 'generic' }],
                      })
                    }
                  >
                    Add Resource
                  </button>
                </div>
                <div className="blackbox-edit-list">
                  {selectedBlackBox.resources.map((resource, index) => (
                    <div key={`${resource.name}:${index}`} className="blackbox-edit-row resource">
                      <input
                        className="property-input"
                        type="text"
                        value={resource.name}
                        placeholder="resource name"
                        onChange={(e) => updateResource(index, { name: e.target.value })}
                      />
                      <input
                        className="property-input"
                        type="text"
                        value={resource.kind}
                        placeholder="kind"
                        onChange={(e) => updateResource(index, { kind: e.target.value })}
                      />
                      <input
                        className="property-input"
                        type="number"
                        min={0}
                        value={resource.capacity ?? ''}
                        placeholder="capacity"
                        onChange={(e) =>
                          updateResource(index, {
                            capacity: e.target.value === '' ? undefined : Number(e.target.value),
                          })
                        }
                      />
                      <label className="petri-toggle" style={{ margin: 0 }}>
                        <input
                          type="checkbox"
                          checked={resource.shared === true}
                          onChange={(e) => updateResource(index, { shared: e.target.checked })}
                        />
                        <span>shared</span>
                      </label>
                      <label className="petri-toggle" style={{ margin: 0 }}>
                        <input
                          type="checkbox"
                          checked={resource.latencySensitive === true}
                          onChange={(e) => updateResource(index, { latencySensitive: e.target.checked })}
                        />
                        <span>latency</span>
                      </label>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() =>
                          updateSelectedBlackBox({
                            ...selectedBlackBox,
                            resources: selectedBlackBox.resources.filter((_, resourceIndex) => resourceIndex !== index),
                          })
                        }
                      >
                        Remove
                      </button>
                      <input
                        className="property-input blackbox-span-full"
                        type="text"
                        value={resource.description || ''}
                        placeholder="description"
                        onChange={(e) => updateResource(index, { description: e.target.value })}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="blackbox-section">
                <div className="blackbox-section-header">
                  <div className="petri-block-title">Public Semantics</div>
                </div>
                <div className="blackbox-semantic-grid">
                  <div className="property-group">
                    <label className="property-label">Observable States</label>
                    <input
                      className="property-input"
                      type="text"
                      value={selectedBlackBox.observableStates.join(', ')}
                      placeholder="Idle, Ready, Faulted"
                      onChange={(e) =>
                        updateSelectedBlackBox({
                          ...selectedBlackBox,
                          observableStates: splitCommaSeparated(e.target.value),
                        })
                      }
                    />
                  </div>
                  <div className="property-group">
                    <label className="property-label">Emitted Events</label>
                    <input
                      className="property-input"
                      type="text"
                      value={selectedBlackBox.emittedEvents.join(', ')}
                      placeholder="fault, recovered"
                      onChange={(e) =>
                        updateSelectedBlackBox({
                          ...selectedBlackBox,
                          emittedEvents: splitCommaSeparated(e.target.value),
                        })
                      }
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        <aside className="blackbox-context">
          <div className="petri-inspector-header">
            <div>
              <h3>Network Context</h3>
              <p>How this interface participates in the wider system.</p>
            </div>
          </div>
          {!selectedAutomata ? (
            <div className="petri-inspector-empty">Select a black box or an automaton to inspect its network role.</div>
          ) : (
            <>
              <div className="petri-inspector-section">
                <div className="petri-block-title">Participant</div>
                <div className="petri-inspector-grid">
                  <div>
                    <span className="petri-kv-label">Automata</span>
                    <span>{selectedAutomata.config.name}</span>
                  </div>
                  <div>
                    <span className="petri-kv-label">Mode</span>
                    <span>{selectedBlackBox ? 'black box' : 'regular automaton'}</span>
                  </div>
                  <div>
                    <span className="petri-kv-label">Device</span>
                    <span>{selectedDevice?.name ?? 'not deployed'}</span>
                  </div>
                  <div>
                    <span className="petri-kv-label">Gateway Ownership</span>
                    <span>{selectedBlackBox ? 'contract only' : 'full runtime'}</span>
                  </div>
                </div>
              </div>

              <div className="petri-inspector-section">
                <div className="petri-block-title">Linked Automata</div>
                {relatedBindings.length === 0 ? (
                  <div className="petri-inspector-empty">
                    No compatible public bindings detected yet. Add shared port names to make this contract reachable.
                  </div>
                ) : (
                  <div className="petri-warning-list">
                    {relatedBindings.map((binding) => {
                      const otherId =
                        binding.sourceAutomataId === selectedAutomata.id
                          ? binding.targetAutomataId
                          : binding.sourceAutomataId;
                      const other = automataMap.get(otherId);
                      return (
                        <div key={`${binding.sourceAutomataId}:${binding.sourceOutputName}:${binding.targetAutomataId}:${binding.targetInputName}`} className="petri-merge-item">
                          <button
                            type="button"
                            className="petri-inline-link"
                            onClick={() => openAutomata(otherId)}
                          >
                            {other?.config.name ?? otherId}
                          </button>
                          <span>
                            {binding.sourceOutputName} {'->'} {binding.targetInputName}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
};
