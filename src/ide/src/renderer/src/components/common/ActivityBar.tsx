/**
 * Aetherium Automata - Workspace Toolbar
 *
 * Intent-based controls for modes and panels.
 */

import React from 'react';
import { useUIStore } from '../../stores';
import type { PanelId } from '../../types';
import {
  IconAutomata,
  IconConsole,
  IconDevice,
  IconExplorer,
  IconGateway,
  IconNetwork,
  IconRuntime,
  IconTimeTravel,
  IconChevronLeft,
  IconChevronRight,
  IconSettings,
  IconTransitions,
  IconVariables,
  IconConnections,
} from './Icons';

interface ToolbarButtonProps {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
}

const ToolbarButton: React.FC<ToolbarButtonProps> = ({ icon, label, active = false, onClick }) => (
  <button
    type="button"
    className={`workspace-tool-btn ${active ? 'active' : ''}`}
    onClick={onClick}
    title={label}
    aria-label={label}
    aria-pressed={active}
  >
    <span className="workspace-tool-icon">{icon}</span>
    <span className="workspace-tool-label">{label}</span>
  </button>
);

const activatePanel = (panelId: PanelId): void => {
  const store = useUIStore.getState();
  const visible = store.layout.panels[panelId]?.isVisible ?? false;
  if (!visible) {
    store.togglePanel(panelId);
  }
};

const switchSidebarPanel = (panelId: PanelId): void => {
  const store = useUIStore.getState();
  if (store.sidebarCollapsed) {
    store.toggleSidebar();
  }
  activatePanel(panelId);
};

export const ActivityBar: React.FC = () => {
  const layout = useUIStore((state) => state.layout);
  const sidebarCollapsed = useUIStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useUIStore((state) => state.toggleSidebar);
  const togglePanel = useUIStore((state) => state.togglePanel);

  const sidebarPanel: PanelId = layout.panels.explorer.isVisible
    ? 'explorer'
    : layout.panels.devices.isVisible
      ? 'devices'
      : 'gateway';

  const modePanel: PanelId = layout.panels.network.isVisible
    ? 'network'
    : layout.panels.runtime.isVisible
      ? 'runtime'
      : layout.panels.timetravel.isVisible
        ? 'timetravel'
        : 'automata';

  const inspectorPanel: PanelId = layout.panels.transitions.isVisible
    ? 'transitions'
    : layout.panels.variables.isVisible
      ? 'variables'
      : layout.panels.connections.isVisible
        ? 'connections'
        : 'properties';

  return (
    <nav className="workspace-toolbar" aria-label="Workspace Controls">
      <div className="workspace-toolbar-section">
        <ToolbarButton
          icon={sidebarCollapsed ? <IconChevronRight size={15} /> : <IconChevronLeft size={15} />}
          label={sidebarCollapsed ? 'Show Sidebar' : 'Hide Sidebar'}
          active={!sidebarCollapsed}
          onClick={toggleSidebar}
        />

        <ToolbarButton
          icon={<IconExplorer size={15} />}
          label="Explorer"
          active={!sidebarCollapsed && sidebarPanel === 'explorer'}
          onClick={() => switchSidebarPanel('explorer')}
        />
        <ToolbarButton
          icon={<IconDevice size={15} />}
          label="Devices"
          active={!sidebarCollapsed && sidebarPanel === 'devices'}
          onClick={() => switchSidebarPanel('devices')}
        />
        <ToolbarButton
          icon={<IconGateway size={15} />}
          label="Gateway"
          active={!sidebarCollapsed && sidebarPanel === 'gateway'}
          onClick={() => switchSidebarPanel('gateway')}
        />
      </div>

      <div className="workspace-toolbar-section workspace-toolbar-section-main">
        <ToolbarButton
          icon={<IconAutomata size={15} />}
          label="Editor"
          active={modePanel === 'automata'}
          onClick={() => activatePanel('automata')}
        />
        <ToolbarButton
          icon={<IconNetwork size={15} />}
          label="Network"
          active={modePanel === 'network'}
          onClick={() => activatePanel('network')}
        />
        <ToolbarButton
          icon={<IconRuntime size={15} />}
          label="Runtime"
          active={modePanel === 'runtime'}
          onClick={() => activatePanel('runtime')}
        />
        <ToolbarButton
          icon={<IconTimeTravel size={15} />}
          label="Time Travel"
          active={modePanel === 'timetravel'}
          onClick={() => activatePanel('timetravel')}
        />
      </div>

      <div className="workspace-toolbar-section">
        <ToolbarButton
          icon={<IconSettings size={15} />}
          label="Properties"
          active={inspectorPanel === 'properties' && layout.panels.properties.isVisible}
          onClick={() => activatePanel('properties')}
        />
        <ToolbarButton
          icon={<IconTransitions size={15} />}
          label="Transitions"
          active={inspectorPanel === 'transitions' && layout.panels.transitions.isVisible}
          onClick={() => activatePanel('transitions')}
        />
        <ToolbarButton
          icon={<IconVariables size={15} />}
          label="Variables"
          active={inspectorPanel === 'variables' && layout.panels.variables.isVisible}
          onClick={() => activatePanel('variables')}
        />
        <ToolbarButton
          icon={<IconConnections size={15} />}
          label="Connections"
          active={inspectorPanel === 'connections' && layout.panels.connections.isVisible}
          onClick={() => activatePanel('connections')}
        />
        <ToolbarButton
          icon={<IconConsole size={15} />}
          label="Console"
          active={layout.panels.console.isVisible}
          onClick={() => togglePanel('console')}
        />
      </div>
    </nav>
  );
};
