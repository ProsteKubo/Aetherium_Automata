import { useRef, useState } from 'react';
import type { NetworkDevice } from './AutomataIDE';
import { Server, Database, Cpu, Wifi, WifiOff, Download, MoreVertical, Activity, HardDrive, Clock, Zap } from 'lucide-react';
import { DeviceDetailsPanel } from './DeviceDetailsPanel';

type NetworkViewProps = {
  devices: NetworkDevice[];
  onFlashDevice: (deviceId: string, automataName: string) => void;
  onDeviceUpdate: (deviceId: string, updates: Partial<NetworkDevice>) => void;
  availableAutomata: string[];
};

export function NetworkView({ devices, onFlashDevice, onDeviceUpdate, availableAutomata }: NetworkViewProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);

  const handleMouseDown = (e: React.MouseEvent, deviceId: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    
    const device = devices.find(d => d.id === deviceId);
    if (!device) return;

    setDragging(deviceId);
    setOffset({
      x: e.clientX - device.x * zoom - pan.x,
      y: e.clientY - device.y * zoom - pan.y
    });
    setSelectedDevice(deviceId);
  };

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0) {
      setSelectedDevice(null);
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (dragging) {
      const newX = (e.clientX - offset.x - pan.x) / zoom;
      const newY = (e.clientY - offset.y - pan.y) / zoom;
      onDeviceUpdate(dragging, { x: newX, y: newY });
    } else if (isPanning) {
      setPan({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y
      });
    }
  };

  const handleMouseUp = () => {
    setDragging(null);
    setIsPanning(false);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(prev => Math.max(0.1, Math.min(3, prev * delta)));
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

  const getConnections = () => {
    const connections: Array<{ from: NetworkDevice; to: NetworkDevice }> = [];
    const connector = devices.find(d => d.type === 'connector');
    const server = devices.find(d => d.type === 'server');
    const database = devices.find(d => d.type === 'database');
    const deviceNodes = devices.filter(d => d.type === 'device');

    if (connector && server) {
      connections.push({ from: connector, to: server });
    }

    if (server && database) {
      connections.push({ from: server, to: database });
    }

    if (server) {
      deviceNodes.forEach(device => {
        connections.push({ from: server, to: device });
      });
    }

    return connections;
  };

  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  };

  const selectedDeviceData = selectedDevice ? devices.find(d => d.id === selectedDevice) : null;

  return (
    <div className="relative h-full bg-[#1e1e1e] overflow-hidden flex">
      {/* Network Canvas */}
      <div className="flex-1 relative">
        {/* Grid background */}
        <div 
          className="absolute inset-0"
          style={{
            backgroundImage: `
              linear-gradient(to right, #2a2a2a 1px, transparent 1px),
              linear-gradient(to bottom, #2a2a2a 1px, transparent 1px)
            `,
            backgroundSize: `${20 * zoom}px ${20 * zoom}px`,
            backgroundPosition: `${pan.x}px ${pan.y}px`
          }}
        />

        {/* Canvas */}
        <div
          ref={canvasRef}
          className="relative h-full cursor-grab active:cursor-grabbing"
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onWheel={handleWheel}
        >
          {/* SVG for connections */}
          <svg
            ref={svgRef}
            className="absolute inset-0 pointer-events-none"
            style={{ width: '100%', height: '100%' }}
          >
            <defs>
              <marker
                id="network-arrow"
                markerWidth="8"
                markerHeight="8"
                refX="7"
                refY="4"
                orient="auto"
              >
                <polygon points="0 0, 8 4, 0 8" fill="#666" />
              </marker>
            </defs>
            
            {getConnections().map((conn, i) => {
              const dx = conn.to.x - conn.from.x;
              const dy = conn.to.y - conn.from.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              
              if (dist === 0) return null;
              
              const fromRadius = 50;
              const toRadius = 50;
              
              const startX = conn.from.x + (dx / dist) * fromRadius;
              const startY = conn.from.y + (dy / dist) * fromRadius;
              const endX = conn.to.x - (dx / dist) * toRadius;
              const endY = conn.to.y - (dy / dist) * toRadius;
              
              const isActive = conn.from.status === 'online' && conn.to.status === 'online';
              
              return (
                <g key={i} transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
                  <line
                    x1={startX}
                    y1={startY}
                    x2={endX}
                    y2={endY}
                    stroke={isActive ? "#4a9eff" : "#666"}
                    strokeWidth={isActive ? 2 : 1}
                    strokeDasharray={isActive ? "0" : "5,5"}
                    markerEnd="url(#network-arrow)"
                  />
                </g>
              );
            })}
          </svg>

          {/* Devices */}
          {devices.map(device => {
            const Icon = getDeviceIcon(device.type);
            const color = getDeviceColor(device.type, device.status);
            const isSelected = selectedDevice === device.id;
            
            return (
              <div
                key={device.id}
                className={`absolute cursor-move select-none transition-all ${
                  isSelected ? 'ring-2 ring-[#4a9eff] shadow-lg shadow-[#4a9eff]/50 z-10' : ''
                }`}
                style={{
                  left: `${device.x * zoom + pan.x}px`,
                  top: `${device.y * zoom + pan.y}px`,
                  transform: 'translate(-50%, -50%)',
                  width: `${120 * zoom}px`,
                }}
                onMouseDown={(e) => handleMouseDown(e, device.id)}
              >
                <div className="relative w-full">
                  {/* Device card */}
                  <div className={`rounded-lg p-3 ${
                    isSelected 
                      ? 'bg-[#2d2d30]' 
                      : 'bg-[#252526]'
                  } border-2 shadow-lg`}
                    style={{ borderColor: color }}
                  >
                    {/* Header */}
                    <div className="flex items-start justify-between mb-2">
                      <div
                        className="p-2 rounded"
                        style={{ backgroundColor: `${color}20` }}
                      >
                        <Icon className="size-6" style={{ color }} />
                      </div>
                      {device.status === 'online' ? (
                        <Wifi className="size-4 text-[#16825d]" />
                      ) : device.status === 'updating' ? (
                        <Download className="size-4 text-[#cca700] animate-pulse" />
                      ) : (
                        <WifiOff className="size-4 text-[#858585]" />
                      )}
                    </div>

                    {/* Device name */}
                    <div className="text-white text-sm mb-1" style={{ fontSize: `${12 * zoom}px` }}>
                      {device.name}
                    </div>

                    {/* Device info */}
                    <div className="text-[#858585] text-xs space-y-0.5" style={{ fontSize: `${10 * zoom}px` }}>
                      <div>{device.ipAddress}</div>
                      <div className="flex items-center gap-1">
                        <span className={`inline-block w-1.5 h-1.5 rounded-full ${
                          device.status === 'online' ? 'bg-[#16825d]' :
                          device.status === 'updating' ? 'bg-[#cca700]' : 'bg-[#858585]'
                        }`} />
                        <span className="capitalize">{device.status}</span>
                      </div>
                      {device.automata && (
                        <div className="text-[#569cd6] truncate">
                          {device.automata}
                        </div>
                      )}
                    </div>

                    {/* Metrics for online devices */}
                    {device.status === 'online' && device.cpu !== undefined && (
                      <div className="mt-2 pt-2 border-t border-[#3e3e42] space-y-1" style={{ fontSize: `${9 * zoom}px` }}>
                        <div className="flex items-center justify-between text-[#858585]">
                          <span>CPU</span>
                          <span className="text-white">{device.cpu}%</span>
                        </div>
                        <div className="flex items-center justify-between text-[#858585]">
                          <span>MEM</span>
                          <span className="text-white">{device.memory}%</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Zoom controls */}
        <div className="absolute bottom-4 right-4 bg-[#252526] border border-[#3e3e42] rounded p-2 flex flex-col gap-2">
          <button
            className="px-3 py-1 text-white hover:bg-[#3e3e42] rounded"
            onClick={() => setZoom(prev => Math.min(3, prev * 1.2))}
          >
            +
          </button>
          <div className="text-center text-[#cccccc] text-xs">
            {Math.round(zoom * 100)}%
          </div>
          <button
            className="px-3 py-1 text-white hover:bg-[#3e3e42] rounded"
            onClick={() => setZoom(prev => Math.max(0.1, prev / 1.2))}
          >
            -
          </button>
          <button
            className="px-3 py-1 text-white hover:bg-[#3e3e42] rounded text-xs"
            onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
          >
            Reset
          </button>
        </div>

        {/* Network stats */}
        <div className="absolute top-4 left-4 bg-[#252526]/90 border border-[#3e3e42] rounded p-3 space-y-2">
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
          onClose={() => setSelectedDevice(null)}
        />
      )}
    </div>
  );
}
