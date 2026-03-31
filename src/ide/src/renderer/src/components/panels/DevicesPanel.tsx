/**
 * Aetherium Automata - Devices Panel Component
 *
 * Fleet navigator with compact per-device quick actions.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useExecutionStore, useGatewayStore, useRuntimeViewStore, useUIStore } from '../../stores';
import type { Device } from '../../types';
import {
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconDevice,
  IconError,
  IconPause,
  IconPlay,
  IconRefresh,
  IconRuntime,
  IconServer,
  IconStop,
  IconWarning,
} from '../common/Icons';
import {
  deploymentStatusRank,
  DeviceDeploymentView,
  isDeviceReachable,
  isRunningLike,
  runtimeStatusToLabel,
  supportsMultipleDeployments,
  transferForDevice,
} from './devicePanelShared';

function getStatusIcon(status: string) {
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
}

interface DeviceRowProps {
  device: Device;
  selected: boolean;
  runningCount: number;
  deploymentCount: number;
  transferActive: boolean;
  onSelect: (device: Device) => void;
}

const DeviceRow: React.FC<DeviceRowProps> = ({
  device,
  selected,
  runningCount,
  deploymentCount,
  transferActive,
  onSelect,
}) => (
  <button
    type="button"
    className={`device-item ${selected ? 'selected' : ''}`}
    onClick={() => onSelect(device)}
  >
    <span className="device-item-main">
      <span className="device-item-icon">
        <IconDevice size={14} />
      </span>
      <span className="device-item-copy">
        <span className="device-name">{device.name}</span>
        <span className="device-item-meta">{device.id}</span>
      </span>
    </span>
    <span className="device-item-badges">
      {runningCount > 0 && (
        <span className="device-pill running" title={`${runningCount} running deployment${runningCount > 1 ? 's' : ''}`}>
          <IconPlay size={10} />
          {runningCount}
        </span>
      )}
      {deploymentCount > 1 && (
        <span className="device-pill muted" title={`${deploymentCount} deployments`}>
          {deploymentCount}
        </span>
      )}
      {transferActive && <span className="deploying-indicator" title="Deployment in progress" />}
      {getStatusIcon(device.status)}
    </span>
  </button>
);

interface SelectedDeviceQuickPanelProps {
  device: Device;
  selectedDeployment: DeviceDeploymentView | null;
  selectedDeviceDeployments: DeviceDeploymentView[];
  serverName: string;
  deviceCanStart: boolean;
  deviceCanStop: boolean;
  deviceCanPause: boolean;
  deviceCanResume: boolean;
  deviceCanReset: boolean;
  onOpenRuntime: () => void;
  onStart: () => void;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
  onReset: () => void;
  onSelectDeployment: (deploymentId: string) => void;
}

const SelectedDeviceQuickPanel: React.FC<SelectedDeviceQuickPanelProps> = ({
  device,
  selectedDeployment,
  selectedDeviceDeployments,
  serverName,
  deviceCanStart,
  deviceCanStop,
  deviceCanPause,
  deviceCanResume,
  deviceCanReset,
  onOpenRuntime,
  onStart,
  onStop,
  onPause,
  onResume,
  onReset,
  onSelectDeployment,
}) => (
  <div className="device-quick-panel">
    <div className="device-quick-header">
      <div className="device-quick-title">
        <IconDevice size={16} />
        <div>
          <div className="device-quick-name">{device.name}</div>
          <div className="device-quick-subtitle">{serverName}</div>
        </div>
      </div>
      <span className={`runtime-status status-${selectedDeployment?.status ?? device.status}`}>
        {runtimeStatusToLabel(selectedDeployment?.status ?? device.status)}
      </span>
    </div>

    <div className="device-quick-grid">
      <div className="device-quick-cell">
        <span className="device-quick-label">Connector</span>
        <span className="device-quick-value">
          {device.connectorType || device.transport || 'Unknown'}
        </span>
      </div>
      <div className="device-quick-cell">
        <span className="device-quick-label">Current State</span>
        <span className="device-quick-value">
          {selectedDeployment?.currentState || device.currentState || 'Idle'}
        </span>
      </div>
    </div>

    {selectedDeviceDeployments.length > 0 ? (
      <div className="device-quick-section">
        <div className="device-quick-section-header">
          <span className="device-quick-label">Deployments</span>
          <span className="device-quick-hint">{selectedDeviceDeployments.length} available</span>
        </div>
        <div className="device-deployment-picker">
          {selectedDeviceDeployments.map((deployment) => (
            <button
              key={deployment.deploymentId}
              type="button"
              className={`device-deployment-chip ${selectedDeployment?.deploymentId === deployment.deploymentId ? 'active' : ''}`}
              onClick={() => onSelectDeployment(deployment.deploymentId)}
            >
              <span>{deployment.automataId}</span>
              <span>{runtimeStatusToLabel(deployment.status)}</span>
            </button>
          ))}
        </div>
      </div>
    ) : (
      <div className="device-runtime-empty">
        No deployment selected. Open Runtime to deploy or inspect this device.
      </div>
    )}

    <div className="device-quick-actions">
      {selectedDeployment && isRunningLike(selectedDeployment.status) ? (
        <button
          type="button"
          className="btn btn-danger btn-sm"
          onClick={onStop}
          disabled={!deviceCanStop}
        >
          <IconStop size={12} />
          <span>Stop</span>
        </button>
      ) : (
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={onStart}
          disabled={!deviceCanStart}
        >
          <IconPlay size={12} />
          <span>Start</span>
        </button>
      )}

      {selectedDeployment?.status === 'paused' ? (
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={onResume}
          disabled={!deviceCanResume}
        >
          <IconPlay size={12} />
          <span>Resume</span>
        </button>
      ) : (
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={onPause}
          disabled={!deviceCanPause}
        >
          <IconPause size={12} />
          <span>Pause</span>
        </button>
      )}

      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={onReset}
        disabled={!deviceCanReset}
      >
        <span>Reset</span>
      </button>

      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={onOpenRuntime}
      >
        <IconRuntime size={12} />
        <span>Open Runtime</span>
      </button>
    </div>
  </div>
);

export const DevicesPanel: React.FC = () => {
  const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set());
  const [selectedDeviceFallback, setSelectedDeviceFallback] = useState<Device | null>(null);
  const [selectedDeploymentId, setSelectedDeploymentId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState<boolean>(false);
  const [deviceFilterText, setDeviceFilterText] = useState<string>('');
  const autoSelectedOnceRef = useRef(false);
  const lastAutoRuntimeKeyRef = useRef('');

  const serversMap = useGatewayStore((state) => state.servers);
  const devicesMap = useGatewayStore((state) => state.devices);
  const connectorsMap = useGatewayStore((state) => state.connectors);
  const isConnected = useGatewayStore((state) => state.status === 'connected');
  const fetchDevices = useGatewayStore((state) => state.fetchDevices);
  const fetchServers = useGatewayStore((state) => state.fetchServers);
  const gatewayService = useGatewayStore((state) => state.service);
  const runtimeDeploymentsMap = useRuntimeViewStore((state) => state.deployments);
  const transfersMap = useRuntimeViewStore((state) => state.transfers);
  const setRuntimeScope = useRuntimeViewStore((state) => state.setScope);
  const setSelectedRuntimeDeployments = useRuntimeViewStore((state) => state.setSelected);
  const addNotification = useUIStore((state) => state.addNotification);
  const togglePanel = useUIStore((state) => state.togglePanel);
  const runtimeVisible = useUIStore((state) => state.layout.panels.runtime?.isVisible ?? false);
  const selectedDeviceId = useExecutionStore((state) => state.selectedDeviceId);
  const selectDevice = useExecutionStore((state) => state.selectDevice);

  const servers = useMemo(() => Array.from(serversMap.values()), [serversMap]);
  const devices = useMemo(() => Array.from(devicesMap.values()), [devicesMap]);
  const connectors = useMemo(() => Array.from(connectorsMap.values()), [connectorsMap]);
  const runtimeDeployments = useMemo(() => Array.from(runtimeDeploymentsMap.values()), [runtimeDeploymentsMap]);

  const connectorSummary = useMemo(() => {
    return connectors.reduce<Record<string, { running: number; total: number }>>((acc, connector) => {
      const key = connector.type || 'unknown';
      if (!acc[key]) {
        acc[key] = { running: 0, total: 0 };
      }
      acc[key].total += 1;
      if (connector.status === 'running') {
        acc[key].running += 1;
      }
      return acc;
    }, {});
  }, [connectors]);

  const deploymentsByDevice = useMemo(() => {
    const mapped = new Map<string, DeviceDeploymentView[]>();

    runtimeDeployments.forEach((deployment) => {
      const existing = mapped.get(String(deployment.deviceId)) ?? [];
      existing.push({
        deploymentId: String(deployment.deploymentId),
        automataId: String(deployment.automataId),
        deviceId: String(deployment.deviceId),
        status: deployment.status,
        currentState: deployment.currentState,
        updatedAt: deployment.updatedAt,
        source: 'runtime',
      });
      mapped.set(String(deployment.deviceId), existing);
    });

    mapped.forEach((entries, deviceId) => {
      const sorted = [...entries].sort((a, b) => {
        const statusDelta = deploymentStatusRank(b.status) - deploymentStatusRank(a.status);
        if (statusDelta !== 0) return statusDelta;
        return b.updatedAt - a.updatedAt;
      });
      const device = devicesMap.get(deviceId);

      if (!supportsMultipleDeployments(device)) {
        const activeEntry = sorted.find((deployment) => isRunningLike(deployment.status)) ?? sorted[0];
        mapped.set(deviceId, activeEntry ? [activeEntry] : []);
        return;
      }

      mapped.set(deviceId, sorted);
    });

    return mapped;
  }, [devicesMap, runtimeDeployments]);

  const visibleDevices = useMemo(() => {
    const query = deviceFilterText.trim().toLowerCase();

    return devices.filter((device) => {
      const deployments = deploymentsByDevice.get(device.id) ?? [];
      const hasLiveDeployment = deployments.some((deployment) => isRunningLike(deployment.status));
      const hasActiveTransfer = Boolean(transferForDevice(device, transfersMap, deployments[0])?.status === 'active');
      const isLive = isDeviceReachable(device.status) || hasLiveDeployment || hasActiveTransfer;

      if (!showHistory && !isLive) {
        return false;
      }

      if (!query) {
        return true;
      }

      const haystack = [
        device.name,
        device.id,
        device.serverId,
        device.connectorType,
        device.transport,
        ...deployments.map((deployment) => deployment.automataId),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [deploymentsByDevice, deviceFilterText, devices, showHistory, transfersMap]);

  const visibleServers = useMemo(() => {
    const visibleDeviceIds = new Set(visibleDevices.map((device) => device.id));
    return servers.filter((server) => {
      if (server.status === 'connected') {
        return true;
      }
      return devices.some((device) => device.serverId === server.id && visibleDeviceIds.has(device.id));
    });
  }, [devices, servers, visibleDevices]);

  const selectedDeviceLive = useMemo(
    () => devices.find((device) => device.id === selectedDeviceId),
    [devices, selectedDeviceId],
  );

  useEffect(() => {
    if (selectedDeviceLive) {
      setSelectedDeviceFallback(selectedDeviceLive);
    }
  }, [selectedDeviceLive]);

  const selectedDevice = selectedDeviceLive ?? selectedDeviceFallback;

  const selectedDeviceDeployments = useMemo(() => {
    if (!selectedDevice) return [];
    return deploymentsByDevice.get(selectedDevice.id) ?? [];
  }, [deploymentsByDevice, selectedDevice]);

  const selectedDeployment = useMemo(
    () =>
      selectedDeviceDeployments.find((deployment) => deployment.deploymentId === selectedDeploymentId) ??
      selectedDeviceDeployments.find((deployment) => isRunningLike(deployment.status)) ??
      selectedDeviceDeployments[0] ??
      null,
    [selectedDeploymentId, selectedDeviceDeployments],
  );

  const supportsCommand = (deviceId: string, command: string): boolean => {
    const device = devicesMap.get(deviceId);
    if (!device?.supportedCommands || device.supportedCommands.length === 0) {
      return true;
    }
    return device.supportedCommands.includes(command);
  };

  const handleSelectDevice = (device: Device) => {
    setSelectedDeviceFallback(device);
    selectDevice(device.id);
  };

  const openRuntimeForDevice = (device: Device, autoOpen = false) => {
    const deployments = deploymentsByDevice.get(device.id) ?? [];
    const runningDeployments = deployments.filter((deployment) => isRunningLike(deployment.status));
    const selected =
      runningDeployments.length > 0
        ? runningDeployments.map((deployment) => deployment.deploymentId)
        : deployments[0]
          ? [deployments[0].deploymentId]
          : [];

    setSelectedRuntimeDeployments(selected);
    setRuntimeScope(runningDeployments.length > 0 ? 'running' : 'project');

    if (autoOpen || !runtimeVisible) {
      togglePanel('runtime');
    }
  };

  useEffect(() => {
    if (visibleDevices.length === 0) {
      return;
    }

    if (selectedDeviceId) {
      const selectedExists = visibleDevices.some((device) => device.id === selectedDeviceId);
      if (!selectedExists) {
        const preferred = visibleDevices.find((device) => isDeviceReachable(device.status)) ?? visibleDevices[0];
        if (preferred) {
          setSelectedDeviceFallback(preferred);
          selectDevice(preferred.id);
        }
      }
      return;
    }

    if (!autoSelectedOnceRef.current) {
      const preferred = visibleDevices.find((device) => isDeviceReachable(device.status)) ?? visibleDevices[0];
      if (preferred) {
        autoSelectedOnceRef.current = true;
        setSelectedDeviceFallback(preferred);
        selectDevice(preferred.id);
      }
    }
  }, [selectDevice, selectedDeviceId, visibleDevices]);

  useEffect(() => {
    if (visibleServers.length === 0) return;
    setExpandedServers((prev) => {
      if (prev.size > 0) return prev;
      return new Set(visibleServers.map((server) => server.id));
    });
  }, [visibleServers]);

  useEffect(() => {
    if (!selectedDevice) {
      setSelectedDeploymentId(null);
      lastAutoRuntimeKeyRef.current = '';
      return;
    }

    if (selectedDeviceDeployments.length === 0) {
      setSelectedDeploymentId(null);
      lastAutoRuntimeKeyRef.current = '';
      return;
    }

    const preferred =
      selectedDeviceDeployments.find((deployment) => deployment.deploymentId === selectedDeploymentId) ??
      selectedDeviceDeployments.find((deployment) => isRunningLike(deployment.status)) ??
      selectedDeviceDeployments[0];

    if (preferred && preferred.deploymentId !== selectedDeploymentId) {
      setSelectedDeploymentId(preferred.deploymentId);
    }
  }, [selectedDeploymentId, selectedDevice, selectedDeviceDeployments]);

  useEffect(() => {
    if (!selectedDevice || !selectedDeployment || !isRunningLike(selectedDeployment.status)) {
      lastAutoRuntimeKeyRef.current = '';
      return;
    }

    const nextKey = `${selectedDevice.id}:${selectedDeployment.deploymentId}:${selectedDeployment.status}`;
    if (lastAutoRuntimeKeyRef.current === nextKey) {
      return;
    }

    lastAutoRuntimeKeyRef.current = nextKey;
    openRuntimeForDevice(selectedDevice, !runtimeVisible);
  }, [runtimeVisible, selectedDeployment, selectedDevice]);

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

  const getCommandTarget = (deployment?: DeviceDeploymentView | null) =>
    deployment
      ? {
          automataId: deployment.automataId as any,
          deploymentId: deployment.deploymentId,
        }
      : undefined;

  const handleStartExecution = async () => {
    if (!selectedDevice || !selectedDeployment) return;
    try {
      await gatewayService.startExecution(selectedDevice.id, getCommandTarget(selectedDeployment));
      addNotification('success', 'Execution', `Started ${selectedDeployment.automataId} on ${selectedDevice.name}`);
    } catch (err) {
      addNotification('error', 'Execution', err instanceof Error ? err.message : 'Failed to start execution');
    }
  };

  const handleStopExecution = async () => {
    if (!selectedDevice || !selectedDeployment) return;
    try {
      await gatewayService.stopExecution(selectedDevice.id, getCommandTarget(selectedDeployment));
      addNotification('success', 'Execution', `Stopped ${selectedDeployment.automataId} on ${selectedDevice.name}`);
    } catch (err) {
      addNotification('error', 'Execution', err instanceof Error ? err.message : 'Failed to stop execution');
    }
  };

  const handlePauseExecution = async () => {
    if (!selectedDevice || !selectedDeployment) return;
    try {
      await gatewayService.pauseExecution(selectedDevice.id, getCommandTarget(selectedDeployment));
      addNotification('success', 'Execution', `Paused ${selectedDeployment.automataId} on ${selectedDevice.name}`);
    } catch (err) {
      addNotification('error', 'Execution', err instanceof Error ? err.message : 'Failed to pause execution');
    }
  };

  const handleResumeExecution = async () => {
    if (!selectedDevice || !selectedDeployment) return;
    try {
      await gatewayService.resumeExecution(selectedDevice.id, getCommandTarget(selectedDeployment));
      addNotification('success', 'Execution', `Resumed ${selectedDeployment.automataId} on ${selectedDevice.name}`);
    } catch (err) {
      addNotification('error', 'Execution', err instanceof Error ? err.message : 'Failed to resume execution');
    }
  };

  const handleResetExecution = async () => {
    if (!selectedDevice || !selectedDeployment) return;
    try {
      await gatewayService.resetExecution(selectedDevice.id, getCommandTarget(selectedDeployment));
      addNotification('success', 'Execution', `Reset ${selectedDeployment.automataId} on ${selectedDevice.name}`);
    } catch (err) {
      addNotification('error', 'Execution', err instanceof Error ? err.message : 'Failed to reset execution');
    }
  };

  const selectedServerName =
    (selectedDevice ? servers.find((server) => server.id === selectedDevice.serverId)?.name : undefined) || 'Unknown server';
  const selectedDeviceCanStart =
    Boolean(selectedDevice && selectedDeployment) &&
    isDeviceReachable(selectedDevice?.status ?? 'unknown') &&
    supportsCommand(selectedDevice!.id, 'start_execution');
  const selectedDeviceCanStop =
    Boolean(selectedDevice && selectedDeployment) &&
    isDeviceReachable(selectedDevice?.status ?? 'unknown') &&
    supportsCommand(selectedDevice!.id, 'stop_execution');
  const selectedDeviceCanPause =
    Boolean(selectedDevice && selectedDeployment && selectedDeployment.status !== 'paused') &&
    isDeviceReachable(selectedDevice?.status ?? 'unknown') &&
    supportsCommand(selectedDevice!.id, 'pause_execution');
  const selectedDeviceCanResume =
    Boolean(selectedDevice && selectedDeployment?.status === 'paused') &&
    isDeviceReachable(selectedDevice?.status ?? 'unknown') &&
    supportsCommand(selectedDevice!.id, 'resume_execution');
  const selectedDeviceCanReset =
    Boolean(selectedDevice && selectedDeployment) &&
    isDeviceReachable(selectedDevice?.status ?? 'unknown') &&
    supportsCommand(selectedDevice!.id, 'reset_execution');

  return (
    <div className="devices-panel devices-sidebar">
      <div className="devices-sidebar-top">
        <div className="panel-header">
          <IconDevice size={16} />
          <span>Devices</span>
          <span className="device-count" style={{ marginLeft: 'auto' }}>
            {visibleDevices.length}/{devices.length}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={handleRefresh}
            title="Refresh devices"
          >
            <IconRefresh size={14} />
          </button>
        </div>

        <div className="devices-toolbar">
          <div className="devices-toolbar-group">
            <button
              type="button"
              className={`btn btn-sm ${showHistory ? 'btn-secondary' : 'btn-primary'}`}
              onClick={() => setShowHistory(false)}
            >
              Live Now
            </button>
            <button
              type="button"
              className={`btn btn-sm ${showHistory ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setShowHistory(true)}
            >
              All Seen
            </button>
          </div>
          <input
            className="input devices-search"
            placeholder="Filter devices, ids, automata"
            value={deviceFilterText}
            onChange={(event) => setDeviceFilterText(event.target.value)}
          />
        </div>

        {connectors.length > 0 && (
          <div className="connector-summary">
            {Object.entries(connectorSummary).map(([type, summary]) => (
              <span
                key={type}
                className={`connector-chip ${summary.running > 0 ? 'running' : 'stopped'}`}
                title={`${summary.running}/${summary.total} ${type} connector instances running`}
              >
                {type}: {summary.running}/{summary.total}
              </span>
            ))}
          </div>
        )}
      </div>

      {!isConnected ? (
        <div className="panel-empty">
          <p>Not connected to gateway</p>
        </div>
      ) : (
        <>
          <div className="devices-sidebar-list">
            {visibleServers.length === 0 ? (
              visibleDevices.length === 0 ? (
                <div className="empty-state">
                  {showHistory
                    ? 'No devices match this filter.'
                    : 'No live devices right now. Switch to All Seen to inspect history.'}
                </div>
              ) : (
                <div className="server-group">
                  <div className="server-header static">
                    <IconServer size={14} />
                    <span className="server-name">Unassigned</span>
                    <span className="device-count">({visibleDevices.length})</span>
                  </div>
                  <div className="device-list">
                    {visibleDevices.map((device) => {
                      const deployments = deploymentsByDevice.get(device.id) ?? [];
                      const runningCount = deployments.filter((deployment) => isRunningLike(deployment.status)).length;
                      const transfer = transferForDevice(device, transfersMap, deployments[0]);

                      return (
                        <DeviceRow
                          key={device.id}
                          device={device}
                          selected={selectedDeviceId === device.id}
                          runningCount={runningCount}
                          deploymentCount={deployments.length}
                          transferActive={transfer?.status === 'active'}
                          onSelect={handleSelectDevice}
                        />
                      );
                    })}
                  </div>
                </div>
              )
            ) : (
              visibleServers.map((server) => {
                const serverDevices = visibleDevices.filter((device) => device.serverId === server.id);
                const isExpanded = expandedServers.has(server.id);

                return (
                  <div key={server.id} className="server-group">
                    <button
                      type="button"
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
                    </button>

                    {isExpanded && (
                      <div className="device-list">
                        {serverDevices.map((device) => {
                          const deployments = deploymentsByDevice.get(device.id) ?? [];
                          const runningCount = deployments.filter((deployment) => isRunningLike(deployment.status)).length;
                          const transfer = transferForDevice(device, transfersMap, deployments[0]);

                          return (
                            <DeviceRow
                              key={device.id}
                              device={device}
                              selected={selectedDeviceId === device.id}
                              runningCount={runningCount}
                              deploymentCount={deployments.length}
                              transferActive={transfer?.status === 'active'}
                              onSelect={handleSelectDevice}
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <div className="devices-sidebar-bottom">
            {selectedDevice ? (
              <SelectedDeviceQuickPanel
                device={selectedDevice}
                selectedDeployment={selectedDeployment}
                selectedDeviceDeployments={selectedDeviceDeployments}
                serverName={selectedServerName}
                deviceCanStart={selectedDeviceCanStart}
                deviceCanStop={selectedDeviceCanStop}
                deviceCanPause={selectedDeviceCanPause}
                deviceCanResume={selectedDeviceCanResume}
                deviceCanReset={selectedDeviceCanReset}
                onOpenRuntime={() => openRuntimeForDevice(selectedDevice)}
                onStart={handleStartExecution}
                onStop={handleStopExecution}
                onPause={handlePauseExecution}
                onResume={handleResumeExecution}
                onReset={handleResetExecution}
                onSelectDeployment={setSelectedDeploymentId}
              />
            ) : (
              <div className="device-quick-panel empty">
                <div className="device-runtime-empty">Select a device to inspect its current runtime state.</div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
