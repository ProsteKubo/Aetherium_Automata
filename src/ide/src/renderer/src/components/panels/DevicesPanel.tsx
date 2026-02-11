/**
 * Aetherium Automata - Devices Panel Component
 * 
 * Shows device network status, allows device management and OTA updates.
 */

import React, { useState, useMemo } from 'react';
import { useGatewayStore, useExecutionStore, useUIStore, useAutomataStore } from '../../stores';
import {
  IconDevice,
  IconServer,
  IconUpload,
  IconPlay,
  IconStop,
  IconRefresh,
  IconSettings,
  IconCheck,
  IconWarning,
  IconError,
  IconChevronRight,
  IconChevronDown,
} from '../common/Icons';

export const DevicesPanel: React.FC = () => {
  const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set());
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  const [varName, setVarName] = useState<string>('');
  const [varValue, setVarValue] = useState<string>('');
  const [eventName, setEventName] = useState<string>('');
  const [eventData, setEventData] = useState<string>('');
  const [forceState, setForceState] = useState<string>('');
  
  // Store data - get raw Maps and memoize array conversion
  const serversMap = useGatewayStore((state) => state.servers);
  const devicesMap = useGatewayStore((state) => state.devices);
  const isConnected = useGatewayStore((state) => state.status === 'connected');
  const fetchDevices = useGatewayStore((state) => state.fetchDevices);
  const fetchServers = useGatewayStore((state) => state.fetchServers);
  const gatewayService = useGatewayStore((state) => state.service);
  const activeAutomataId = useAutomataStore((state) => state.activeAutomataId);
  const automataMap = useAutomataStore((state) => state.automata);
  const deviceExecutions = useExecutionStore((state) => state.deviceExecutions);
  const startExecution = useExecutionStore((state) => state.startExecution);
  const stopExecution = useExecutionStore((state) => state.stopExecution);
  const pauseExecution = useExecutionStore((state) => state.pauseExecution);
  const resumeExecution = useExecutionStore((state) => state.resumeExecution);
  const resetExecution = useExecutionStore((state) => state.resetExecution);
  const fetchSnapshot = useExecutionStore((state) => state.fetchSnapshot);
  const addNotification = useUIStore((state) => state.addNotification);
  
  // Memoize array conversions
  const servers = useMemo(() => Array.from(serversMap.values()), [serversMap]);
  const devices = useMemo(() => Array.from(devicesMap.values()), [devicesMap]);
  const activeAutomata = activeAutomataId ? automataMap.get(activeAutomataId) : undefined;

  const pickDeployCandidate = (): { id: string; automata: any } | null => {
    if (activeAutomataId && activeAutomata) {
      return { id: activeAutomataId, automata: activeAutomata };
    }

    const first = automataMap.values().next().value;
    if (first?.id) {
      return { id: first.id, automata: first };
    }

    return null;
  };
  
  const toggleServer = (serverId: string) => {
    setExpandedServers((prev) => {
      const next = new Set(prev);
      if (next.has(serverId)) {
        next.delete(serverId);
      } else {
        next.add(serverId);
      }
      return next;
    });
  };
  
  const handleRefresh = async () => {
    await Promise.all([fetchServers(), fetchDevices()]);
    addNotification('info', 'Refresh', 'Device list refreshed');
  };
  
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'online':
      case 'connected':
        return <IconCheck size={12} className="status-icon online" />;
      case 'error':
        return <IconError size={12} className="status-icon error" />;
      case 'updating':
        return <IconRefresh size={12} className="status-icon warning spin" />;
      default:
        return <IconWarning size={12} className="status-icon offline" />;
    }
  };
  
  const getDeviceExecution = (deviceId: string) => {
    return deviceExecutions.get(deviceId);
  };

  const supportsCommand = (deviceId: string, command: string): boolean => {
    const device = devicesMap.get(deviceId);
    if (!device?.supportedCommands || device.supportedCommands.length === 0) {
      return true;
    }
    return device.supportedCommands.includes(command);
  };

  const isDeviceReachable = (status: string): boolean => {
    return status === 'online' || status === 'connected';
  };
  
  const handleStartExecution = async (deviceId: string) => {
    try {
      const device = devicesMap.get(deviceId);

      if (!device?.assignedAutomataId) {
        const candidate = pickDeployCandidate();
        if (!candidate) {
          addNotification('warning', 'Execution', 'No automata available. Create or import one first.');
          return;
        }

        await gatewayService.deployAutomata(candidate.id, deviceId, { automata: candidate.automata });
        addNotification('info', 'Deploy', `Auto-deployed ${candidate.automata?.config?.name ?? candidate.id} to ${deviceId}`);
      }

      await startExecution(deviceId);
      addNotification('success', 'Execution', `Started execution on ${deviceId}`);
    } catch (err) {
      addNotification('error', 'Execution', err instanceof Error ? err.message : 'Failed to start execution');
    }
  };
  
  const handleStopExecution = async (deviceId: string) => {
    try {
      await stopExecution(deviceId);
      addNotification('success', 'Execution', `Stopped execution on ${deviceId}`);
    } catch (err) {
      addNotification('error', 'Execution', err instanceof Error ? err.message : 'Failed to stop execution');
    }
  };

  const handlePauseExecution = async (deviceId: string) => {
    try {
      await pauseExecution(deviceId);
      addNotification('success', 'Execution', `Paused execution on ${deviceId}`);
    } catch (err) {
      addNotification('error', 'Execution', err instanceof Error ? err.message : 'Failed to pause execution');
    }
  };

  const handleResumeExecution = async (deviceId: string) => {
    try {
      await resumeExecution(deviceId);
      addNotification('success', 'Execution', `Resumed execution on ${deviceId}`);
    } catch (err) {
      addNotification('error', 'Execution', err instanceof Error ? err.message : 'Failed to resume execution');
    }
  };

  const handleResetExecution = async (deviceId: string) => {
    try {
      await resetExecution(deviceId);
      addNotification('success', 'Execution', `Reset execution on ${deviceId}`);
    } catch (err) {
      addNotification('error', 'Execution', err instanceof Error ? err.message : 'Failed to reset execution');
    }
  };

  const handleSnapshot = async (deviceId: string) => {
    try {
      const snapshot = await fetchSnapshot(deviceId);
      addNotification('info', 'Snapshot', `State: ${snapshot.currentState}`);
    } catch (err) {
      addNotification('error', 'Snapshot', err instanceof Error ? err.message : 'Failed to fetch snapshot');
    }
  };
  
  const handleOTAUpdate = async (deviceId: string) => {
    // TODO: Implement OTA update
    addNotification('info', 'OTA Update', `Initiating OTA update for device ${deviceId}`);
  };

  const handleDeployActiveAutomata = async (deviceId: string) => {
    const candidate = pickDeployCandidate();
    if (!candidate) {
      addNotification('warning', 'Deploy', 'No automata available. Create or import one first.');
      return;
    }

    try {
      await gatewayService.deployAutomata(candidate.id, deviceId, { automata: candidate.automata });
      addNotification('success', 'Deploy', `Deployed ${candidate.automata?.config?.name ?? candidate.id} to ${deviceId}`);
    } catch (err) {
      addNotification('error', 'Deploy', err instanceof Error ? err.message : 'Failed to deploy automata');
    }
  };

  const parseJsonOrString = (text: string): unknown => {
    const trimmed = text.trim();
    if (!trimmed) return '';
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  };

  const handleSendVariable = async (deviceId: string) => {
    if (!varName.trim()) {
      addNotification('warning', 'Set Variable', 'Variable name is required');
      return;
    }

    try {
      await gatewayService.setVariable(deviceId, varName.trim(), parseJsonOrString(varValue));
      addNotification('success', 'Set Variable', `Sent ${varName.trim()} to ${deviceId}`);
    } catch (err) {
      addNotification('error', 'Set Variable', err instanceof Error ? err.message : 'Failed to send');
    }
  };

  const handleTriggerEvent = async (deviceId: string) => {
    if (!eventName.trim()) {
      addNotification('warning', 'Trigger Event', 'Event name is required');
      return;
    }

    try {
      const data = eventData.trim() ? parseJsonOrString(eventData) : undefined;
      await gatewayService.triggerEvent(deviceId, eventName.trim(), data);
      addNotification('success', 'Trigger Event', `Triggered ${eventName.trim()} on ${deviceId}`);
    } catch (err) {
      addNotification('error', 'Trigger Event', err instanceof Error ? err.message : 'Failed to send');
    }
  };

  const handleForceTransition = async (deviceId: string) => {
    if (!forceState.trim()) {
      addNotification('warning', 'Force Transition', 'Target state is required');
      return;
    }

    try {
      await gatewayService.forceTransition(deviceId, forceState.trim());
      addNotification('success', 'Force Transition', `Forced ${deviceId} to ${forceState.trim()}`);
    } catch (err) {
      addNotification('error', 'Force Transition', err instanceof Error ? err.message : 'Failed to send');
    }
  };
  
  const selectedDevice = devices.find((d) => d.id === selectedDeviceId);
  
  return (
    <div className="devices-panel">
      <div className="panel-header">
        <IconDevice size={16} />
        <span>Devices</span>
        <button
          className="btn btn-ghost btn-icon"
          onClick={handleRefresh}
          title="Refresh devices"
          style={{ marginLeft: 'auto' }}
        >
          <IconRefresh size={14} />
        </button>
      </div>
      
      {!isConnected ? (
        <div className="panel-empty">
          <p>Not connected to gateway</p>
        </div>
      ) : (
        <div className="devices-content">
          {/* Server/Device Tree */}
          <div className="device-tree">
            {servers.length === 0 ? (
              <div className="empty-state">No servers found</div>
            ) : (
              servers.map((server) => {
                const serverDevices = devices.filter((d) => d.serverId === server.id);
                const isExpanded = expandedServers.has(server.id);
                
                return (
                  <div key={server.id} className="server-group">
                    <div 
                      className="server-header"
                      onClick={() => toggleServer(server.id)}
                    >
                      <span className="expand-icon">
                        {isExpanded ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
                      </span>
                      <IconServer size={14} />
                      <span className="server-name">{server.name}</span>
                      {getStatusIcon(server.status)}
                      <span className="device-count">({serverDevices.length})</span>
                    </div>
                    
                    {isExpanded && (
                      <div className="device-list">
                        {serverDevices.map((device) => {
                          const execution = getDeviceExecution(device.id);
                          
                          return (
                            <div
                              key={device.id}
                              className={`device-item ${selectedDeviceId === device.id ? 'selected' : ''}`}
                              onClick={() => setSelectedDeviceId(device.id)}
                            >
                              <IconDevice size={14} />
                              <span className="device-name">{device.name}</span>
                              {getStatusIcon(device.status)}
                              {execution?.isRunning && (
                                <span className="running-indicator" title="Running">
                                  <IconPlay size={10} />
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
          
          {/* Device Details */}
          {selectedDevice && (
            <div className="device-details">
              <div className="details-header">
                <IconDevice size={16} />
                <span>{selectedDevice.name}</span>
              </div>
              
              <div className="details-content">
                <div className="detail-row">
                  <span className="detail-label">Status:</span>
                  <span className={`detail-value status-${selectedDevice.status}`}>
                    {selectedDevice.status}
                  </span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Server:</span>
                  <span className="detail-value">
                    {servers.find((s) => s.id === selectedDevice.serverId)?.name || 'Unknown'}
                  </span>
                </div>
                {selectedDevice.lastSeen && (
                  <div className="detail-row">
                    <span className="detail-label">Last Seen:</span>
                    <span className="detail-value">{selectedDevice.lastSeen}</span>
                  </div>
                )}
                {selectedDevice.temperature !== undefined && (
                  <div className="detail-row">
                    <span className="detail-label">Temperature:</span>
                    <span className="detail-value">
                      {selectedDevice.temperature === null ? '—' : `${selectedDevice.temperature}°C`}
                    </span>
                  </div>
                )}
                {selectedDevice.error && (
                  <div className="detail-row">
                    <span className="detail-label">Error:</span>
                    <span className="detail-value">{selectedDevice.error}</span>
                  </div>
                )}
                <div className="detail-row">
                  <span className="detail-label">Engine Version:</span>
                  <span className="detail-value">{selectedDevice.engineVersion}</span>
                </div>

                {selectedDevice.currentState && (
                  <div className="detail-row">
                    <span className="detail-label">Current State:</span>
                    <span className="detail-value">{selectedDevice.currentState}</span>
                  </div>
                )}
                {selectedDevice.assignedAutomataId && (
                  <div className="detail-row">
                    <span className="detail-label">Automata:</span>
                    <span className="detail-value">{selectedDevice.assignedAutomataId}</span>
                  </div>
                )}
                {selectedDevice.location && (
                  <div className="detail-row">
                    <span className="detail-label">Location:</span>
                    <span className="detail-value">{selectedDevice.location}</span>
                  </div>
                )}
                
                {selectedDevice.capabilities && selectedDevice.capabilities.length > 0 && (
                  <div className="detail-section">
                    <label className="section-label">Capabilities</label>
                    <div className="capability-tags">
                      {selectedDevice.capabilities.map((cap) => (
                        <span key={cap} className="capability-tag">{cap}</span>
                      ))}
                    </div>
                  </div>
                )}
                
                {selectedDevice.tags && selectedDevice.tags.length > 0 && (
                  <div className="detail-section">
                    <label className="section-label">Tags</label>
                    <div className="metadata-list">
                      {selectedDevice.tags.map((tag) => (
                        <span key={tag} className="tag-item">{tag}</span>
                      ))}
                    </div>
                  </div>
                )}
                
                {/* Device Actions */}
                <div className="device-actions">
                  {getDeviceExecution(selectedDevice.id)?.isRunning ? (
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => handleStopExecution(selectedDevice.id)}
                      disabled={
                        !isDeviceReachable(selectedDevice.status) ||
                        !supportsCommand(selectedDevice.id, 'stop_execution')
                      }
                    >
                      <IconStop size={12} />
                      <span>Stop</span>
                    </button>
                  ) : (
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => handleStartExecution(selectedDevice.id)}
                      disabled={
                        !isDeviceReachable(selectedDevice.status) ||
                        !supportsCommand(selectedDevice.id, 'start_execution')
                      }
                    >
                      <IconPlay size={12} />
                      <span>Start</span>
                    </button>
                  )}

                  {getDeviceExecution(selectedDevice.id)?.isRunning && !getDeviceExecution(selectedDevice.id)?.isPaused && (
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => handlePauseExecution(selectedDevice.id)}
                      disabled={
                        !isDeviceReachable(selectedDevice.status) ||
                        !supportsCommand(selectedDevice.id, 'pause_execution')
                      }
                    >
                      <span>Pause</span>
                    </button>
                  )}

                  {getDeviceExecution(selectedDevice.id)?.isPaused && (
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleResumeExecution(selectedDevice.id)}
                      disabled={
                        !isDeviceReachable(selectedDevice.status) ||
                        !supportsCommand(selectedDevice.id, 'resume_execution')
                      }
                    >
                      <span>Resume</span>
                    </button>
                  )}

                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => handleResetExecution(selectedDevice.id)}
                    disabled={
                      !isDeviceReachable(selectedDevice.status) ||
                      !supportsCommand(selectedDevice.id, 'reset_execution')
                    }
                  >
                    <span>Reset</span>
                  </button>

                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => handleSnapshot(selectedDevice.id)}
                    disabled={
                      !isDeviceReachable(selectedDevice.status) ||
                      !supportsCommand(selectedDevice.id, 'request_state')
                    }
                  >
                    <span>Snapshot</span>
                  </button>
                  
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => handleOTAUpdate(selectedDevice.id)}
                    disabled={!isDeviceReachable(selectedDevice.status)}
                  >
                    <IconUpload size={12} />
                    <span>OTA Update</span>
                  </button>

                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => handleDeployActiveAutomata(selectedDevice.id)}
                    disabled={!isDeviceReachable(selectedDevice.status) || automataMap.size === 0}
                    title={automataMap.size > 0 ? `Deploy ${activeAutomata?.config?.name ?? activeAutomataId ?? 'first automata'}` : 'Create or import an automata first'}
                  >
                    <span>Deploy Active</span>
                  </button>
                  
                  <button
                    className="btn btn-ghost btn-sm"
                    title="Device settings"
                  >
                    <IconSettings size={12} />
                  </button>
                </div>

                {/* Runtime Control (works when a deployment exists on the device) */}
                <div className="detail-section">
                  <label className="section-label">Runtime Control</label>

                  <div className="detail-row" style={{ gap: 'var(--spacing-2)' }}>
                    <span className="detail-label">Set Variable</span>
                    <input
                      className="input"
                      placeholder="name"
                      value={varName}
                      onChange={(e) => setVarName(e.target.value)}
                      style={{ flex: 1 }}
                    />
                    <input
                      className="input"
                      placeholder='value (json or text)'
                      value={varValue}
                      onChange={(e) => setVarValue(e.target.value)}
                      style={{ flex: 2 }}
                    />
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleSendVariable(selectedDevice.id)}
                      disabled={
                        !isDeviceReachable(selectedDevice.status) ||
                        !supportsCommand(selectedDevice.id, 'set_variable')
                      }
                    >
                      Send
                    </button>
                  </div>

                  <div className="detail-row" style={{ gap: 'var(--spacing-2)' }}>
                    <span className="detail-label">Trigger Event</span>
                    <input
                      className="input"
                      placeholder="event"
                      value={eventName}
                      onChange={(e) => setEventName(e.target.value)}
                      style={{ flex: 1 }}
                    />
                    <input
                      className="input"
                      placeholder='data (optional json/text)'
                      value={eventData}
                      onChange={(e) => setEventData(e.target.value)}
                      style={{ flex: 2 }}
                    />
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleTriggerEvent(selectedDevice.id)}
                      disabled={
                        !isDeviceReachable(selectedDevice.status) ||
                        !supportsCommand(selectedDevice.id, 'trigger_event')
                      }
                    >
                      Send
                    </button>
                  </div>

                  <div className="detail-row" style={{ gap: 'var(--spacing-2)' }}>
                    <span className="detail-label">Force State</span>
                    <input
                      className="input"
                      placeholder="state id"
                      value={forceState}
                      onChange={(e) => setForceState(e.target.value)}
                      style={{ flex: 1 }}
                    />
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => handleForceTransition(selectedDevice.id)}
                      disabled={
                        !isDeviceReachable(selectedDevice.status) ||
                        !supportsCommand(selectedDevice.id, 'force_transition')
                      }
                    >
                      Force
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
