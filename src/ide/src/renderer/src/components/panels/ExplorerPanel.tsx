/**
 * Aetherium Automata - Explorer Panel Component
 * 
 * Shows automata files, servers, and devices in a tree structure.
 * Supports nested automata and multiple automata creation.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useGatewayStore, useAutomataStore, useUIStore, useProjectStore } from '../../stores';
import {
  IconChevronRight,
  IconChevronDown,
  IconAutomata,
  IconServer,
  IconDevice,
  IconPlus,
  IconRefresh,
} from '../common/Icons';

// ============================================================================
// Create Automata Dialog
// ============================================================================

interface CreateAutomataDialogProps {
  isOpen: boolean;
  parentId?: string;
  onClose: () => void;
  onSubmit: (name: string, description: string) => void;
}

const CreateAutomataDialog: React.FC<CreateAutomataDialogProps> = ({
  isOpen,
  parentId,
  onClose,
  onSubmit,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onSubmit(name.trim(), description.trim());
      setName('');
      setDescription('');
    }
  };
  
  if (!isOpen) return null;
  
  return (
    <div 
      className="dialog-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div 
        className="dialog-content"
        style={{
          backgroundColor: 'var(--color-bg-secondary)',
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--spacing-4)',
          minWidth: 320,
          maxWidth: 400,
          border: '1px solid var(--color-border)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ marginBottom: 'var(--spacing-3)', fontSize: 'var(--font-size-lg)' }}>
          {parentId ? 'Create Nested Automata' : 'Create New Automata'}
        </h3>
        
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 'var(--spacing-3)' }}>
            <label 
              htmlFor="automata-name"
              style={{ 
                display: 'block', 
                marginBottom: 'var(--spacing-1)',
                fontSize: 'var(--font-size-sm)',
              }}
            >
              Name *
            </label>
            <input
              id="automata-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Automata"
              autoFocus
              style={{
                width: '100%',
                padding: 'var(--spacing-2)',
                backgroundColor: 'var(--color-bg-tertiary)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--color-text-primary)',
              }}
            />
          </div>
          
          <div style={{ marginBottom: 'var(--spacing-4)' }}>
            <label 
              htmlFor="automata-desc"
              style={{ 
                display: 'block', 
                marginBottom: 'var(--spacing-1)',
                fontSize: 'var(--font-size-sm)',
              }}
            >
              Description
            </label>
            <textarea
              id="automata-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description..."
              rows={3}
              style={{
                width: '100%',
                padding: 'var(--spacing-2)',
                backgroundColor: 'var(--color-bg-tertiary)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--color-text-primary)',
                resize: 'vertical',
              }}
            />
          </div>
          
          <div style={{ display: 'flex', gap: 'var(--spacing-2)', justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!name.trim()}
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ============================================================================
// Tree Item Component
// ============================================================================

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
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createParentId, setCreateParentId] = useState<string | undefined>(undefined);
  
  // Store data - use raw Maps and memoize the array conversion
  const isConnected = useGatewayStore((state) => state.status === 'connected');
  const serversMap = useGatewayStore((state) => state.servers);
  const devicesMap = useGatewayStore((state) => state.devices);
  const automataMap = useAutomataStore((state) => state.automata);
  const activeAutomataId = useAutomataStore((state) => state.activeAutomataId);
  const setActiveAutomata = useAutomataStore((state) => state.setActiveAutomata);
  const createAutomata = useAutomataStore((state) => state.createAutomata);
  const fetchAutomata = useAutomataStore((state) => state.fetchAutomata);
  const fetchServers = useGatewayStore((state) => state.fetchServers);
  const fetchDevices = useGatewayStore((state) => state.fetchDevices);
  const connect = useGatewayStore((state) => state.connect);
  const openTab = useUIStore((state) => state.openTab);
  
  // Project store
  const project = useProjectStore((state) => state.project);
  const createNetwork = useProjectStore((state) => state.createNetwork);
  const addAutomataToNetwork = useProjectStore((state) => state.addAutomataToNetwork);
  const markDirty = useProjectStore((state) => state.markDirty);
  
  // Memoize array conversions to prevent infinite re-renders
  const servers = useMemo(() => Array.from(serversMap.values()), [serversMap]);
  const devices = useMemo(() => Array.from(devicesMap.values()), [devicesMap]);
  const automataList = useMemo(() => Array.from(automataMap.values()), [automataMap]);
  
  // Get root automata (those without a parent)
  const rootAutomata = useMemo(() => 
    automataList.filter((a) => !a.parentAutomataId),
    [automataList]
  );
  
  // Get nested automata for a parent
  const getNestedAutomata = useCallback((parentId: string) => 
    automataList.filter((a) => a.parentAutomataId === parentId),
    [automataList]
  );
  
  // Auto-connect on mount (for demo purposes)
  useEffect(() => {
    if (!isConnected) {
      connect({
        host: 'localhost',
        port: 4000,
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
  
  const handleCreateAutomata = async (name: string, description: string) => {
    try {
      const automata = await createAutomata(name, description, createParentId);
      setShowCreateDialog(false);
      setCreateParentId(undefined);
      
      // Add automata to project
      if (project) {
        // Ensure there's at least one network
        let networkId = project.networks[0]?.id;
        if (!networkId) {
          networkId = createNetwork('Default Network');
        }
        
        // Add automata to network
        addAutomataToNetwork(networkId, automata);
        markDirty();
      }
      
      // Open the new automata in editor
      setActiveAutomata(automata.id);
      openTab({
        type: 'automata',
        targetId: automata.id,
        name: automata.config.name,
        isDirty: false,
      });
    } catch (error) {
      console.error('Failed to create automata:', error);
    }
  };
  
  const handleCreateNested = (parentId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCreateParentId(parentId);
    setShowCreateDialog(true);
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
  
  // Recursive component for rendering automata tree
  const AutomataTreeItem: React.FC<{ automata: typeof automataList[0]; depth: number }> = ({ automata, depth }) => {
    const nested = getNestedAutomata(automata.id);
    const hasNested = nested.length > 0;
    const isExpanded = expandedItems.has(automata.id);
    
    return (
      <React.Fragment key={automata.id}>
        <div 
          className={`tree-item ${activeAutomataId === automata.id ? 'selected' : ''}`}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => handleAutomataClick(automata.id)}
          onDoubleClick={() => handleAutomataDoubleClick(automata.id, automata.config.name)}
        >
          <span
            className="tree-item-toggle"
            onClick={(e) => {
              e.stopPropagation();
              toggleItem(automata.id);
            }}
          >
            {hasNested && (isExpanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />)}
          </span>
          <span className="tree-item-icon">
            <IconAutomata size={14} />
          </span>
          <span className="tree-item-label">{automata.config.name}</span>
          <button
            className="btn btn-ghost btn-icon tree-item-action"
            style={{ 
              width: 18, 
              height: 18, 
              padding: 0, 
              marginLeft: 'auto',
              opacity: 0.6,
            }}
            onClick={(e) => handleCreateNested(automata.id, e)}
            title="Add nested automata"
          >
            <IconPlus size={10} />
          </button>
        </div>
        
        {isExpanded && nested.map((child) => (
          <AutomataTreeItem key={child.id} automata={child} depth={depth + 1} />
        ))}
      </React.Fragment>
    );
  };
  
  return (
    <div className="explorer-panel">
      {/* Create Automata Dialog */}
      <CreateAutomataDialog
        isOpen={showCreateDialog}
        parentId={createParentId}
        onClose={() => {
          setShowCreateDialog(false);
          setCreateParentId(undefined);
        }}
        onSubmit={handleCreateAutomata}
      />
      
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
                setCreateParentId(undefined);
                setShowCreateDialog(true);
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
            {rootAutomata.length === 0 ? (
              <div style={{ padding: 'var(--spacing-3)', color: 'var(--color-text-tertiary)', fontSize: 'var(--font-size-sm)' }}>
                No automata yet. Click + to create one.
              </div>
            ) : (
              rootAutomata.map((automata) => (
                <AutomataTreeItem key={automata.id} automata={automata} depth={0} />
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
