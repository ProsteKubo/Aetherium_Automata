import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  Edge,
  Handle,
  MarkerType,
  MiniMap,
  Node,
  NodeProps,
  Position,
  ReactFlowInstance,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useAutomataStore, useGatewayStore, useProjectStore, useRuntimeViewStore, useUIStore } from '../../stores';
import type { RuntimeDeployment } from '../../types';
import { deriveCompatibleBindingDrafts } from '../../utils/automataBindings';
import { IconAutomata, IconDevice, IconGateway, IconRefresh } from '../common/Icons';

type NetworkNodeKind = 'gateway' | 'server' | 'device';

type NetworkCanvasNode = {
  id: string;
  kind: NetworkNodeKind;
  label: string;
  subtitle?: string;
  status: string;
  metadata?: Record<string, unknown>;
  position: { x: number; y: number };
};

type Selection =
  | { kind: 'node'; id: string }
  | null;

type CanvasNodeData = {
  node: NetworkCanvasNode;
};

type LogicalNetworkSummary = {
  id: string;
  name: string;
  color?: string;
  automataCount: number;
  deploymentCount: number;
  deviceCount: number;
  serverCount: number;
  crossNetworkChannelCount: number;
  inputCount: number;
  outputCount: number;
};

type LogicalChannelRoute = {
  id: string;
  channelName: string;
  sourceNetworkId: string;
  sourceNetworkName: string;
  sourceNetworkColor?: string;
  targetNetworkId: string;
  targetNetworkName: string;
  targetNetworkColor?: string;
  sourceAutomataIds: string[];
  targetAutomataIds: string[];
  sourceAutomataNames: string[];
  targetAutomataNames: string[];
  sourceTypes: string[];
  targetTypes: string[];
  linkCount: number;
};

const HIDDEN_HANDLE_STYLE = {
  width: 10,
  height: 10,
  opacity: 0,
  border: 'none',
  background: 'transparent',
};

const TOPOLOGY_GATEWAY_X = 80;
const TOPOLOGY_SERVER_X = 340;
const TOPOLOGY_DEVICE_X = 650;
const TOPOLOGY_TOP = 80;
const TOPOLOGY_SERVER_CARD_HEIGHT = 104;
const TOPOLOGY_DEVICE_CARD_HEIGHT = 108;
const TOPOLOGY_DEVICE_GAP = 124;
const TOPOLOGY_CLUSTER_GAP = 64;

function nodeColor(kind: NetworkNodeKind): string {
  if (kind === 'gateway') return '#22c55e';
  if (kind === 'server') return '#60a5fa';
  return '#f59e0b';
}

function statusClass(status: string): string {
  if (status === 'connected' || status === 'online' || status === 'running') return 'online';
  if (status === 'error') return 'error';
  if (status === 'connecting' || status === 'syncing' || status === 'loading') return 'busy';
  return 'offline';
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';

  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable]';
  }
}

const NetworkCanvasNodeComponent: React.FC<NodeProps<CanvasNodeData>> = ({ data, selected }) => {
  const node = data.node;
  return (
    <div className={`network-live-node kind-${node.kind} status-${statusClass(node.status)} ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Left} style={HIDDEN_HANDLE_STYLE} />
      <div className="network-live-node-title">{node.label}</div>
      {node.subtitle && <div className="network-live-node-subtitle">{node.subtitle}</div>}
      <div className="network-live-node-status">{node.status}</div>
      <Handle type="source" position={Position.Right} style={HIDDEN_HANDLE_STYLE} />
    </div>
  );
};

const nodeTypes = {
  networkNode: NetworkCanvasNodeComponent,
};

export const NetworkPanel: React.FC = () => {
  const [selection, setSelection] = useState<Selection>(null);
  const [showOffline, setShowOffline] = useState(true);
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance | null>(null);

  const gatewayStatus = useGatewayStore((state) => state.status);
  const serversMap = useGatewayStore((state) => state.servers);
  const devicesMap = useGatewayStore((state) => state.devices);
  const fetchServers = useGatewayStore((state) => state.fetchServers);
  const fetchDevices = useGatewayStore((state) => state.fetchDevices);
  const deploymentsMap = useRuntimeViewStore((state) => state.deployments);
  const automataMap = useAutomataStore((state) => state.automata);
  const project = useProjectStore((state) => state.project);
  const setActiveAutomata = useAutomataStore((state) => state.setActiveAutomata);
  const openTab = useUIStore((state) => state.openTab);
  const layout = useUIStore((state) => state.layout);
  const togglePanel = useUIStore((state) => state.togglePanel);

  const networkByAutomataId = useMemo(() => {
    const mapped = new Map<string, { id: string; name: string; color?: string; inputCount: number; outputCount: number }>();
    project?.networks.forEach((network) => {
      network.automataIds.forEach((automataId) => {
        mapped.set(automataId, {
          id: network.id,
          name: network.name,
          color: network.color,
          inputCount: network.inputs?.length ?? 0,
          outputCount: network.outputs?.length ?? 0,
        });
      });
    });
    return mapped;
  }, [project]);

  const crossNetworkChannels = useMemo(() => {
    return deriveCompatibleBindingDrafts(Array.from(automataMap.values()))
      .map((binding) => {
        const sourceNetwork = networkByAutomataId.get(binding.sourceAutomataId);
        const targetNetwork = networkByAutomataId.get(binding.targetAutomataId);
        return {
          binding,
          sourceNetwork,
          targetNetwork,
        };
      })
      .filter(
        (entry) =>
          Boolean(entry.sourceNetwork && entry.targetNetwork) &&
          entry.sourceNetwork?.id !== entry.targetNetwork?.id,
      );
  }, [automataMap, networkByAutomataId]);

  const logicalChannelRoutes = useMemo<LogicalChannelRoute[]>(() => {
    const grouped = new Map<string, LogicalChannelRoute>();

    crossNetworkChannels.forEach((entry) => {
      if (!entry.sourceNetwork || !entry.targetNetwork) {
        return;
      }

      const key = [
        entry.sourceNetwork.id,
        entry.targetNetwork.id,
        entry.binding.sourceOutputName,
      ].join('::');
      const sourceAutomataName = automataMap.get(entry.binding.sourceAutomataId)?.config.name ?? entry.binding.sourceAutomataId;
      const targetAutomataName = automataMap.get(entry.binding.targetAutomataId)?.config.name ?? entry.binding.targetAutomataId;
      const existing = grouped.get(key);

      if (existing) {
        if (!existing.sourceAutomataIds.includes(entry.binding.sourceAutomataId)) {
          existing.sourceAutomataIds.push(entry.binding.sourceAutomataId);
          existing.sourceAutomataNames.push(sourceAutomataName);
        }
        if (!existing.targetAutomataIds.includes(entry.binding.targetAutomataId)) {
          existing.targetAutomataIds.push(entry.binding.targetAutomataId);
          existing.targetAutomataNames.push(targetAutomataName);
        }
        if (!existing.sourceTypes.includes(entry.binding.sourceType)) {
          existing.sourceTypes.push(entry.binding.sourceType);
        }
        if (!existing.targetTypes.includes(entry.binding.targetType)) {
          existing.targetTypes.push(entry.binding.targetType);
        }
        existing.linkCount += 1;
        return;
      }

      grouped.set(key, {
        id: key,
        channelName: entry.binding.sourceOutputName,
        sourceNetworkId: entry.sourceNetwork.id,
        sourceNetworkName: entry.sourceNetwork.name,
        sourceNetworkColor: entry.sourceNetwork.color,
        targetNetworkId: entry.targetNetwork.id,
        targetNetworkName: entry.targetNetwork.name,
        targetNetworkColor: entry.targetNetwork.color,
        sourceAutomataIds: [entry.binding.sourceAutomataId],
        targetAutomataIds: [entry.binding.targetAutomataId],
        sourceAutomataNames: [sourceAutomataName],
        targetAutomataNames: [targetAutomataName],
        sourceTypes: [entry.binding.sourceType],
        targetTypes: [entry.binding.targetType],
        linkCount: 1,
      });
    });

    return Array.from(grouped.values()).sort((left, right) => {
      if (right.linkCount !== left.linkCount) {
        return right.linkCount - left.linkCount;
      }
      return left.channelName.localeCompare(right.channelName);
    });
  }, [automataMap, crossNetworkChannels]);

  const activatePanel = useCallback(() => {
    if (!layout.panels.automata?.isVisible) {
      togglePanel('automata');
    }
  }, [layout.panels, togglePanel]);

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
      activatePanel();
    },
    [activatePanel, automataMap, openTab, setActiveAutomata],
  );

  const openBlackBoxes = useCallback(() => {
    if (!layout.panels.blackboxes?.isVisible) {
      togglePanel('blackboxes');
    }
  }, [layout.panels, togglePanel]);

  const servers = useMemo(
    () =>
      Array.from(serversMap.values())
        .filter((server) => showOffline || server.status === 'connected' || server.status === 'syncing')
        .sort((left, right) => left.name.localeCompare(right.name)),
    [serversMap, showOffline],
  );

  const deploymentsByDevice = useMemo(() => {
    const grouped = new Map<string, RuntimeDeployment[]>();
    deploymentsMap.forEach((deployment) => {
      const existing = grouped.get(deployment.deviceId) ?? [];
      existing.push(deployment);
      grouped.set(deployment.deviceId, existing);
    });
    return grouped;
  }, [deploymentsMap]);

  const devices = useMemo(
    () =>
      Array.from(devicesMap.values())
        .filter((device) => showOffline || device.status === 'online' || device.status === 'updating')
        .sort((left, right) => left.name.localeCompare(right.name)),
    [devicesMap, showOffline],
  );

  const blackBoxParticipants = useMemo(
    () =>
      Array.from(automataMap.values())
        .filter((automata) => Boolean(automata.blackBox))
        .map((automata) => {
          const deployment = Array.from(deploymentsMap.values()).find(
            (entry) => entry.automataId === automata.id,
          );
          const device = deployment ? devicesMap.get(deployment.deviceId) : undefined;

          return {
            automata,
            deployment,
            device,
          };
        })
        .sort((left, right) => left.automata.config.name.localeCompare(right.automata.config.name)),
    [automataMap, deploymentsMap, devicesMap],
  );

  const logicalNetworks = useMemo<LogicalNetworkSummary[]>(() => {
    if (!project) {
      return [];
    }

    return project.networks.map((network) => {
      const automataIds = new Set(network.automataIds);
      const deployments = Array.from(deploymentsMap.values()).filter((deployment) => automataIds.has(deployment.automataId));
      const deviceIds = Array.from(new Set(deployments.map((deployment) => String(deployment.deviceId))));
      const serverIds = Array.from(
        new Set(
          deviceIds
            .map((deviceId) => devicesMap.get(deviceId)?.serverId)
            .filter((serverId): serverId is string => typeof serverId === 'string' && serverId.length > 0),
        ),
      );

      return {
        id: network.id,
        name: network.name,
        color: network.color,
        automataCount: network.automataIds.length,
        deploymentCount: deployments.length,
        deviceCount: deviceIds.length,
        serverCount: serverIds.length,
        crossNetworkChannelCount: logicalChannelRoutes.filter(
          (route) => route.sourceNetworkId === network.id || route.targetNetworkId === network.id,
        ).length,
        inputCount: network.inputs?.length ?? 0,
        outputCount: network.outputs?.length ?? 0,
      };
    });
  }, [deploymentsMap, devicesMap, logicalChannelRoutes, project]);

  const graph = useMemo(() => {
    let layoutY = TOPOLOGY_TOP;
    const serverLayouts = servers.map((server) => {
      const serverDevices = devices.filter((device) => device.serverId === server.id);
      const deviceBandHeight =
        serverDevices.length > 0
          ? (serverDevices.length - 1) * TOPOLOGY_DEVICE_GAP + TOPOLOGY_DEVICE_CARD_HEIGHT
          : TOPOLOGY_SERVER_CARD_HEIGHT;
      const clusterHeight = Math.max(TOPOLOGY_SERVER_CARD_HEIGHT, deviceBandHeight);
      const layout = {
        server,
        serverDevices,
        serverY: layoutY + (clusterHeight - TOPOLOGY_SERVER_CARD_HEIGHT) / 2,
        deviceStartY: layoutY,
        clusterTop: layoutY,
        clusterHeight,
      };
      layoutY += clusterHeight + TOPOLOGY_CLUSTER_GAP;
      return layout;
    });
    const graphHeight =
      serverLayouts.length > 0
        ? serverLayouts[serverLayouts.length - 1].clusterTop + serverLayouts[serverLayouts.length - 1].clusterHeight - TOPOLOGY_TOP
        : TOPOLOGY_SERVER_CARD_HEIGHT;

    const nodes: NetworkCanvasNode[] = [
      {
        id: 'gateway_root',
        kind: 'gateway',
        label: 'Gateway',
        subtitle: `${servers.length} servers`,
        status: gatewayStatus,
        position: { x: TOPOLOGY_GATEWAY_X, y: TOPOLOGY_TOP + Math.max(0, (graphHeight - TOPOLOGY_SERVER_CARD_HEIGHT) / 2) },
      },
    ];
    const edges: Edge[] = [];

    serverLayouts.forEach(({ server, serverDevices, serverY, deviceStartY }) => {
      const serverNodeId = `server:${server.id}`;

      nodes.push({
        id: serverNodeId,
        kind: 'server',
        label: server.name,
        subtitle: `${serverDevices.length} devices`,
        status: server.status,
        position: { x: TOPOLOGY_SERVER_X, y: serverY },
        metadata: {
          id: server.id,
          address: `${server.address}:${server.port}`,
          latency: server.latency,
          deviceCount: serverDevices.length,
        },
      });

      edges.push({
        id: `gateway->${serverNodeId}`,
        source: 'gateway_root',
        target: serverNodeId,
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed, color: '#60a5fa' },
        style: { stroke: '#60a5fa', strokeWidth: 2.2 },
      });

      serverDevices.forEach((device, deviceIndex) => {
        const deploymentList = deploymentsByDevice.get(device.id) ?? [];
        const primaryDeployment = deploymentList[0];
        const assignedAutomata =
          (primaryDeployment ? automataMap.get(primaryDeployment.automataId) : undefined) ??
          (device.assignedAutomataId ? automataMap.get(device.assignedAutomataId) : undefined);
        const assignedBlackBox = assignedAutomata?.blackBox;
        const automataName = primaryDeployment
          ? automataMap.get(primaryDeployment.automataId)?.config.name ?? primaryDeployment.automataId
          : device.assignedAutomataId
            ? automataMap.get(device.assignedAutomataId)?.config.name ?? device.assignedAutomataId
            : undefined;
        const deviceNetworkNames = Array.from(
          new Set(
            deploymentList
              .map((deployment) => networkByAutomataId.get(deployment.automataId)?.name)
              .filter((value): value is string => Boolean(value)),
          ),
        );
        const primaryNetwork = primaryDeployment ? networkByAutomataId.get(primaryDeployment.automataId) : undefined;
        const deviceNodeId = `device:${device.id}`;

        nodes.push({
          id: deviceNodeId,
          kind: 'device',
          label: device.name,
          subtitle:
            assignedBlackBox
              ? `Black box · ${automataName ?? 'interface only'}`
              : deviceNetworkNames.length > 0
                ? `${deviceNetworkNames.join(' · ')}${automataName ? ` · ${automataName}` : ''}`
                : automataName ?? device.connectorType ?? device.transport ?? device.address,
          status: device.status,
          position: { x: TOPOLOGY_DEVICE_X, y: deviceStartY + deviceIndex * TOPOLOGY_DEVICE_GAP },
          metadata: {
            id: device.id,
            serverId: device.serverId,
            address: `${device.address}:${device.port}`,
            connectorType: device.connectorType,
            transport: device.transport,
            assignedAutomataId: primaryDeployment?.automataId ?? device.assignedAutomataId,
            currentState: primaryDeployment?.currentState ?? device.currentState,
            supportedCommands: device.supportedCommands,
            lastSeen: device.lastSeen,
            blackBoxParticipant: Boolean(assignedBlackBox),
            ownership: assignedBlackBox ? 'external-interface-only' : 'gateway-managed',
            blackBoxPortCount: assignedBlackBox?.ports.length,
            blackBoxResourceCount: assignedBlackBox?.resources.length,
            logicalNetwork: primaryNetwork?.name,
            logicalNetworks: deviceNetworkNames,
            logicalChannelCount: primaryNetwork
              ? logicalChannelRoutes.filter(
                  (route) =>
                    route.sourceNetworkId === primaryNetwork.id || route.targetNetworkId === primaryNetwork.id,
                ).length
              : 0,
          },
        });

        edges.push({
          id: `${serverNodeId}->${deviceNodeId}`,
          source: serverNodeId,
          target: deviceNodeId,
          type: 'smoothstep',
          label: primaryDeployment?.currentState,
          markerEnd: { type: MarkerType.ArrowClosed, color: '#f59e0b' },
          style: {
            stroke: '#f59e0b',
            strokeWidth: 2,
            strokeDasharray: device.status === 'offline' ? '6 4' : undefined,
          },
          labelStyle: {
            fill: '#dbe7ff',
            fontSize: 11,
            fontWeight: 600,
          },
        });
      });
    });

    return { nodes, edges };
  }, [automataMap, deploymentsByDevice, devices, gatewayStatus, logicalChannelRoutes, networkByAutomataId, servers]);

  const flowNodes = useMemo<Node<CanvasNodeData>[]>(
    () =>
      graph.nodes.map((node) => ({
        id: node.id,
        type: 'networkNode',
        position: node.position,
        data: { node },
        draggable: false,
      })),
    [graph.nodes],
  );

  const selectedNode =
    selection?.kind === 'node' ? graph.nodes.find((node) => node.id === selection.id) ?? null : null;

  useEffect(() => {
    if (!selection) return;
    if (!graph.nodes.some((node) => node.id === selection.id)) {
      setSelection(null);
    }
  }, [graph.nodes, selection]);

  return (
    <div className="network-panel-live">
      <div className="network-live-toolbar">
        <div className="network-live-toolbar-group">
          <span className="petri-chip">
            <IconGateway size={12} />
            Gateway {gatewayStatus}
          </span>
          <span className="petri-chip">
            <IconDevice size={12} />
            {devices.length} devices
          </span>
          <span className="petri-chip">{logicalNetworks.length} logical networks</span>
          <span className="petri-chip">{logicalChannelRoutes.length} M:N channel routes</span>
          <span className="petri-chip">{crossNetworkChannels.length} individual channel links</span>
        </div>
        <div className="network-live-toolbar-group">
          <label className="petri-toggle">
            <input type="checkbox" checked={showOffline} onChange={(event) => setShowOffline(event.target.checked)} />
            <span>Show offline</span>
          </label>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => void Promise.all([fetchServers(), fetchDevices()])}
          >
            <IconRefresh size={14} />
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => flowInstance?.fitView({ padding: 0.2, duration: 150 })}>
            Fit
          </button>
        </div>
      </div>

      <div className="network-live-body">
        <div className="network-live-canvas">
          <ReactFlow
            nodes={flowNodes}
            edges={graph.edges}
            nodeTypes={nodeTypes}
            onInit={setFlowInstance}
            onNodeClick={(_event, node) => setSelection({ kind: 'node', id: node.id })}
            onPaneClick={() => setSelection(null)}
            fitView
            nodesDraggable={false}
            nodesConnectable={false}
            proOptions={{ hideAttribution: true }}
          >
            <Controls showInteractive={false} />
            <MiniMap
              pannable
              zoomable
              nodeColor={(node) => nodeColor((node.data as CanvasNodeData).node.kind)}
              maskColor="rgba(3, 8, 18, 0.68)"
            />
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
          </ReactFlow>
        </div>

        <aside className="network-live-inspector">
          <div className="petri-inspector-header">
            <div>
              <h3>Network Inspector</h3>
              <p>Live gateway, server, and device placement.</p>
            </div>
          </div>

          {!selectedNode ? (
            <div className="petri-inspector-empty">Select a gateway, server, or device node.</div>
          ) : (
            <div className="petri-inspector-section">
              <div className="petri-inspector-title">
                <span>{selectedNode.label}</span>
                <span className="petri-chip">{selectedNode.kind}</span>
              </div>
              {selectedNode.subtitle && (
                <div className="petri-inspector-subtitle">{selectedNode.subtitle}</div>
              )}
              <div className="petri-inspector-grid">
                <div>
                  <span className="petri-kv-label">Status</span>
                  <span>{selectedNode.status}</span>
                </div>
                {Object.entries(selectedNode.metadata ?? {}).map(([key, value]) => (
                  <div key={key}>
                    <span className="petri-kv-label">{key}</span>
                    <span>{formatValue(value)}</span>
                  </div>
                ))}
              </div>
              {typeof selectedNode.metadata?.assignedAutomataId === 'string' && (
                <div className="petri-inspector-actions">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => openAutomata(String(selectedNode.metadata?.assignedAutomataId))}
                  >
                    <IconAutomata size={14} />
                    Open Automata
                  </button>
                </div>
              )}

              {selectedNode.metadata?.blackBoxParticipant === true && (
                <div className="petri-inspector-block">
                  <div className="petri-block-title">Black Box Boundary</div>
                  <div className="petri-inspector-subtitle">
                    This device is hosting an external/interface-only black box. The network can route signals to the
                    contract and observe public outputs, but it does not own or directly manage the internal logic.
                  </div>
                  <div className="petri-inspector-grid">
                    <div>
                      <span className="petri-kv-label">Ownership</span>
                      <span>external interface only</span>
                    </div>
                    <div>
                      <span className="petri-kv-label">Gateway Control</span>
                      <span>contract interaction only</span>
                    </div>
                    <div>
                      <span className="petri-kv-label">Ports</span>
                      <span>{formatValue(selectedNode.metadata?.blackBoxPortCount)}</span>
                    </div>
                    <div>
                      <span className="petri-kv-label">Resources</span>
                      <span>{formatValue(selectedNode.metadata?.blackBoxResourceCount)}</span>
                    </div>
                  </div>
                  <div className="petri-inspector-actions">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={openBlackBoxes}>
                      Open Black Boxes
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {logicalNetworks.length > 0 && (
            <div className="petri-inspector-section">
              <div className="petri-block-title">Logical Networks</div>
              <div className="petri-inspector-subtitle">
                The flagship workspace is organized as a network-of-networks. These groups describe where EFSMs are
                deployed and how many M:N channel routes each group exposes to the rest of the workspace.
              </div>
              <div className="petri-warning-list">
                {logicalNetworks.map((network) => (
                  <div key={network.id} className="petri-merge-item">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: 1 }}>
                      <strong>{network.name}</strong>
                      <span>
                        {network.automataCount} automata · {network.deploymentCount} deployments · {network.deviceCount}{' '}
                        devices · {network.serverCount} servers
                      </span>
                      <span>
                        {network.inputCount} inputs · {network.outputCount} outputs · {network.crossNetworkChannelCount}{' '}
                        M:N routes
                      </span>
                    </div>
                    <span className="petri-chip accent" style={network.color ? { borderColor: network.color, color: network.color } : undefined}>
                      logical network
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {logicalChannelRoutes.length > 0 && (
            <div className="petri-inspector-section">
              <div className="petri-block-title">Channel Routes</div>
              <div className="petri-inspector-subtitle">
                Named outputs and inputs are linked as M:N channels. These routes show how the flagship workspace binds
                one logical network to another through shared channel contracts.
              </div>
              <div className="petri-warning-list">
                {logicalChannelRoutes.map((route) => (
                  <div key={route.id} className="petri-merge-item" style={{ alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <strong>channel:{route.channelName}</strong>
                        <span className="petri-chip">{route.linkCount} links</span>
                        <span className="petri-chip">{route.sourceTypes.join(', ')} → {route.targetTypes.join(', ')}</span>
                      </div>
                      <span>
                        <span style={route.sourceNetworkColor ? { color: route.sourceNetworkColor } : undefined}>
                          {route.sourceNetworkName}
                        </span>
                        {' → '}
                        <span style={route.targetNetworkColor ? { color: route.targetNetworkColor } : undefined}>
                          {route.targetNetworkName}
                        </span>
                      </span>
                      <span>Sources: {route.sourceAutomataNames.join(', ')}</span>
                      <span>Targets: {route.targetAutomataNames.join(', ')}</span>
                    </div>
                    <div className="petri-inspector-actions" style={{ marginTop: 0 }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => openAutomata(route.sourceAutomataIds[0])}
                      >
                        <IconAutomata size={14} />
                        Open Source
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => openAutomata(route.targetAutomataIds[0])}
                      >
                        <IconAutomata size={14} />
                        Open Target
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {blackBoxParticipants.length > 0 && (
            <div className="petri-inspector-section">
              <div className="petri-block-title">Black Box Participants</div>
              <div className="petri-inspector-subtitle">
                Recognized external participants in the workspace network. Devices can talk to their contracts, but
                the gateway does not own their internals.
              </div>
              <div className="petri-warning-list">
                {blackBoxParticipants.map(({ automata, device, deployment }) => (
                  <div key={automata.id} className="petri-merge-item">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: 1 }}>
                      <button
                        type="button"
                        className="petri-inline-link"
                        onClick={() => openAutomata(automata.id)}
                        style={{ alignSelf: 'flex-start' }}
                      >
                        {automata.config.name}
                      </button>
                      <span>
                        {deployment && device
                          ? `Deployed on ${device.name}. Contract reachable through device protocol.`
                          : 'Editor-visible contract only. Not currently deployed to a device.'}
                      </span>
                    </div>
                    <span className="petri-chip accent">interface only</span>
                  </div>
                ))}
              </div>
              <div className="petri-inspector-actions">
                <button type="button" className="btn btn-secondary btn-sm" onClick={openBlackBoxes}>
                  Open Black Boxes
                </button>
              </div>
            </div>
          )}
        </aside>
      </div>

      <div className="petri-summary-strip">
        <div className="petri-summary-stat">
          <span className="petri-summary-label">Servers</span>
          <strong>{servers.length}</strong>
        </div>
        <div className="petri-summary-stat">
          <span className="petri-summary-label">Devices</span>
          <strong>{devices.length}</strong>
        </div>
        <div className="petri-summary-stat">
          <span className="petri-summary-label">Networks</span>
          <strong>{logicalNetworks.length}</strong>
        </div>
        <div className="petri-summary-stat">
          <span className="petri-summary-label">M:N Routes</span>
          <strong>{logicalChannelRoutes.length}</strong>
        </div>
        <div className="petri-summary-stat">
          <span className="petri-summary-label">Channel Links</span>
          <strong>{crossNetworkChannels.length}</strong>
        </div>
        <div className="petri-summary-stat">
          <span className="petri-summary-label">Deployments</span>
          <strong>{deploymentsMap.size}</strong>
        </div>
        <div className="petri-summary-stat">
          <span className="petri-summary-label">Black Boxes</span>
          <strong>{blackBoxParticipants.length}</strong>
        </div>
      </div>
    </div>
  );
};
