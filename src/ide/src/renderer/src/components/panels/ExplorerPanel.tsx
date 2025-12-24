/**
 * Aetherium Automata - Explorer Panel Component
 * 
 * Shows automata files, servers, and devices in a tree structure.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useGatewayStore, useAutomataStore, useUIStore } from '../../stores';
import {
  IconChevronRight,
  IconChevronDown,
  IconAutomata,
  IconServer,
  IconDevice,
  IconPlus,
  IconRefresh,
} from '../common/Icons';

interface TreeItemProps {
  label: string;
  icon: React.ReactNode;
  isExpanded?: boolean;
  isSelected?: boolean;
  depth?: number;
  hasChildren?: boolean;
  onClick?: () => void;
  onToggle?: () => void;
  onDoubleClick?: () => void;
  statusIndicator?: 'online' | 'offline' | 'error' | 'warning';
}

const TreeItem: React.FC<TreeItemProps> = ({
  label,
  icon,
  isExpanded = false,
  isSelected = false,
  depth = 0,
  hasChildren = false,
  onClick,
  onToggle,
  onDoubleClick,
  statusIndicator,
}) => {
  return (
    <div
      className={`tree-item ${isSelected ? 'selected' : ''}`}
      style={{ paddingLeft: `${depth * 16 + 8}px` }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      <span
        className="tree-item-toggle"
        onClick={(e) => {
          e.stopPropagation();
          onToggle?.();
        }}
      >
        {hasChildren && (isExpanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />)}
      </span>
      <span className="tree-item-icon">{icon}</span>
      <span className="tree-item-label">{label}</span>
      {statusIndicator && (
        <span className={`status-indicator ${statusIndicator}`} style={{ marginLeft: 'auto' }} />
      )}
    </div>
  );
};

export const ExplorerPanel: React.FC = () => {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    automata: true,
    servers: true,
  });
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  
  // Store data - use raw Maps and memoize the array conversion
  const isConnected = useGatewayStore((state) => state.status === 'connected');
  const serversMap = useGatewayStore((state) => state.servers);
  const devicesMap = useGatewayStore((state) => state.devices);
  const automataMap = useAutomataStore((state) => state.automata);
  const activeAutomataId = useAutomataStore((state) => state.activeAutomataId);
  const setActiveAutomata = useAutomataStore((state) => state.setActiveAutomata);
  const fetchAutomata = useAutomataStore((state) => state.fetchAutomata);
  const fetchServers = useGatewayStore((state) => state.fetchServers);
  const fetchDevices = useGatewayStore((state) => state.fetchDevices);
  const connect = useGatewayStore((state) => state.connect);
  const openTab = useUIStore((state) => state.openTab);
  
  // Memoize array conversions to prevent infinite re-renders
  const servers = useMemo(() => Array.from(serversMap.values()), [serversMap]);
  const devices = useMemo(() => Array.from(devicesMap.values()), [devicesMap]);
  const automataList = useMemo(() => Array.from(automataMap.values()), [automataMap]);
  
  // Auto-connect on mount (for demo purposes)
  useEffect(() => {
    if (!isConnected) {
      connect({
        address: 'localhost',
        port: 8080,
        reconnectInterval: 5000,
        heartbeatInterval: 30000,
        timeout: 10000,
        useTLS: false,
      }).then(() => {
        fetchAutomata();
      });
    }
  }, []);
  
  const toggleSection = (section: string) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };
  
  const toggleItem = (itemId: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };
  
  const handleAutomataClick = (automataId: string) => {
    setActiveAutomata(automataId);
  };
  
  const handleAutomataDoubleClick = (automataId: string, name: string) => {
    setActiveAutomata(automataId);
    openTab({
      type: 'automata',
      targetId: automataId,
      name,
      isDirty: false,
    });
  };
  
  const handleRefresh = async () => {
    if (isConnected) {
      await Promise.all([fetchServers(), fetchDevices(), fetchAutomata()]);
    }
  };
  
  const getDeviceStatus = (status: string): 'online' | 'offline' | 'error' | 'warning' => {
    switch (status) {
      case 'online':
        return 'online';
      case 'error':
        return 'error';
      case 'updating':
        return 'warning';
      default:
        return 'offline';
    }
  };
  
  return (
    <div className="explorer-panel">
      {/* Automata Section */}
      <div className="explorer-section">
        <div
          className="explorer-section-header"
          onClick={() => toggleSection('automata')}
        >
          {expandedSections.automata ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
          <span>AUTOMATA</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--spacing-1)' }}>
            <button
              className="btn btn-ghost btn-icon"
              style={{ width: 20, height: 20, padding: 0 }}
              title="New Automata"
              onClick={(e) => {
                e.stopPropagation();
                // TODO: Open create automata modal
              }}
            >
              <IconPlus size={12} />
            </button>
            <button
              className="btn btn-ghost btn-icon"
              style={{ width: 20, height: 20, padding: 0 }}
              title="Refresh"
              onClick={(e) => {
                e.stopPropagation();
                handleRefresh();
              }}
            >
              <IconRefresh size={12} />
            </button>
          </div>
        </div>
        
        {expandedSections.automata && (
          <div className="explorer-section-content">
            {automataList.length === 0 ? (
              <div style={{ padding: 'var(--spacing-3)', color: 'var(--color-text-tertiary)', fontSize: 'var(--font-size-sm)' }}>
                No automata yet
              </div>
            ) : (
              automataList.map((automata) => (
                <TreeItem
                  key={automata.id}
                  label={automata.config.name}
                  icon={<IconAutomata size={14} />}
                  isSelected={activeAutomataId === automata.id}
                  onClick={() => handleAutomataClick(automata.id)}
                  onDoubleClick={() => handleAutomataDoubleClick(automata.id, automata.config.name)}
                />
              ))
            )}
          </div>
        )}
      </div>
      
      {/* Servers & Devices Section */}
      <div className="explorer-section">
        <div
          className="explorer-section-header"
          onClick={() => toggleSection('servers')}
        >
          {expandedSections.servers ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
          <span>NETWORK</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--spacing-1)' }}>
            <button
              className="btn btn-ghost btn-icon"
              style={{ width: 20, height: 20, padding: 0 }}
              title="Refresh"
              onClick={(e) => {
                e.stopPropagation();
                handleRefresh();
              }}
            >
              <IconRefresh size={12} />
            </button>
          </div>
        </div>
        
        {expandedSections.servers && (
          <div className="explorer-section-content">
            {!isConnected ? (
              <div style={{ padding: 'var(--spacing-3)', color: 'var(--color-text-tertiary)', fontSize: 'var(--font-size-sm)' }}>
                Not connected to gateway
              </div>
            ) : servers.length === 0 ? (
              <div style={{ padding: 'var(--spacing-3)', color: 'var(--color-text-tertiary)', fontSize: 'var(--font-size-sm)' }}>
                No servers found
              </div>
            ) : (
              servers.map((server) => {
                const serverDevices = devices.filter((d) => d.serverId === server.id);
                const isExpanded = expandedItems.has(server.id);
                
                return (
                  <React.Fragment key={server.id}>
                    <TreeItem
                      label={server.name}
                      icon={<IconServer size={14} />}
                      hasChildren={serverDevices.length > 0}
                      isExpanded={isExpanded}
                      onToggle={() => toggleItem(server.id)}
                      statusIndicator={server.status === 'connected' ? 'online' : 'offline'}
                    />
                    
                    {isExpanded && serverDevices.map((device) => (
                      <TreeItem
                        key={device.id}
                        label={device.name}
                        icon={<IconDevice size={14} />}
                        depth={1}
                        statusIndicator={getDeviceStatus(device.status)}
                      />
                    ))}
                  </React.Fragment>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
};
