/**
 * Aetherium Automata - Activity Bar Component
 * 
 * The leftmost icon bar for main navigation.
 */

import React from 'react';
import { useUIStore } from '../../stores';
import type { PanelId } from '../../types';
import {
  IconExplorer,
  IconAutomata,
  IconDevice,
  IconNetwork,
  IconTimeTravel,
  IconConsole,
  IconSettings,
} from './Icons';

interface ActivityBarItemProps {
  icon: React.ReactNode;
  panelId: PanelId;
  label: string;
  badge?: number;
}

const ActivityBarItem: React.FC<ActivityBarItemProps> = ({
  icon,
  panelId,
  label,
  badge,
}) => {
  const togglePanel = useUIStore((state) => state.togglePanel);
  const panel = useUIStore((state) => state.layout.panels[panelId]);
  
  return (
    <div
      className={`activity-bar-item ${panel?.isVisible ? 'active' : ''}`}
      onClick={() => togglePanel(panelId)}
      title={label}
    >
      {icon}
      {badge !== undefined && badge > 0 && (
        <span className="activity-bar-item-badge">{badge > 99 ? '99+' : badge}</span>
      )}
    </div>
  );
};

export const ActivityBar: React.FC = () => {
  return (
    <div className="activity-bar">
      <div className="activity-bar-top">
        <ActivityBarItem
          icon={<IconExplorer size={22} />}
          panelId="explorer"
          label="Explorer"
        />
        <ActivityBarItem
          icon={<IconAutomata size={22} />}
          panelId="automata"
          label="Automata Editor"
        />
        <ActivityBarItem
          icon={<IconDevice size={22} />}
          panelId="devices"
          label="Devices"
        />
        <ActivityBarItem
          icon={<IconNetwork size={22} />}
          panelId="network"
          label="Network View"
        />
        <ActivityBarItem
          icon={<IconTimeTravel size={22} />}
          panelId="timetravel"
          label="Time Travel Debugger"
        />
      </div>
      
      <div className="activity-bar-bottom">
        <ActivityBarItem
          icon={<IconConsole size={22} />}
          panelId="console"
          label="Console"
        />
        <div
          className="activity-bar-item"
          title="Settings"
        >
          <IconSettings size={22} />
        </div>
      </div>
    </div>
  );
};
