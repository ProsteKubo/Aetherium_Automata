/**
 * Aetherium Automata - Workspace Toolbar
 *
 * Intent-based controls for modes and panels.
 */

import React from 'react';
import { useUIStore } from '../../stores';
import type { PanelId } from '../../types';
import {
  IconAnalyzer,
  IconAutomata,
  IconBlackBox,
  IconConsole,
  IconDevice,
  IconExplorer,
  IconGateway,
  IconNetwork,
  IconRuntime,
  IconTimeTravel,
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
    : layout.panels.timeline.isVisible
      ? 'timeline'
    : layout.panels.network.isVisible
      ? 'network'
    : layout.panels.analyzer.isVisible
      ? 'analyzer'
    : layout.panels.blackboxes.isVisible
      ? 'blackboxes'
    : layout.panels.petri.isVisible
      ? 'petri'
      : 'automata';

  return (
    <nav className="activity-bar activity-bar-compact" aria-label="Workspace Controls">
      <div className="activity-bar-center">
        <ToolbarButton
          icon={<IconNetwork size={20} />}
          label="Topology"
          active={modePanel === 'network'}
          onClick={() => activatePanel('network')}
        />
        <ToolbarButton
          icon={<IconNetwork size={20} />}
          label="Petri Net"
          active={modePanel === 'petri'}
          onClick={() => activatePanel('petri')}
        />
        <ToolbarButton
          icon={<IconAutomata size={20} />}
          label="Logic Editor"
          active={modePanel === 'automata'}
          onClick={() => activatePanel('automata')}
        />
        <ToolbarButton
          icon={<IconGateway size={20} />}
          label="Fault Lab"
          active={!sidebarCollapsed && sidebarPanel === 'gateway'}
          onClick={() => switchSidebarPanel('gateway')}
        />
        <ToolbarButton
          icon={<IconRuntime size={20} />}
          label="Debugger"
          active={modePanel === 'runtime'}
          onClick={() => activatePanel('runtime')}
        />
        <ToolbarButton
          icon={<IconTimeTravel size={20} />}
          label="Timeline"
          active={modePanel === 'timeline'}
          onClick={() => activatePanel('timeline')}
        />
        <ToolbarButton
          icon={<IconAnalyzer size={20} />}
          label="Analyzer"
          active={modePanel === 'analyzer'}
          onClick={() => activatePanel('analyzer')}
        />
        <ToolbarButton
          icon={<IconBlackBox size={20} />}
          label="Black Boxes"
          active={modePanel === 'blackboxes'}
          onClick={() => activatePanel('blackboxes')}
        />
      </div>

      <div className="activity-bar-bottom">
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
          icon={<IconConsole size={20} />}
          label="Console"
          active={layout.panels.console.isVisible}
          onClick={() => togglePanel('console')}
        />
      </div>
    </nav>
  );
};
