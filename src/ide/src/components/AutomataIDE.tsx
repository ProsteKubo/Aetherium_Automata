import { useState } from 'react';
import { FileExplorer } from './FileExplorer';
import { StateGraph } from './StateGraph';
import { CodeEditor } from './CodeEditor';
import { PropertiesPanel } from './PropertiesPanel';
import { Console } from './Console';
import { Toolbar } from './Toolbar';
import { NetworkView } from './NetworkView';
import { TimelineView } from './TimelineView';
import { ResizablePanel } from './ResizablePanel';
import { Menu, Play, Settings, Save, FolderOpen, FileText, GitBranch } from 'lucide-react';

export type State = {
  id: string;
  name: string;
  inputs: string[];
  outputs: string[];
  variables: string[];
  code?: string;
  onEnter?: string;
  onExit?: string;
  x: number;
  y: number;
};

export type Transition = {
  id: string;
  name: string;
  from: string;
  to: string;
  condition?: string;
  body?: string;
  triggered?: string;
  priority?: number;
  weight?: number;
};

export type AutomataProject = {
  version: string;
  config: {
    name: string;
    type: 'inline' | 'folder';
    location?: string;
    language?: string;
    description?: string;
    tags?: string[];
  };
  automata: {
    initialState?: string;
    states: Record<string, State>;
    transitions: Record<string, Transition>;
  };
};

export type NetworkDevice = {
  id: string;
  name: string;
  type: 'device' | 'server' | 'database' | 'connector';
  status: 'online' | 'offline' | 'updating';
  ipAddress: string;
  lastSeen: Date;
  version: string;
  automata?: string;
  x: number;
  y: number;
  cpu?: number;
  memory?: number;
  uptime?: number;
};

export type ExecutionSnapshot = {
  timestamp: number;
  currentState: string;
  previousState?: string;
  variables: Record<string, any>;
  inputs: Record<string, any>;
  outputs: Record<string, any>;
  event: {
    type: 'transition' | 'input' | 'output' | 'variable' | 'state_enter' | 'state_exit' | 'error';
    description: string;
    details?: any;
  };
  stackTrace?: string[];
};

export function AutomataIDE() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(true);
  const [activeView, setActiveView] = useState<'visual' | 'yaml' | 'network'>('visual');
  const [selectedState, setSelectedState] = useState<string | null>(null);
  const [selectedTransition, setSelectedTransition] = useState<string | null>(null);
  const [consoleOutput, setConsoleOutput] = useState<string[]>([]);
  const [sidebarWidth, setSidebarWidth] = useState(256);
  const [rightPanelWidth, setRightPanelWidth] = useState(320);
  const [consoleHeight, setConsoleHeight] = useState(192);
  const [bottomPanelCollapsed, setBottomPanelCollapsed] = useState(false);
  
  // Time travel debugging state
  const [executionSnapshots, setExecutionSnapshots] = useState<ExecutionSnapshot[]>([]);
  const [currentSnapshotIndex, setCurrentSnapshotIndex] = useState(0);
  const [isPlayingBack, setIsPlayingBack] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [bookmarks, setBookmarks] = useState<Set<number>>(new Set());
  const [isRecording, setIsRecording] = useState(true);
  const [bottomPanelTab, setBottomPanelTab] = useState<'console' | 'timeline'>('console');
  
  // Sample project data
  const [project, setProject] = useState<AutomataProject>({
    version: '0.0.1',
    config: {
      name: 'Sample Automata',
      type: 'inline',
      language: 'lua',
      description: 'A sample automata project',
      tags: ['example', 'demo']
    },
    automata: {
      initialState: 'Idle',
      states: {
        'Idle': {
          id: 'Idle',
          name: 'Idle',
          inputs: ['trigger'],
          outputs: ['status'],
          variables: ['counter'],
          code: 'if check("trigger") then\n  setVal("counter", value("counter") + 1)\n  emit("status", "triggered")\nend',
          x: 200,
          y: 200
        },
        'Active': {
          id: 'Active',
          name: 'Active',
          inputs: ['stop'],
          outputs: ['status'],
          variables: [],
          code: 'if check("stop") then\n  emit("status", "stopping")\nend',
          x: 500,
          y: 200
        },
        'Processing': {
          id: 'Processing',
          name: 'Processing',
          inputs: ['data'],
          outputs: ['result'],
          variables: ['temp'],
          code: 'if check("data") then\n  local val = value("data")\n  setVal("temp", val * 2)\n  emit("result", value("temp"))\nend',
          x: 350,
          y: 400
        }
      },
      transitions: {
        'StartProcessing': {
          id: 'StartProcessing',
          name: 'Start Processing',
          from: 'Idle',
          to: 'Active',
          condition: 'check("trigger")',
          body: 'log("info", "Starting processing")',
          priority: 0
        },
        'GoToProcessing': {
          id: 'GoToProcessing',
          name: 'Go To Processing',
          from: 'Active',
          to: 'Processing',
          condition: 'true',
          body: 'emit("status", "processing")',
          priority: 0
        },
        'StopProcessing': {
          id: 'StopProcessing',
          name: 'Stop Processing',
          from: 'Processing',
          to: 'Idle',
          condition: 'check("result")',
          body: 'log("info", "Processing complete")',
          priority: 0
        }
      }
    }
  });

  // Sample network devices
  const [networkDevices, setNetworkDevices] = useState<NetworkDevice[]>([
    {
      id: 'connector-1',
      name: 'IDE Connector',
      type: 'connector',
      status: 'online',
      ipAddress: '192.168.1.100',
      lastSeen: new Date(),
      version: '1.0.0',
      x: 200,
      y: 300,
      cpu: 15,
      memory: 45,
      uptime: 86400
    },
    {
      id: 'server-1',
      name: 'Core Server',
      type: 'server',
      status: 'online',
      ipAddress: '192.168.1.10',
      lastSeen: new Date(),
      version: '2.1.0',
      x: 500,
      y: 200,
      cpu: 35,
      memory: 68,
      uptime: 259200
    },
    {
      id: 'db-1',
      name: 'Telemetry DB',
      type: 'database',
      status: 'online',
      ipAddress: '192.168.1.20',
      lastSeen: new Date(),
      version: '1.5.0',
      x: 800,
      y: 200,
      cpu: 25,
      memory: 72,
      uptime: 432000
    },
    {
      id: 'device-1',
      name: 'IoT Device #1',
      type: 'device',
      status: 'online',
      ipAddress: '192.168.1.101',
      lastSeen: new Date(),
      version: '0.9.0',
      automata: 'Sample Automata',
      x: 500,
      y: 450,
      cpu: 42,
      memory: 38,
      uptime: 172800
    },
    {
      id: 'device-2',
      name: 'IoT Device #2',
      type: 'device',
      status: 'online',
      ipAddress: '192.168.1.102',
      lastSeen: new Date(Date.now() - 30000),
      version: '0.9.0',
      automata: 'Sample Automata',
      x: 350,
      y: 550,
      cpu: 28,
      memory: 52,
      uptime: 86400
    },
    {
      id: 'device-3',
      name: 'IoT Device #3',
      type: 'device',
      status: 'offline',
      ipAddress: '192.168.1.103',
      lastSeen: new Date(Date.now() - 300000),
      version: '0.8.5',
      x: 650,
      y: 550,
      cpu: 0,
      memory: 0,
      uptime: 0
    }
  ]);

  const handleRunSimulation = () => {
    setConsoleOutput(prev => [...prev, '[Simulation] Starting automata execution...']);
    setConsoleOutput(prev => [...prev, `[Simulation] Initial state: ${project.automata.initialState}`]);
    setConsoleOutput(prev => [...prev, '[Simulation] Ready to process events']);
    
    // Start recording if not already
    if (!isRecording) {
      setIsRecording(true);
      setExecutionSnapshots([]);
    }
    
    // Simulate execution with snapshots
    simulateExecution();
  };

  const simulateExecution = () => {
    const snapshots: ExecutionSnapshot[] = [];
    let currentState = project.automata.initialState || 'Idle';
    const baseTime = Date.now();
    
    // Initial state
    snapshots.push({
      timestamp: baseTime,
      currentState,
      variables: { counter: 0 },
      inputs: {},
      outputs: {},
      event: {
        type: 'state_enter',
        description: `Entered state: ${currentState}`,
        details: { state: currentState }
      },
      stackTrace: [`main() -> ${currentState}`]
    });

    // Simulate some state transitions
    const events = [
      { delay: 500, type: 'input', name: 'trigger', value: true },
      { delay: 1000, type: 'transition', from: 'Idle', to: 'Active' },
      { delay: 1500, type: 'variable', name: 'counter', value: 1 },
      { delay: 2000, type: 'output', name: 'status', value: 'triggered' },
      { delay: 2500, type: 'transition', from: 'Active', to: 'Processing' },
      { delay: 3000, type: 'input', name: 'data', value: 42 },
      { delay: 3500, type: 'variable', name: 'temp', value: 84 },
      { delay: 4000, type: 'output', name: 'result', value: 84 },
      { delay: 4500, type: 'transition', from: 'Processing', to: 'Idle' },
    ];

    let vars = { counter: 0 };
    let inputs: Record<string, any> = {};
    let outputs: Record<string, any> = {};

    events.forEach((event, i) => {
      if (event.type === 'input') {
        inputs = { ...inputs, [event.name]: event.value };
        snapshots.push({
          timestamp: baseTime + event.delay,
          currentState,
          variables: { ...vars },
          inputs: { ...inputs },
          outputs: { ...outputs },
          event: {
            type: 'input',
            description: `Input received: ${event.name} = ${event.value}`,
            details: { name: event.name, value: event.value }
          },
          stackTrace: [`main() -> ${currentState} -> on_input(${event.name})`]
        });
        setConsoleOutput(prev => [...prev, `[Simulation] Input: ${event.name} = ${event.value}`]);
      } else if (event.type === 'output') {
        outputs = { ...outputs, [event.name]: event.value };
        snapshots.push({
          timestamp: baseTime + event.delay,
          currentState,
          variables: { ...vars },
          inputs: { ...inputs },
          outputs: { ...outputs },
          event: {
            type: 'output',
            description: `Output emitted: ${event.name} = ${event.value}`,
            details: { name: event.name, value: event.value }
          },
          stackTrace: [`main() -> ${currentState} -> emit(${event.name})`]
        });
        setConsoleOutput(prev => [...prev, `[Simulation] Output: ${event.name} = ${event.value}`]);
      } else if (event.type === 'variable') {
        vars = { ...vars, [event.name]: event.value };
        snapshots.push({
          timestamp: baseTime + event.delay,
          currentState,
          variables: { ...vars },
          inputs: { ...inputs },
          outputs: { ...outputs },
          event: {
            type: 'variable',
            description: `Variable changed: ${event.name} = ${event.value}`,
            details: { name: event.name, value: event.value }
          },
          stackTrace: [`main() -> ${currentState} -> setVal(${event.name})`]
        });
      } else if (event.type === 'transition') {
        const prevState = currentState;
        currentState = event.to;
        snapshots.push({
          timestamp: baseTime + event.delay,
          currentState,
          previousState: prevState,
          variables: { ...vars },
          inputs: { ...inputs },
          outputs: { ...outputs },
          event: {
            type: 'transition',
            description: `Transition: ${prevState} → ${currentState}`,
            details: { from: prevState, to: currentState }
          },
          stackTrace: [`main() -> transition(${prevState} -> ${currentState})`]
        });
        setConsoleOutput(prev => [...prev, `[Simulation] Transition: ${prevState} → ${currentState}`]);
      }
    });

    setExecutionSnapshots(snapshots);
    setCurrentSnapshotIndex(snapshots.length - 1);
    setConsoleOutput(prev => [...prev, `[Simulation] Recorded ${snapshots.length} snapshots`]);
  };

  const handleSaveProject = () => {
    setConsoleOutput(prev => [...prev, '[System] Project saved successfully']);
  };

  const handleStateUpdate = (stateId: string, updates: Partial<State>) => {
    setProject(prev => ({
      ...prev,
      automata: {
        ...prev.automata,
        states: {
          ...prev.automata.states,
          [stateId]: {
            ...prev.automata.states[stateId],
            ...updates
          }
        }
      }
    }));
  };

  const handleTransitionUpdate = (transitionId: string, updates: Partial<Transition>) => {
    setProject(prev => ({
      ...prev,
      automata: {
        ...prev.automata,
        transitions: {
          ...prev.automata.transitions,
          [transitionId]: {
            ...prev.automata.transitions[transitionId],
            ...updates
          }
        }
      }
    }));
  };

  const handleStateCreate = (state: State) => {
    setProject(prev => ({
      ...prev,
      automata: {
        ...prev.automata,
        states: {
          ...prev.automata.states,
          [state.id]: state
        }
      }
    }));
  };

  const handleTransitionCreate = (transition: Transition) => {
    setProject(prev => ({
      ...prev,
      automata: {
        ...prev.automata,
        transitions: {
          ...prev.automata.transitions,
          [transition.id]: transition
        }
      }
    }));
  };

  // Auto-open properties panel when something is selected
  const handleStateSelect = (stateId: string | null) => {
    setSelectedState(stateId);
    setSelectedTransition(null);
    if (stateId) {
      setRightPanelCollapsed(false);
    }
  };

  const handleTransitionSelect = (transitionId: string | null) => {
    setSelectedTransition(transitionId);
    setSelectedState(null);
    if (transitionId) {
      setRightPanelCollapsed(false);
    }
  };

  const handleFlashDevice = (deviceId: string, automataName: string) => {
    setConsoleOutput(prev => [...prev, `[Network] Flashing device ${deviceId} with automata: ${automataName}`]);
    setConsoleOutput(prev => [...prev, `[Network] Uploading automata definition...`]);
    
    // Simulate flashing process
    setTimeout(() => {
      setNetworkDevices(prev => prev.map(d => 
        d.id === deviceId 
          ? { ...d, status: 'updating' as const }
          : d
      ));
      setConsoleOutput(prev => [...prev, `[Network] Device ${deviceId} entering update mode`]);
    }, 500);

    setTimeout(() => {
      setNetworkDevices(prev => prev.map(d => 
        d.id === deviceId 
          ? { ...d, status: 'online' as const, automata: automataName, version: '1.0.0' }
          : d
      ));
      setConsoleOutput(prev => [...prev, `[Network] Device ${deviceId} updated successfully`]);
    }, 2500);
  };

  const handleDeviceUpdate = (deviceId: string, updates: Partial<NetworkDevice>) => {
    setNetworkDevices(prev => prev.map(d => 
      d.id === deviceId ? { ...d, ...updates } : d
    ));
  };

  // Time travel debugging handlers
  const handleSeekSnapshot = (index: number) => {
    setCurrentSnapshotIndex(index);
    const snapshot = executionSnapshots[index];
    if (snapshot) {
      setConsoleOutput(prev => [...prev, `[TDD] Jumped to snapshot ${index + 1}: ${snapshot.event.description}`]);
    }
  };

  const handlePlayback = () => {
    if (isPlayingBack) {
      setIsPlayingBack(false);
      return;
    }

    setIsPlayingBack(true);
    setConsoleOutput(prev => [...prev, '[TDD] Starting playback...']);

    const playNext = (index: number) => {
      if (index >= executionSnapshots.length) {
        setIsPlayingBack(false);
        setConsoleOutput(prev => [...prev, '[TDD] Playback complete']);
        return;
      }

      setCurrentSnapshotIndex(index);
      
      if (!isPlayingBack && index < executionSnapshots.length - 1) {
        return; // Playback was paused
      }

      const nextDelay = index < executionSnapshots.length - 1
        ? (executionSnapshots[index + 1].timestamp - executionSnapshots[index].timestamp) / playbackSpeed
        : 0;

      if (nextDelay > 0) {
        setTimeout(() => playNext(index + 1), nextDelay);
      } else {
        playNext(index + 1);
      }
    };

    playNext(currentSnapshotIndex);
  };

  const handlePausePlayback = () => {
    setIsPlayingBack(false);
    setConsoleOutput(prev => [...prev, '[TDD] Playback paused']);
  };

  const handleStepForward = () => {
    if (currentSnapshotIndex < executionSnapshots.length - 1) {
      const newIndex = currentSnapshotIndex + 1;
      setCurrentSnapshotIndex(newIndex);
      setConsoleOutput(prev => [...prev, `[TDD] Step forward to snapshot ${newIndex + 1}`]);
    }
  };

  const handleStepBackward = () => {
    if (currentSnapshotIndex > 0) {
      const newIndex = currentSnapshotIndex - 1;
      setCurrentSnapshotIndex(newIndex);
      setConsoleOutput(prev => [...prev, `[TDD] Step backward to snapshot ${newIndex + 1}`]);
    }
  };

  const handleClearSnapshots = () => {
    setExecutionSnapshots([]);
    setCurrentSnapshotIndex(0);
    setBookmarks(new Set());
    setConsoleOutput(prev => [...prev, '[TDD] Cleared all snapshots']);
  };

  const handleBookmark = (index: number) => {
    setBookmarks(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
        setConsoleOutput(prev => [...prev, `[TDD] Removed bookmark at snapshot ${index + 1}`]);
      } else {
        next.add(index);
        setConsoleOutput(prev => [...prev, `[TDD] Added bookmark at snapshot ${index + 1}`]);
      }
      return next;
    });
  };

  // Apply snapshot state to visual view
  const getCurrentStateFromSnapshot = () => {
    if (executionSnapshots.length === 0 || currentSnapshotIndex >= executionSnapshots.length) {
      return null;
    }
    return executionSnapshots[currentSnapshotIndex].currentState;
  };

  const visualSelectedState = executionSnapshots.length > 0 && activeView === 'visual' 
    ? getCurrentStateFromSnapshot() 
    : selectedState;

  return (
    <div className="h-screen flex flex-col bg-[#1e1e1e]">
      {/* Top Toolbar */}
      <Toolbar 
        onRunSimulation={handleRunSimulation}
        onSaveProject={handleSaveProject}
        activeView={activeView}
        onViewChange={setActiveView}
        onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
        onToggleProperties={() => setRightPanelCollapsed(!rightPanelCollapsed)}
        onToggleBottomPanel={() => setBottomPanelCollapsed(!bottomPanelCollapsed)}
        sidebarCollapsed={sidebarCollapsed}
        propertiesCollapsed={rightPanelCollapsed}
        bottomPanelCollapsed={bottomPanelCollapsed}
      />

      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar - File Explorer */}
        {!sidebarCollapsed && (
          <ResizablePanel
            initialWidth={sidebarWidth}
            onResize={setSidebarWidth}
            minWidth={200}
            maxWidth={600}
            side="right"
          >
            <div className="h-full bg-[#252526] border-r border-[#3e3e42] flex flex-col">
              <FileExplorer project={project} />
            </div>
          </ResizablePanel>
        )}

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Visual Editor / YAML Editor / Network View */}
          <div className="flex-1 overflow-hidden">
            {activeView === 'visual' ? (
              <StateGraph
                states={project.automata.states}
                transitions={project.automata.transitions}
                selectedState={visualSelectedState}
                selectedTransition={selectedTransition}
                onStateSelect={handleStateSelect}
                onTransitionSelect={handleTransitionSelect}
                onStateUpdate={handleStateUpdate}
                onTransitionUpdate={handleTransitionUpdate}
                onStateCreate={handleStateCreate}
                onTransitionCreate={handleTransitionCreate}
              />
            ) : activeView === 'yaml' ? (
              <CodeEditor
                value={JSON.stringify(project, null, 2)}
                onChange={(value) => {
                  try {
                    const parsed = JSON.parse(value);
                    setProject(parsed);
                  } catch (e) {
                    console.error('Invalid JSON');
                  }
                }}
                language="yaml"
              />
            ) : (
              <NetworkView
                devices={networkDevices}
                onFlashDevice={handleFlashDevice}
                onDeviceUpdate={handleDeviceUpdate}
                availableAutomata={[project.config.name]}
              />
            )}
          </div>

          {/* Bottom Panel - Console or Timeline */}
          {!bottomPanelCollapsed && (
            <ResizablePanel
              initialWidth={consoleHeight}
              onResize={setConsoleHeight}
              minWidth={100}
              maxWidth={600}
              side="top"
            >
              <div className="h-full border-t border-[#3e3e42] flex">
                {/* Tab selector */}
                <div className="w-48 bg-[#252526] border-r border-[#3e3e42] flex flex-col">
                  <button
                    onClick={() => setBottomPanelTab('console')}
                    className={`px-4 py-3 text-left text-sm transition-all ${
                      bottomPanelTab === 'console'
                        ? 'text-white bg-[#1e1e1e] border-l-2 border-[#007acc]'
                        : 'text-[#cccccc] hover:bg-[#2a2d2e]'
                    }`}
                  >
                    Console
                  </button>
                  <button
                    onClick={() => setBottomPanelTab('timeline')}
                    className={`px-4 py-3 text-left text-sm transition-all ${
                      bottomPanelTab === 'timeline'
                        ? 'text-white bg-[#1e1e1e] border-l-2 border-[#007acc]'
                        : 'text-[#cccccc] hover:bg-[#2a2d2e]'
                    }`}
                  >
                    Timeline
                  </button>
                </div>
                
                {/* Content area */}
                <div className="flex-1">
                  {bottomPanelTab === 'console' ? (
                    <Console output={consoleOutput} onClear={() => setConsoleOutput([])} />
                  ) : (
                    <TimelineView
                      snapshots={executionSnapshots}
                      currentIndex={currentSnapshotIndex}
                      isPlaying={isPlayingBack}
                      playbackSpeed={playbackSpeed}
                      onSeek={handleSeekSnapshot}
                      onPlay={handlePlayback}
                      onPause={handlePausePlayback}
                      onStepForward={handleStepForward}
                      onStepBackward={handleStepBackward}
                      onSpeedChange={setPlaybackSpeed}
                      onClear={handleClearSnapshots}
                      onBookmark={handleBookmark}
                      bookmarks={bookmarks}
                    />
                  )}
                </div>
              </div>
            </ResizablePanel>
          )}
        </div>

        {/* Right Sidebar - Properties Panel */}
        {!rightPanelCollapsed && (selectedState || selectedTransition) && (
          <ResizablePanel
            initialWidth={rightPanelWidth}
            onResize={setRightPanelWidth}
            minWidth={250}
            maxWidth={600}
            side="left"
          >
            <div className="h-full bg-[#252526] border-l border-[#3e3e42] flex flex-col">
              <PropertiesPanel
                selectedState={selectedState ? project.automata.states[selectedState] : null}
                selectedTransition={selectedTransition ? project.automata.transitions[selectedTransition] : null}
                onStateUpdate={(updates) => selectedState && handleStateUpdate(selectedState, updates)}
                onTransitionUpdate={(updates) => selectedTransition && handleTransitionUpdate(selectedTransition, updates)}
                onClose={() => {
                  setSelectedState(null);
                  setSelectedTransition(null);
                  setRightPanelCollapsed(true);
                }}
              />
            </div>
          </ResizablePanel>
        )}
      </div>
    </div>
  );
}