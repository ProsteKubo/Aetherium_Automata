/**
 * Aetherium Automata - Network Topology Panel
 * 
 * Futuristic command center style network visualization showing
 * device relationships, data flows, network health, device management,
 * logs, metrics, and server assignment capabilities.
 */

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useGatewayStore, useUIStore } from '../../stores';
import {
  IconNetwork,
  IconRefresh,
  IconZoomIn,
  IconZoomOut,
  IconFitView,
  IconDevice,
  IconServer,
  IconUpload,
  IconTerminal,
  IconSettings,
  IconX,
  IconCheck,
  IconWarning,
  IconInfo,
  IconClear,
} from '../common/Icons';

// Types for network visualization
interface NetworkNode {
  id: string;
  type: 'server' | 'device' | 'gateway';
  name: string;
  status: 'online' | 'offline' | 'warning' | 'error' | 'updating';
  x: number;
  y: number;
  connections: string[];
  serverId?: string;
  metrics?: {
    latency?: number;
    throughput?: number;
    health?: number;
    cpu?: number;
    memory?: number;
    uptime?: number;
  };
}

interface NetworkConnection {
  id: string;
  source: string;
  target: string;
  status: 'active' | 'idle' | 'error';
  dataFlow?: 'bidirectional' | 'upstream' | 'downstream';
  strength: number;
}

interface DataParticle {
  id: string;
  connectionId: string;
  progress: number;
  speed: number;
  direction: 1 | -1;
}

interface DeviceLog {
  id: string;
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  source?: string;
}

interface DeviceMetricPoint {
  timestamp: number;
  value: number;
}

// Mock log generator for demo
const generateMockLogs = (deviceId: string): DeviceLog[] => {
  const levels: DeviceLog['level'][] = ['info', 'warn', 'error', 'debug'];
  const messages = [
    'State transition: IDLE -> ACTIVE',
    'Sensor reading: temperature=23.5°C',
    'Network heartbeat sent',
    'Automata execution cycle completed',
    'Input received on port GPIO_4',
    'Output triggered on port GPIO_12',
    'Memory usage: 45% of 512KB',
    'Connection to server stable',
    'Watchdog timer reset',
    'Power consumption: 120mA',
  ];
  
  return Array.from({ length: 20 }, (_, i) => ({
    id: `${deviceId}-log-${i}`,
    timestamp: Date.now() - (20 - i) * 5000,
    level: levels[Math.floor(Math.random() * levels.length)],
    message: messages[Math.floor(Math.random() * messages.length)],
    source: Math.random() > 0.5 ? 'automata-engine' : 'system',
  }));
};

// Mock metrics generator
const generateMockMetrics = (): DeviceMetricPoint[] => {
  return Array.from({ length: 30 }, (_, i) => ({
    timestamp: Date.now() - (30 - i) * 2000,
    value: 30 + Math.random() * 50 + Math.sin(i / 5) * 15,
  }));
};

export const NetworkPanel: React.FC = () => {
  // View state
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [lastMousePos, setLastMousePos] = useState({ x: 0, y: 0 });
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set());
  const [particles, setParticles] = useState<DataParticle[]>([]);
  const [scanAngle, setScanAngle] = useState(0);
  
  // Detail panel state
  const [showDetailPanel, setShowDetailPanel] = useState(false);
  const [detailTab, setDetailTab] = useState<'info' | 'logs' | 'metrics'>('info');
  const [deviceLogs, setDeviceLogs] = useState<DeviceLog[]>([]);
  const [cpuMetrics, setCpuMetrics] = useState<DeviceMetricPoint[]>([]);
  const [memoryMetrics, setMemoryMetrics] = useState<DeviceMetricPoint[]>([]);
  const [logFilter, setLogFilter] = useState<string>('');
  const [logLevelFilter, setLogLevelFilter] = useState<Set<DeviceLog['level']>>(
    new Set(['info', 'warn', 'error', 'debug'])
  );
  
  // Dialog state
  const [showReassignDialog, setShowReassignDialog] = useState(false);
  const [showFlashDialog, setShowFlashDialog] = useState(false);
  const [flashProgress, setFlashProgress] = useState(0);
  const [isFlashing, setIsFlashing] = useState(false);
  
  // Store data
  const serversMap = useGatewayStore((state) => state.servers);
  const devicesMap = useGatewayStore((state) => state.devices);
  const isConnected = useGatewayStore((state) => state.status === 'connected');
  const fetchDevices = useGatewayStore((state) => state.fetchDevices);
  const fetchServers = useGatewayStore((state) => state.fetchServers);
  const addNotification = useUIStore((state) => state.addNotification);
  
  // Memoize array conversions
  const servers = useMemo(() => Array.from(serversMap.values()), [serversMap]);
  const devices = useMemo(() => Array.from(devicesMap.values()), [devicesMap]);
  
  // Build network topology
  const { nodes, connections } = useMemo(() => {
    const nodes: NetworkNode[] = [];
    const connections: NetworkConnection[] = [];
    
    // Add gateway node at center
    nodes.push({
      id: 'gateway',
      type: 'gateway',
      name: 'Gateway Hub',
      status: isConnected ? 'online' : 'offline',
      x: 400,
      y: 300,
      connections: servers.map(s => s.id),
      metrics: {
        cpu: 25 + Math.random() * 20,
        memory: 40 + Math.random() * 30,
        uptime: 86400 * 7,
      },
    });
    
    // Add servers in a circle around gateway
    const serverRadius = 150;
    servers.forEach((server, i) => {
      const angle = (i / Math.max(servers.length, 1)) * 2 * Math.PI - Math.PI / 2;
      const x = 400 + Math.cos(angle) * serverRadius;
      const y = 300 + Math.sin(angle) * serverRadius;
      
      nodes.push({
        id: server.id,
        type: 'server',
        name: server.name,
        status: server.status === 'connected' ? 'online' : 
               server.status === 'error' ? 'error' : 'offline',
        x,
        y,
        connections: devices.filter(d => d.serverId === server.id).map(d => d.id),
        metrics: {
          health: 85 + Math.random() * 15,
          latency: server.latency || 10 + Math.random() * 50,
          cpu: 20 + Math.random() * 40,
          memory: 30 + Math.random() * 40,
        },
      });
      
      connections.push({
        id: `gateway-${server.id}`,
        source: 'gateway',
        target: server.id,
        status: server.status === 'connected' ? 'active' : 'idle',
        dataFlow: 'bidirectional',
        strength: 80 + Math.random() * 20,
      });
    });
    
    // Add devices around their servers
    const deviceRadius = 100;
    servers.forEach((server) => {
      const serverNode = nodes.find(n => n.id === server.id);
      if (!serverNode) return;
      
      const serverDevices = devices.filter(d => d.serverId === server.id);
      serverDevices.forEach((device, i) => {
        const angle = (i / Math.max(serverDevices.length, 1)) * 2 * Math.PI;
        const x = serverNode.x + Math.cos(angle) * deviceRadius;
        const y = serverNode.y + Math.sin(angle) * deviceRadius;
        
        nodes.push({
          id: device.id,
          type: 'device',
          name: device.name,
          status: device.status === 'online' ? 'online' :
                 device.status === 'error' ? 'error' :
                 device.status === 'updating' ? 'updating' : 'offline',
          x,
          y,
          connections: [],
          serverId: server.id,
          metrics: {
            health: 70 + Math.random() * 30,
            latency: 5 + Math.random() * 30,
            throughput: Math.random() * 100,
            cpu: 10 + Math.random() * 60,
            memory: 20 + Math.random() * 50,
            uptime: Math.random() * 86400 * 30,
          },
        });
        
        connections.push({
          id: `${server.id}-${device.id}`,
          source: server.id,
          target: device.id,
          status: device.status === 'online' ? 'active' : 'idle',
          dataFlow: 'downstream',
          strength: 60 + Math.random() * 40,
        });
      });
    });
    
    return { nodes, connections };
  }, [servers, devices, isConnected]);
  
  // Get selected node data
  const selectedNodeData = useMemo(() => {
    if (!selectedNode) return null;
    return nodes.find(n => n.id === selectedNode) || null;
  }, [selectedNode, nodes]);
  
  // Load node data when selected
  useEffect(() => {
    if (selectedNode && selectedNodeData) {
      // Always show the detail panel when a node is selected
      setShowDetailPanel(true);
      setDetailTab('info'); // Reset to info tab
      
      // Load device-specific data
      if (selectedNodeData.type === 'device') {
        setDeviceLogs(generateMockLogs(selectedNode));
        setCpuMetrics(generateMockMetrics());
        setMemoryMetrics(generateMockMetrics());
      }
    }
  }, [selectedNode, selectedNodeData]);
  
  // Animate radar scan
  useEffect(() => {
    const interval = setInterval(() => {
      setScanAngle(prev => (prev + 2) % 360);
    }, 50);
    return () => clearInterval(interval);
  }, []);
  
  // Animate data particles
  useEffect(() => {
    if (connections.length === 0) return;
    
    const createParticle = setInterval(() => {
      const activeConnections = connections.filter(c => c.status === 'active');
      if (activeConnections.length === 0) return;
      
      const conn = activeConnections[Math.floor(Math.random() * activeConnections.length)];
      const newParticle: DataParticle = {
        id: `${conn.id}-${Date.now()}-${Math.random()}`,
        connectionId: conn.id,
        progress: 0,
        speed: 0.01 + Math.random() * 0.02,
        direction: Math.random() > 0.5 ? 1 : -1,
      };
      
      setParticles(prev => [...prev.slice(-20), newParticle]);
    }, 200);
    
    const animateParticles = setInterval(() => {
      setParticles(prev => 
        prev
          .map(p => ({ ...p, progress: p.progress + p.speed * p.direction }))
          .filter(p => p.progress >= 0 && p.progress <= 1)
      );
    }, 16);
    
    return () => {
      clearInterval(createParticle);
      clearInterval(animateParticles);
    };
  }, [connections]);
  
  // Simulate live log updates
  useEffect(() => {
    if (!selectedNode || selectedNodeData?.type !== 'device') return;
    
    const interval = setInterval(() => {
      const newLog: DeviceLog = {
        id: `${selectedNode}-log-${Date.now()}`,
        timestamp: Date.now(),
        level: ['info', 'debug', 'info', 'warn'][Math.floor(Math.random() * 4)] as DeviceLog['level'],
        message: [
          'Heartbeat ping: OK',
          'Sensor poll completed',
          'State machine tick',
          'Memory GC cycle',
          'Network buffer flushed',
        ][Math.floor(Math.random() * 5)],
        source: 'automata-engine',
      };
      setDeviceLogs(prev => [...prev.slice(-50), newLog]);
    }, 3000);
    
    return () => clearInterval(interval);
  }, [selectedNode, selectedNodeData?.type]);
  
  // Zoom handlers
  const handleZoomIn = () => setZoom(prev => Math.min(prev * 1.2, 3));
  const handleZoomOut = () => setZoom(prev => Math.max(prev / 1.2, 0.3));
  const handleFitView = () => {
    setZoom(1);
    setPanOffset({ x: 0, y: 0 });
  };
  
  // Pan handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && e.ctrlKey)) {
      setIsPanning(true);
      setLastMousePos({ x: e.clientX, y: e.clientY });
    }
  }, []);
  
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanning) {
      const dx = e.clientX - lastMousePos.x;
      const dy = e.clientY - lastMousePos.y;
      setPanOffset(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      setLastMousePos({ x: e.clientX, y: e.clientY });
    }
  }, [isPanning, lastMousePos]);
  
  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);
  
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    if (e.deltaY < 0) handleZoomIn();
    else handleZoomOut();
  }, []);
  
  const handleRefresh = async () => {
    await Promise.all([fetchServers(), fetchDevices()]);
    addNotification('info', 'Network Scan', 'Network topology refreshed');
  };
  
  // Node selection
  const handleNodeClick = (nodeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (e.shiftKey) {
      setSelectedNodes(prev => {
        const next = new Set(prev);
        if (next.has(nodeId)) next.delete(nodeId);
        else next.add(nodeId);
        return next;
      });
    } else {
      setSelectedNode(nodeId === selectedNode ? null : nodeId);
      setSelectedNodes(new Set());
    }
  };
  
  // Device actions
  const handleRebootDevice = async (deviceId: string) => {
    addNotification('info', 'Device Reboot', `Initiating reboot for device ${deviceId}...`);
    setTimeout(() => {
      addNotification('success', 'Device Reboot', `Device ${deviceId} is rebooting`);
    }, 1000);
  };
  
  const handleFlashDevice = async () => {
    if (!selectedNode) return;
    setIsFlashing(true);
    setFlashProgress(0);
    
    const interval = setInterval(() => {
      setFlashProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval);
          setIsFlashing(false);
          setShowFlashDialog(false);
          addNotification('success', 'OTA Update', `Device ${selectedNode} updated successfully`);
          return 100;
        }
        return prev + Math.random() * 15;
      });
    }, 500);
  };
  
  const handleReassignDevice = (targetServerId: string) => {
    if (!selectedNode) return;
    addNotification('info', 'Device Reassignment', 
      `Moving device ${selectedNode} to server ${targetServerId}`);
    setShowReassignDialog(false);
  };
  
  const handleBatchReboot = () => {
    if (selectedNodes.size === 0) return;
    addNotification('info', 'Batch Reboot', 
      `Initiating reboot for ${selectedNodes.size} devices...`);
  };
  
  const handleBatchFlash = () => {
    if (selectedNodes.size === 0) return;
    addNotification('info', 'Batch Update', 
      `Initiating OTA update for ${selectedNodes.size} devices...`);
  };
  
  // Helper functions
  const getConnectionPath = (conn: NetworkConnection) => {
    const sourceNode = nodes.find(n => n.id === conn.source);
    const targetNode = nodes.find(n => n.id === conn.target);
    if (!sourceNode || !targetNode) return null;
    return { x1: sourceNode.x, y1: sourceNode.y, x2: targetNode.x, y2: targetNode.y };
  };
  
  const getParticlePosition = (particle: DataParticle) => {
    const conn = connections.find(c => c.id === particle.connectionId);
    if (!conn) return null;
    const path = getConnectionPath(conn);
    if (!path) return null;
    return {
      x: path.x1 + (path.x2 - path.x1) * particle.progress,
      y: path.y1 + (path.y2 - path.y1) * particle.progress,
    };
  };
  
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online':
      case 'active':
        return 'var(--color-success)';
      case 'warning':
      case 'updating':
        return 'var(--color-warning)';
      case 'error':
        return 'var(--color-error)';
      default:
        return 'var(--color-text-tertiary)';
    }
  };
  
  const getNodeSize = (type: string) => {
    switch (type) {
      case 'gateway': return 40;
      case 'server': return 30;
      case 'device': return 20;
      default: return 20;
    }
  };
  
  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  };
  
  const formatTimestamp = (ts: number) => {
    const date = new Date(ts);
    return date.toLocaleTimeString('en-US', { 
      hour12: false, 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit' 
    });
  };
  
  const filteredLogs = useMemo(() => {
    return deviceLogs.filter(log => {
      if (!logLevelFilter.has(log.level)) return false;
      if (logFilter && !log.message.toLowerCase().includes(logFilter.toLowerCase())) return false;
      return true;
    });
  }, [deviceLogs, logFilter, logLevelFilter]);
  
  const toggleLogLevel = (level: DeviceLog['level']) => {
    setLogLevelFilter(prev => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  };
  
  // Render mini sparkline chart
  const renderSparkline = (data: DeviceMetricPoint[], color: string, gradientId: string) => {
    if (data.length < 2) return null;
    const maxVal = Math.max(...data.map(d => d.value));
    const minVal = Math.min(...data.map(d => d.value));
    const range = maxVal - minVal || 1;
    const width = 150;
    const height = 40;
    
    const points = data.map((d, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((d.value - minVal) / range) * height;
      return `${x},${y}`;
    }).join(' ');
    
    return (
      <svg width={width} height={height} className="sparkline">
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon
          points={`0,${height} ${points} ${width},${height}`}
          fill={`url(#${gradientId})`}
        />
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  };

  return (
    <div className="network-panel">
      {/* Panel Header */}
      <div className="panel-header network-header">
        <IconNetwork size={16} />
        <span>Network Topology</span>
        
        {/* Batch actions when multiple selected */}
        {selectedNodes.size > 0 && (
          <div className="batch-actions">
            <span className="batch-count">{selectedNodes.size} selected</span>
            <button className="btn btn-ghost btn-sm" onClick={handleBatchReboot}>
              <IconRefresh size={12} /> Reboot All
            </button>
            <button className="btn btn-ghost btn-sm" onClick={handleBatchFlash}>
              <IconUpload size={12} /> Flash All
            </button>
            <button 
              className="btn btn-ghost btn-sm" 
              onClick={() => setSelectedNodes(new Set())}
            >
              <IconX size={12} />
            </button>
          </div>
        )}
        
        <div className="network-header-actions">
          <button className="btn btn-ghost btn-icon" onClick={handleZoomOut} title="Zoom Out">
            <IconZoomOut size={14} />
          </button>
          <span className="zoom-level">{Math.round(zoom * 100)}%</span>
          <button className="btn btn-ghost btn-icon" onClick={handleZoomIn} title="Zoom In">
            <IconZoomIn size={14} />
          </button>
          <button className="btn btn-ghost btn-icon" onClick={handleFitView} title="Fit View">
            <IconFitView size={14} />
          </button>
          <button className="btn btn-ghost btn-icon" onClick={handleRefresh} title="Refresh">
            <IconRefresh size={14} />
          </button>
        </div>
      </div>
      
      <div className="network-content">
        {/* Network Visualization Canvas */}
        <div 
          className={`network-canvas ${showDetailPanel ? 'with-panel' : ''}`}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
          onClick={() => {
            setSelectedNode(null);
            setShowDetailPanel(false);
          }}
        >
          <svg 
            width="100%" 
            height="100%" 
            viewBox="0 0 800 600"
            style={{
              transform: `scale(${zoom}) translate(${panOffset.x / zoom}px, ${panOffset.y / zoom}px)`,
              transformOrigin: 'center center',
            }}
          >
            {/* Definitions */}
            <defs>
              <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
                <feMerge>
                  <feMergeNode in="coloredBlur"/>
                  <feMergeNode in="SourceGraphic"/>
                </feMerge>
              </filter>
              
              <filter id="glow-strong" x="-100%" y="-100%" width="300%" height="300%">
                <feGaussianBlur stdDeviation="6" result="coloredBlur"/>
                <feMerge>
                  <feMergeNode in="coloredBlur"/>
                  <feMergeNode in="coloredBlur"/>
                  <feMergeNode in="SourceGraphic"/>
                </feMerge>
              </filter>
              
              <linearGradient id="radarGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0"/>
                <stop offset="50%" stopColor="var(--color-primary)" stopOpacity="0.3"/>
                <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0"/>
              </linearGradient>
              
              <pattern id="hexGrid" width="56" height="100" patternUnits="userSpaceOnUse" patternTransform="scale(0.5)">
                <path 
                  d="M28 0 L56 17 L56 52 L28 69 L0 52 L0 17 Z M28 69 L56 86 L56 121 L28 138 L0 121 L0 86 Z M0 52 L0 86 M56 52 L56 86"
                  fill="none"
                  stroke="var(--color-primary)"
                  strokeWidth="0.5"
                  opacity="0.15"
                />
              </pattern>
            </defs>
            
            {/* Background */}
            <rect width="100%" height="100%" fill="url(#hexGrid)" />
            
            {/* Radar scan */}
            <g transform="translate(400, 300)">
              <circle r="250" fill="none" stroke="var(--color-primary)" strokeWidth="1" opacity="0.2" strokeDasharray="5,5" />
              <circle r="175" fill="none" stroke="var(--color-primary)" strokeWidth="1" opacity="0.15" strokeDasharray="5,5" />
              <circle r="100" fill="none" stroke="var(--color-primary)" strokeWidth="1" opacity="0.1" strokeDasharray="5,5" />
              <line x1="0" y1="0" x2="250" y2="0" stroke="url(#radarGradient)" strokeWidth="2" transform={`rotate(${scanAngle})`} opacity="0.6" />
              <path
                d={`M 0 0 L ${250 * Math.cos((scanAngle - 30) * Math.PI / 180)} ${250 * Math.sin((scanAngle - 30) * Math.PI / 180)} A 250 250 0 0 1 ${250 * Math.cos(scanAngle * Math.PI / 180)} ${250 * Math.sin(scanAngle * Math.PI / 180)} Z`}
                fill="var(--color-primary)"
                opacity="0.05"
              />
            </g>
            
            {/* Connections */}
            {connections.map((conn) => {
              const path = getConnectionPath(conn);
              if (!path) return null;
              return (
                <g key={conn.id}>
                  <line
                    x1={path.x1} y1={path.y1} x2={path.x2} y2={path.y2}
                    stroke={getStatusColor(conn.status)}
                    strokeWidth={conn.status === 'active' ? 2 : 1}
                    opacity={conn.status === 'active' ? 0.6 : 0.2}
                    strokeDasharray={conn.status === 'idle' ? '4,4' : 'none'}
                  />
                  {conn.status === 'active' && (
                    <line
                      x1={path.x1} y1={path.y1} x2={path.x2} y2={path.y2}
                      stroke={getStatusColor(conn.status)}
                      strokeWidth={4}
                      opacity={0.2}
                      filter="url(#glow)"
                    />
                  )}
                </g>
              );
            })}
            
            {/* Particles */}
            {particles.map((particle) => {
              const pos = getParticlePosition(particle);
              if (!pos) return null;
              return (
                <circle
                  key={particle.id}
                  cx={pos.x}
                  cy={pos.y}
                  r={3}
                  fill="var(--color-primary)"
                  filter="url(#glow-strong)"
                />
              );
            })}
            
            {/* Nodes */}
            {nodes.map((node) => {
              const size = getNodeSize(node.type);
              const isSelected = selectedNode === node.id || selectedNodes.has(node.id);
              
              return (
                <g 
                  key={node.id}
                  transform={`translate(${node.x}, ${node.y})`}
                  onClick={(e) => handleNodeClick(node.id, e)}
                  style={{ cursor: 'pointer' }}
                >
                  {/* Selection ring */}
                  {isSelected && (
                    <circle r={size + 10} fill="none" stroke="var(--color-primary)" strokeWidth="2" opacity="0.5" filter="url(#glow-strong)">
                      <animate attributeName="r" values={`${size + 8};${size + 12};${size + 8}`} dur="2s" repeatCount="indefinite" />
                    </circle>
                  )}
                  
                  {/* Status ring */}
                  <circle r={size + 4} fill="none" stroke={getStatusColor(node.status)} strokeWidth="2" opacity="0.6" />
                  
                  {/* Main circle */}
                  <circle r={size} fill="var(--color-bg-elevated)" stroke={getStatusColor(node.status)} strokeWidth="2" filter="url(#glow)" />
                  
                  {/* Inner circle */}
                  <circle r={size * 0.6} fill="none" stroke={getStatusColor(node.status)} strokeWidth="1" opacity="0.5" />
                  
                  {/* Icon based on type */}
                  {node.type === 'gateway' && (
                    <g fill="none" stroke="var(--color-primary)" strokeWidth="1.5">
                      <circle r="8" />
                      <line x1="-12" y1="0" x2="-8" y2="0" />
                      <line x1="8" y1="0" x2="12" y2="0" />
                      <line x1="0" y1="-12" x2="0" y2="-8" />
                      <line x1="0" y1="8" x2="0" y2="12" />
                    </g>
                  )}
                  {node.type === 'server' && (
                    <g fill="none" stroke="var(--color-secondary-400)" strokeWidth="1.5">
                      <rect x="-8" y="-8" width="16" height="6" rx="1" />
                      <rect x="-8" y="2" width="16" height="6" rx="1" />
                      <circle cx="-4" cy="-5" r="1" fill="var(--color-secondary-400)" />
                      <circle cx="-4" cy="5" r="1" fill="var(--color-secondary-400)" />
                    </g>
                  )}
                  {node.type === 'device' && (
                    <g fill="none" stroke="var(--color-accent-400)" strokeWidth="1.5">
                      <rect x="-6" y="-6" width="12" height="12" rx="2" />
                      <circle cx="0" cy="0" r="3" />
                    </g>
                  )}
                  
                  {/* Updating spinner */}
                  {node.status === 'updating' && (
                    <g>
                      <circle r={size + 6} fill="none" stroke="var(--color-warning)" strokeWidth="2" strokeDasharray="10,5" opacity="0.8">
                        <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="2s" repeatCount="indefinite" />
                      </circle>
                    </g>
                  )}
                  
                  {/* Status dot */}
                  <circle cx={size * 0.7} cy={-size * 0.7} r="4" fill={getStatusColor(node.status)} filter="url(#glow)" />
                  
                  {/* Label */}
                  <text y={size + 16} textAnchor="middle" fill="var(--color-text-secondary)" fontSize="10" fontFamily="var(--font-family-sans)">
                    {node.name}
                  </text>
                  
                  {/* Quick metrics on hover/select for devices */}
                  {isSelected && node.type === 'device' && node.metrics && (
                    <g transform={`translate(0, ${size + 28})`}>
                      <rect x="-45" y="0" width="90" height="24" rx="4" fill="var(--color-bg-overlay)" stroke="var(--color-border-default)" />
                      <text x="-38" y="10" fill="var(--color-success)" fontSize="8" fontFamily="var(--font-family-mono)">
                        CPU {node.metrics.cpu?.toFixed(0)}%
                      </text>
                      <text x="8" y="10" fill="var(--color-info)" fontSize="8" fontFamily="var(--font-family-mono)">
                        MEM {node.metrics.memory?.toFixed(0)}%
                      </text>
                      <text x="-20" y="20" fill="var(--color-text-tertiary)" fontSize="7">
                        {node.metrics.latency?.toFixed(0)}ms latency
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </svg>
          
          {/* Stats overlay */}
          <div className="network-stats-overlay">
            <div className="stat-card">
              <div className="stat-value">{nodes.filter(n => n.type === 'server').length}</div>
              <div className="stat-label">SERVERS</div>
              <div className="stat-indicator online" />
            </div>
            <div className="stat-card">
              <div className="stat-value">{nodes.filter(n => n.type === 'device').length}</div>
              <div className="stat-label">DEVICES</div>
              <div className="stat-indicator" style={{ background: nodes.some(n => n.type === 'device' && n.status === 'online') ? 'var(--color-success)' : 'var(--color-text-tertiary)' }} />
            </div>
            <div className="stat-card">
              <div className="stat-value">{connections.filter(c => c.status === 'active').length}</div>
              <div className="stat-label">ACTIVE</div>
              <div className="stat-indicator active" />
            </div>
            <div className="stat-card clickable" onClick={() => nodes.filter(n => n.status === 'error').length > 0 && addNotification('warning', 'Alerts', `${nodes.filter(n => n.status === 'error').length} devices have errors`)}>
              <div className="stat-value" style={{ color: nodes.some(n => n.status === 'error') ? 'var(--color-error)' : 'var(--color-text-primary)' }}>
                {nodes.filter(n => n.status === 'error').length}
              </div>
              <div className="stat-label">ALERTS</div>
              <div className="stat-indicator" style={{ background: nodes.some(n => n.status === 'error') ? 'var(--color-error)' : 'var(--color-success)' }} />
            </div>
          </div>
          
          {/* Corner decorations */}
          <div className="corner-decoration top-left">
            <svg width="40" height="40" viewBox="0 0 40 40">
              <path d="M0 20 L0 0 L20 0" fill="none" stroke="var(--color-primary)" strokeWidth="2" opacity="0.5" />
            </svg>
          </div>
          <div className="corner-decoration top-right">
            <svg width="40" height="40" viewBox="0 0 40 40">
              <path d="M20 0 L40 0 L40 20" fill="none" stroke="var(--color-primary)" strokeWidth="2" opacity="0.5" />
            </svg>
          </div>
          <div className="corner-decoration bottom-left">
            <svg width="40" height="40" viewBox="0 0 40 40">
              <path d="M0 20 L0 40 L20 40" fill="none" stroke="var(--color-primary)" strokeWidth="2" opacity="0.5" />
            </svg>
          </div>
          <div className="corner-decoration bottom-right">
            <svg width="40" height="40" viewBox="0 0 40 40">
              <path d="M20 40 L40 40 L40 20" fill="none" stroke="var(--color-primary)" strokeWidth="2" opacity="0.5" />
            </svg>
          </div>
          
          {/* Scanlines */}
          <div className="scanlines-overlay" />
          
          {/* HUD */}
          <div className="network-hud">
            <div className="hud-line">
              <span className="hud-label">SYS:</span>
              <span className="hud-value">AETHERIUM v1.0</span>
            </div>
            <div className="hud-line">
              <span className="hud-label">MODE:</span>
              <span className="hud-value">TOPOLOGY VIEW</span>
            </div>
            <div className="hud-line">
              <span className="hud-label">SCAN:</span>
              <span className="hud-value">{scanAngle.toFixed(0)}°</span>
            </div>
            <div className="hud-line">
              <span className="hud-label">ZOOM:</span>
              <span className="hud-value">{(zoom * 100).toFixed(0)}%</span>
            </div>
          </div>
        </div>
        
        {/* Detail Panel */}
        {showDetailPanel && selectedNodeData && (
          <div className="device-detail-panel">
            <div className="detail-panel-header">
              <div className="detail-title">
                {selectedNodeData.type === 'device' && <IconDevice size={16} />}
                {selectedNodeData.type === 'server' && <IconServer size={16} />}
                {selectedNodeData.type === 'gateway' && <IconNetwork size={16} />}
                <span>{selectedNodeData.name}</span>
                <span className={`status-badge ${selectedNodeData.status}`}>
                  {selectedNodeData.status}
                </span>
              </div>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowDetailPanel(false)}>
                <IconX size={14} />
              </button>
            </div>
            
            {/* Tabs */}
            <div className="detail-tabs">
              <button 
                className={`detail-tab ${detailTab === 'info' ? 'active' : ''}`}
                onClick={() => setDetailTab('info')}
              >
                <IconInfo size={12} /> Info
              </button>
              {(selectedNodeData.type === 'device' || selectedNodeData.type === 'server' || selectedNodeData.type === 'gateway') && (
                <button 
                  className={`detail-tab ${detailTab === 'logs' ? 'active' : ''}`}
                  onClick={() => setDetailTab('logs')}
                >
                  <IconTerminal size={12} /> Logs
                </button>
              )}
              {selectedNodeData.type === 'device' && (
                <button 
                  className={`detail-tab ${detailTab === 'metrics' ? 'active' : ''}`}
                  onClick={() => setDetailTab('metrics')}
                >
                  <IconSettings size={12} /> Metrics
                </button>
              )}
              {(selectedNodeData.type === 'server' || selectedNodeData.type === 'gateway') && (
                <button 
                  className={`detail-tab ${detailTab === 'metrics' ? 'active' : ''}`}
                  onClick={() => setDetailTab('metrics')}
                >
                  <IconDevice size={12} /> Devices
                </button>
              )}
            </div>
            
            {/* Tab Content */}
            <div className="detail-content">
              {/* Info Tab */}
              {detailTab === 'info' && (
                <div className="info-content">
                  <div className="info-section">
                    <div className="info-row">
                      <span className="info-label">ID</span>
                      <span className="info-value mono">{selectedNodeData.id}</span>
                    </div>
                    <div className="info-row">
                      <span className="info-label">Type</span>
                      <span className="info-value">{selectedNodeData.type}</span>
                    </div>
                    <div className="info-row">
                      <span className="info-label">Status</span>
                      <span className={`info-value status-${selectedNodeData.status}`}>
                        {selectedNodeData.status}
                      </span>
                    </div>
                    {selectedNodeData.serverId && (
                      <div className="info-row">
                        <span className="info-label">Server</span>
                        <span className="info-value">{selectedNodeData.serverId}</span>
                      </div>
                    )}
                    {selectedNodeData.metrics?.uptime && (
                      <div className="info-row">
                        <span className="info-label">Uptime</span>
                        <span className="info-value">{formatUptime(selectedNodeData.metrics.uptime)}</span>
                      </div>
                    )}
                  </div>
                  
                  {selectedNodeData.metrics && (
                    <div className="info-section">
                      <h4 className="section-title">Quick Metrics</h4>
                      <div className="metrics-grid">
                        <div className="metric-item">
                          <span className="metric-label">CPU</span>
                          <div className="metric-bar">
                            <div 
                              className="metric-fill cpu" 
                              style={{ width: `${selectedNodeData.metrics.cpu || 0}%` }}
                            />
                          </div>
                          <span className="metric-value">{selectedNodeData.metrics.cpu?.toFixed(0)}%</span>
                        </div>
                        <div className="metric-item">
                          <span className="metric-label">Memory</span>
                          <div className="metric-bar">
                            <div 
                              className="metric-fill memory" 
                              style={{ width: `${selectedNodeData.metrics.memory || 0}%` }}
                            />
                          </div>
                          <span className="metric-value">{selectedNodeData.metrics.memory?.toFixed(0)}%</span>
                        </div>
                        {selectedNodeData.metrics.latency !== undefined && (
                          <div className="metric-item">
                            <span className="metric-label">Latency</span>
                            <span className="metric-value highlight">{selectedNodeData.metrics.latency?.toFixed(0)} ms</span>
                          </div>
                        )}
                        {selectedNodeData.metrics.health !== undefined && (
                          <div className="metric-item">
                            <span className="metric-label">Health</span>
                            <span className="metric-value highlight" style={{ color: selectedNodeData.metrics.health > 80 ? 'var(--color-success)' : 'var(--color-warning)' }}>
                              {selectedNodeData.metrics.health?.toFixed(0)}%
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  
                  {/* Device Actions */}
                  {selectedNodeData.type === 'device' && (
                    <div className="info-section">
                      <h4 className="section-title">Actions</h4>
                      <div className="action-buttons">
                        <button 
                          className="btn btn-primary btn-sm"
                          onClick={() => handleRebootDevice(selectedNodeData.id)}
                        >
                          <IconRefresh size={12} /> Reboot
                        </button>
                        <button 
                          className="btn btn-secondary btn-sm"
                          onClick={() => setShowFlashDialog(true)}
                        >
                          <IconUpload size={12} /> Flash Update
                        </button>
                        <button 
                          className="btn btn-outline btn-sm"
                          onClick={() => setShowReassignDialog(true)}
                        >
                          <IconServer size={12} /> Reassign
                        </button>
                      </div>
                    </div>
                  )}
                  
                  {/* Server Actions */}
                  {selectedNodeData.type === 'server' && (
                    <div className="info-section">
                      <h4 className="section-title">Connected Devices</h4>
                      <div className="connected-devices-summary">
                        <div className="device-stat">
                          <span className="stat-number">{nodes.filter(n => n.serverId === selectedNodeData.id).length}</span>
                          <span className="stat-label">Total</span>
                        </div>
                        <div className="device-stat online">
                          <span className="stat-number">{nodes.filter(n => n.serverId === selectedNodeData.id && n.status === 'online').length}</span>
                          <span className="stat-label">Online</span>
                        </div>
                        <div className="device-stat offline">
                          <span className="stat-number">{nodes.filter(n => n.serverId === selectedNodeData.id && n.status === 'offline').length}</span>
                          <span className="stat-label">Offline</span>
                        </div>
                      </div>
                      <h4 className="section-title" style={{ marginTop: 'var(--spacing-3)' }}>Actions</h4>
                      <div className="action-buttons">
                        <button 
                          className="btn btn-primary btn-sm"
                          onClick={() => addNotification('info', 'Server Restart', `Restarting server ${selectedNodeData.name}...`)}
                        >
                          <IconRefresh size={12} /> Restart
                        </button>
                        <button 
                          className="btn btn-secondary btn-sm"
                          onClick={() => {
                            const serverDevices = nodes.filter(n => n.serverId === selectedNodeData.id);
                            setSelectedNodes(new Set(serverDevices.map(d => d.id)));
                            addNotification('info', 'Selection', `Selected ${serverDevices.length} devices`);
                          }}
                        >
                          <IconDevice size={12} /> Select All Devices
                        </button>
                      </div>
                    </div>
                  )}
                  
                  {/* Gateway Actions */}
                  {selectedNodeData.type === 'gateway' && (
                    <div className="info-section">
                      <h4 className="section-title">Network Overview</h4>
                      <div className="connected-devices-summary">
                        <div className="device-stat">
                          <span className="stat-number">{servers.length}</span>
                          <span className="stat-label">Servers</span>
                        </div>
                        <div className="device-stat online">
                          <span className="stat-number">{devices.length}</span>
                          <span className="stat-label">Devices</span>
                        </div>
                        <div className="device-stat">
                          <span className="stat-number">{connections.filter(c => c.status === 'active').length}</span>
                          <span className="stat-label">Active</span>
                        </div>
                      </div>
                      <h4 className="section-title" style={{ marginTop: 'var(--spacing-3)' }}>Actions</h4>
                      <div className="action-buttons">
                        <button 
                          className="btn btn-primary btn-sm"
                          onClick={handleRefresh}
                        >
                          <IconRefresh size={12} /> Scan Network
                        </button>
                        <button 
                          className="btn btn-secondary btn-sm"
                          onClick={() => addNotification('info', 'Gateway', 'Synchronizing all servers...')}
                        >
                          <IconServer size={12} /> Sync All
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              
              {/* Logs Tab */}
              {detailTab === 'logs' && (
                <div className="logs-content">
                  <div className="logs-toolbar">
                    <input 
                      type="text"
                      className="log-search"
                      placeholder="Filter logs..."
                      value={logFilter}
                      onChange={(e) => setLogFilter(e.target.value)}
                    />
                    <div className="log-level-filters">
                      {(['debug', 'info', 'warn', 'error'] as const).map(level => (
                        <button
                          key={level}
                          className={`level-btn ${level} ${logLevelFilter.has(level) ? 'active' : ''}`}
                          onClick={() => toggleLogLevel(level)}
                        >
                          {level[0].toUpperCase()}
                        </button>
                      ))}
                    </div>
                    <button 
                      className="btn btn-ghost btn-icon"
                      onClick={() => setDeviceLogs([])}
                      title="Clear logs"
                    >
                      <IconClear size={14} />
                    </button>
                  </div>
                  
                  <div className="logs-list">
                    {filteredLogs.map((log) => (
                      <div key={log.id} className={`log-entry ${log.level}`}>
                        <span className="log-time">{formatTimestamp(log.timestamp)}</span>
                        <span className={`log-level ${log.level}`}>{log.level.toUpperCase()}</span>
                        <span className="log-message">{log.message}</span>
                        {log.source && <span className="log-source">{log.source}</span>}
                      </div>
                    ))}
                    {filteredLogs.length === 0 && (
                      <div className="logs-empty">No logs matching filter</div>
                    )}
                  </div>
                </div>
              )}
              
              {/* Metrics Tab - For Devices */}
              {detailTab === 'metrics' && selectedNodeData.type === 'device' && (
                <div className="metrics-content">
                  <div className="chart-section">
                    <h4 className="chart-title">
                      <span>CPU Usage</span>
                      <span className="chart-value">{cpuMetrics[cpuMetrics.length - 1]?.value.toFixed(1)}%</span>
                    </h4>
                    <div className="chart-container">
                      {renderSparkline(cpuMetrics, 'var(--color-success)', 'cpu-grad')}
                    </div>
                  </div>
                  
                  <div className="chart-section">
                    <h4 className="chart-title">
                      <span>Memory Usage</span>
                      <span className="chart-value">{memoryMetrics[memoryMetrics.length - 1]?.value.toFixed(1)}%</span>
                    </h4>
                    <div className="chart-container">
                      {renderSparkline(memoryMetrics, 'var(--color-info)', 'mem-grad')}
                    </div>
                  </div>
                  
                  <div className="metrics-stats">
                    <div className="metric-stat">
                      <span className="stat-label">Avg CPU</span>
                      <span className="stat-value">
                        {(cpuMetrics.reduce((a, b) => a + b.value, 0) / cpuMetrics.length).toFixed(1)}%
                      </span>
                    </div>
                    <div className="metric-stat">
                      <span className="stat-label">Peak CPU</span>
                      <span className="stat-value">
                        {Math.max(...cpuMetrics.map(m => m.value)).toFixed(1)}%
                      </span>
                    </div>
                    <div className="metric-stat">
                      <span className="stat-label">Avg Memory</span>
                      <span className="stat-value">
                        {(memoryMetrics.reduce((a, b) => a + b.value, 0) / memoryMetrics.length).toFixed(1)}%
                      </span>
                    </div>
                    <div className="metric-stat">
                      <span className="stat-label">Peak Memory</span>
                      <span className="stat-value">
                        {Math.max(...memoryMetrics.map(m => m.value)).toFixed(1)}%
                      </span>
                    </div>
                  </div>
                </div>
              )}
              
              {/* Devices Tab - For Servers */}
              {detailTab === 'metrics' && selectedNodeData.type === 'server' && (
                <div className="devices-list-content">
                  <div className="devices-list-header">
                    <span>{nodes.filter(n => n.serverId === selectedNodeData.id).length} devices connected</span>
                  </div>
                  <div className="connected-devices-list">
                    {nodes.filter(n => n.serverId === selectedNodeData.id).map(device => (
                      <div 
                        key={device.id} 
                        className={`connected-device-item ${device.status}`}
                        onClick={() => {
                          setSelectedNode(device.id);
                        }}
                      >
                        <div className={`device-status-dot ${device.status}`} />
                        <span className="device-name">{device.name}</span>
                        <span className="device-id">{device.id}</span>
                        {device.metrics && (
                          <span className="device-metrics">
                            CPU {device.metrics.cpu?.toFixed(0)}% | MEM {device.metrics.memory?.toFixed(0)}%
                          </span>
                        )}
                      </div>
                    ))}
                    {nodes.filter(n => n.serverId === selectedNodeData.id).length === 0 && (
                      <div className="no-devices">No devices connected to this server</div>
                    )}
                  </div>
                </div>
              )}
              
              {/* Devices Tab - For Gateway (shows all servers and their devices) */}
              {detailTab === 'metrics' && selectedNodeData.type === 'gateway' && (
                <div className="devices-list-content">
                  <div className="devices-list-header">
                    <span>{servers.length} servers, {devices.length} devices</span>
                  </div>
                  <div className="connected-devices-list">
                    {servers.map(server => {
                      const serverNode = nodes.find(n => n.id === server.id);
                      const serverDevices = nodes.filter(n => n.serverId === server.id);
                      return (
                        <div key={server.id} className="server-group-item">
                          <div 
                            className={`server-item ${serverNode?.status || 'offline'}`}
                            onClick={() => setSelectedNode(server.id)}
                          >
                            <IconServer size={14} />
                            <span className="server-name">{server.name}</span>
                            <span className="device-count">{serverDevices.length} devices</span>
                            <div className={`device-status-dot ${serverNode?.status || 'offline'}`} />
                          </div>
                          <div className="server-devices">
                            {serverDevices.slice(0, 3).map(device => (
                              <div 
                                key={device.id}
                                className={`nested-device-item ${device.status}`}
                                onClick={() => setSelectedNode(device.id)}
                              >
                                <div className={`device-status-dot ${device.status}`} />
                                <span>{device.name}</span>
                              </div>
                            ))}
                            {serverDevices.length > 3 && (
                              <div className="more-devices">+{serverDevices.length - 3} more</div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      
      {/* Legend */}
      <div className="network-legend">
        <div className="legend-item">
          <div className="legend-color" style={{ background: 'var(--color-primary)' }} />
          <span>Gateway</span>
        </div>
        <div className="legend-item">
          <div className="legend-color" style={{ background: 'var(--color-secondary-400)' }} />
          <span>Server</span>
        </div>
        <div className="legend-item">
          <div className="legend-color" style={{ background: 'var(--color-accent-400)' }} />
          <span>Device</span>
        </div>
        <div className="legend-divider" />
        <div className="legend-item">
          <div className="legend-color" style={{ background: 'var(--color-success)' }} />
          <span>Online</span>
        </div>
        <div className="legend-item">
          <div className="legend-color" style={{ background: 'var(--color-warning)' }} />
          <span>Updating</span>
        </div>
        <div className="legend-item">
          <div className="legend-color" style={{ background: 'var(--color-error)' }} />
          <span>Error</span>
        </div>
        <div className="legend-hint">
          <kbd>Shift</kbd>+Click for multi-select
        </div>
      </div>
      
      {/* Reassign Dialog */}
      {showReassignDialog && (
        <div className="modal-overlay" onClick={() => setShowReassignDialog(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Reassign Device</h3>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowReassignDialog(false)}>
                <IconX size={16} />
              </button>
            </div>
            <div className="modal-content">
              <p className="modal-description">
                Select a target server for <strong>{selectedNodeData?.name}</strong>
              </p>
              <div className="server-list">
                {servers.map((server) => (
                  <div 
                    key={server.id}
                    className={`server-option ${selectedNodeData?.serverId === server.id ? 'current' : ''}`}
                    onClick={() => handleReassignDevice(server.id)}
                  >
                    <IconServer size={16} />
                    <span className="server-name">{server.name}</span>
                    <span className={`server-status ${server.status}`}>
                      {server.status === 'connected' ? <IconCheck size={12} /> : <IconWarning size={12} />}
                    </span>
                    {selectedNodeData?.serverId === server.id && (
                      <span className="current-badge">Current</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Flash Dialog */}
      {showFlashDialog && (
        <div className="modal-overlay" onClick={() => !isFlashing && setShowFlashDialog(false)}>
          <div className="modal-dialog flash-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>OTA Flash Update</h3>
              {!isFlashing && (
                <button className="btn btn-ghost btn-icon" onClick={() => setShowFlashDialog(false)}>
                  <IconX size={16} />
                </button>
              )}
            </div>
            <div className="modal-content">
              {!isFlashing ? (
                <>
                  <p className="modal-description">
                    Flash new firmware to <strong>{selectedNodeData?.name}</strong>
                  </p>
                  <div className="flash-options">
                    <div className="flash-option">
                      <input type="radio" name="firmware" id="fw-latest" defaultChecked />
                      <label htmlFor="fw-latest">
                        <strong>Latest Stable</strong>
                        <span>v2.1.0 - Released Dec 20, 2025</span>
                      </label>
                    </div>
                    <div className="flash-option">
                      <input type="radio" name="firmware" id="fw-beta" />
                      <label htmlFor="fw-beta">
                        <strong>Beta</strong>
                        <span>v2.2.0-beta.3 - Released Dec 23, 2025</span>
                      </label>
                    </div>
                    <div className="flash-option">
                      <input type="radio" name="firmware" id="fw-custom" />
                      <label htmlFor="fw-custom">
                        <strong>Custom Binary</strong>
                        <span>Upload your own firmware file</span>
                      </label>
                    </div>
                  </div>
                  <div className="flash-warning">
                    <IconWarning size={16} />
                    <span>Device will reboot during update. Ensure stable connection.</span>
                  </div>
                  <div className="modal-actions">
                    <button className="btn btn-ghost" onClick={() => setShowFlashDialog(false)}>
                      Cancel
                    </button>
                    <button className="btn btn-primary" onClick={handleFlashDevice}>
                      <IconUpload size={14} /> Start Flash
                    </button>
                  </div>
                </>
              ) : (
                <div className="flash-progress">
                  <div className="progress-icon">
                    <IconUpload size={32} className="uploading" />
                  </div>
                  <h4>Flashing firmware...</h4>
                  <div className="progress-bar">
                    <div 
                      className="progress-fill" 
                      style={{ width: `${Math.min(flashProgress, 100)}%` }}
                    />
                  </div>
                  <span className="progress-text">{Math.min(flashProgress, 100).toFixed(0)}%</span>
                  <p className="progress-status">
                    {flashProgress < 30 && 'Uploading firmware...'}
                    {flashProgress >= 30 && flashProgress < 60 && 'Verifying checksum...'}
                    {flashProgress >= 60 && flashProgress < 90 && 'Writing to flash...'}
                    {flashProgress >= 90 && 'Finalizing...'}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
