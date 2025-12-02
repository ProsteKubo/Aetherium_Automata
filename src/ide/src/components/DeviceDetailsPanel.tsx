import { useState } from 'react';
import type { NetworkDevice } from './AutomataIDE';
import { X, Download, RefreshCw, Power, Activity, HardDrive, Clock, Cpu, Wifi, Terminal, Settings } from 'lucide-react';

type DeviceDetailsPanelProps = {
  device: NetworkDevice;
  availableAutomata: string[];
  onFlash: (automataName: string) => void;
  onClose: () => void;
};

export function DeviceDetailsPanel({ device, availableAutomata, onFlash, onClose }: DeviceDetailsPanelProps) {
  const [selectedAutomata, setSelectedAutomata] = useState(device.automata || availableAutomata[0] || '');
  const [activeTab, setActiveTab] = useState<'details' | 'logs' | 'config'>('details');

  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    
    if (days > 0) return `${days}d ${hours}h ${mins}m`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  };

  const formatLastSeen = (date: Date) => {
    const now = Date.now();
    const diff = now - date.getTime();
    
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  };

  const getStatusColor = (status: NetworkDevice['status']) => {
    switch (status) {
      case 'online': return 'text-[#16825d]';
      case 'offline': return 'text-[#f48771]';
      case 'updating': return 'text-[#cca700]';
      default: return 'text-[#858585]';
    }
  };

  const getTypeLabel = (type: NetworkDevice['type']) => {
    switch (type) {
      case 'device': return 'IoT Device';
      case 'server': return 'Core Server';
      case 'database': return 'Database';
      case 'connector': return 'Connector';
      default: return type;
    }
  };

  return (
    <div className="w-96 bg-[#252526] border-l border-[#3e3e42] flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[#3e3e42] flex items-center justify-between">
        <div>
          <div className="text-white text-sm">{device.name}</div>
          <div className="text-[#858585] text-xs">{getTypeLabel(device.type)}</div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 text-[#cccccc] hover:bg-[#3e3e42] rounded transition-colors"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[#3e3e42]">
        <button
          className={`flex-1 px-4 py-2 text-sm flex items-center justify-center gap-2 ${
            activeTab === 'details'
              ? 'bg-[#1e1e1e] text-white border-b-2 border-[#0e639c]'
              : 'text-[#cccccc] hover:bg-[#2a2d2e]'
          }`}
          onClick={() => setActiveTab('details')}
        >
          <Activity className="size-4" />
          Details
        </button>
        <button
          className={`flex-1 px-4 py-2 text-sm flex items-center justify-center gap-2 ${
            activeTab === 'logs'
              ? 'bg-[#1e1e1e] text-white border-b-2 border-[#0e639c]'
              : 'text-[#cccccc] hover:bg-[#2a2d2e]'
          }`}
          onClick={() => setActiveTab('logs')}
        >
          <Terminal className="size-4" />
          Logs
        </button>
        <button
          className={`flex-1 px-4 py-2 text-sm flex items-center justify-center gap-2 ${
            activeTab === 'config'
              ? 'bg-[#1e1e1e] text-white border-b-2 border-[#0e639c]'
              : 'text-[#cccccc] hover:bg-[#2a2d2e]'
          }`}
          onClick={() => setActiveTab('config')}
        >
          <Settings className="size-4" />
          Config
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'details' && (
          <div className="space-y-4">
            {/* Status */}
            <div>
              <label className="block text-[#858585] text-xs mb-2">Status</label>
              <div className={`flex items-center gap-2 ${getStatusColor(device.status)}`}>
                <span className={`inline-block w-2 h-2 rounded-full ${
                  device.status === 'online' ? 'bg-[#16825d]' :
                  device.status === 'updating' ? 'bg-[#cca700]' : 'bg-[#f48771]'
                }`} />
                <span className="capitalize text-sm">{device.status}</span>
              </div>
            </div>

            {/* Network Info */}
            <div>
              <label className="block text-[#858585] text-xs mb-2">Network</label>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2 text-[#cccccc]">
                  <Wifi className="size-4 text-[#569cd6]" />
                  <span>{device.ipAddress}</span>
                </div>
                <div className="text-[#858585] text-xs">
                  Last seen: {formatLastSeen(device.lastSeen)}
                </div>
              </div>
            </div>

            {/* Version */}
            <div>
              <label className="block text-[#858585] text-xs mb-2">Version</label>
              <div className="text-white text-sm">{device.version}</div>
            </div>

            {/* Metrics */}
            {device.status === 'online' && (
              <div>
                <label className="block text-[#858585] text-xs mb-2">System Metrics</label>
                <div className="space-y-3">
                  <div>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <div className="flex items-center gap-2 text-[#cccccc]">
                        <Cpu className="size-3" />
                        <span>CPU Usage</span>
                      </div>
                      <span className="text-white">{device.cpu}%</span>
                    </div>
                    <div className="h-2 bg-[#3c3c3c] rounded overflow-hidden">
                      <div 
                        className="h-full bg-[#0e639c] transition-all"
                        style={{ width: `${device.cpu}%` }}
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <div className="flex items-center gap-2 text-[#cccccc]">
                        <HardDrive className="size-3" />
                        <span>Memory Usage</span>
                      </div>
                      <span className="text-white">{device.memory}%</span>
                    </div>
                    <div className="h-2 bg-[#3c3c3c] rounded overflow-hidden">
                      <div 
                        className="h-full bg-[#c586c0] transition-all"
                        style={{ width: `${device.memory}%` }}
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-[#cccccc]">
                    <Clock className="size-3" />
                    <span>Uptime: {formatUptime(device.uptime || 0)}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Current Automata */}
            {device.automata && (
              <div>
                <label className="block text-[#858585] text-xs mb-2">Current Automata</label>
                <div className="px-3 py-2 bg-[#3c3c3c] text-white border border-[#3e3e42] rounded text-sm">
                  {device.automata}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'logs' && (
          <div className="space-y-2">
            <div className="text-xs text-[#858585] font-mono">
              <div className="py-1">[12:34:56] Device started</div>
              <div className="py-1">[12:35:01] Automata loaded: {device.automata || 'None'}</div>
              <div className="py-1">[12:35:02] State transition: Idle → Active</div>
              <div className="py-1">[12:35:15] Processing input: trigger</div>
              <div className="py-1">[12:35:16] Output emitted: status = "active"</div>
              <div className="py-1 text-[#16825d]">[12:35:20] System healthy</div>
            </div>
          </div>
        )}

        {activeTab === 'config' && (
          <div className="space-y-4">
            <div>
              <label className="block text-[#858585] text-xs mb-2">Device ID</label>
              <div className="px-3 py-2 bg-[#3c3c3c] text-white border border-[#3e3e42] rounded text-sm font-mono">
                {device.id}
              </div>
            </div>
            <div>
              <label className="block text-[#858585] text-xs mb-2">Transport</label>
              <select className="w-full px-3 py-2 bg-[#3c3c3c] text-white border border-[#3e3e42] rounded text-sm">
                <option>WebSocket (JSON)</option>
                <option>MQTT</option>
                <option>UDP (CBOR)</option>
                <option>Serial</option>
              </select>
            </div>
            <div>
              <label className="block text-[#858585] text-xs mb-2">Telemetry Interval</label>
              <input
                type="number"
                defaultValue={1000}
                className="w-full px-3 py-2 bg-[#3c3c3c] text-white border border-[#3e3e42] rounded text-sm"
              />
              <div className="text-[#858585] text-xs mt-1">milliseconds</div>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      {device.type === 'device' && (
        <div className="p-4 border-t border-[#3e3e42] space-y-3">
          <div>
            <label className="block text-[#858585] text-xs mb-2">Flash Automata</label>
            <select
              value={selectedAutomata}
              onChange={(e) => setSelectedAutomata(e.target.value)}
              className="w-full px-3 py-2 bg-[#3c3c3c] text-white border border-[#3e3e42] rounded text-sm mb-2"
              disabled={device.status === 'offline'}
            >
              {availableAutomata.map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
            <button
              onClick={() => onFlash(selectedAutomata)}
              disabled={device.status === 'offline' || device.status === 'updating'}
              className="w-full px-3 py-2 bg-[#0e639c] hover:bg-[#1177bb] disabled:bg-[#3c3c3c] disabled:text-[#858585] text-white text-sm rounded flex items-center justify-center gap-2 transition-colors"
            >
              <Download className="size-4" />
              Flash Device
            </button>
          </div>

          <div className="flex gap-2">
            <button
              disabled={device.status === 'offline'}
              className="flex-1 px-3 py-2 bg-[#3c3c3c] hover:bg-[#4a4a4a] disabled:bg-[#2a2a2a] disabled:text-[#858585] text-white text-sm rounded flex items-center justify-center gap-2 transition-colors"
            >
              <RefreshCw className="size-4" />
              Restart
            </button>
            <button
              disabled={device.status === 'offline'}
              className="flex-1 px-3 py-2 bg-[#3c3c3c] hover:bg-[#4a4a4a] disabled:bg-[#2a2a2a] disabled:text-[#858585] text-white text-sm rounded flex items-center justify-center gap-2 transition-colors"
            >
              <Power className="size-4" />
              Shutdown
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
