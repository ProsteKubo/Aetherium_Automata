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
import { useAutomataStore, useGatewayStore, useRuntimeViewStore, useUIStore } from '../../stores';
import type { RuntimeDeployment } from '../../types';
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

const HIDDEN_HANDLE_STYLE = {
  width: 10,
  height: 10,
  opacity: 0,
  border: 'none',
  background: 'transparent',
};

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
  const setActiveAutomata = useAutomataStore((state) => state.setActiveAutomata);
  const openTab = useUIStore((state) => state.openTab);
  const layout = useUIStore((state) => state.layout);
  const togglePanel = useUIStore((state) => state.togglePanel);

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

  const graph = useMemo(() => {
    const nodes: NetworkCanvasNode[] = [
      {
        id: 'gateway_root',
        kind: 'gateway',
        label: 'Gateway',
        subtitle: `${servers.length} servers`,
        status: gatewayStatus,
        position: { x: 80, y: 220 },
      },
    ];
    const edges: Edge[] = [];

    servers.forEach((server, serverIndex) => {
      const serverY = 90 + serverIndex * 200;
      const serverNodeId = `server:${server.id}`;
      const serverDevices = devices.filter((device) => device.serverId === server.id);

      nodes.push({
        id: serverNodeId,
        kind: 'server',
        label: server.name,
        subtitle: `${serverDevices.length} devices`,
        status: server.status,
        position: { x: 340, y: serverY },
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
        const deviceNodeId = `device:${device.id}`;

        nodes.push({
          id: deviceNodeId,
          kind: 'device',
          label: device.name,
          subtitle:
            assignedBlackBox
              ? `Black box · ${automataName ?? 'interface only'}`
              : automataName ??
            device.connectorType ??
            device.transport ??
            device.address,
          status: device.status,
          position: { x: 650, y: serverY + deviceIndex * 108 - Math.max(0, serverDevices.length - 1) * 42 },
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
  }, [automataMap, deploymentsByDevice, devices, gatewayStatus, servers]);

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
