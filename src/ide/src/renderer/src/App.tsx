/**
 * Aetherium Automata - Main Application Component
 * 
 * Root component that assembles the complete IDE layout.
 */

import React from 'react';
import { useUIStore, useAutomataStore } from './stores';
import {
  AppHeader,
  ActivityBar,
  StatusBar,
  TabBar,
  NotificationToasts,
} from './components/common';
import {
  ExplorerPanel,
  PropertiesPanel,
  OutputPanel,
  TimeTravelPanel,
  DevicesPanel,
} from './components/panels';
import { AutomataEditor, CodeEditor } from './components/editor';
import './styles/index.css';

// Panel content based on active panel
const PanelContent: React.FC<{ panelId: string }> = ({ panelId }) => {
  switch (panelId) {
    case 'explorer':
      return <ExplorerPanel />;
    case 'devices':
      return <DevicesPanel />;
    case 'timetravel':
      return <TimeTravelPanel />;
    case 'properties':
      return <PropertiesPanel />;
    case 'console':
      return <OutputPanel />;
    default:
      return null;
  }
};

// Editor content based on active tab
const EditorContent: React.FC = () => {
  const tabs = useUIStore((state) => state.tabs);
  const activeTabId = useUIStore((state) => state.activeTabId);
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const createAutomata = useAutomataStore((state) => state.createAutomata);
  const setActiveAutomata = useAutomataStore((state) => state.setActiveAutomata);
  const openTab = useUIStore((state) => state.openTab);
  const automataMap = useAutomataStore((state) => state.automata);
  
  const handleNewAutomata = async () => {
    try {
      const automata = await createAutomata('New Automata', 'A new automata project');
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
  
  // Find which automata a state belongs to
  const findAutomataForState = (stateId: string): string => {
    for (const [automataId, automata] of automataMap) {
      if (automata.states[stateId]) {
        return automataId;
      }
    }
    return '';
  };
  
  if (!activeTab) {
    return (
      <div className="editor-welcome">
        <div className="welcome-content">
          <div className="welcome-logo">
            <svg viewBox="0 0 100 100" width="120" height="120">
              <defs>
                <linearGradient id="logoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="var(--color-primary)" />
                  <stop offset="100%" stopColor="var(--color-secondary)" />
                </linearGradient>
              </defs>
              <circle cx="50" cy="50" r="45" fill="none" stroke="url(#logoGrad)" strokeWidth="2" />
              <circle cx="50" cy="30" r="8" fill="var(--color-primary)" />
              <circle cx="30" cy="60" r="8" fill="var(--color-primary)" />
              <circle cx="70" cy="60" r="8" fill="var(--color-primary)" />
              <line x1="50" y1="38" x2="35" y2="54" stroke="var(--color-primary)" strokeWidth="2" />
              <line x1="50" y1="38" x2="65" y2="54" stroke="var(--color-primary)" strokeWidth="2" />
              <line x1="38" y1="60" x2="62" y2="60" stroke="var(--color-primary)" strokeWidth="2" />
            </svg>
          </div>
          <h1 className="welcome-title">Aetherium Automata</h1>
          <p className="welcome-subtitle">Intelligent Automata Development Environment</p>
          <div className="welcome-actions">
            <button className="btn btn-primary" onClick={handleNewAutomata}>
              <span>New Automata</span>
            </button>
            <button className="btn btn-secondary">
              <span>Open Project</span>
            </button>
          </div>
          <div className="welcome-shortcuts">
            <div className="shortcut-item">
              <kbd>Ctrl</kbd> + <kbd>N</kbd>
              <span>New Automata</span>
            </div>
            <div className="shortcut-item">
              <kbd>Ctrl</kbd> + <kbd>O</kbd>
              <span>Open File</span>
            </div>
            <div className="shortcut-item">
              <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>P</kbd>
              <span>Command Palette</span>
            </div>
          </div>
        </div>
      </div>
    );
  }
  
  switch (activeTab.type) {
    case 'automata':
      return <AutomataEditor automataId={activeTab.targetId} />;
    case 'code':
      const parentAutomataId = findAutomataForState(activeTab.targetId);
      if (!parentAutomataId) {
        return (
          <div className="editor-error">
            <p>Could not find automata for state: {activeTab.targetId}</p>
          </div>
        );
      }
      return (
        <CodeEditor
          stateId={activeTab.targetId}
          automataId={parentAutomataId}
        />
      );
    default:
      return (
        <div className="editor-unsupported">
          <p>Unsupported tab type: {activeTab.type}</p>
        </div>
      );
  }
};

const App: React.FC = () => {
  // UI state
  const layout = useUIStore((state) => state.layout);
  const sidebarCollapsed = useUIStore((state) => state.sidebarCollapsed);
  
  // Get panel visibility from layout
  const explorerVisible = layout.panels.explorer?.isVisible ?? true;
  const propertiesVisible = layout.panels.properties?.isVisible ?? false;
  const consoleVisible = layout.panels.console?.isVisible ?? false;
  
  // Determine which sidebar panel to show
  const getActiveSidebarPanel = (): string => {
    if (layout.panels.explorer?.isVisible) return 'explorer';
    if (layout.panels.devices?.isVisible) return 'devices';
    if (layout.panels.timetravel?.isVisible) return 'timetravel';
    return 'explorer';
  };
  
  return (
    <div className="app-container">
      {/* Header */}
      <AppHeader />
      
      {/* Main content area */}
      <div className="app-main">
        {/* Activity Bar */}
        <ActivityBar />
        
        {/* Main layout */}
        <div className="app-content">
          {/* Left sidebar panel */}
          {!sidebarCollapsed && explorerVisible && (
            <div className="panel-left" style={{ width: layout.sidebarWidth }}>
              <PanelContent panelId={getActiveSidebarPanel()} />
            </div>
          )}
          
          {/* Center area with editor and bottom panel */}
          <div className="panel-center">
            {/* Editor tabs and content */}
            <div className="editor-area">
              <TabBar />
              <div className="editor-content">
                <EditorContent />
              </div>
            </div>
            
            {/* Bottom panel */}
            {consoleVisible && (
              <div className="panel-bottom" style={{ height: layout.bottomPanelHeight }}>
                <OutputPanel />
              </div>
            )}
          </div>
          
          {/* Right panel - properties */}
          {propertiesVisible && (
            <div className="panel-right" style={{ width: layout.rightPanelWidth }}>
              <PropertiesPanel />
            </div>
          )}
        </div>
      </div>
      
      {/* Status Bar */}
      <StatusBar />
      
      {/* Notification Toasts */}
      <NotificationToasts />
    </div>
  );
};

export default App;
