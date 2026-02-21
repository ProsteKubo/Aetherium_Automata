/**
 * Aetherium Automata - App Header Component
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  selectIsConnected,
  useAutomataStore,
  useGatewayStore,
  useProjectStore,
  useUIStore,
} from '../../stores';
import { IconChevronRight, IconSearch, IconSettings, IconZap } from './Icons';

// ============================================================================
// File Menu Icons
// ============================================================================

const IconFile: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <path d="M4 1h5l4 4v9a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1zm4.5 1H4v12h8V5.5H8.5V2z" />
  </svg>
);

const IconFolder: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <path d="M1 3h5l1 1h7v10H1V3zm1 2v8h12V5H6.5l-1-1H2z" />
  </svg>
);

const IconSave: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <path d="M2 1h10l2 2v11a1 1 0 01-1 1H3a1 1 0 01-1-1V2a1 1 0 011-1zm1 1v12h10V3.5l-1.5-1.5H3zm2 9h6v2H5v-2zm1-7h4v3H6V4z" />
  </svg>
);

const IconExport: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <path d="M8 1l4 4h-3v5H7V5H4l4-4zM2 12v2h12v-2h1v3H1v-3h1z" />
  </svg>
);

const IconRecent: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <path d="M8 1a7 7 0 107 7 7 7 0 00-7-7zm0 12.5A5.5 5.5 0 1113.5 8 5.51 5.51 0 018 13.5zM8.5 4v4.25l3 1.5-.5 1L7 9V4h1.5z" />
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
}

const MenuItem: React.FC<MenuItemProps> = ({ label, icon, shortcut, onClick, disabled }) => (
  <button
    type="button"
    className="header-menu-item"
    onClick={onClick}
    disabled={disabled}
  >
    {icon && <span className="header-menu-item-icon">{icon}</span>}
    <span className="header-menu-item-label">{label}</span>
    {shortcut && <span className="header-menu-item-shortcut">{shortcut}</span>}
  </button>
);

const MenuDivider: React.FC = () => <div className="header-menu-divider" />;

// ============================================================================
// Main Header Component
// ============================================================================

export const AppHeader: React.FC = () => {
  const isConnected = useGatewayStore(selectIsConnected);
  const status = useGatewayStore((state) => state.status);
  const togglePanel = useUIStore((state) => state.togglePanel);
  const setCommandPaletteOpen = useUIStore((state) => state.setCommandPaletteOpen);

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
  const menuRootRef = useRef<HTMLDivElement>(null);

  const closeMenus = useCallback(() => {
    setFileMenuOpen(false);
    setRecentMenuOpen(false);
  }, []);

  useEffect(() => {
    loadRecentProjects();
  }, [loadRecentProjects]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      if (menuRootRef.current && !menuRootRef.current.contains(event.target as Node)) {
        closeMenus();
      }
    };

    if (fileMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [closeMenus, fileMenuOpen]);

  const handleNew = useCallback(async () => {
    closeMenus();
    await createProject();
  }, [closeMenus, createProject]);

  const handleOpen = useCallback(async () => {
    closeMenus();
    await openProject();
  }, [closeMenus, openProject]);

  const handleSave = useCallback(async () => {
    closeMenus();
    await saveProject();
  }, [closeMenus, saveProject]);

  const handleSaveAs = useCallback(async () => {
    closeMenus();
    await saveProjectAs();
  }, [closeMenus, saveProjectAs]);

  const handleExportAutomata = useCallback(async () => {
    closeMenus();
    if (activeAutomataId) {
      const automata = automataMap.get(activeAutomataId);
      if (automata && window.api?.automata?.saveYaml) {
        await window.api.automata.saveYaml(automata);
      }
    }
  }, [activeAutomataId, automataMap, closeMenus]);

  const handleOpenRecent = useCallback(
    async (filePath: string) => {
      closeMenus();
      await openRecentProject(filePath);
    },
    [closeMenus, openRecentProject],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const isMac = navigator.platform.toUpperCase().includes('MAC');
      const ctrlOrCmd = isMac ? event.metaKey : event.ctrlKey;

      if (event.key === 'Escape') {
        closeMenus();
      } else if (ctrlOrCmd && event.key === 'k') {
        event.preventDefault();
        setCommandPaletteOpen(true);
      } else if (ctrlOrCmd && event.key === 's') {
        event.preventDefault();
        if (event.shiftKey) {
          void handleSaveAs();
        } else {
          void handleSave();
        }
      } else if (ctrlOrCmd && event.key === 'o') {
        event.preventDefault();
        void handleOpen();
      } else if (ctrlOrCmd && event.key === 'n') {
        event.preventDefault();
        void handleNew();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeMenus, handleNew, handleOpen, handleSave, handleSaveAs, setCommandPaletteOpen]);

  const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');
  const modKey = isMac ? '⌘' : 'Ctrl';

  return (
    <header className="app-header">
      <div className="app-header-left">
        <div className="app-logo">
          <IconZap size={17} className="app-logo-icon" />
          <span>Aetherium</span>
        </div>

        <div className="header-menu-root" ref={menuRootRef}>
          <button
            type="button"
            className={`header-menu-trigger ${fileMenuOpen ? 'open' : ''}`}
            onClick={() => {
              setFileMenuOpen((prev) => !prev);
              setRecentMenuOpen(false);
            }}
            aria-expanded={fileMenuOpen}
          >
            File
          </button>

          {fileMenuOpen && (
            <div className="header-menu-dropdown" role="menu">
              <MenuItem
                label="New Project"
                icon={<IconFile size={14} />}
                shortcut={`${modKey}+N`}
                onClick={() => void handleNew()}
              />
              <MenuItem
                label="Open Project..."
                icon={<IconFolder size={14} />}
                shortcut={`${modKey}+O`}
                onClick={() => void handleOpen()}
              />

              {recentProjects.length > 0 && (
                <div className="header-submenu-root">
                  <button
                    type="button"
                    className="header-menu-item"
                    onClick={() => setRecentMenuOpen((prev) => !prev)}
                    aria-expanded={recentMenuOpen}
                  >
                    <span className="header-menu-item-icon">
                      <IconRecent size={14} />
                    </span>
                    <span className="header-menu-item-label">Open Recent</span>
                    <span className="header-menu-item-shortcut">
                      <IconChevronRight size={12} />
                    </span>
                  </button>

                  {recentMenuOpen && (
                    <div className="header-submenu-dropdown">
                      {recentProjects.slice(0, 10).map((recent) => (
                        <MenuItem
                          key={recent.filePath}
                          label={recent.name}
                          onClick={() => void handleOpenRecent(recent.filePath)}
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
                onClick={() => void handleSave()}
                disabled={!project || isSaving}
              />
              <MenuItem
                label="Save As..."
                icon={<IconSave size={14} />}
                shortcut={`${modKey}+Shift+S`}
                onClick={() => void handleSaveAs()}
                disabled={!project || isSaving}
              />

              <MenuDivider />

              <MenuItem
                label="Export Automata as YAML..."
                icon={<IconExport size={14} />}
                onClick={() => void handleExportAutomata()}
                disabled={!activeAutomataId}
              />
            </div>
          )}
        </div>

        {project && (
          <div className="header-project-chip">
            <span className="header-project-name">{project.metadata.name}</span>
            {isDirty && <span className="header-project-dirty" title="Unsaved changes" />}
          </div>
        )}
      </div>

      <div className="app-header-center">
        <button
          type="button"
          className="header-search-trigger"
          onClick={() => setCommandPaletteOpen(true)}
          title={`Quick Search (${modKey}+K)`}
        >
          <IconSearch size={14} />
          <span>Search commands, files, automata...</span>
          <span className="header-search-shortcut">{modKey}+K</span>
        </button>
      </div>

      <div className="app-header-right">
        {isSaving && <span className="header-saving-state">Saving...</span>}

        <div className={`header-connection-pill ${isConnected ? 'connected' : 'disconnected'}`}>
          <span className={`status-indicator ${isConnected ? 'online' : 'offline'}`} />
          <span>{status === 'connected' ? 'Gateway Online' : 'Gateway Offline'}</span>
        </div>

        <button
          type="button"
          className="btn btn-ghost btn-icon"
          onClick={() => togglePanel('gateway')}
          title="Gateway panel"
        >
          <IconSettings size={16} />
        </button>
      </div>
    </header>
  );
};
