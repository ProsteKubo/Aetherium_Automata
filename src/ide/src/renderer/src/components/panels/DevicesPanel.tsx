/**
 * Aetherium Automata - Devices Panel Component
 * 
 * Shows device network status, allows device management and OTA updates.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useGatewayStore, useExecutionStore, useUIStore, useAutomataStore, useRuntimeViewStore, useProjectStore } from '../../stores';
import type { Automata, Device } from '../../types';
import type { RuntimeDeployment, RuntimeDeploymentTransfer } from '../../types/runtimeView';
import { normalizeImportedAutomata } from '../../utils/importedAutomata';
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
  IconRuntime,
} from '../common/Icons';

interface ShowcaseAutomataEntry {
  id: string;
  name: string;
  category: string;
  relativePath: string;
}

interface DeviceDeploymentView {
  deploymentId: string;
  automataId: string;
  deviceId: string;
  status: RuntimeDeployment['status'];
  currentState?: string;
  updatedAt: number;
  source: 'runtime' | 'device';
}

export const DevicesPanel: React.FC = () => {
  const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set());
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [selectedDeviceFallback, setSelectedDeviceFallback] = useState<Device | null>(null);
  const [selectedDeploymentId, setSelectedDeploymentId] = useState<string | null>(null);
  const pendingDeploymentTargetsRef = useRef<Map<string, DeviceDeploymentView>>(new Map());

  const [varName, setVarName] = useState<string>('');
  const [varValue, setVarValue] = useState<string>('');
  const [eventName, setEventName] = useState<string>('');
  const [eventData, setEventData] = useState<string>('');
  const [forceState, setForceState] = useState<string>('');
  const [showcaseEntries, setShowcaseEntries] = useState<ShowcaseAutomataEntry[]>([]);
  const [selectedShowcasePath, setSelectedShowcasePath] = useState<string>('');
  const [showcaseBusy, setShowcaseBusy] = useState<boolean>(false);
  const [showHistory, setShowHistory] = useState<boolean>(false);
  const [deviceFilterText, setDeviceFilterText] = useState<string>('');
  
  // Store data - get raw Maps and memoize array conversion
  const serversMap = useGatewayStore((state) => state.servers);
  const devicesMap = useGatewayStore((state) => state.devices);
  const connectorsMap = useGatewayStore((state) => state.connectors);
  const isConnected = useGatewayStore((state) => state.status === 'connected');
  const fetchDevices = useGatewayStore((state) => state.fetchDevices);
  const fetchServers = useGatewayStore((state) => state.fetchServers);
  const gatewayService = useGatewayStore((state) => state.service);
  const activeAutomataId = useAutomataStore((state) => state.activeAutomataId);
  const automataMap = useAutomataStore((state) => state.automata);
  const setAutomataMap = useAutomataStore((state) => state.setAutomataMap);
  const setActiveAutomata = useAutomataStore((state) => state.setActiveAutomata);
  const selectDevice = useExecutionStore((state) => state.selectDevice);
  const deviceExecutionsMap = useExecutionStore((state) => state.deviceExecutions);
  const addNotification = useUIStore((state) => state.addNotification);
  const togglePanel = useUIStore((state) => state.togglePanel);
  const runtimeVisible = useUIStore((state) => state.layout.panels.runtime?.isVisible ?? false);
  const setRuntimeScope = useRuntimeViewStore((state) => state.setScope);
  const upsertRuntimeDeployment = useRuntimeViewStore((state) => state.upsertDeployment);
  const selectRuntimeDeployment = useRuntimeViewStore((state) => state.toggleSelection);
  const runtimeDeploymentsMap = useRuntimeViewStore((state) => state.deployments);
  const transfersMap = useRuntimeViewStore((state) => state.transfers);
  const project = useProjectStore((state) => state.project);
  const createNetwork = useProjectStore((state) => state.createNetwork);
  const addAutomataToNetwork = useProjectStore((state) => state.addAutomataToNetwork);
  const markProjectDirty = useProjectStore((state) => state.markDirty);
  
  // Memoize array conversions
  const servers = useMemo(() => Array.from(serversMap.values()), [serversMap]);
  const devices = useMemo(() => Array.from(devicesMap.values()), [devicesMap]);
  const connectors = useMemo(() => Array.from(connectorsMap.values()), [connectorsMap]);
  const runtimeDeployments = useMemo(() => Array.from(runtimeDeploymentsMap.values()), [runtimeDeploymentsMap]);
  const activeAutomata = activeAutomataId ? automataMap.get(activeAutomataId) : undefined;
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


  useEffect(() => {
    let cancelled = false;

    const loadShowcaseCatalog = async () => {
      const result = await window.api.automata.listShowcase();
      if (cancelled) {
        return;
      }

      if (!result.success || !result.data) {
        if (result.error) {
          addNotification('warning', 'Showcase', `Showcase catalog unavailable: ${result.error}`);
        }
        return;
      }

      const entries = result.data;
      setShowcaseEntries(entries);
      setSelectedShowcasePath((prev) => {
        if (prev && entries.some((entry) => entry.relativePath === prev)) {
          return prev;
        }
        return entries[0]?.relativePath || '';
      });
    };

    void loadShowcaseCatalog();

    return () => {
      cancelled = true;
    };
  }, [addNotification]);

  const importShowcaseAutomata = async (
    target: string,
  ): Promise<{ id: string; automata: Automata } | null> => {
    const result = await window.api.automata.loadShowcase(target);
    if (!result.success || !result.data) {
      addNotification('error', 'Showcase', result.error || `Failed to load showcase automata: ${target}`);
      return null;
    }

    const normalizedPath = String(result.filePath || '').replace(/\\/g, '/');
    const existing = Array.from(automataMap.values()).find((automata) =>
      String(automata.filePath || '').replace(/\\/g, '/') === normalizedPath,
    );

    if (existing?.id) {
      setActiveAutomata(existing.id);
      return { id: existing.id, automata: existing };
    }

    const imported = normalizeImportedAutomata(result.data as Partial<Automata>, {
      filePath: result.filePath,
      keepDirty: true,
    });

    const nextMap = new Map(automataMap);
    nextMap.set(imported.id, imported);
    setAutomataMap(nextMap);
    setActiveAutomata(imported.id);

    if (project) {
      let networkId = project.networks[0]?.id;
      if (!networkId) {
        networkId = createNetwork('Default Network');
      }
      addAutomataToNetwork(networkId, imported);
      markProjectDirty();
    }

    addNotification('success', 'Showcase', `Loaded ${imported.config.name} into editor.`);
    return { id: imported.id, automata: imported };
  };

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

  const deploymentStatusRank = (status: DeviceDeploymentView['status']): number => {
    switch (status) {
      case 'running':
        return 6;
      case 'loading':
        return 5;
      case 'paused':
        return 4;
      case 'stopped':
        return 3;
      case 'error':
        return 2;
      case 'offline':
        return 1;
      default:
        return 0;
    }
  };

  const runtimeStatusToLabel = (status: DeviceDeploymentView['status']): string =>
    status.replace(/_/g, ' ');

  const isRunningLike = (status: DeviceDeploymentView['status']): boolean =>
    status === 'running' || status === 'loading' || status === 'paused';

  const supportsMultipleDeployments = (device?: Device | null): boolean => {
    if (!device) return false;
    return device.connectorType === 'host_runtime' || device.transport === 'host_runtime';
  };

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
        const activeEntry =
          sorted.find((deployment) => isRunningLike(deployment.status)) ??
          sorted[0];

        mapped.set(deviceId, activeEntry ? [activeEntry] : []);
        return;
      }

      mapped.set(deviceId, sorted);
    });

    return mapped;
  }, [devices, devicesMap, runtimeDeployments]);

  const getDeploymentsForDevice = (deviceId: string): DeviceDeploymentView[] =>
    deploymentsByDevice.get(deviceId) ?? [];

  const resolveCommandDeployment = (deviceId: string): DeviceDeploymentView | null => {
    const device = devicesMap.get(deviceId);
    const deployments = getDeploymentsForDevice(deviceId);
    const pending = pendingDeploymentTargetsRef.current.get(deviceId) ?? null;
    const selected =
      deployments.find((deployment) => deployment.deploymentId === selectedDeploymentId) ?? null;

    if (pending && deployments.some((deployment) => deployment.deploymentId === pending.deploymentId)) {
      pendingDeploymentTargetsRef.current.delete(deviceId);
    }

    if (!supportsMultipleDeployments(device)) {
      return pending ?? deployments[0] ?? null;
    }

    if (selected) {
      return selected;
    }

    if (pending) {
      return pending;
    }

    if (selectedDeploymentId) {
      const [automataId, selectedDeviceId] = selectedDeploymentId.split(':', 2);
      if (automataId && selectedDeviceId === deviceId) {
        return {
          deploymentId: selectedDeploymentId,
          automataId,
          deviceId,
          status: isDeviceReachable(devicesMap.get(deviceId)?.status ?? 'unknown') ? 'loading' : 'offline',
          currentState: devicesMap.get(deviceId)?.currentState,
          updatedAt: Date.now(),
          source: 'runtime',
        };
      }
    }

    return deployments[0] ?? null;
  };

  const getCommandTarget = (deployment?: DeviceDeploymentView | null) =>
    deployment
      ? {
          automataId: deployment.automataId as any,
          deploymentId: deployment.deploymentId,
        }
      : undefined;

  const describeDeployment = (deviceId: string, deployment?: DeviceDeploymentView | null): string =>
    deployment ? `${deployment.automataId} on ${deviceId}` : deviceId;

  const humanizeTransferStage = (stage: string): string =>
    stage
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());

  const transferForDeployment = (
    device: Device,
    deployment?: DeviceDeploymentView | null,
  ): RuntimeDeploymentTransfer | undefined => {
    if (deployment && transfersMap.has(deployment.deploymentId)) {
      return transfersMap.get(deployment.deploymentId);
    }

    return Array.from(transfersMap.values())
      .filter((transfer) => transfer.deviceId === (device.id as RuntimeDeploymentTransfer['deviceId']))
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  };

  const visibleDevices = useMemo(() => {
    const query = deviceFilterText.trim().toLowerCase();

    return devices.filter((device) => {
      const deployments = getDeploymentsForDevice(device.id);
      const hasLiveDeployment = deployments.some((deployment) => isRunningLike(deployment.status));
      const hasActiveTransfer = !!transferForDeployment(device, deployments[0]);
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
        ...deployments.map((deployment) => deployment.automataId),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [deviceFilterText, devices, showHistory, transfersMap, deploymentsByDevice]);

  const visibleServers = useMemo(() => {
    const visibleDeviceIds = new Set(visibleDevices.map((device) => device.id));
    return servers.filter((server) => {
      if (server.status === 'connected') {
        return true;
      }

      return devices.some((device) => device.serverId === server.id && visibleDeviceIds.has(device.id));
    });
  }, [devices, servers, visibleDevices]);

  useEffect(() => {
    if (visibleDevices.length === 0) {
      return;
    }

    const selectedExists = selectedDeviceId
      ? visibleDevices.some((device) => device.id === selectedDeviceId)
      : false;
    if (!selectedExists) {
      const preferred =
        visibleDevices.find((device) => isDeviceReachable(device.status)) ?? visibleDevices[0];
      if (preferred?.id && preferred.id !== selectedDeviceId) {
        setSelectedDeviceId(preferred.id);
        setSelectedDeviceFallback(preferred as Device);
        selectDevice(preferred.id as any);
      }
    }
  }, [selectedDeviceId, selectDevice, visibleDevices]);

  useEffect(() => {
    if (visibleServers.length === 0) return;
    setExpandedServers((prev) => {
      if (prev.size > 0) return prev;
      return new Set(visibleServers.map((server) => server.id));
    });
  }, [visibleServers]);
  
  const handleStartExecution = async (deviceId: string) => {
    try {
      let selectedDeployment = resolveCommandDeployment(deviceId);

      if (!selectedDeployment) {
        const candidate = pickDeployCandidate();
        if (!candidate) {
          addNotification('warning', 'Execution', 'No automata available. Create or import one first.');
          return;
        }

        await gatewayService.deployAutomata(candidate.id, deviceId, { automata: candidate.automata });
        selectedDeployment = {
          deploymentId: `${candidate.id}:${deviceId}`,
          automataId: candidate.id,
          deviceId,
          status: 'loading',
          updatedAt: Date.now(),
          source: 'runtime',
        };
        pendingDeploymentTargetsRef.current.set(deviceId, selectedDeployment);
        setSelectedDeploymentId(selectedDeployment.deploymentId);
        addNotification('info', 'Deploy', `Auto-deployed ${candidate.automata?.config?.name ?? candidate.id} to ${deviceId}`);
      }

      const targetDeployment = selectedDeployment ?? null;
      await gatewayService.startExecution(deviceId, getCommandTarget(targetDeployment));
      addNotification('success', 'Execution', `Started ${describeDeployment(deviceId, targetDeployment)}`);
    } catch (err) {
      addNotification('error', 'Execution', err instanceof Error ? err.message : 'Failed to start execution');
    }
  };
  
  const handleStopExecution = async (deviceId: string) => {
    try {
      const selectedDeployment = resolveCommandDeployment(deviceId);
      await gatewayService.stopExecution(deviceId, getCommandTarget(selectedDeployment));
      addNotification('success', 'Execution', `Stopped ${describeDeployment(deviceId, selectedDeployment)}`);
    } catch (err) {
      addNotification('error', 'Execution', err instanceof Error ? err.message : 'Failed to stop execution');
    }
  };

  const handlePauseExecution = async (deviceId: string) => {
    try {
      const selectedDeployment = resolveCommandDeployment(deviceId);
      await gatewayService.pauseExecution(deviceId, getCommandTarget(selectedDeployment));
      addNotification('success', 'Execution', `Paused ${describeDeployment(deviceId, selectedDeployment)}`);
    } catch (err) {
      addNotification('error', 'Execution', err instanceof Error ? err.message : 'Failed to pause execution');
    }
  };

  const handleResumeExecution = async (deviceId: string) => {
    try {
      const selectedDeployment = resolveCommandDeployment(deviceId);
      await gatewayService.resumeExecution(deviceId, getCommandTarget(selectedDeployment));
      addNotification('success', 'Execution', `Resumed ${describeDeployment(deviceId, selectedDeployment)}`);
    } catch (err) {
      addNotification('error', 'Execution', err instanceof Error ? err.message : 'Failed to resume execution');
    }
  };

  const handleResetExecution = async (deviceId: string) => {
    try {
      const selectedDeployment = resolveCommandDeployment(deviceId);
      await gatewayService.resetExecution(deviceId, getCommandTarget(selectedDeployment));
      addNotification('success', 'Execution', `Reset ${describeDeployment(deviceId, selectedDeployment)}`);
    } catch (err) {
      addNotification('error', 'Execution', err instanceof Error ? err.message : 'Failed to reset execution');
    }
  };

  const handleSnapshot = async (deviceId: string) => {
    try {
      const selectedDeployment = resolveCommandDeployment(deviceId);
      const snapshot = await gatewayService.getSnapshot(deviceId, getCommandTarget(selectedDeployment));
      upsertRuntimeDeployment({
        deploymentId: selectedDeployment?.deploymentId ?? `${snapshot.snapshot.automataId}:${deviceId}`,
        automataId: snapshot.snapshot.automataId as any,
        deviceId: deviceId as any,
        status: selectedDeployment?.status ?? 'unknown',
        currentState: snapshot.snapshot.currentState,
        variables: Object.fromEntries(
          Object.entries(snapshot.snapshot.variables ?? {}).map(([name, meta]) => [name, meta?.value]),
        ),
        updatedAt: Date.now(),
      });
      addNotification(
        'info',
        'Snapshot',
        `${describeDeployment(deviceId, selectedDeployment)} in state ${snapshot.snapshot.currentState}`,
      );
    } catch (err) {
      addNotification('error', 'Snapshot', err instanceof Error ? err.message : 'Failed to fetch snapshot');
    }
  };

  const handleOpenRuntimeMonitor = (deviceId: string) => {
    const device = devicesMap.get(deviceId);
    const selectedDeployment = resolveCommandDeployment(deviceId);

    if (!device || !selectedDeployment) {
      addNotification('warning', 'Runtime Monitor', 'Deploy an automata to this device first.');
      return;
    }

    const deploymentId = selectedDeployment.deploymentId;
    const status = selectedDeployment.status;
    upsertRuntimeDeployment({
      deploymentId,
      automataId: selectedDeployment.automataId as any,
      deviceId: device.id,
      status,
      currentState: selectedDeployment.currentState,
      updatedAt: Date.now(),
    });
    selectRuntimeDeployment(deploymentId, true);
    setRuntimeScope(status === 'running' || status === 'loading' || status === 'paused' ? 'running' : 'project');
    if (!runtimeVisible) {
      togglePanel('runtime');
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
      const deploymentId = `${candidate.id}:${deviceId}`;
      pendingDeploymentTargetsRef.current.set(deviceId, {
        deploymentId,
        automataId: candidate.id,
        deviceId,
        status: 'loading',
        updatedAt: Date.now(),
        source: 'runtime',
      });
      setSelectedDeploymentId(deploymentId);
      addNotification('success', 'Deploy', `Deployed ${candidate.automata?.config?.name ?? candidate.id} to ${deviceId}`);
    } catch (err) {
      addNotification('error', 'Deploy', err instanceof Error ? err.message : 'Failed to deploy automata');
    }
  };

  const handleLoadShowcase = async () => {
    if (!selectedShowcasePath) {
      addNotification('warning', 'Showcase', 'No showcase automata selected.');
      return;
    }

    setShowcaseBusy(true);
    try {
      await importShowcaseAutomata(selectedShowcasePath);
    } finally {
      setShowcaseBusy(false);
    }
  };

  const handleDeployShowcase = async (deviceId: string) => {
    if (!selectedShowcasePath) {
      addNotification('warning', 'Showcase Deploy', 'No showcase automata selected.');
      return;
    }

    setShowcaseBusy(true);
    try {
      const candidate = await importShowcaseAutomata(selectedShowcasePath);
      if (!candidate) {
        return;
      }

      await gatewayService.deployAutomata(candidate.id, deviceId, { automata: candidate.automata });
      const deploymentId = `${candidate.id}:${deviceId}`;
      pendingDeploymentTargetsRef.current.set(deviceId, {
        deploymentId,
        automataId: candidate.id,
        deviceId,
        status: 'loading',
        updatedAt: Date.now(),
        source: 'runtime',
      });
      setSelectedDeploymentId(deploymentId);
      addNotification('success', 'Showcase Deploy', `Deployed ${candidate.automata.config.name} to ${deviceId}`);
    } catch (err) {
      addNotification('error', 'Showcase Deploy', err instanceof Error ? err.message : 'Failed to deploy showcase');
    } finally {
      setShowcaseBusy(false);
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
      const selectedDeployment = resolveCommandDeployment(deviceId);
      await gatewayService.setVariable(
        deviceId,
        varName.trim(),
        parseJsonOrString(varValue),
        getCommandTarget(selectedDeployment),
      );
      addNotification('success', 'Set Variable', `Sent ${varName.trim()} to ${describeDeployment(deviceId, selectedDeployment)}`);
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
      const selectedDeployment = resolveCommandDeployment(deviceId);
      await gatewayService.triggerEvent(
        deviceId,
        eventName.trim(),
        data,
        getCommandTarget(selectedDeployment),
      );
      addNotification(
        'success',
        'Trigger Event',
        `Triggered ${eventName.trim()} on ${describeDeployment(deviceId, selectedDeployment)}`,
      );
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
      const selectedDeployment = resolveCommandDeployment(deviceId);
      await gatewayService.forceTransition(
        deviceId,
        forceState.trim(),
        getCommandTarget(selectedDeployment),
      );
      addNotification(
        'success',
        'Force Transition',
        `Forced ${describeDeployment(deviceId, selectedDeployment)} to ${forceState.trim()}`,
      );
    } catch (err) {
      addNotification('error', 'Force Transition', err instanceof Error ? err.message : 'Failed to send');
    }
  };

  const handleStartAllDeployments = async (deviceId: string) => {
    const deployments = getDeploymentsForDevice(deviceId);
    if (deployments.length === 0) {
      addNotification('warning', 'Execution', 'No deployments available on this device.');
      return;
    }

    try {
      for (const deployment of deployments) {
        await gatewayService.startExecution(deviceId, getCommandTarget(deployment));
      }
      addNotification('success', 'Execution', `Started ${deployments.length} deployments on ${deviceId}`);
    } catch (err) {
      addNotification('error', 'Execution', err instanceof Error ? err.message : 'Failed to start all deployments');
    }
  };

  const handleStopAllDeployments = async (deviceId: string) => {
    const deployments = getDeploymentsForDevice(deviceId);
    if (deployments.length === 0) {
      addNotification('warning', 'Execution', 'No deployments available on this device.');
      return;
    }

    try {
      for (const deployment of deployments) {
        await gatewayService.stopExecution(deviceId, getCommandTarget(deployment));
      }
      addNotification('success', 'Execution', `Stopped ${deployments.length} deployments on ${deviceId}`);
    } catch (err) {
      addNotification('error', 'Execution', err instanceof Error ? err.message : 'Failed to stop all deployments');
    }
  };
  
  const selectedDeviceLive = devices.find((d) => d.id === selectedDeviceId) as Device | undefined;

  useEffect(() => {
    if (selectedDeviceLive) {
      setSelectedDeviceFallback(selectedDeviceLive);
    }
  }, [selectedDeviceLive]);

  const selectedDevice = selectedDeviceLive ?? selectedDeviceFallback;
  const selectedDeviceDeployments = useMemo(
    () => {
      if (!selectedDevice) return [];
      const deployments = deploymentsByDevice.get(selectedDevice.id) ?? [];

      if (showHistory || !supportsMultipleDeployments(selectedDevice)) {
        return deployments;
      }

      const live = deployments.filter((deployment) => isRunningLike(deployment.status));
      return live.length > 0 ? live : deployments.slice(0, 1);
    },
    [selectedDevice, deploymentsByDevice, showHistory],
  );
  const selectedDeployment =
    selectedDeviceDeployments.find((deployment) => deployment.deploymentId === selectedDeploymentId) ??
    selectedDeviceDeployments[0] ??
    null;
  const selectedRuntimeDeployment =
    selectedDeployment ? runtimeDeploymentsMap.get(selectedDeployment.deploymentId) : undefined;
  const selectedExecution = selectedDevice ? deviceExecutionsMap.get(selectedDevice.id as any) : undefined;
  const selectedSnapshot =
    selectedExecution?.currentSnapshot &&
    (!selectedDeployment ||
      String(selectedExecution.currentSnapshot.automataId) === selectedDeployment.automataId)
      ? selectedExecution.currentSnapshot
      : null;
  const selectedVariableEntries = useMemo(() => {
    if (selectedSnapshot) {
      return Object.entries(selectedSnapshot.variables ?? {})
        .map(([name, meta]) => [name, meta?.value] as const)
        .sort(([a], [b]) => a.localeCompare(b));
    }

    return Object.entries(selectedRuntimeDeployment?.variables ?? {}).sort(([a], [b]) =>
      a.localeCompare(b),
    );
  }, [selectedRuntimeDeployment, selectedSnapshot]);
  const selectedInputEntries = useMemo(
    () =>
      Object.entries(selectedSnapshot?.inputs ?? {})
        .map(([name, meta]) => [name, meta?.value] as const)
        .sort(([a], [b]) => a.localeCompare(b)),
    [selectedSnapshot],
  );
  const selectedOutputEntries = useMemo(
    () =>
      Object.entries(selectedSnapshot?.outputs ?? {})
        .map(([name, meta]) => [name, meta?.value] as const)
        .sort(([a], [b]) => a.localeCompare(b)),
    [selectedSnapshot],
  );
  const selectedTransfer = selectedDevice ? transferForDeployment(selectedDevice, selectedDeployment) : undefined;
  const selectedDeviceCanSnapshot = selectedDevice
    ? supportsCommand(selectedDevice.id, 'request_state')
    : false;

  const formatSignalValue = (value: unknown): string => {
    if (typeof value === 'string') return value;
    if (
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      value === null ||
      value === undefined
    ) {
      return String(value);
    }

    try {
      return JSON.stringify(value);
    } catch {
      return '[unserializable]';
    }
  };

  useEffect(() => {
    if (!selectedDevice) {
      setSelectedDeploymentId(null);
      return;
    }

    if (selectedDeviceDeployments.length === 0) {
      if (selectedDeploymentId !== null) {
        setSelectedDeploymentId(null);
      }
      return;
    }

    const selectedExists = selectedDeploymentId
      ? selectedDeviceDeployments.some((deployment) => deployment.deploymentId === selectedDeploymentId)
      : false;

    if (!selectedExists) {
      const preferred =
        selectedDeviceDeployments.find((deployment) => isRunningLike(deployment.status)) ??
        selectedDeviceDeployments[0];
      if (preferred && preferred.deploymentId !== selectedDeploymentId) {
        setSelectedDeploymentId(preferred.deploymentId);
      }
    }
  }, [selectedDeploymentId, selectedDevice, selectedDeviceDeployments]);

  useEffect(() => {
    if (!selectedDevice || !selectedDeployment) {
      return;
    }

    if (!isConnected || !isDeviceReachable(selectedDevice.status)) {
      return;
    }

    if (!isRunningLike(selectedDeployment.status) || !selectedDeviceCanSnapshot) {
      return;
    }

    let cancelled = false;

    const refreshSnapshot = async () => {
      try {
        await gatewayService.getSnapshot(selectedDevice.id, getCommandTarget(selectedDeployment));
      } catch {
        if (!cancelled) {
          // Best-effort live polling; surface errors only on explicit snapshot requests.
        }
      }
    };

    void refreshSnapshot();
    const interval = setInterval(() => {
      void refreshSnapshot();
    }, 1200);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [gatewayService, isConnected, selectedDeployment, selectedDevice, selectedDeviceCanSnapshot]);
  
  return (
    <div className="devices-panel">
      <div className="panel-header">
        <IconDevice size={16} />
        <span>Devices</span>
        <span className="device-count" style={{ marginLeft: 'auto' }}>
          {visibleDevices.length}/{devices.length}
        </span>
        <button
          className="btn btn-ghost btn-icon"
          onClick={handleRefresh}
          title="Refresh devices"
        >
          <IconRefresh size={14} />
        </button>
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
      
      {!isConnected ? (
        <div className="panel-empty">
          <p>Not connected to gateway</p>
        </div>
      ) : (
        <div className="devices-content">
          <div className="devices-toolbar">
            <div className="devices-toolbar-group">
              <button
                className={`btn btn-sm ${showHistory ? 'btn-secondary' : 'btn-primary'}`}
                onClick={() => setShowHistory(false)}
              >
                Live Now
              </button>
              <button
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

          {/* Server/Device Tree */}
          <div className="device-tree">
            {visibleServers.length === 0 ? (
              visibleDevices.length === 0 ? (
                <div className="empty-state">
                  {showHistory ? 'No devices match this filter.' : 'No live devices right now. Switch to All Seen to inspect history.'}
                </div>
              ) : (
                <div className="server-group">
                  <div className="server-header">
                    <IconServer size={14} />
                    <span className="server-name">Unassigned</span>
                    <span className="device-count">({visibleDevices.length})</span>
                  </div>
                  <div className="device-list">
                    {visibleDevices.map((device) => {
                      const deployments = getDeploymentsForDevice(device.id);
                      const runningCount = deployments.filter((deployment) => isRunningLike(deployment.status)).length;
                      const transfer = transferForDeployment(device, deployments[0]);
                      return (
                        <div
                          key={device.id}
                          className={`device-item ${selectedDeviceId === device.id ? 'selected' : ''}`}
                          onClick={() => {
                            setSelectedDeviceId(device.id);
                            setSelectedDeviceFallback(device as Device);
                            selectDevice(device.id);
                          }}
                        >
                          <IconDevice size={14} />
                          <span className="device-name">{device.name}</span>
                          {getStatusIcon(device.status)}
                          {runningCount > 0 && (
                            <span className="running-indicator" title="Running">
                              <IconPlay size={10} />
                            </span>
                          )}
                          {deployments.length > 1 && (
                            <span className="device-count" title={`${deployments.length} deployments`}>
                              {deployments.length}
                            </span>
                          )}
                          {transfer?.status === 'active' && (
                            <span className="deploying-indicator" title="Deployment in progress" />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )
            ) : (
              visibleServers.map((server) => {
                const serverDevices = visibleDevices.filter((d) => d.serverId === server.id);
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
                          const deployments = getDeploymentsForDevice(device.id);
                          const runningCount = deployments.filter((deployment) => isRunningLike(deployment.status)).length;
                          const transfer = transferForDeployment(device, deployments[0]);
                          
                          return (
                            <div
                              key={device.id}
                              className={`device-item ${selectedDeviceId === device.id ? 'selected' : ''}`}
                              onClick={() => {
                                setSelectedDeviceId(device.id);
                                setSelectedDeviceFallback(device as Device);
                                selectDevice(device.id);
                              }}
                            >
                              <IconDevice size={14} />
                              <span className="device-name">{device.name}</span>
                              {getStatusIcon(device.status)}
                              {runningCount > 0 && (
                                <span className="running-indicator" title="Running">
                                  <IconPlay size={10} />
                                </span>
                              )}
                              {deployments.length > 1 && (
                                <span className="device-count" title={`${deployments.length} deployments`}>
                                  {deployments.length}
                                </span>
                              )}
                              {transfer?.status === 'active' && (
                                <span className="deploying-indicator" title="Deployment in progress" />
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
                {selectedDevice.connectorType && (
                  <div className="detail-row">
                    <span className="detail-label">Connector:</span>
                    <span className="detail-value">
                      {selectedDevice.connectorType}
                      {selectedDevice.connectorId ? ` (${selectedDevice.connectorId})` : ''}
                    </span>
                  </div>
                )}
                {selectedDevice.transport && (
                  <div className="detail-row">
                    <span className="detail-label">Transport:</span>
                    <span className="detail-value">
                      {selectedDevice.transport}
                      {selectedDevice.link ? ` · ${selectedDevice.link}` : ''}
                    </span>
                  </div>
                )}
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

                {(selectedSnapshot?.currentState ?? selectedDeployment?.currentState) && (
                  <div className="detail-row">
                    <span className="detail-label">Current State:</span>
                    <span className="detail-value">
                      {selectedSnapshot?.currentState ?? selectedDeployment?.currentState}
                    </span>
                  </div>
                )}
                {selectedSnapshot && (
                  <div className="detail-row">
                    <span className="detail-label">Snapshot:</span>
                    <span className="detail-value">
                      {new Date(selectedSnapshot.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                )}
                {selectedDeployment && (
                  <div className="detail-row">
                    <span className="detail-label">Selected Deployment:</span>
                    <span className="detail-value">
                      {selectedDeployment.automataId} · {runtimeStatusToLabel(selectedDeployment.status)}
                    </span>
                  </div>
                )}
                {selectedDeviceDeployments.length > 0 && (
                  <div className="detail-section">
                    <label className="section-label">Deployments</label>
                    <div className="metadata-list">
                      {selectedDeviceDeployments.map((deployment) => (
                        <button
                          key={deployment.deploymentId}
                          className={`btn btn-sm ${selectedDeployment?.deploymentId === deployment.deploymentId ? 'btn-primary' : 'btn-secondary'}`}
                          onClick={() => setSelectedDeploymentId(deployment.deploymentId)}
                          title={deployment.deploymentId}
                        >
                          {deployment.automataId} · {runtimeStatusToLabel(deployment.status)}
                        </button>
                      ))}
                    </div>
                    {selectedDeviceDeployments.length > 1 && (
                      <div className="device-actions" style={{ marginTop: 'var(--spacing-2)' }}>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => handleStartAllDeployments(selectedDevice.id)}
                          disabled={!isDeviceReachable(selectedDevice.status)}
                        >
                          <span>Start All</span>
                        </button>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => handleStopAllDeployments(selectedDevice.id)}
                          disabled={!isDeviceReachable(selectedDevice.status)}
                        >
                          <span>Stop All</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {(selectedVariableEntries.length > 0 ||
                  selectedInputEntries.length > 0 ||
                  selectedOutputEntries.length > 0) && (
                  <div className="detail-section">
                    <label className="section-label">Live Snapshot</label>
                    {selectedVariableEntries.length > 0 && (
                      <div className="signal-group">
                        <span className="subsection-label">Variables</span>
                        <div className="metadata-list">
                          {selectedVariableEntries.map(([name, value]) => (
                            <span key={name} className="tag-item" title={formatSignalValue(value)}>
                              {name}: {formatSignalValue(value)}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {selectedInputEntries.length > 0 && (
                      <div className="signal-group">
                        <span className="subsection-label">Inputs</span>
                        <div className="metadata-list">
                          {selectedInputEntries.map(([name, value]) => (
                            <span key={name} className="tag-item" title={formatSignalValue(value)}>
                              {name}: {formatSignalValue(value)}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {selectedOutputEntries.length > 0 && (
                      <div className="signal-group">
                        <span className="subsection-label">Outputs</span>
                        <div className="metadata-list">
                          {selectedOutputEntries.map(([name, value]) => (
                            <span key={name} className="tag-item" title={formatSignalValue(value)}>
                              {name}: {formatSignalValue(value)}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {selectedTransfer && (
                  <div className="detail-section">
                    <label className="section-label">Deployment Transfer</label>
                    <div className="deploy-transfer-card">
                      <div className="deploy-transfer-meta">
                        <span>{humanizeTransferStage(selectedTransfer.stage)}</span>
                        <span>{Math.round(selectedTransfer.progressPercent)}%</span>
                      </div>
                      <div className="deploy-transfer-track">
                        <div
                          className={`deploy-transfer-fill status-${selectedTransfer.status}`}
                          style={{ width: `${Math.round(selectedTransfer.progressPercent)}%` }}
                        />
                      </div>
                      <div className="deploy-transfer-extra">
                        {selectedTransfer.totalChunks ? (
                          <span>
                            chunk {(selectedTransfer.chunkIndex ?? 0) + 1}/{selectedTransfer.totalChunks}
                          </span>
                        ) : (
                          <span>single payload</span>
                        )}
                        {selectedTransfer.maxRetries ? (
                          <span>
                            retry {selectedTransfer.retryCount ?? 0}/{selectedTransfer.maxRetries}
                          </span>
                        ) : (
                          <span>retry n/a</span>
                        )}
                      </div>
                      {selectedTransfer.error && (
                        <div className="deploy-transfer-error">{selectedTransfer.error}</div>
                      )}
                    </div>
                  </div>
                )}
                {selectedDevice.location && (
                  <div className="detail-row">
                    <span className="detail-label">Location:</span>
                    <span className="detail-value">{selectedDevice.location}</span>
                  </div>
                )}
                
                {(selectedDevice.capabilities?.length || selectedDevice.tags?.length) && (
                  <details className="detail-accordion">
                    <summary className="section-label">Metadata</summary>
                    <div className="detail-section accordion-body">
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
                    </div>
                  </details>
                )}

                {showcaseEntries.length > 0 && (
                  <details className="detail-accordion">
                    <summary className="section-label">Showcase Automata</summary>
                    <div className="detail-section accordion-body">
                      <div className="showcase-controls">
                        <select
                          className="input showcase-select"
                          value={selectedShowcasePath}
                          onChange={(event) => setSelectedShowcasePath(event.target.value)}
                          disabled={showcaseBusy}
                          title="Curated automata examples for demos and quick testing"
                        >
                          {showcaseEntries.map((entry) => (
                            <option key={entry.id} value={entry.relativePath}>
                              {entry.category} · {entry.name}
                            </option>
                          ))}
                        </select>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={handleLoadShowcase}
                          disabled={showcaseBusy}
                          title="Load selected showcase automata into editor"
                        >
                          Load
                        </button>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => handleDeployShowcase(selectedDevice.id)}
                          disabled={showcaseBusy || !isDeviceReachable(selectedDevice.status)}
                          title="Load and deploy selected showcase automata to this device"
                        >
                          Deploy Showcase
                        </button>
                      </div>
                    </div>
                  </details>
                )}
                
                {/* Device Actions */}
                <div className="device-actions">
                  {selectedDeployment && isRunningLike(selectedDeployment.status) ? (
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => handleStopExecution(selectedDevice.id)}
                      disabled={
                        !selectedDeployment ||
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
                        (!selectedDeployment && automataMap.size === 0) ||
                        !supportsCommand(selectedDevice.id, 'start_execution')
                      }
                    >
                      <IconPlay size={12} />
                      <span>Start</span>
                    </button>
                  )}

                  {selectedDeployment && isRunningLike(selectedDeployment.status) && selectedDeployment.status !== 'paused' && (
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => handlePauseExecution(selectedDevice.id)}
                      disabled={
                        !selectedDeployment ||
                        !isDeviceReachable(selectedDevice.status) ||
                        !supportsCommand(selectedDevice.id, 'pause_execution')
                      }
                    >
                      <span>Pause</span>
                    </button>
                  )}

                  {selectedDeployment?.status === 'paused' && (
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleResumeExecution(selectedDevice.id)}
                      disabled={
                        !selectedDeployment ||
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
                      !selectedDeployment ||
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
                      !selectedDeployment ||
                      !isDeviceReachable(selectedDevice.status) ||
                      !supportsCommand(selectedDevice.id, 'request_state')
                    }
                  >
                    <span>Snapshot</span>
                  </button>

                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => handleOpenRuntimeMonitor(selectedDevice.id)}
                    disabled={!selectedDeployment}
                    title={selectedDeployment ? 'Open runtime monitor for the selected deployment' : 'Deploy automata first'}
                  >
                    <IconRuntime size={12} />
                    <span>Runtime</span>
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
                <details className="detail-accordion">
                  <summary className="section-label">Advanced Runtime Control</summary>
                  <div className="detail-section accordion-body">

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
                        !selectedDeployment ||
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
                        !selectedDeployment ||
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
                        !selectedDeployment ||
                        !isDeviceReachable(selectedDevice.status) ||
                        !supportsCommand(selectedDevice.id, 'force_transition')
                      }
                    >
                      Force
                    </button>
                  </div>
                  </div>
                </details>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
