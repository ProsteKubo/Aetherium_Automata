/**
 * Aetherium Automata - Automata Overview Panel
 * 
 * Birds-eye view showing all automatas across the network,
 * their host devices, and inter-automata communication via inputs/outputs.
 * Also shows connections to external systems (RTOS, plugins, etc.)
 */

import React, { useState, useMemo, useCallback } from 'react';
import { useAutomataStore, useGatewayStore, useUIStore } from '../../stores';
import {
  IconAutomata,
  IconDevice,
  IconRefresh,
  IconZoomIn,
  IconZoomOut,
  IconFitView,
  IconSettings,
  IconX,
  IconChevronRight,
} from '../common/Icons';

// Types for the overview visualization
interface AutomataNode {
  id: string;
  name: string;
  description?: string;
  deviceId?: string;
  deviceName?: string;
  serverId?: string;
  serverName?: string;
  stateCount: number;
  inputs: string[];
  outputs: string[];
  status: 'running' | 'stopped' | 'error' | 'paused';
  x: number;
  y: number;
}

interface DeviceCluster {
  id: string;
  name: string;
  serverId?: string;
  serverName?: string;
  automatas: AutomataNode[];
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DataChannel {
  id: string;
  name: string; // The shared input/output name
  sourceAutomataId: string;
  targetAutomataId: string;
  sourceDeviceId?: string;
  targetDeviceId?: string;
  type: 'internal' | 'cross-device' | 'external';
}

interface ExternalSystem {
  id: string;
  name: string;
  type: 'rtos' | 'plugin' | 'mqtt' | 'http' | 'can' | 'modbus' | 'custom';
  status: 'connected' | 'disconnected' | 'error';
  connectedAutomatas: string[];
  x: number;
  y: number;
}

// Mock external systems for demo
const mockExternalSystems: ExternalSystem[] = [
  {
    id: 'ext-rtos-1',
    name: 'FreeRTOS Core',
    type: 'rtos',
    status: 'connected',
    connectedAutomatas: [],
    x: 50,
    y: 200,
  },
  {
    id: 'ext-mqtt-1',
    name: 'MQTT Broker',
    type: 'mqtt',
    status: 'connected',
    connectedAutomatas: [],
    x: 50,
    y: 400,
  },
  {
    id: 'ext-can-1',
    name: 'CAN Bus',
    type: 'can',
    status: 'connected',
    connectedAutomatas: [],
    x: 750,
    y: 300,
  },
];

export const AutomataOverviewPanel: React.FC = () => {
  // View state
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [lastMousePos, setLastMousePos] = useState({ x: 0, y: 0 });
  const [selectedAutomata, setSelectedAutomata] = useState<string | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [showDetailPanel, setShowDetailPanel] = useState(false);
  const [filterText, setFilterText] = useState('');
  
  // Store data
  const automataMap = useAutomataStore((state) => state.automata);
  const setActiveAutomata = useAutomataStore((state) => state.setActiveAutomata);
  const devicesMap = useGatewayStore((state) => state.devices);
  const serversMap = useGatewayStore((state) => state.servers);
  const openTab = useUIStore((state) => state.openTab);
  const togglePanel = useUIStore((state) => state.togglePanel);
  const addNotification = useUIStore((state) => state.addNotification);
  
  // Convert maps to arrays
  const automatas = useMemo(() => Array.from(automataMap.values()), [automataMap]);
  const devices = useMemo(() => Array.from(devicesMap.values()), [devicesMap]);
  const servers = useMemo(() => Array.from(serversMap.values()), [serversMap]);
  
  // Build automata nodes with positions
  const automataNodes: AutomataNode[] = useMemo(() => {
    return automatas.map((automata, index) => {
      // Extract inputs and outputs from states
      const inputs = new Set<string>();
      const outputs = new Set<string>();
      
      Object.values(automata.states).forEach((state) => {
        state.inputs?.forEach((input) => inputs.add(input));
        state.outputs?.forEach((output) => outputs.add(output));
      });
      
      // Also add global automata inputs/outputs
      automata.inputs?.forEach((input) => inputs.add(input));
      automata.outputs?.forEach((output) => outputs.add(output));
      
      // Find assigned device (mock - in real implementation, this would come from automata config)
      const deviceIndex = index % Math.max(devices.length, 1);
      const device = devices[deviceIndex];
      const server = device ? servers.find(s => s.id === device.serverId) : undefined;
      
      // Determine status based on automata state (isDirty, etc.)
      const status: 'running' | 'stopped' | 'error' | 'paused' = 
        automata.isDirty ? 'paused' : 'stopped';
      
      return {
        id: automata.id,
        name: automata.config.name,
        description: automata.config.description,
        deviceId: device?.id,
        deviceName: device?.name,
        serverId: server?.id,
        serverName: server?.name,
        stateCount: Object.keys(automata.states).length,
        inputs: Array.from(inputs),
        outputs: Array.from(outputs),
        status,
        x: 200 + (index % 3) * 200,
        y: 150 + Math.floor(index / 3) * 180,
      };
    });
  }, [automatas, devices, servers]);
  
  // Group automatas by device into clusters
  const deviceClusters: DeviceCluster[] = useMemo(() => {
    const clusters: Map<string, DeviceCluster> = new Map();
    
    // Group by device
    automataNodes.forEach((node) => {
      const deviceId = node.deviceId || 'unassigned';
      if (!clusters.has(deviceId)) {
        const device = devices.find(d => d.id === deviceId);
        const server = device ? servers.find(s => s.id === device.serverId) : undefined;
        clusters.set(deviceId, {
          id: deviceId,
          name: device?.name || 'Unassigned',
          serverId: server?.id,
          serverName: server?.name,
          automatas: [],
          x: 0,
          y: 0,
          width: 0,
          height: 0,
        });
      }
      clusters.get(deviceId)!.automatas.push(node);
    });
    
    // Position clusters
    let xOffset = 150;
    clusters.forEach((cluster) => {
      cluster.x = xOffset;
      cluster.y = 100;
      cluster.width = Math.max(180, cluster.automatas.length * 80 + 40);
      cluster.height = 200;
      
      // Position automatas within cluster
      cluster.automatas.forEach((automata, i) => {
        automata.x = cluster.x + 40 + i * 70;
        automata.y = cluster.y + 80;
      });
      
      xOffset += cluster.width + 50;
    });
    
    return Array.from(clusters.values());
  }, [automataNodes, devices, servers]);
  
  // Find data channels (connections via shared input/output names)
  const dataChannels: DataChannel[] = useMemo(() => {
    const channels: DataChannel[] = [];
    
    // For each automata's outputs, find automatas with matching inputs
    automataNodes.forEach((sourceNode) => {
      sourceNode.outputs.forEach((outputName) => {
        automataNodes.forEach((targetNode) => {
          if (sourceNode.id !== targetNode.id && targetNode.inputs.includes(outputName)) {
            const isCrossDevice = sourceNode.deviceId !== targetNode.deviceId;
            channels.push({
              id: `${sourceNode.id}-${outputName}-${targetNode.id}`,
              name: outputName,
              sourceAutomataId: sourceNode.id,
              targetAutomataId: targetNode.id,
              sourceDeviceId: sourceNode.deviceId,
              targetDeviceId: targetNode.deviceId,
              type: isCrossDevice ? 'cross-device' : 'internal',
            });
          }
        });
      });
    });
    
    return channels;
  }, [automataNodes]);
  
  // Selected automata data
  const selectedAutomataData = useMemo(() => {
    if (!selectedAutomata) return null;
    return automataNodes.find(n => n.id === selectedAutomata) || null;
  }, [selectedAutomata, automataNodes]);
  
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
  
  // Open automata for editing
  const handleOpenAutomata = (automataId: string) => {
    const automata = automataMap.get(automataId);
    if (automata) {
      setActiveAutomata(automataId);
      openTab({
        type: 'automata',
        targetId: automataId,
        name: automata.config.name,
        isDirty: false,
      });
      togglePanel('automata'); // Hide overview, show editor
    }
  };
  
  // Node click handler
  const handleNodeClick = (automataId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (e.detail === 2) {
      // Double click - open for editing
      handleOpenAutomata(automataId);
    } else {
      setSelectedAutomata(automataId === selectedAutomata ? null : automataId);
      setShowDetailPanel(true);
    }
  };
  
  // Get status color
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running':
      case 'connected':
        return 'var(--color-success)';
      case 'paused':
        return 'var(--color-warning)';
      case 'error':
      case 'disconnected':
        return 'var(--color-error)';
      default:
        return 'var(--color-text-tertiary)';
    }
  };
  
  // Get external system icon color
  const getSystemColor = (type: string) => {
    switch (type) {
      case 'rtos':
        return 'var(--color-accent-400)';
      case 'mqtt':
        return 'var(--color-primary)';
      case 'can':
        return 'var(--color-secondary-400)';
      case 'http':
        return 'var(--color-info)';
      default:
        return 'var(--color-text-secondary)';
    }
  };
  
  // Filter automatas
  const filteredAutomatas = useMemo(() => {
    if (!filterText) return automataNodes;
    const lower = filterText.toLowerCase();
    return automataNodes.filter(a => 
      a.name.toLowerCase().includes(lower) ||
      a.deviceName?.toLowerCase().includes(lower) ||
      a.inputs.some(i => i.toLowerCase().includes(lower)) ||
      a.outputs.some(o => o.toLowerCase().includes(lower))
    );
  }, [automataNodes, filterText]);

  return (
    <div className="automata-overview-panel">
      {/* Header */}
      <div className="panel-header overview-header">
        <IconAutomata size={16} />
        <span>Automata Network Overview</span>
        
        <div className="overview-search">
          <input
            type="text"
            placeholder="Filter automatas..."
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            className="overview-search-input"
          />
        </div>
        
        <div className="overview-header-actions">
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
          <button className="btn btn-ghost btn-icon" title="Refresh">
            <IconRefresh size={14} />
          </button>
        </div>
      </div>
      
      <div className="overview-content">
        {/* Main Canvas */}
        <div 
          className={`overview-canvas ${showDetailPanel ? 'with-panel' : ''}`}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
          onClick={() => {
            setSelectedAutomata(null);
            setSelectedChannel(null);
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
              <filter id="glow-overview" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
                <feMerge>
                  <feMergeNode in="coloredBlur"/>
                  <feMergeNode in="SourceGraphic"/>
                </feMerge>
              </filter>
              
              <marker
                id="arrowhead"
                markerWidth="10"
                markerHeight="7"
                refX="9"
                refY="3.5"
                orient="auto"
              >
                <polygon
                  points="0 0, 10 3.5, 0 7"
                  fill="var(--color-primary)"
                  opacity="0.6"
                />
              </marker>
              
              <marker
                id="arrowhead-cross"
                markerWidth="10"
                markerHeight="7"
                refX="9"
                refY="3.5"
                orient="auto"
              >
                <polygon
                  points="0 0, 10 3.5, 0 7"
                  fill="var(--color-secondary-400)"
                  opacity="0.8"
                />
              </marker>
              
              <pattern id="gridPattern" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="var(--color-border-subtle)" strokeWidth="0.5" opacity="0.5" />
              </pattern>
            </defs>
            
            {/* Background Grid */}
            <rect width="100%" height="100%" fill="url(#gridPattern)" />
            
            {/* Device Clusters */}
            {deviceClusters.map((cluster) => (
              <g key={cluster.id}>
                {/* Cluster background */}
                <rect
                  x={cluster.x}
                  y={cluster.y}
                  width={cluster.width}
                  height={cluster.height}
                  rx="8"
                  fill="var(--color-bg-surface)"
                  stroke="var(--color-border-default)"
                  strokeWidth="1"
                  opacity="0.8"
                />
                
                {/* Cluster header */}
                <rect
                  x={cluster.x}
                  y={cluster.y}
                  width={cluster.width}
                  height="36"
                  rx="8"
                  fill="var(--color-bg-elevated)"
                />
                <rect
                  x={cluster.x}
                  y={cluster.y + 28}
                  width={cluster.width}
                  height="8"
                  fill="var(--color-bg-elevated)"
                />
                
                {/* Device icon and name */}
                <g transform={`translate(${cluster.x + 12}, ${cluster.y + 12})`}>
                  <IconDevice size={14} />
                </g>
                <text
                  x={cluster.x + 32}
                  y={cluster.y + 23}
                  fill="var(--color-text-primary)"
                  fontSize="12"
                  fontWeight="500"
                >
                  {cluster.name}
                </text>
                
                {/* Server badge */}
                {cluster.serverName && (
                  <text
                    x={cluster.x + cluster.width - 10}
                    y={cluster.y + 23}
                    fill="var(--color-text-tertiary)"
                    fontSize="9"
                    textAnchor="end"
                  >
                    {cluster.serverName}
                  </text>
                )}
              </g>
            ))}
            
            {/* Data Channels (Connections) */}
            {dataChannels.map((channel) => {
              const source = automataNodes.find(n => n.id === channel.sourceAutomataId);
              const target = automataNodes.find(n => n.id === channel.targetAutomataId);
              if (!source || !target) return null;
              
              const isCrossDevice = channel.type === 'cross-device';
              const isSelected = selectedChannel === channel.id;
              
              // Calculate curve control points
              const midX = (source.x + target.x) / 2;
              const midY = (source.y + target.y) / 2;
              const dx = target.x - source.x;
              const dy = target.y - source.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              const curveOffset = isCrossDevice ? dist * 0.3 : dist * 0.15;
              
              // Perpendicular offset for curve
              const perpX = -dy / dist * curveOffset;
              const perpY = dx / dist * curveOffset;
              
              const controlX = midX + perpX;
              const controlY = midY + perpY;
              
              const pathD = `M ${source.x + 25} ${source.y + 25} Q ${controlX} ${controlY} ${target.x + 25} ${target.y + 25}`;
              
              return (
                <g key={channel.id}>
                  {/* Connection path */}
                  <path
                    d={pathD}
                    fill="none"
                    stroke={isCrossDevice ? 'var(--color-secondary-400)' : 'var(--color-primary)'}
                    strokeWidth={isSelected ? 3 : 2}
                    strokeDasharray={isCrossDevice ? '8,4' : 'none'}
                    opacity={isSelected ? 1 : 0.5}
                    markerEnd={isCrossDevice ? 'url(#arrowhead-cross)' : 'url(#arrowhead)'}
                    className="channel-path"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedChannel(channel.id);
                    }}
                    style={{ cursor: 'pointer' }}
                  />
                  
                  {/* Animated particles */}
                  <circle
                    r={3}
                    fill={isCrossDevice ? 'var(--color-secondary-400)' : 'var(--color-primary)'}
                    filter="url(#glow-overview)"
                  >
                    <animateMotion
                      dur="2s"
                      repeatCount="indefinite"
                      path={pathD}
                    />
                  </circle>
                  
                  {/* Channel label */}
                  <text
                    x={controlX}
                    y={controlY - 8}
                    fill="var(--color-text-secondary)"
                    fontSize="9"
                    textAnchor="middle"
                    className="channel-label"
                  >
                    {channel.name}
                  </text>
                </g>
              );
            })}
            
            {/* External Systems */}
            {mockExternalSystems.map((system) => (
              <g key={system.id} transform={`translate(${system.x}, ${system.y})`}>
                {/* System node */}
                <rect
                  x={-40}
                  y={-25}
                  width={80}
                  height={50}
                  rx="6"
                  fill="var(--color-bg-overlay)"
                  stroke={getSystemColor(system.type)}
                  strokeWidth="2"
                  strokeDasharray="4,2"
                />
                
                {/* System icon */}
                <text
                  x={0}
                  y={-5}
                  fill={getSystemColor(system.type)}
                  fontSize="18"
                  textAnchor="middle"
                >
                  {system.type === 'rtos' ? '⚡' : 
                   system.type === 'mqtt' ? '📡' : 
                   system.type === 'can' ? '🔌' : '🔗'}
                </text>
                
                {/* System name */}
                <text
                  x={0}
                  y={15}
                  fill="var(--color-text-secondary)"
                  fontSize="9"
                  textAnchor="middle"
                >
                  {system.name}
                </text>
                
                {/* Status dot */}
                <circle
                  cx={32}
                  cy={-17}
                  r={4}
                  fill={getStatusColor(system.status)}
                  filter="url(#glow-overview)"
                />
              </g>
            ))}
            
            {/* Automata Nodes */}
            {filteredAutomatas.map((automata) => {
              const isSelected = selectedAutomata === automata.id;
              
              return (
                <g
                  key={automata.id}
                  transform={`translate(${automata.x}, ${automata.y})`}
                  onClick={(e) => handleNodeClick(automata.id, e)}
                  style={{ cursor: 'pointer' }}
                >
                  {/* Selection ring */}
                  {isSelected && (
                    <circle
                      r={35}
                      fill="none"
                      stroke="var(--color-primary)"
                      strokeWidth="2"
                      opacity="0.5"
                      filter="url(#glow-overview)"
                    >
                      <animate
                        attributeName="r"
                        values="33;37;33"
                        dur="2s"
                        repeatCount="indefinite"
                      />
                    </circle>
                  )}
                  
                  {/* Main circle */}
                  <circle
                    r={25}
                    fill="var(--color-bg-elevated)"
                    stroke={getStatusColor(automata.status)}
                    strokeWidth="2"
                    filter="url(#glow-overview)"
                  />
                  
                  {/* Inner circle */}
                  <circle
                    r={18}
                    fill="none"
                    stroke={getStatusColor(automata.status)}
                    strokeWidth="1"
                    opacity="0.5"
                  />
                  
                  {/* Automata icon */}
                  <g fill="none" stroke={getStatusColor(automata.status)} strokeWidth="1.5">
                    <circle r="6" />
                    <circle r="2" fill={getStatusColor(automata.status)} />
                    <line x1="-10" y1="0" x2="-6" y2="0" />
                    <line x1="6" y1="0" x2="10" y2="0" />
                    <line x1="0" y1="-10" x2="0" y2="-6" />
                    <line x1="0" y1="6" x2="0" y2="10" />
                  </g>
                  
                  {/* Running indicator */}
                  {automata.status === 'running' && (
                    <circle
                      r={25}
                      fill="none"
                      stroke={getStatusColor(automata.status)}
                      strokeWidth="1"
                      opacity="0.3"
                    >
                      <animate
                        attributeName="r"
                        values="25;30;25"
                        dur="1.5s"
                        repeatCount="indefinite"
                      />
                      <animate
                        attributeName="opacity"
                        values="0.3;0;0.3"
                        dur="1.5s"
                        repeatCount="indefinite"
                      />
                    </circle>
                  )}
                  
                  {/* State count badge */}
                  <circle
                    cx={18}
                    cy={-18}
                    r={10}
                    fill="var(--color-bg-overlay)"
                    stroke="var(--color-border-default)"
                  />
                  <text
                    x={18}
                    y={-14}
                    fill="var(--color-text-secondary)"
                    fontSize="9"
                    textAnchor="middle"
                    fontWeight="bold"
                  >
                    {automata.stateCount}
                  </text>
                  
                  {/* I/O indicators */}
                  {automata.inputs.length > 0 && (
                    <g transform="translate(-25, 0)">
                      <rect
                        x={-8}
                        y={-6}
                        width={8}
                        height={12}
                        rx={2}
                        fill="var(--color-info)"
                        opacity="0.8"
                      />
                      <text x={-4} y={3} fill="white" fontSize="8" textAnchor="middle">I</text>
                    </g>
                  )}
                  {automata.outputs.length > 0 && (
                    <g transform="translate(25, 0)">
                      <rect
                        x={0}
                        y={-6}
                        width={8}
                        height={12}
                        rx={2}
                        fill="var(--color-success)"
                        opacity="0.8"
                      />
                      <text x={4} y={3} fill="white" fontSize="8" textAnchor="middle">O</text>
                    </g>
                  )}
                  
                  {/* Name label */}
                  <text
                    y={40}
                    fill="var(--color-text-primary)"
                    fontSize="10"
                    textAnchor="middle"
                    fontWeight="500"
                  >
                    {automata.name.length > 15 ? automata.name.slice(0, 12) + '...' : automata.name}
                  </text>
                </g>
              );
            })}
          </svg>
          
          {/* Stats Overlay */}
          <div className="overview-stats-overlay">
            <div className="stat-card">
              <div className="stat-value">{automataNodes.length}</div>
              <div className="stat-label">AUTOMATAS</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{deviceClusters.length}</div>
              <div className="stat-label">DEVICES</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{dataChannels.length}</div>
              <div className="stat-label">CHANNELS</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{automataNodes.filter(a => a.status === 'running').length}</div>
              <div className="stat-label">RUNNING</div>
              <div className="stat-indicator active" />
            </div>
          </div>
          
          {/* Corner decorations */}
          <div className="corner-decoration top-left">
            <svg width="40" height="40" viewBox="0 0 40 40">
              <path d="M0 20 L0 0 L20 0" fill="none" stroke="var(--color-accent-400)" strokeWidth="2" opacity="0.5" />
            </svg>
          </div>
          <div className="corner-decoration top-right">
            <svg width="40" height="40" viewBox="0 0 40 40">
              <path d="M20 0 L40 0 L40 20" fill="none" stroke="var(--color-accent-400)" strokeWidth="2" opacity="0.5" />
            </svg>
          </div>
          <div className="corner-decoration bottom-left">
            <svg width="40" height="40" viewBox="0 0 40 40">
              <path d="M0 20 L0 40 L20 40" fill="none" stroke="var(--color-accent-400)" strokeWidth="2" opacity="0.5" />
            </svg>
          </div>
          <div className="corner-decoration bottom-right">
            <svg width="40" height="40" viewBox="0 0 40 40">
              <path d="M20 40 L40 40 L40 20" fill="none" stroke="var(--color-accent-400)" strokeWidth="2" opacity="0.5" />
            </svg>
          </div>
          
          {/* HUD */}
          <div className="overview-hud">
            <div className="hud-line">
              <span className="hud-label">VIEW:</span>
              <span className="hud-value">AUTOMATA NETWORK</span>
            </div>
            <div className="hud-line">
              <span className="hud-label">ZOOM:</span>
              <span className="hud-value">{(zoom * 100).toFixed(0)}%</span>
            </div>
            <div className="hud-line">
              <span className="hud-label">CHANNELS:</span>
              <span className="hud-value">{dataChannels.filter(c => c.type === 'internal').length} INT / {dataChannels.filter(c => c.type === 'cross-device').length} EXT</span>
            </div>
          </div>
        </div>
        
        {/* Detail Panel */}
        {showDetailPanel && selectedAutomataData && (
          <div className="overview-detail-panel">
            <div className="detail-panel-header">
              <div className="detail-title">
                <IconAutomata size={16} />
                <span>{selectedAutomataData.name}</span>
                <span className={`status-badge ${selectedAutomataData.status}`}>
                  {selectedAutomataData.status}
                </span>
              </div>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowDetailPanel(false)}>
                <IconX size={14} />
              </button>
            </div>
            
            <div className="detail-content">
              {/* Basic Info */}
              <div className="info-section">
                <div className="info-row">
                  <span className="info-label">States</span>
                  <span className="info-value">{selectedAutomataData.stateCount}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Device</span>
                  <span className="info-value">{selectedAutomataData.deviceName || 'Unassigned'}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Server</span>
                  <span className="info-value">{selectedAutomataData.serverName || 'N/A'}</span>
                </div>
              </div>
              
              {/* Inputs */}
              <div className="info-section">
                <h4 className="section-title">
                  <span className="io-badge input">I</span> Inputs ({selectedAutomataData.inputs.length})
                </h4>
                <div className="io-list">
                  {selectedAutomataData.inputs.length > 0 ? (
                    selectedAutomataData.inputs.map((input) => (
                      <div key={input} className="io-item input">
                        <IconChevronRight size={12} />
                        <span>{input}</span>
                        {dataChannels.some(c => c.name === input && c.targetAutomataId === selectedAutomataData.id) && (
                          <span className="connected-badge">connected</span>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="io-empty">No inputs defined</div>
                  )}
                </div>
              </div>
              
              {/* Outputs */}
              <div className="info-section">
                <h4 className="section-title">
                  <span className="io-badge output">O</span> Outputs ({selectedAutomataData.outputs.length})
                </h4>
                <div className="io-list">
                  {selectedAutomataData.outputs.length > 0 ? (
                    selectedAutomataData.outputs.map((output) => {
                      const connections = dataChannels.filter(c => c.name === output && c.sourceAutomataId === selectedAutomataData.id);
                      return (
                        <div key={output} className="io-item output">
                          <IconChevronRight size={12} />
                          <span>{output}</span>
                          {connections.length > 0 && (
                            <span className="connected-badge">{connections.length} receiver{connections.length > 1 ? 's' : ''}</span>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <div className="io-empty">No outputs defined</div>
                  )}
                </div>
              </div>
              
              {/* Connected Automatas */}
              <div className="info-section">
                <h4 className="section-title">Connected Automatas</h4>
                <div className="connected-list">
                  {(() => {
                    const connectedIds = new Set<string>();
                    dataChannels.forEach(c => {
                      if (c.sourceAutomataId === selectedAutomataData.id) connectedIds.add(c.targetAutomataId);
                      if (c.targetAutomataId === selectedAutomataData.id) connectedIds.add(c.sourceAutomataId);
                    });
                    const connectedAutomatas = automataNodes.filter(a => connectedIds.has(a.id));
                    
                    return connectedAutomatas.length > 0 ? (
                      connectedAutomatas.map((a) => (
                        <div
                          key={a.id}
                          className="connected-automata-item"
                          onClick={() => setSelectedAutomata(a.id)}
                        >
                          <div className={`status-dot ${a.status}`} />
                          <span className="automata-name">{a.name}</span>
                          <span className="automata-device">{a.deviceName || 'Unassigned'}</span>
                        </div>
                      ))
                    ) : (
                      <div className="io-empty">No connections</div>
                    );
                  })()}
                </div>
              </div>
              
              {/* Actions */}
              <div className="info-section">
                <h4 className="section-title">Actions</h4>
                <div className="action-buttons">
                  <button 
                    className="btn btn-primary btn-sm"
                    onClick={() => handleOpenAutomata(selectedAutomataData.id)}
                  >
                    <IconSettings size={12} /> Edit
                  </button>
                  <button 
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      addNotification('info', 'Deploy', `Deploying ${selectedAutomataData.name}...`);
                    }}
                  >
                    <IconDevice size={12} /> Deploy
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      
      {/* Legend */}
      <div className="overview-legend">
        <div className="legend-item">
          <div className="legend-icon automata" />
          <span>Automata</span>
        </div>
        <div className="legend-item">
          <div className="legend-color" style={{ background: 'var(--color-primary)' }} />
          <span>Internal Channel</span>
        </div>
        <div className="legend-item">
          <div className="legend-color dashed" style={{ background: 'var(--color-secondary-400)' }} />
          <span>Cross-Device</span>
        </div>
        <div className="legend-divider" />
        <div className="legend-item">
          <span className="io-badge input small">I</span>
          <span>Input</span>
        </div>
        <div className="legend-item">
          <span className="io-badge output small">O</span>
          <span>Output</span>
        </div>
        <div className="legend-hint">
          Double-click to edit automata
        </div>
      </div>
    </div>
  );
};
