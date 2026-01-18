/**
 * Aetherium Automata - App Header Component
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useGatewayStore, selectIsConnected, useProjectStore, useAutomataStore } from '../../stores';
import { IconZap, IconSettings, IconSearch } from './Icons';

// ============================================================================
// File Menu Icons
// ============================================================================

const IconFile: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <path d="M4 1h5l4 4v9a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1zm4.5 1H4v12h8V5.5H8.5V2z"/>
  </svg>
);

const IconFolder: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <path d="M1 3h5l1 1h7v10H1V3zm1 2v8h12V5H6.5l-1-1H2z"/>
  </svg>
);

const IconSave: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <path d="M2 1h10l2 2v11a1 1 0 01-1 1H3a1 1 0 01-1-1V2a1 1 0 011-1zm1 1v12h10V3.5l-1.5-1.5H3zm2 9h6v2H5v-2zm1-7h4v3H6V4z"/>
  </svg>
);

const IconExport: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <path d="M8 1l4 4h-3v5H7V5H4l4-4zM2 12v2h12v-2h1v3H1v-3h1z"/>
  </svg>
);

const IconRecent: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <path d="M8 1a7 7 0 107 7 7 7 0 00-7-7zm0 12.5A5.5 5.5 0 1113.5 8 5.51 5.51 0 018 13.5zM8.5 4v4.25l3 1.5-.5 1L7 9V4h1.5z"/>
  </svg>
);

// ============================================================================
// Menu Item Component
// ============================================================================

interface MenuItemProps {
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}

const MenuItem: React.FC<MenuItemProps> = ({ label, icon, shortcut, onClick, disabled, danger }) => (
  <button
    className="menu-item"
    onClick={onClick}
    disabled={disabled}
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--spacing-2)',
      padding: 'var(--spacing-2) var(--spacing-3)',
      width: '100%',
      textAlign: 'left',
      background: 'none',
      border: 'none',
      color: danger ? 'var(--color-danger)' : disabled ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)',
      cursor: disabled ? 'not-allowed' : 'pointer',
      fontSize: 'var(--font-size-sm)',
      borderRadius: 'var(--radius-sm)',
    }}
  >
    {icon && <span style={{ opacity: 0.7 }}>{icon}</span>}
    <span style={{ flex: 1 }}>{label}</span>
    {shortcut && (
      <span style={{ 
        color: 'var(--color-text-tertiary)', 
        fontSize: 'var(--font-size-xs)',
      }}>
        {shortcut}
      </span>
    )}
  </button>
);

// ============================================================================
// Dropdown Menu Component
// ============================================================================

interface DropdownMenuProps {
  trigger: React.ReactNode;
  children: React.ReactNode;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

const DropdownMenu: React.FC<DropdownMenuProps> = ({ trigger, children, isOpen, onOpenChange }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onOpenChange(false);
      }
    };
    
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onOpenChange]);
  
  return (
    <div ref={menuRef} style={{ position: 'relative' }}>
      <div onClick={() => onOpenChange(!isOpen)}>{trigger}</div>
      {isOpen && (
        <div
          className="dropdown-menu"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            minWidth: 220,
            backgroundColor: 'var(--color-bg-secondary)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
            padding: 'var(--spacing-1)',
            zIndex: 1000,
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
};

const MenuDivider: React.FC = () => (
  <div style={{ 
    height: 1, 
    backgroundColor: 'var(--color-border)', 
    margin: 'var(--spacing-1) 0' 
  }} />
);

// ============================================================================
// Main Header Component
// ============================================================================

export const AppHeader: React.FC = () => {
  const isConnected = useGatewayStore(selectIsConnected);
  const status = useGatewayStore((state) => state.status);
  
  // Project store
  const createProject = useProjectStore((state) => state.createProject);
  const openProject = useProjectStore((state) => state.openProject);
  const saveProject = useProjectStore((state) => state.saveProject);
  const saveProjectAs = useProjectStore((state) => state.saveProjectAs);
  const project = useProjectStore((state) => state.project);
  const isDirty = useProjectStore((state) => state.isDirty);
  const isSaving = useProjectStore((state) => state.isSaving);
  const recentProjects = useProjectStore((state) => state.recentProjects);
  const openRecentProject = useProjectStore((state) => state.openRecentProject);
  const loadRecentProjects = useProjectStore((state) => state.loadRecentProjects);
  
  // Automata store for exporting
  const automataMap = useAutomataStore((state) => state.automata);
  const activeAutomataId = useAutomataStore((state) => state.activeAutomataId);
  
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [recentMenuOpen, setRecentMenuOpen] = useState(false);
  
  // Load recent projects on mount
  useEffect(() => {
    loadRecentProjects();
  }, [loadRecentProjects]);
  
  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const ctrlOrCmd = isMac ? e.metaKey : e.ctrlKey;
      
      if (ctrlOrCmd && e.key === 's') {
        e.preventDefault();
        if (e.shiftKey) {
          handleSaveAs();
        } else {
          handleSave();
        }
      } else if (ctrlOrCmd && e.key === 'o') {
        e.preventDefault();
        handleOpen();
      } else if (ctrlOrCmd && e.key === 'n') {
        e.preventDefault();
        handleNew();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
  
  const handleNew = useCallback(async () => {
    setFileMenuOpen(false);
    await createProject();
  }, [createProject]);
  
  const handleOpen = useCallback(async () => {
    setFileMenuOpen(false);
    await openProject();
  }, [openProject]);
  
  const handleSave = useCallback(async () => {
    setFileMenuOpen(false);
    await saveProject();
  }, [saveProject]);
  
  const handleSaveAs = useCallback(async () => {
    setFileMenuOpen(false);
    await saveProjectAs();
  }, [saveProjectAs]);
  
  const handleExportAutomata = useCallback(async () => {
    setFileMenuOpen(false);
    if (activeAutomataId) {
      const automata = automataMap.get(activeAutomataId);
      if (automata && window.api?.automata?.saveYaml) {
        await window.api.automata.saveYaml(automata);
      }
    }
  }, [activeAutomataId, automataMap]);
  
  const handleOpenRecent = useCallback(async (filePath: string) => {
    setFileMenuOpen(false);
    setRecentMenuOpen(false);
    await openRecentProject(filePath);
  }, [openRecentProject]);
  
  const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const modKey = isMac ? '⌘' : 'Ctrl';
  
  return (
    <header className="app-header">
      <div className="app-header-left">
        <div className="app-logo">
          <IconZap size={18} className="app-logo-icon" />
          <span>AETHERIUM</span>
        </div>
        
        {/* File Menu */}
        <DropdownMenu
          trigger={
            <button 
              className="btn btn-ghost"
              style={{ fontSize: 'var(--font-size-sm)', padding: 'var(--spacing-1) var(--spacing-2)' }}
            >
              File
            </button>
          }
          isOpen={fileMenuOpen}
          onOpenChange={setFileMenuOpen}
        >
          <MenuItem
            label="New Project"
            icon={<IconFile size={14} />}
            shortcut={`${modKey}+N`}
            onClick={handleNew}
          />
          <MenuItem
            label="Open Project..."
            icon={<IconFolder size={14} />}
            shortcut={`${modKey}+O`}
            onClick={handleOpen}
          />
          
          {/* Recent Projects Submenu */}
          {recentProjects.length > 0 && (
            <div style={{ position: 'relative' }}>
              <button
                className="menu-item"
                onClick={() => setRecentMenuOpen(!recentMenuOpen)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--spacing-2)',
                  padding: 'var(--spacing-2) var(--spacing-3)',
                  width: '100%',
                  textAlign: 'left',
                  background: 'none',
                  border: 'none',
                  color: 'var(--color-text-primary)',
                  cursor: 'pointer',
                  fontSize: 'var(--font-size-sm)',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                <IconRecent size={14} />
                <span style={{ flex: 1 }}>Open Recent</span>
                <span style={{ color: 'var(--color-text-tertiary)' }}>▶</span>
              </button>
              
              {recentMenuOpen && (
                <div
                  style={{
                    position: 'absolute',
                    left: '100%',
                    top: 0,
                    marginLeft: 4,
                    minWidth: 280,
                    backgroundColor: 'var(--color-bg-secondary)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                    padding: 'var(--spacing-1)',
                    zIndex: 1001,
                    maxHeight: 300,
                    overflowY: 'auto',
                  }}
                >
                  {recentProjects.slice(0, 10).map((recent) => (
                    <MenuItem
                      key={recent.filePath}
                      label={recent.name}
                      onClick={() => handleOpenRecent(recent.filePath)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
          
          <MenuDivider />
          
          <MenuItem
            label="Save"
            icon={<IconSave size={14} />}
            shortcut={`${modKey}+S`}
            onClick={handleSave}
            disabled={!project || isSaving}
          />
          <MenuItem
            label="Save As..."
            icon={<IconSave size={14} />}
            shortcut={`${modKey}+Shift+S`}
            onClick={handleSaveAs}
            disabled={!project || isSaving}
          />
          
          <MenuDivider />
          
          <MenuItem
            label="Export Automata as YAML..."
            icon={<IconExport size={14} />}
            onClick={handleExportAutomata}
            disabled={!activeAutomataId}
          />
        </DropdownMenu>
        
        {/* Show project name if loaded */}
        {project && (
          <span style={{ 
            marginLeft: 'var(--spacing-3)',
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text-secondary)',
          }}>
            {project.metadata.name}
            {isDirty && <span style={{ color: 'var(--color-warning)' }}> •</span>}
          </span>
        )}
      </div>
      
      <div className="app-header-center">
        <button 
          className="btn btn-ghost"
          style={{ 
            width: '300px', 
            justifyContent: 'flex-start',
            color: 'var(--color-text-tertiary)',
            fontSize: 'var(--font-size-sm)'
          }}
        >
          <IconSearch size={14} />
          <span>Search commands, files, automata...</span>
          <span style={{ marginLeft: 'auto', opacity: 0.5, fontSize: 'var(--font-size-xs)' }}>
            {modKey}+K
          </span>
        </button>
      </div>
      
      <div className="app-header-right">
        {isSaving && (
          <span style={{ 
            fontSize: 'var(--font-size-xs)', 
            color: 'var(--color-text-tertiary)',
            marginRight: 'var(--spacing-2)',
          }}>
            Saving...
          </span>
        )}
        
        <div 
          className={`status-bar-item ${isConnected ? 'connected' : 'disconnected'}`}
          style={{ 
            padding: 'var(--spacing-1) var(--spacing-2)',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--font-size-xs)'
          }}
        >
          <span 
            className={`status-indicator ${isConnected ? 'online' : 'offline'}`} 
            style={{ width: 6, height: 6 }}
          />
          <span>{status === 'connected' ? 'Gateway Connected' : 'Disconnected'}</span>
        </div>
        
        <button className="btn btn-ghost btn-icon">
          <IconSettings size={18} />
        </button>
      </div>
    </header>
  );
};
