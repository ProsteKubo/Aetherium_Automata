/**
 * Aetherium Automata - Main Application Component
 * 
 * Root component that assembles the complete IDE layout.
 */

import React, { useState, useEffect } from 'react';
import { useUIStore, useAutomataStore, useGatewayStore } from './stores';
import {
  AppHeader,
  ActivityBar,
  StatusBar,
  TabBar,
  NotificationToasts,
  GatewaySettings,
} from './components/common';
import {
  ExplorerPanel,
  PropertiesPanel,
  OutputPanel,
  TimeTravelPanel,
  DevicesPanel,
  NetworkPanel,
  AutomataOverviewPanel,
  GatewayPanel,
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
    case 'gateway':
      return <GatewayPanel />;
    case 'timetravel':
      return <TimeTravelPanel />;
    case 'properties':
      return <PropertiesPanel />;
    case 'console':
      return <OutputPanel />;
    case 'network':
      return <NetworkPanel />;
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
  // Gateway connection state
  const [showGatewaySettings, setShowGatewaySettings] = useState(false);
  const connect = useGatewayStore((state) => state.connect);
  const setUseMockService = useGatewayStore((state) => state.setUseMockService);
  
  // Check if we should show settings on first load
  useEffect(() => {
    const hasShownSettings = localStorage.getItem('gateway_settings_shown');
    if (!hasShownSettings) {
      setShowGatewaySettings(true);
    }
  }, []);
  
  const handleGatewayConnect = async (host: string, port: string) => {
    // Validate inputs
    if (!host || !port) {
      alert('Please enter both host and port');
      return;
    }
    
    const portNum = parseInt(port);
    if (isNaN(portNum) || portNum <= 0 || portNum > 65535) {
      alert('Please enter a valid port number (1-65535)');
      return;
    }
    
    console.log('[App] Attempting to connect to gateway:', { host, port: portNum });
    
    try {
      await connect({
        host,
        port: portNum,
      });
      localStorage.setItem('gateway_settings_shown', 'true');
      setShowGatewaySettings(false);
      console.log('[App] Successfully connected to gateway');
    } catch (error) {
      console.error('[App] Failed to connect to gateway:', error);
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      alert(`Failed to connect to gateway:\n${errorMsg}\n\nPlease check that:\n- Gateway server is running\n- Host and port are correct\n- Network connection is available`);
      // Don't close dialog on error - let user try again
    }
  };
  
  const handleSkipGateway = () => {
    // Use mock service for everything
    setUseMockService(true);
    localStorage.setItem('gateway_settings_shown', 'true');
    setShowGatewaySettings(false);
  };
  
  // UI state
  const layout = useUIStore((state) => state.layout);
  const sidebarCollapsed = useUIStore((state) => state.sidebarCollapsed);
  
  // Get panel visibility from layout
  const explorerVisible = layout.panels.explorer?.isVisible ?? false;
  const propertiesVisible = layout.panels.properties?.isVisible ?? false;
  const consoleVisible = layout.panels.console?.isVisible ?? false;
  const networkVisible = layout.panels.network?.isVisible ?? false;
  const automataOverviewVisible = layout.panels.automata?.isVisible ?? false;
  const devicesVisible = layout.panels.devices?.isVisible ?? false;
  const timetravelVisible = layout.panels.timetravel?.isVisible ?? false;
  const gatewayVisible = layout.panels.gateway?.isVisible ?? false;
  
  // Determine which sidebar panel to show (only one can be active due to togglePanel logic)
  const getActiveSidebarPanel = (): string | null => {
    if (explorerVisible) return 'explorer';
    if (devicesVisible) return 'devices';
    if (gatewayVisible) return 'gateway';
    return null;
  };
  
  // Check if any sidebar panel is active
  const activeSidebarPanel = getActiveSidebarPanel();
  const hasSidebarPanel = activeSidebarPanel !== null;
  
  return (
    <div className="app-container">
      {/* Gateway Settings Dialog */}
      {showGatewaySettings && (
        <GatewaySettings
          onConnect={handleGatewayConnect}
          onSkip={handleSkipGateway}
        />
      )}
      
      {/* Header */}
      <AppHeader />
      
      {/* Main content area */}
      <div className="app-main">
        {/* Activity Bar */}
        <ActivityBar />
        
        {/* Main layout */}
        <div className="app-content">
          {/* Left sidebar panel */}
          {!sidebarCollapsed && hasSidebarPanel && activeSidebarPanel && (
            <div className="panel-left" style={{ width: layout.sidebarWidth }}>
              <PanelContent panelId={activeSidebarPanel} />
            </div>
          )}
          
          {/* Center area with editor and bottom panel */}
          <div className="panel-center">
            {/* Network panel, Time Travel, Automata Overview, or Editor tabs and content */}
            {timetravelVisible ? (
              <div className="timetravel-view-container">
                <TimeTravelPanel />
              </div>
            ) : networkVisible ? (
              <div className="network-view-container">
                <NetworkPanel />
              </div>
            ) : automataOverviewVisible ? (
              <div className="overview-view-container">
                <AutomataOverviewPanel />
              </div>
            ) : (
              <div className="editor-area">
                <TabBar />
                <div className="editor-content">
                  <EditorContent />
                </div>
              </div>
            )}
            
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
