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
  const visible = store.layout.panels[panelId]?.isVisible ?? false;

  if (visible && !store.sidebarCollapsed) {
    store.toggleSidebar();
  } else {
    if (store.sidebarCollapsed) {
      store.toggleSidebar();
    }
    activatePanel(panelId);
  }
};

export const ActivityBar: React.FC = () => {
  const layout = useUIStore((state) => state.layout);
  const sidebarCollapsed = useUIStore((state) => state.sidebarCollapsed);
  const togglePanel = useUIStore((state) => state.togglePanel);

  const sidebarPanel: PanelId = layout.panels.explorer.isVisible
    ? 'explorer'
    : layout.panels.devices.isVisible
      ? 'devices'
      : 'gateway';

  const modePanel: PanelId = layout.panels.runtime.isVisible
    ? 'runtime'
    : layout.panels.network.isVisible
      ? 'network'
    : layout.panels.petri.isVisible
      ? 'petri'
      : 'automata';

  return (
    <nav className="activity-bar" aria-label="Workspace Controls">
      <div className="activity-bar-top">
        <ToolbarButton
          icon={<IconExplorer size={20} />}
          label="Explorer"
          active={!sidebarCollapsed && sidebarPanel === 'explorer'}
          onClick={() => switchSidebarPanel('explorer')}
        />
        <ToolbarButton
          icon={<IconDevice size={20} />}
          label="Devices"
          active={!sidebarCollapsed && sidebarPanel === 'devices'}
          onClick={() => switchSidebarPanel('devices')}
        />
        <ToolbarButton
          icon={<IconGateway size={20} />}
          label="Gateway"
          active={!sidebarCollapsed && sidebarPanel === 'gateway'}
          onClick={() => switchSidebarPanel('gateway')}
        />
      </div>

      <div className="activity-bar-center">
        <ToolbarButton
          icon={<IconAutomata size={20} />}
          label="Editor"
          active={modePanel === 'automata'}
          onClick={() => activatePanel('automata')}
        />
        <ToolbarButton
          icon={<IconNetwork size={20} />}
          label="Petri"
          active={modePanel === 'petri'}
          onClick={() => activatePanel('petri')}
        />
        <ToolbarButton
          icon={<IconNetwork size={20} />}
          label="Network"
          active={modePanel === 'network'}
          onClick={() => activatePanel('network')}
        />
        <ToolbarButton
          icon={<IconRuntime size={20} />}
          label="Runtime"
          active={modePanel === 'runtime'}
          onClick={() => activatePanel('runtime')}
        />
      </div>

      <div className="activity-bar-bottom">
        <ToolbarButton
          icon={<IconConsole size={20} />}
          label="Console"
          active={layout.panels.console.isVisible}
          onClick={() => togglePanel('console')}
        />
      </div>
    </nav>
  );
};
