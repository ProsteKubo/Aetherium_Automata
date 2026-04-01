/**
 * Aetherium Automata - Main Application Component
 *
 * Root component that assembles the complete IDE layout.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  useAutomataStore,
  useGatewayStore,
  useProjectStore,
  useUIStore,
} from './stores';
import type { PanelId } from './types';
import {
  ActivityBar,
  AppHeader,
  GatewaySettings,
  NotificationToasts,
  StatusBar,
  TabBar,
} from './components/common';
import {
  AnalyzerPanel,
  AutomataConnectionsPanel,
  DevicesPanel,
  ExplorerPanel,
  GatewayPanel,
  BlackBoxesPanel,
  NetworkPanel,
  OutputPanel,
  PetriNetPanel,
  PropertiesPanel,
  RuntimeMonitorPanel,
  TransitionGroupPanel,
  VariableManagementPanel,
} from './components/panels';
import { AutomataEditor, CodeEditor } from './components/editor';
import { GatewayEventBridge } from './components/runtime/GatewayEventBridge';
import './styles/index.css';

type SidebarPanelId = 'explorer' | 'devices' | 'gateway';
type CenterPanelId = 'automata' | 'analyzer' | 'blackboxes' | 'petri' | 'network' | 'runtime';
type RightPanelId = 'properties' | 'transitions' | 'variables' | 'connections';

const PanelContent: React.FC<{ panelId: string }> = ({ panelId }) => {
  switch (panelId) {
    case 'explorer':
      return <ExplorerPanel />;
    case 'devices':
      return <DevicesPanel />;
    case 'gateway':
      return <GatewayPanel />;
    case 'properties':
      return <PropertiesPanel />;
    case 'console':
      return <OutputPanel />;
    case 'runtime':
      return <RuntimeMonitorPanel />;
    case 'transitions':
      return <TransitionGroupPanel />;
    case 'variables':
      return <VariableManagementPanel />;
    case 'connections':
      return <AutomataConnectionsPanel />;
    default:
      return null;
  }
};

const EditorContent: React.FC = () => {
  const tabs = useUIStore((state) => state.tabs);
  const activeTabId = useUIStore((state) => state.activeTabId);
  const addNotification = useUIStore((state) => state.addNotification);
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const createAutomata = useAutomataStore((state) => state.createAutomata);
  const setActiveAutomata = useAutomataStore((state) => state.setActiveAutomata);
  const automataMap = useAutomataStore((state) => state.automata);
  const openTab = useUIStore((state) => state.openTab);
  const openProject = useProjectStore((state) => state.openProject);

  const handleNewAutomata = async (): Promise<void> => {
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
      addNotification('error', 'Create Automata', 'Failed to create a new automata.');
    }
  };

  const handleOpenProject = async (): Promise<void> => {
    try {
      await openProject();
    } catch (error) {
      console.error('Failed to open project:', error);
      addNotification('error', 'Open Project', 'Project open failed.');
    }
  };

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
          <div className="welcome-badge">Automation Workbench</div>
          <h1 className="welcome-title">Aetherium Automata</h1>
          <p className="welcome-subtitle">
            Build, simulate, and deploy deterministic state machines from one command console.
          </p>

          <div className="welcome-actions">
            <button className="btn btn-primary btn-lg" onClick={() => void handleNewAutomata()}>
              New Automata
            </button>
            <button className="btn btn-secondary btn-lg" onClick={() => void handleOpenProject()}>
              Open Project
            </button>
          </div>

          <div className="welcome-shortcuts">
            <div className="shortcut-item">
              <kbd>Ctrl</kbd>
              <kbd>N</kbd>
              <span>Create automata</span>
            </div>
            <div className="shortcut-item">
              <kbd>Ctrl</kbd>
              <kbd>O</kbd>
              <span>Open project</span>
            </div>
            <div className="shortcut-item">
              <kbd>Ctrl</kbd>
              <kbd>K</kbd>
              <span>Quick search</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  switch (activeTab.type) {
    case 'automata':
      return <AutomataEditor automataId={activeTab.targetId} />;
    case 'code': {
      const parentAutomataId = findAutomataForState(activeTab.targetId);
      if (!parentAutomataId) {
        return (
          <div className="editor-error">
            <p>Could not find automata for state: {activeTab.targetId}</p>
          </div>
        );
      }

      return <CodeEditor stateId={activeTab.targetId} automataId={parentAutomataId} />;
    }
    default:
      return (
        <div className="editor-unsupported">
          <p>Unsupported tab type: {activeTab.type}</p>
        </div>
      );
  }
};

const App: React.FC = () => {
  const [showGatewaySettings, setShowGatewaySettings] = useState<boolean>(() => {
    if (typeof window === 'undefined') {
      return false;
    }

    return !window.localStorage.getItem('gateway_settings_shown');
  });
  const connect = useGatewayStore((state) => state.connect);
  const addNotification = useUIStore((state) => state.addNotification);
  const layout = useUIStore((state) => state.layout);
  const sidebarCollapsed = useUIStore((state) => state.sidebarCollapsed);
  const togglePanel = useUIStore((state) => state.togglePanel);
  const toggleSidebar = useUIStore((state) => state.toggleSidebar);
  const [viewport, setViewport] = useState<{ width: number; height: number }>(() => {
    if (typeof window === 'undefined') {
      return { width: 1440, height: 900 };
    }

    return {
      width: window.innerWidth,
      height: window.innerHeight,
    };
  });

  useEffect(() => {
    let rafId = 0;
    const handleResize = (): void => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        setViewport({
          width: window.innerWidth,
          height: window.innerHeight,
        });
      });
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(rafId);
    };
  }, []);

  const handleGatewayConnect = async (host: string, port: string): Promise<void> => {
    if (!host || !port) {
      addNotification('warning', 'Gateway Connection', 'Please enter both host and port');
      return;
    }

    const portNum = parseInt(port, 10);
    if (Number.isNaN(portNum) || portNum <= 0 || portNum > 65535) {
      addNotification('warning', 'Gateway Connection', 'Please enter a valid port number (1-65535)');
      return;
    }

    try {
      await connect({ host, port: portNum });
      localStorage.setItem('gateway_settings_shown', 'true');
      setShowGatewaySettings(false);
      addNotification('success', 'Gateway Connection', `Connected to ${host}:${portNum}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      addNotification('error', 'Gateway Connection', `Failed to connect: ${errorMsg}`);
    }
  };

  const handleContinueOffline = (): void => {
    localStorage.setItem('gateway_settings_shown', 'true');
    setShowGatewaySettings(false);
    addNotification('info', 'Gateway Connection', 'Continuing offline. Live runtime panels need a gateway connection.');
  };

  const activeSidebarPanel = useMemo<SidebarPanelId | null>(() => {
    const order: SidebarPanelId[] = ['explorer', 'devices', 'gateway'];
    return order.find((panelId) => layout.panels[panelId]?.isVisible) ?? null;
  }, [layout.panels]);

  const activeCenterPanel = useMemo<CenterPanelId | null>(() => {
    const order: CenterPanelId[] = ['automata', 'analyzer', 'blackboxes', 'petri', 'network', 'runtime'];
    return order.find((panelId) => layout.panels[panelId]?.isVisible) ?? null;
  }, [layout.panels]);

  const activeRightPanel = useMemo<RightPanelId | null>(() => {
    const order: RightPanelId[] = ['properties', 'transitions', 'variables', 'connections'];
    return order.find((panelId) => layout.panels[panelId]?.isVisible) ?? null;
  }, [layout.panels]);

  const consoleVisible = layout.panels.console?.isVisible ?? false;
  const isNarrowViewport = viewport.width < 1280;
  const isCompactViewport = viewport.width < 980;
  const viewportClass = isCompactViewport
    ? 'viewport-compact'
    : isNarrowViewport
      ? 'viewport-narrow'
      : 'viewport-wide';

  const sidebarInlineWidth = useMemo(() => {
    const maxWidth = Math.max(220, Math.floor(viewport.width * 0.3));
    return Math.min(Math.max(layout.sidebarWidth, 220), maxWidth);
  }, [layout.sidebarWidth, viewport.width]);

  const rightInlineWidth = useMemo(() => {
    const maxWidth = Math.max(260, Math.floor(viewport.width * 0.32));
    return Math.min(Math.max(layout.rightPanelWidth, 260), maxWidth);
  }, [layout.rightPanelWidth, viewport.width]);

  const overlayPanelWidth = useMemo(
    () => Math.min(420, Math.max(280, Math.floor(viewport.width * 0.84))),
    [viewport.width],
  );

  const bottomPanelHeight = useMemo(() => {
    const maxHeight = Math.max(140, Math.floor(viewport.height * (isCompactViewport ? 0.3 : 0.36)));
    return Math.min(Math.max(layout.bottomPanelHeight, 120), maxHeight);
  }, [isCompactViewport, layout.bottomPanelHeight, viewport.height]);

  const showSidebarInline = Boolean(!sidebarCollapsed && activeSidebarPanel && !isCompactViewport);
  const showSidebarOverlay = Boolean(!sidebarCollapsed && activeSidebarPanel && isCompactViewport);
  const centerOwnsInspector =
    activeCenterPanel === 'petri' ||
    activeCenterPanel === 'network' ||
    activeCenterPanel === 'blackboxes' ||
    activeCenterPanel === 'analyzer';
  const showRightInline = Boolean(activeRightPanel && !isNarrowViewport && !centerOwnsInspector);
  const showRightOverlay = Boolean(
    activeRightPanel && isNarrowViewport && !showSidebarOverlay && !centerOwnsInspector,
  );
  const showPanelBackdrop = showSidebarOverlay || showRightOverlay;

  const activatePanel = (panelId: PanelId): void => {
    const isVisible = layout.panels[panelId]?.isVisible ?? false;
    if (!isVisible) {
      togglePanel(panelId);
    }
  };

  const dismissOverlayPanels = (): void => {
    if (showSidebarOverlay) {
      toggleSidebar();
    }

    if (showRightOverlay && activeRightPanel) {
      togglePanel(activeRightPanel);
    }
  };

  const renderMainView = (): React.ReactNode => {
    switch (activeCenterPanel) {
      case 'analyzer':
        return (
          <div className="runtime-view-container">
            <AnalyzerPanel />
          </div>
        );
      case 'blackboxes':
        return (
          <div className="runtime-view-container">
            <BlackBoxesPanel />
          </div>
        );
      case 'network':
        return (
          <div className="runtime-view-container">
            <NetworkPanel />
          </div>
        );
      case 'petri':
        return (
          <div className="runtime-view-container">
            <PetriNetPanel />
          </div>
        );
      case 'runtime':
        return (
          <div className="runtime-view-container">
            <RuntimeMonitorPanel />
          </div>
        );
      case 'automata':
      default:
        return (
          <div className="editor-area">
            <TabBar />
            <div className="editor-content">
              <EditorContent />
            </div>
          </div>
        );
    }
  };

  const renderSidebarPanel = (className: string, width: number): React.ReactNode => {
    if (!activeSidebarPanel) {
      return null;
    }

    return (
      <aside className={`${className} panel-left panel-frame`} style={{ width }}>
        <div className="panel-shell-header">
          <div className="panel-shell-title" style={{ paddingLeft: 'var(--spacing-3)', textTransform: 'uppercase', fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-semibold)', color: 'var(--color-text-secondary)', letterSpacing: '0.05em' }}>
            {activeSidebarPanel}
          </div>
          <button type="button" className="panel-shell-close" onClick={toggleSidebar} title="Collapse sidebar">
            Collapse
          </button>
        </div>
        <div className="panel-shell-body">
          <PanelContent panelId={activeSidebarPanel} />
        </div>
      </aside>
    );
  };

  const renderRightPanel = (className: string, width: number): React.ReactNode => {
    if (!activeRightPanel) {
      return null;
    }

    return (
      <aside className={`${className} panel-right panel-frame`} style={{ width }}>
        <div className="panel-shell-header">
          <div className="panel-shell-tabs">
            <button
              type="button"
              className={`panel-shell-tab ${activeRightPanel === 'properties' ? 'active' : ''}`}
              onClick={() => activatePanel('properties')}
            >
              Properties
            </button>
            <button
              type="button"
              className={`panel-shell-tab ${activeRightPanel === 'transitions' ? 'active' : ''}`}
              onClick={() => activatePanel('transitions')}
            >
              Transitions
            </button>
            <button
              type="button"
              className={`panel-shell-tab ${activeRightPanel === 'variables' ? 'active' : ''}`}
              onClick={() => activatePanel('variables')}
            >
              Variables
            </button>
            <button
              type="button"
              className={`panel-shell-tab ${activeRightPanel === 'connections' ? 'active' : ''}`}
              onClick={() => activatePanel('connections')}
            >
              Links
            </button>
          </div>
          <button
            type="button"
            className="panel-shell-close"
            onClick={() => togglePanel(activeRightPanel)}
            title="Hide inspector"
          >
            Hide
          </button>
        </div>
        <div className="panel-shell-body">
          {activeRightPanel === 'properties' ? (
            <PropertiesPanel />
          ) : (
            <PanelContent panelId={activeRightPanel} />
          )}
        </div>
      </aside>
    );
  };

  return (
    <div className={`app-container ${viewportClass}`}>
      <GatewayEventBridge />
      {showGatewaySettings && (
        <GatewaySettings onConnect={handleGatewayConnect} onContinueOffline={handleContinueOffline} />
      )}

      <AppHeader />

      <div className="app-main">
        <ActivityBar />
        <div className="app-content">
          {showSidebarInline && renderSidebarPanel('', sidebarInlineWidth)}

          {showPanelBackdrop && (
            <button
              type="button"
              className="panel-overlay-backdrop"
              aria-label="Close overlay panels"
              onClick={dismissOverlayPanels}
            />
          )}

          {showSidebarOverlay && renderSidebarPanel('panel-overlay panel-overlay-left', overlayPanelWidth)}

          <section className="panel-center">
            {renderMainView()}

            {consoleVisible && (
              <div className="panel-bottom panel-frame" style={{ height: bottomPanelHeight }}>
                <OutputPanel />
              </div>
            )}
          </section>

          {showRightInline && renderRightPanel('', rightInlineWidth)}
          {showRightOverlay && renderRightPanel('panel-overlay panel-overlay-right', overlayPanelWidth)}
        </div>
      </div>

      <StatusBar />
      <NotificationToasts />
    </div>
  );
};

export default App;
