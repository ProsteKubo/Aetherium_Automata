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
  const togglePanel = useUIStore((state) => state.togglePanel);
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const setActiveAutomata = useAutomataStore((state) => state.setActiveAutomata);
  const automataMap = useAutomataStore((state) => state.automata);
  const openTab = useUIStore((state) => state.openTab);
  const createProject = useProjectStore((state) => state.createProject);
  const ensureLocalProject = useProjectStore((state) => state.ensureLocalProject);
  const openProject = useProjectStore((state) => state.openProject);
  const project = useProjectStore((state) => state.project);

  const handleCreateWorkspace = async (): Promise<void> => {
    try {
      await createProject();
    } catch (error) {
      console.error('Failed to create flagship workspace:', error);
      addNotification('error', 'Create Workspace', 'Failed to create the flagship workspace.');
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

  const handleOpenWorkspaceView = (panelId: CenterPanelId): void => {
    togglePanel(panelId);
  };

  const handleLoadBuiltInShowcase = (view: CenterPanelId = 'network'): void => {
    ensureLocalProject();
    togglePanel(view);
    addNotification('success', 'Built-in Showcase', 'Loaded the built-in flagship workspace.');
  };

  const handleOpenFirstAutomata = (): void => {
    if (!project) {
      return;
    }

    const firstAutomataId = project.networks
      .flatMap((network) => network.rootAutomataIds)
      .find((automataId) => project.automata[automataId]);

    if (!firstAutomataId) {
      addNotification('warning', 'Open Automata', 'No flagship automata were found in this workspace.');
      return;
    }

    const automata = project.automata[firstAutomataId];
    setActiveAutomata(firstAutomataId);
    openTab({
      type: 'automata',
      targetId: firstAutomataId,
      name: automata.config.name,
      isDirty: false,
    });
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
    const networkCount = project?.networks.length ?? 0;
    const automataCount = project ? Object.keys(project.automata).length : 0;
    const channelCount = project?.networks.reduce(
      (total, network) => total + (network.outputs?.length ?? 0),
      0,
    ) ?? 0;

    return (
      <div className="editor-welcome">
        <div className="welcome-content flagship-welcome">
          <div className="welcome-badge">Converged EFSM Orchestrator</div>
          <h1 className="welcome-title">
            {project ? project.metadata.name : 'Aetherium Flagship Workspace'}
          </h1>
          <p className="welcome-subtitle">
            {project?.metadata.description ||
              'Design, deploy, observe, rewind, and analyze one multi-network EFSM package with named channels, black boxes, and deployment-aware runtime insight.'}
          </p>

          <div className="welcome-actions">
            <button className="btn btn-primary btn-lg" onClick={() => void handleCreateWorkspace()}>
              Create Flagship Workspace
            </button>
            {!project && (
              <button className="btn btn-secondary btn-lg" onClick={() => handleLoadBuiltInShowcase('network')}>
                Load Built-in Showcase
              </button>
            )}
            <button className="btn btn-secondary btn-lg" onClick={() => void handleOpenProject()}>
              Open Workspace
            </button>
            {project && (
              <button className="btn btn-ghost btn-lg" onClick={handleOpenFirstAutomata}>
                Open First Automata
              </button>
            )}
          </div>

          {project ? (
            <>
              <div className="workspace-overview-grid">
                <div className="workspace-overview-card workspace-overview-card-accent">
                  <span className="workspace-overview-label">Logical Networks</span>
                  <strong>{networkCount}</strong>
                  <span>Cooperating network domains in one workspace</span>
                </div>
                <div className="workspace-overview-card">
                  <span className="workspace-overview-label">Automata</span>
                  <strong>{automataCount}</strong>
                  <span>State-heavy actors spanning devices, servers, and black boxes</span>
                </div>
                <div className="workspace-overview-card">
                  <span className="workspace-overview-label">Named Channels</span>
                  <strong>{channelCount}</strong>
                  <span>Published outputs feeding cross-network orchestration and analysis</span>
                </div>
              </div>

              <div className="workspace-launch-grid">
                <button className="workspace-launch-card" onClick={() => handleOpenWorkspaceView('network')}>
                  <span className="workspace-launch-kicker">Topology</span>
                  <strong>Open Network Map</strong>
                  <span>Inspect the network-of-networks layout, placements, and cross-network channel flow.</span>
                </button>
                <button className="workspace-launch-card" onClick={() => handleOpenWorkspaceView('runtime')}>
                  <span className="workspace-launch-kicker">Runtime</span>
                  <strong>Open Runtime &amp; Replay</strong>
                  <span>Drive the flagship deployment, inspect live state, and move through time-travel traces.</span>
                </button>
                <button className="workspace-launch-card" onClick={() => handleOpenWorkspaceView('petri')}>
                  <span className="workspace-launch-kicker">Petri Net</span>
                  <strong>Open Petri View</strong>
                  <span>See structural bottlenecks and synchronization points emerge from the flagship scenario.</span>
                </button>
                <button className="workspace-launch-card" onClick={() => handleOpenWorkspaceView('analyzer')}>
                  <span className="workspace-launch-kicker">Analyzer</span>
                  <strong>Open Analyzer View</strong>
                  <span>Review contention, latency, blocked handoffs, and black-box opacity from one story.</span>
                </button>
              </div>

              <div className="workspace-network-grid">
                {project.networks.map((network) => (
                  <div key={network.id} className="workspace-network-card">
                    <div className="workspace-network-card-header">
                      <span className="workspace-network-dot" style={{ backgroundColor: network.color || '#3d8fe9' }} />
                      <strong>{network.name}</strong>
                    </div>
                    <p>{network.description || 'Flagship network segment.'}</p>
                    <div className="workspace-network-meta">
                      <span>{network.automataIds.length} automata</span>
                      <span>{network.inputs?.length ?? 0} inputs</span>
                      <span>{network.outputs?.length ?? 0} outputs</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="workspace-launch-grid welcome-demo-grid">
                <button className="workspace-launch-card workspace-launch-card-accent" onClick={() => handleLoadBuiltInShowcase('network')}>
                  <span className="workspace-launch-kicker">Recommended</span>
                  <strong>Hardware Button Showcase</strong>
                  <span>Load a two-node demo for `device_cpp_01` and `mcxn947-core0`, with the NXP onboard button publishing into the desktop observer.</span>
                </button>
                <button className="workspace-launch-card" onClick={() => handleLoadBuiltInShowcase('runtime')}>
                  <span className="workspace-launch-kicker">Runtime</span>
                  <strong>Open Deploy &amp; Trace</strong>
                  <span>Jump straight into the runtime view after loading the built-in workspace.</span>
                </button>
              </div>

              <div className="welcome-shortcuts">
                <div className="shortcut-item">
                  <kbd>Ctrl</kbd>
                  <kbd>N</kbd>
                  <span>Create flagship workspace</span>
                </div>
                <div className="shortcut-item">
                  <kbd>Ctrl</kbd>
                  <kbd>O</kbd>
                  <span>Open workspace</span>
                </div>
                <div className="shortcut-item">
                  <kbd>Ctrl</kbd>
                  <kbd>K</kbd>
                  <span>Search commands</span>
                </div>
              </div>
            </>
          )}
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

      return (
        <div className="logic-editor-workspace">
          <div className="logic-canvas-pane">
            <div className="logic-pane-header">
              <span>Finite State Machine View</span>
              <div className="logic-pane-tools">
                <span>Zoom</span>
                <span>Fit</span>
                <span>Grid</span>
              </div>
            </div>
            <AutomataEditor automataId={parentAutomataId} />
          </div>
          <div className="logic-code-pane">
            <CodeEditor stateId={activeTab.targetId} automataId={parentAutomataId} />
          </div>
          <div className="logic-inspector-pane">
            <div className="logic-inspector-title">
              <strong>State Inspector</strong>
              <span>Node Properties</span>
            </div>
            <div className="logic-inspector-grid">
              <label>
                <span>Transition Delay (ms)</span>
                <input className="input input-mono" value="250.00" readOnly />
              </label>
              <label>
                <span>Fault-in-loop Prob.</span>
                <input className="input input-mono" value="0.04%" readOnly />
              </label>
              <label>
                <span>Telemetry Level</span>
                <div className="logic-segmented">
                  <button type="button" className="active">Full</button>
                  <button type="button">Lite</button>
                  <button type="button">Silent</button>
                </div>
              </label>
            </div>
          </div>
        </div>
      );
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
    const order: CenterPanelId[] = ['network', 'petri', 'runtime', 'analyzer', 'blackboxes', 'automata'];
    return order.find((panelId) => layout.panels[panelId]?.isVisible) ?? null;
  }, [layout.panels]);

  const activeRightPanel = useMemo<RightPanelId | null>(() => {
    const order: RightPanelId[] = ['properties', 'transitions', 'variables', 'connections'];
    return order.find((panelId) => layout.panels[panelId]?.isVisible) ?? null;
  }, [layout.panels]);

  const consoleVisible = (layout.panels.console?.isVisible ?? false) && activeCenterPanel === 'automata';
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

  const activityOwnsSidebar = false;
  const showSidebarInline = Boolean(!activityOwnsSidebar && !sidebarCollapsed && activeSidebarPanel && !isCompactViewport);
  const showSidebarOverlay = Boolean(!activityOwnsSidebar && !sidebarCollapsed && activeSidebarPanel && isCompactViewport);
  const centerOwnsInspector =
    activeCenterPanel === 'automata' ||
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
          <div className="runtime-view-container analyzer-view-shell">
            <AnalyzerPanel />
          </div>
        );
      case 'blackboxes':
        return (
          <div className="runtime-view-container blackboxes-view-shell">
            <BlackBoxesPanel />
          </div>
        );
      case 'network':
        return (
          <div className="runtime-view-container network-view-shell">
            <NetworkPanel />
          </div>
        );
      case 'petri':
        return (
          <div className="runtime-view-container petri-view-shell">
            <PetriNetPanel />
          </div>
        );
      case 'runtime':
        return (
          <div className="runtime-view-container runtime-debugger-shell">
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
    <div className={`app-container ${viewportClass} app-view-${activeCenterPanel ?? 'automata'}`}>
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
