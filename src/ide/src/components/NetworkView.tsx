import { useCallback, useMemo, useState } from 'react';
import { 
  ReactFlow, 
  Background, 
  Controls, 
  MiniMap, 
  Handle, 
  Position,
  Node,
  Edge,
  NodeChange,
  NodeProps,
  BackgroundVariant,
  ReactFlowProvider
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { NetworkDevice } from './AutomataIDE';
import { Server, Database, Cpu, Wifi, WifiOff, Download } from 'lucide-react';
import { DeviceDetailsPanel } from './DeviceDetailsPanel';

type NetworkViewProps = {
  devices: NetworkDevice[];
  onFlashDevice: (deviceId: string, automataName: string) => void;
  onDeviceUpdate: (deviceId: string, updates: Partial<NetworkDevice>) => void;
  availableAutomata: string[];
};

const getDeviceIcon = (type: NetworkDevice['type']) => {
  switch (type) {
    case 'server': return Server;
    case 'database': return Database;
    case 'device': return Cpu;
    case 'connector': return Wifi;
    default: return Cpu;
  }
};

const getDeviceColor = (type: NetworkDevice['type'], status: NetworkDevice['status']) => {
  if (status === 'offline') return '#666';
  if (status === 'updating') return '#cca700';
  
  switch (type) {
    case 'server': return '#4a9eff';
    case 'database': return '#c586c0';
    case 'device': return '#16825d';
    case 'connector': return '#569cd6';
    default: return '#858585';
  }
};

const DeviceNode = ({ data, selected }: NodeProps<Node<NetworkDevice>>) => {
  const Icon = getDeviceIcon(data.type);
  const color = getDeviceColor(data.type, data.status);

  return (
    <div className={`relative w-[180px] rounded-lg p-3 transition-all ${
      selected 
        ? 'bg-[#2d2d30] ring-2 ring-[#4a9eff] shadow-lg shadow-[#4a9eff]/50' 
        : 'bg-[#252526] border-2'
    }`}
    style={{ borderColor: selected ? '#4a9eff' : color }}
    >
      <Handle type="target" position={Position.Top} className="opacity-0" />
      
      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <div
          className="p-2 rounded"
          style={{ backgroundColor: `${color}20` }}
        >
          <Icon className="size-6" style={{ color }} />
        </div>
        {data.status === 'online' ? (
          <Wifi className="size-4 text-[#16825d]" />
        ) : data.status === 'updating' ? (
          <Download className="size-4 text-[#cca700] animate-pulse" />
        ) : (
          <WifiOff className="size-4 text-[#858585]" />
        )}
      </div>

      {/* Device name */}
      <div className="text-white text-sm mb-1 font-medium">
        {data.name}
      </div>

      {/* Device info */}
      <div className="text-[#858585] text-xs space-y-0.5">
        <div>{data.ipAddress}</div>
        <div className="flex items-center gap-1">
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${
            data.status === 'online' ? 'bg-[#16825d]' :
            data.status === 'updating' ? 'bg-[#cca700]' : 'bg-[#858585]'
          }`} />
          <span className="capitalize">{data.status}</span>
        </div>
        {data.automata && (
          <div className="text-[#569cd6] truncate">
            {data.automata}
          </div>
        )}
      </div>

      {/* Metrics for online devices */}
      {data.status === 'online' && data.cpu !== undefined && (
        <div className="mt-2 pt-2 border-t border-[#3e3e42] space-y-1 text-[10px]">
          <div className="flex items-center justify-between text-[#858585]">
            <span>CPU</span>
            <span className="text-white">{data.cpu}%</span>
          </div>
          <div className="flex items-center justify-between text-[#858585]">
            <span>MEM</span>
            <span className="text-white">{data.memory}%</span>
          </div>
        </div>
      )}
      
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
    </div>
  );
};

const nodeTypes = {
  device: DeviceNode,
};

function NetworkViewContent({ devices, onFlashDevice, onDeviceUpdate, availableAutomata }: NetworkViewProps) {
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  const nodes = useMemo(() => devices.map(d => ({
    id: d.id,
    type: 'device',
    position: { x: d.x, y: d.y },
    data: d,
    selected: selectedDeviceId === d.id
  })), [devices, selectedDeviceId]);

  const edges = useMemo(() => {
    const connections: Edge[] = [];
    const connector = devices.find(d => d.type === 'connector');
    const server = devices.find(d => d.type === 'server');
    const database = devices.find(d => d.type === 'database');
    const deviceNodes = devices.filter(d => d.type === 'device');

    if (connector && server) {
      connections.push({ 
        id: `e-${connector.id}-${server.id}`, 
        source: connector.id, 
        target: server.id,
        animated: connector.status === 'online' && server.status === 'online',
        style: { stroke: '#4a9eff' }
      });
    }

    if (server && database) {
      connections.push({ 
        id: `e-${server.id}-${database.id}`, 
        source: server.id, 
        target: database.id,
        animated: server.status === 'online' && database.status === 'online',
        style: { stroke: '#c586c0' }
      });
    }

    if (server) {
      deviceNodes.forEach(device => {
        connections.push({ 
          id: `e-${server.id}-${device.id}`, 
          source: server.id, 
          target: device.id,
          animated: server.status === 'online' && device.status === 'online',
          style: { stroke: '#16825d' }
        });
      });
    }

    return connections;
  }, [devices]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    changes.forEach(change => {
      if (change.type === 'position' && change.position && change.dragging) {
        onDeviceUpdate(change.id, { x: change.position.x, y: change.position.y });
      }
      if (change.type === 'select') {
        if (change.selected) {
            setSelectedDeviceId(change.id);
        } else if (selectedDeviceId === change.id) {
            setSelectedDeviceId(null);
        }
      }
    });
  }, [onDeviceUpdate, selectedDeviceId]);

  const onPaneClick = useCallback(() => {
      setSelectedDeviceId(null);
  }, []);

  const selectedDeviceData = selectedDeviceId ? devices.find(d => d.id === selectedDeviceId) : null;

  return (
    <div className="h-full w-full bg-[#1e1e1e] flex">
      <div className="flex-1 relative">
        <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            nodeTypes={nodeTypes}
            onPaneClick={onPaneClick}
            fitView
            minZoom={0.1}
            maxZoom={4}
            snapToGrid={true}
            snapGrid={[15, 15]}
            panOnScroll={true}
            selectionOnDrag={true}
        >
            <Background color="#333" gap={20} variant={BackgroundVariant.Dots} size={1} />
            <Controls className="bg-[#252526] border-[#3e3e42] text-white fill-white" />
            <MiniMap 
                nodeColor={(n) => {
                    const d = n.data as NetworkDevice;
                    return getDeviceColor(d.type, d.status);
                }}
                maskColor="#1e1e1e"
                className="bg-[#252526] border border-[#3e3e42] !bottom-4 !right-4"
            />
        </ReactFlow>
        
        {/* Network stats overlay */}
        <div className="absolute top-4 left-4 bg-[#252526]/90 border border-[#3e3e42] rounded p-3 space-y-2 pointer-events-none">
          <div className="text-[#cccccc] text-sm mb-2">Network Status</div>
          <div className="space-y-1 text-xs">
            <div className="flex items-center justify-between gap-4">
              <span className="text-[#858585]">Total Devices</span>
              <span className="text-white">{devices.length}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-[#858585]">Online</span>
              <span className="text-[#16825d]">{devices.filter(d => d.status === 'online').length}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-[#858585]">Offline</span>
              <span className="text-[#f48771]">{devices.filter(d => d.status === 'offline').length}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-[#858585]">Updating</span>
              <span className="text-[#cca700]">{devices.filter(d => d.status === 'updating').length}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Device Details Panel */}
      {selectedDeviceData && (
        <DeviceDetailsPanel
          device={selectedDeviceData}
          availableAutomata={availableAutomata}
          onFlash={(automataName) => onFlashDevice(selectedDeviceData.id, automataName)}
          onClose={() => setSelectedDeviceId(null)}
        />
      )}
    </div>
  );
}

export function NetworkView(props: NetworkViewProps) {
    return (
        <ReactFlowProvider>
            <NetworkViewContent {...props} />
        </ReactFlowProvider>
    );
}
