/**
 * Aetherium Automata - Project Explorer Panel
 * 
 * Solution Explorer-style hierarchical view:
 * Project > Networks > Automata > Sub-Automata
 * 
 * Features:
 * - Tree view with expand/collapse
 * - Context menus for CRUD operations
 * - Drag-drop reordering
 * - Inline rename
 * - Status indicators (dirty, error)
 * - Quick actions
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useProjectStore, useAutomataStore, useUIStore } from '../../stores';
import type { TreeNode } from '../../types/project';
import {
  IconChevronRight,
  IconChevronDown,
  IconPlus,
  IconRefresh,
} from '../common/Icons';

// ============================================================================
// Icons for different node types
// ============================================================================

const ProjectIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <path d="M1.5 1h13l.5.5v13l-.5.5h-13l-.5-.5v-13l.5-.5zM2 2v12h12V2H2z"/>
    <path d="M3 4h10v1H3V4zm0 3h10v1H3V7zm0 3h7v1H3v-1z"/>
  </svg>
);

const FolderIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <path d="M14.5 3H7.71l-.85-.85L6.51 2H1.5l-.5.5v11l.5.5h13l.5-.5v-10l-.5-.5zm-.5 8.5l-7-3.5-5 2.5V4h4.29l.85.85.35.15h7v6.5z"/>
  </svg>
);

const FolderOpenIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <path d="M1.5 14h11l.48-.37 2.63-7-.48-.63H14V3.5l-.5-.5H7.71l-.86-.85L6.5 2h-5l-.5.5v11l.5.5zM2 3h4.29l.86.85.35.15H13v2H8.5l-.35.15-.86.85H3.5l-.47.34-1 3.5L2 3zm10.13 10H2.19l1.67-5.84.14-.16h3.29l.85-.85.36-.15h5.37l-2.74 7z"/>
  </svg>
);

const NetworkIcon: React.FC<{ size?: number; isExpanded?: boolean }> = ({ size = 16, isExpanded }) => (
  isExpanded ? <FolderOpenIcon size={size} /> : <FolderIcon size={size} />
);

const AutomataIcon: React.FC<{ size?: number; isRoot?: boolean }> = ({ size = 16, isRoot }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <circle cx="8" cy="8" r="5" fill={isRoot ? 'var(--color-primary)' : 'none'} />
    <circle cx="8" cy="8" r="2" fill="currentColor" />
    {isRoot && <circle cx="8" cy="8" r="6.5" strokeDasharray="2 2" />}
  </svg>
);

// ============================================================================
// Context Menu
// ============================================================================

interface ContextMenuProps {
  x: number;
  y: number;
  nodeType: TreeNode['type'];
  onClose: () => void;
  onAction: (action: string) => void;
}

const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, nodeType, onClose, onAction }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);
  
  const getMenuItems = () => {
    switch (nodeType) {
      case 'project':
        return [
          { id: 'new-network', label: 'New Network', shortcut: 'Ctrl+Shift+N' },
          { id: 'divider-1', type: 'divider' },
          { id: 'save', label: 'Save Project', shortcut: 'Ctrl+S' },
          { id: 'save-as', label: 'Save As...', shortcut: 'Ctrl+Shift+S' },
          { id: 'divider-2', type: 'divider' },
          { id: 'close', label: 'Close Project' },
        ];
      case 'network':
        return [
          { id: 'new-automata', label: 'New Automata', shortcut: 'Ctrl+N' },
          { id: 'import-automata', label: 'Import Automata...' },
          { id: 'divider-1', type: 'divider' },
          { id: 'rename', label: 'Rename', shortcut: 'F2' },
          { id: 'delete', label: 'Delete Network', shortcut: 'Del' },
          { id: 'divider-2', type: 'divider' },
          { id: 'expand-all', label: 'Expand All' },
          { id: 'collapse-all', label: 'Collapse All' },
        ];
      case 'automata':
        return [
          { id: 'open', label: 'Open in Editor', shortcut: 'Enter' },
          { id: 'divider-1', type: 'divider' },
          { id: 'new-sub-automata', label: 'New Sub-Automata' },
          { id: 'set-root', label: 'Set as Root ★' },
          { id: 'divider-2', type: 'divider' },
          { id: 'rename', label: 'Rename', shortcut: 'F2' },
          { id: 'duplicate', label: 'Duplicate', shortcut: 'Ctrl+D' },
          { id: 'export-yaml', label: 'Export as YAML...' },
          { id: 'divider-3', type: 'divider' },
          { id: 'delete', label: 'Delete Automata', shortcut: 'Del' },
        ];
      default:
        return [];
    }
  };
  
  const items = getMenuItems();
  
  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{
        position: 'fixed',
        top: y,
        left: x,
        zIndex: 1000,
        minWidth: 200,
        backgroundColor: 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-lg)',
        padding: 'var(--spacing-1) 0',
      }}
    >
      {items.map((item) => {
        if (item.type === 'divider') {
          return (
            <div
              key={item.id}
              style={{
                height: 1,
                backgroundColor: 'var(--color-border)',
                margin: 'var(--spacing-1) 0',
              }}
            />
          );
        }
        
        return (
          <button
            key={item.id}
            className="context-menu-item"
            onClick={() => {
              onAction(item.id);
              onClose();
            }}
            style={{
              display: 'flex',
              width: '100%',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: 'var(--spacing-2) var(--spacing-3)',
              background: 'none',
              border: 'none',
              color: 'var(--color-text-primary)',
              cursor: 'pointer',
              fontSize: 'var(--font-size-sm)',
              textAlign: 'left',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            <span>{item.label}</span>
            {item.shortcut && (
              <span style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--font-size-xs)' }}>
                {item.shortcut}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};

// ============================================================================
// Tree Item Component
// ============================================================================

interface TreeItemComponentProps {
  node: TreeNode;
  depth: number;
  onSelect: (nodeId: string) => void;
  onToggle: (nodeId: string) => void;
  onDoubleClick: (node: TreeNode) => void;
  onContextMenu: (e: React.MouseEvent, node: TreeNode) => void;
  onRename: (nodeId: string, newName: string) => void;
  isRenaming: boolean;
  onStartRename: () => void;
  onCancelRename: () => void;
}

const TreeItemComponent: React.FC<TreeItemComponentProps> = ({
  node,
  depth,
  onSelect,
  onToggle,
  onDoubleClick,
  onContextMenu,
  onRename,
  isRenaming,
  onStartRename,
  onCancelRename,
}) => {
  const [renameValue, setRenameValue] = useState(node.name.replace(' ★', ''));
  const inputRef = useRef<HTMLInputElement>(null);
  
  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isRenaming]);
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      onRename(node.id, renameValue);
    } else if (e.key === 'Escape') {
      setRenameValue(node.name.replace(' ★', ''));
      onCancelRename();
    }
  };
  
  const getIcon = () => {
    switch (node.type) {
      case 'project':
        return <ProjectIcon size={14} />;
      case 'network':
        return <NetworkIcon size={14} isExpanded={node.isExpanded} />;
      case 'automata':
        return <AutomataIcon size={14} isRoot={node.name.includes('★')} />;
      default:
        return null;
    }
  };
  
  const hasChildren = node.children && node.children.length > 0;
  
  return (
    <>
      <div
        className={`tree-item ${node.isSelected ? 'selected' : ''}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: 'var(--spacing-1) var(--spacing-2)',
          paddingLeft: `${depth * 16 + 8}px`,
          cursor: 'pointer',
          borderRadius: 'var(--radius-sm)',
          backgroundColor: node.isSelected ? 'var(--color-bg-active)' : 'transparent',
          color: node.isSelected ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
        }}
        onClick={() => onSelect(node.id)}
        onDoubleClick={() => onDoubleClick(node)}
        onContextMenu={(e) => onContextMenu(e, node)}
      >
        {/* Expand/Collapse toggle */}
        <span
          style={{
            width: 16,
            height: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginRight: 'var(--spacing-1)',
            opacity: hasChildren ? 1 : 0,
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) onToggle(node.id);
          }}
        >
          {hasChildren && (
            node.isExpanded ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />
          )}
        </span>
        
        {/* Icon */}
        <span style={{ marginRight: 'var(--spacing-2)', display: 'flex' }}>
          {getIcon()}
        </span>
        
        {/* Name (or input for rename) */}
        {isRenaming ? (
          <input
            ref={inputRef}
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              onRename(node.id, renameValue);
            }}
            style={{
              flex: 1,
              padding: '2px 4px',
              fontSize: 'var(--font-size-sm)',
              backgroundColor: 'var(--color-bg-primary)',
              border: '1px solid var(--color-primary)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--color-text-primary)',
              outline: 'none',
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span style={{ flex: 1, fontSize: 'var(--font-size-sm)' }}>
            {node.name}
          </span>
        )}
        
        {/* Status indicators */}
        {node.isDirty && (
          <span style={{ marginLeft: 'var(--spacing-1)', color: 'var(--color-warning)' }}>●</span>
        )}
        {node.status === 'error' && (
          <span style={{ marginLeft: 'var(--spacing-1)', color: 'var(--color-error)' }}>⚠</span>
        )}
      </div>
      
      {/* Render children */}
      {node.isExpanded && node.children.map((child) => (
        <TreeItemComponent
          key={child.id}
          node={child}
          depth={depth + 1}
          onSelect={onSelect}
          onToggle={onToggle}
          onDoubleClick={onDoubleClick}
          onContextMenu={onContextMenu}
          onRename={onRename}
          isRenaming={false}
          onStartRename={onStartRename}
          onCancelRename={onCancelRename}
        />
      ))}
    </>
  );
};

// ============================================================================
// Welcome Screen (No Project)
// ============================================================================

const WelcomeScreen: React.FC = () => {
  const createProject = useProjectStore((s) => s.createProject);
  const openProject = useProjectStore((s) => s.openProject);
  const recentProjects = useProjectStore((s) => s.recentProjects);
  const openRecentProject = useProjectStore((s) => s.openRecentProject);
  const loadRecentProjects = useProjectStore((s) => s.loadRecentProjects);
  
  useEffect(() => {
    loadRecentProjects();
  }, [loadRecentProjects]);
  
  return (
    <div style={{ padding: 'var(--spacing-4)' }}>
      <h3 style={{ marginBottom: 'var(--spacing-4)', color: 'var(--color-text-primary)' }}>
        Aetherium Automata
      </h3>
      
      {/* Quick Actions */}
      <div style={{ marginBottom: 'var(--spacing-4)' }}>
        <button
          className="btn btn-primary"
          style={{ width: '100%', marginBottom: 'var(--spacing-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--spacing-2)' }}
          onClick={() => createProject()}
        >
          <IconPlus size={14} />
          New Project
        </button>
        <button
          className="btn btn-secondary"
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--spacing-2)' }}
          onClick={() => openProject()}
        >
          <FolderIcon size={14} />
          Open Project...
        </button>
      </div>
      
      {/* Recent Projects */}
      {recentProjects.length > 0 && (
        <div>
          <h4 style={{ 
            fontSize: 'var(--font-size-xs)', 
            color: 'var(--color-text-tertiary)',
            marginBottom: 'var(--spacing-2)',
            textTransform: 'uppercase',
          }}>
            Recent Projects
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-1)' }}>
            {recentProjects.slice(0, 5).map((project) => (
              <button
                key={project.filePath}
                className="btn btn-ghost"
                style={{
                  justifyContent: 'flex-start',
                  padding: 'var(--spacing-2)',
                  textAlign: 'left',
                }}
                onClick={() => openRecentProject(project.filePath)}
              >
                <ProjectIcon size={14} />
                <span style={{ marginLeft: 'var(--spacing-2)', flex: 1 }}>
                  {project.name}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// Main Explorer Panel
// ============================================================================

export const ProjectExplorerPanel: React.FC = () => {
  const project = useProjectStore((s) => s.project);
  const isLoaded = useProjectStore((s) => s.isLoaded);
  const treeNodes = useProjectStore((s) => s.treeNodes);
  const selectedNodeId = useProjectStore((s) => s.selectedNodeId);
  const selectNode = useProjectStore((s) => s.selectNode);
  const toggleNodeExpanded = useProjectStore((s) => s.toggleNodeExpanded);
  const createNetwork = useProjectStore((s) => s.createNetwork);
  const deleteNetwork = useProjectStore((s) => s.deleteNetwork);
  const renameNetwork = useProjectStore((s) => s.renameNetwork);
  const saveProject = useProjectStore((s) => s.saveProject);
  const closeProject = useProjectStore((s) => s.closeProject);
  
  const setActiveAutomata = useAutomataStore((s) => s.setActiveAutomata);
  const openTab = useUIStore((s) => s.openTab);
  
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    node: TreeNode;
  } | null>(null);
  
  const [renamingNodeId, setRenamingNodeId] = useState<string | null>(null);
  
  // Handle double-click to open
  const handleDoubleClick = useCallback((node: TreeNode) => {
    if (node.type === 'automata') {
      setActiveAutomata(node.entityId);
      openTab({
        type: 'automata',
        targetId: node.entityId,
        name: node.name.replace(' ★', ''),
        isDirty: node.isDirty,
      });
    }
  }, [setActiveAutomata, openTab]);
  
  // Handle context menu
  const handleContextMenu = useCallback((e: React.MouseEvent, node: TreeNode) => {
    e.preventDefault();
    selectNode(node.id);
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      node,
    });
  }, [selectNode]);
  
  // Handle context menu actions
  const handleContextMenuAction = useCallback((action: string) => {
    if (!contextMenu) return;
    
    const { node } = contextMenu;
    
    switch (action) {
      case 'new-network':
        createNetwork('New Network');
        break;
      case 'save':
        saveProject();
        break;
      case 'close':
        closeProject();
        break;
      case 'new-automata':
        // TODO: Create automata in network
        console.log('Create automata in network:', node.entityId);
        break;
      case 'rename':
        setRenamingNodeId(node.id);
        break;
      case 'delete':
        if (node.type === 'network') {
          if (confirm(`Delete network "${node.name}" and all its automata?`)) {
            deleteNetwork(node.entityId);
          }
        }
        break;
      case 'open':
        handleDoubleClick(node);
        break;
      default:
        console.log('Context menu action:', action, node);
    }
    
    setContextMenu(null);
  }, [contextMenu, createNetwork, saveProject, closeProject, deleteNetwork, handleDoubleClick]);
  
  // Handle rename
  const handleRename = useCallback((nodeId: string, newName: string) => {
    const node = findNodeById(treeNodes, nodeId);
    if (node && node.type === 'network') {
      renameNetwork(node.entityId, newName);
    }
    setRenamingNodeId(null);
  }, [treeNodes, renameNetwork]);
  
  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!selectedNodeId) return;
      
      if (e.key === 'F2' && !renamingNodeId) {
        setRenamingNodeId(selectedNodeId);
        e.preventDefault();
      }
      
      if (e.key === 'Enter' && !renamingNodeId) {
        const node = findNodeById(treeNodes, selectedNodeId);
        if (node) handleDoubleClick(node);
        e.preventDefault();
      }
      
      if (e.key === 'Delete' && !renamingNodeId) {
        const node = findNodeById(treeNodes, selectedNodeId);
        if (node && node.type === 'network') {
          if (confirm(`Delete network "${node.name}"?`)) {
            deleteNetwork(node.entityId);
          }
        }
        e.preventDefault();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedNodeId, renamingNodeId, treeNodes, handleDoubleClick, deleteNetwork]);
  
  // Show welcome screen if no project
  if (!isLoaded || !project) {
    return <WelcomeScreen />;
  }
  
  return (
    <div className="project-explorer" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 'var(--spacing-2) var(--spacing-3)',
        borderBottom: '1px solid var(--color-border)',
      }}>
        <span style={{ 
          fontSize: 'var(--font-size-xs)', 
          color: 'var(--color-text-tertiary)',
          textTransform: 'uppercase',
          fontWeight: 600,
        }}>
          Explorer
        </span>
        <div style={{ display: 'flex', gap: 'var(--spacing-1)' }}>
          <button
            className="btn btn-ghost btn-icon"
            title="New Network"
            onClick={() => createNetwork('New Network')}
            style={{ padding: 4 }}
          >
            <IconPlus size={14} />
          </button>
          <button
            className="btn btn-ghost btn-icon"
            title="Refresh"
            style={{ padding: 4 }}
          >
            <IconRefresh size={14} />
          </button>
        </div>
      </div>
      
      {/* Tree */}
      <div style={{ flex: 1, overflow: 'auto', padding: 'var(--spacing-2)' }}>
        {treeNodes.map((node) => (
          <TreeItemComponent
            key={node.id}
            node={node}
            depth={0}
            onSelect={selectNode}
            onToggle={toggleNodeExpanded}
            onDoubleClick={handleDoubleClick}
            onContextMenu={handleContextMenu}
            onRename={handleRename}
            isRenaming={renamingNodeId === node.id}
            onStartRename={() => setRenamingNodeId(node.id)}
            onCancelRename={() => setRenamingNodeId(null)}
          />
        ))}
      </div>
      
      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          nodeType={contextMenu.node.type}
          onClose={() => setContextMenu(null)}
          onAction={handleContextMenuAction}
        />
      )}
    </div>
  );
};

// Helper function to find node by ID
function findNodeById(nodes: TreeNode[], id: string): TreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findNodeById(node.children, id);
      if (found) return found;
    }
  }
  return null;
}
