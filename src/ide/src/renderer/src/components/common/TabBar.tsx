/**
 * Aetherium Automata - Tab Bar Component
 */

import React from 'react';
import { useUIStore } from '../../stores';
import { IconX, IconAutomata, IconDevice, IconSettings } from './Icons';

const getTabIcon = (type: string) => {
  switch (type) {
    case 'automata':
      return <IconAutomata size={14} />;
    case 'device':
      return <IconDevice size={14} />;
    case 'settings':
      return <IconSettings size={14} />;
    default:
      return <IconAutomata size={14} />;
  }
};

export const TabBar: React.FC = () => {
  const tabs = useUIStore((state) => state.tabs);
  const setActiveTab = useUIStore((state) => state.setActiveTab);
  const closeTab = useUIStore((state) => state.closeTab);
  
  if (tabs.length === 0) {
    return null;
  }
  
  return (
    <div className="tab-bar">
      <div className="tab-bar-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`editor-tab ${tab.isActive ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="editor-tab-icon">{getTabIcon(tab.type)}</span>
            <span className="editor-tab-name">{tab.name}</span>
            {tab.isDirty && <span className="editor-tab-dirty" />}
            <span
              className="editor-tab-close"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
            >
              <IconX size={12} />
            </span>
          </button>
        ))}
      </div>
      
      <div className="tab-bar-actions">
        {/* Add tab bar action buttons here if needed */}
      </div>
    </div>
  );
};
