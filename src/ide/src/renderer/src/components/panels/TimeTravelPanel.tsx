/**
 * Aetherium Automata - Time Travel Debugger Panel
 * 
 * Network-wide recording and replay system. Records everything across
 * all devices, automatas, and communications simultaneously, allowing
 * complete network state rewind and analysis.
 * 
 * THE MAIN FEATURE: Rewind the entire network to any point in time.
 */

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useUIStore } from '../../stores';
import {
  IconTimeTravel,
  IconRewind,
  IconStepBack,
  IconStepForward,
  IconFastForward,
  IconPlay,
  IconPause,
  IconRecord,
  IconStop,
  IconDevice,
  IconAutomata,
  IconNetwork,
  IconChevronRight,
  IconChevronDown,
  IconX,
  IconSettings,
  IconZoomIn,
  IconZoomOut,
} from '../common/Icons';

// ============================================================================
// Types for Network-Wide Time Travel
// ============================================================================

interface NetworkSnapshot {
  id: string;
  timestamp: number;
  frameNumber: number;
  
  // Device states at this moment
  deviceStates: Map<string, DeviceSnapshotState>;
  
  // All automata states at this moment
  automataStates: Map<string, AutomataSnapshotState>;
  
  // Communications happening at this moment
  communications: CommunicationEvent[];
  
  // Any events/triggers at this moment
  events: NetworkEvent[];
}

interface DeviceSnapshotState {
  deviceId: string;
  deviceName: string;
  status: 'online' | 'offline' | 'error' | 'updating';
  cpuUsage?: number;
  memoryUsage?: number;
  activeAutomataId?: string;
}

interface AutomataSnapshotState {
  automataId: string;
  automataName: string;
  deviceId?: string;
  currentState: string;
  previousState?: string;
  variables: Record<string, unknown>;
  lastTransition?: string;
  executionCycle: number;
}

interface CommunicationEvent {
  id: string;
  type: 'input' | 'output' | 'message' | 'signal';
  sourceId: string;
  sourceName: string;
  targetId?: string;
  targetName?: string;
  channel: string;
  data: unknown;
  timestamp: number;
}

interface NetworkEvent {
  id: string;
  type: 'state_change' | 'transition' | 'error' | 'warning' | 'connection' | 'disconnection';
  sourceId: string;
  sourceName: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
  timestamp: number;
}

interface RecordingSession {
  id: string;
  name: string;
  startTime: number;
  endTime?: number;
  isRecording: boolean;
  snapshots: NetworkSnapshot[];
  deviceIds: string[];
  bookmarks: Array<{ frameNumber: number; name: string; timestamp: number }>;
  maxSnapshots: number;
  captureInterval: number; // ms
}

// ============================================================================
// Mock Data Generator (for demonstration)
// ============================================================================

const generateMockNetworkSnapshot = (
  frameNumber: number,
  devices: Array<{ id: string; name: string }>,
  automatas: Array<{ id: string; name: string; states: string[] }>
): NetworkSnapshot => {
  const timestamp = Date.now() - (100 - frameNumber) * 50;
  
  const deviceStates = new Map<string, DeviceSnapshotState>();
  devices.forEach((device, idx) => {
    deviceStates.set(device.id, {
      deviceId: device.id,
      deviceName: device.name,
      status: 'online',
      cpuUsage: 20 + Math.sin(frameNumber * 0.1 + idx) * 15,
      memoryUsage: 40 + Math.cos(frameNumber * 0.15 + idx) * 20,
      activeAutomataId: automatas[idx % automatas.length]?.id,
    });
  });
  
  const automataStates = new Map<string, AutomataSnapshotState>();
  automatas.forEach((automata, idx) => {
    const stateIdx = Math.floor((frameNumber + idx * 7) / 5) % automata.states.length;
    const prevStateIdx = stateIdx > 0 ? stateIdx - 1 : automata.states.length - 1;
    automataStates.set(automata.id, {
      automataId: automata.id,
      automataName: automata.name,
      deviceId: devices[idx % devices.length]?.id,
      currentState: automata.states[stateIdx],
      previousState: automata.states[prevStateIdx],
      variables: {
        counter: frameNumber + idx * 10,
        sensor_value: Math.sin(frameNumber * 0.2) * 100,
        flag: frameNumber % 10 < 5,
      },
      lastTransition: frameNumber % 5 === 0 ? `t_${stateIdx}` : undefined,
      executionCycle: frameNumber,
    });
  });
  
  const communications: CommunicationEvent[] = [];
  if (frameNumber % 3 === 0 && automatas.length >= 2) {
    communications.push({
      id: `comm_${frameNumber}`,
      type: 'output',
      sourceId: automatas[0].id,
      sourceName: automatas[0].name,
      targetId: automatas[1].id,
      targetName: automatas[1].name,
      channel: 'sensor_data',
      data: { value: Math.random() * 100 },
      timestamp,
    });
  }
  
  const events: NetworkEvent[] = [];
  if (frameNumber % 5 === 0) {
    events.push({
      id: `evt_${frameNumber}`,
      type: 'state_change',
      sourceId: automatas[frameNumber % automatas.length]?.id || 'unknown',
      sourceName: automatas[frameNumber % automatas.length]?.name || 'Unknown',
      message: `State changed to ${automatas[0]?.states[frameNumber % (automatas[0]?.states.length || 1)]}`,
      severity: 'info',
      timestamp,
    });
  }
  
  return {
    id: `snapshot_${frameNumber}`,
    timestamp,
    frameNumber,
    deviceStates,
    automataStates,
    communications,
    events,
  };
};

// ============================================================================
// Component
// ============================================================================

export const TimeTravelPanel: React.FC = () => {
  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSession, setRecordingSession] = useState<RecordingSession | null>(null);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  
  // UI state
  const [timelineZoom, setTimelineZoom] = useState(1);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['devices', 'automatas', 'events']));
  const [captureInterval, setCaptureInterval] = useState(50);
  const [maxSnapshots, setMaxSnapshots] = useState(10000);
  
  // Refs
  const timelineRef = useRef<HTMLDivElement>(null);
  const playbackIntervalRef = useRef<number | null>(null);
  
  // Store data
  const addNotification = useUIStore((state) => state.addNotification);
  
  // Note: In production, mock data would be replaced with real store data
  // Real implementation would use: useGatewayStore for devices/servers
  // and useAutomataStore for automata
  
  // Mock data for demo
  const mockDevices = useMemo(() => [
    { id: 'dev-1', name: 'ESP32-Main' },
    { id: 'dev-2', name: 'RPi-Gateway' },
    { id: 'dev-3', name: 'Arduino-Sensor' },
  ], []);
  
  const mockAutomatas = useMemo(() => [
    { id: 'auto-1', name: 'TemperatureController', states: ['Idle', 'Monitoring', 'Heating', 'Cooling', 'Alert'] },
    { id: 'auto-2', name: 'SensorPoller', states: ['Init', 'Polling', 'Processing', 'Transmitting'] },
    { id: 'auto-3', name: 'SafetyMonitor', states: ['Standby', 'Checking', 'Normal', 'Warning', 'Emergency'] },
  ], []);
  
  // Current snapshot
  const currentSnapshot = useMemo(() => {
    if (!recordingSession || recordingSession.snapshots.length === 0) return null;
    const idx = Math.min(currentFrame, recordingSession.snapshots.length - 1);
    return recordingSession.snapshots[idx] || null;
  }, [recordingSession, currentFrame]);
  
  const totalFrames = recordingSession?.snapshots.length || 0;
  
  // Toggle section expansion
  const toggleSection = (section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };
  
  // Start network-wide recording
  const handleStartRecording = useCallback(() => {
    const session: RecordingSession = {
      id: `session_${Date.now()}`,
      name: `Recording ${new Date().toLocaleString()}`,
      startTime: Date.now(),
      isRecording: true,
      snapshots: [],
      deviceIds: mockDevices.map(d => d.id),
      bookmarks: [],
      maxSnapshots,
      captureInterval,
    };
    
    // Generate initial snapshots for demo
    for (let i = 0; i < 100; i++) {
      session.snapshots.push(generateMockNetworkSnapshot(i, mockDevices, mockAutomatas));
    }
    
    setRecordingSession(session);
    setIsRecording(true);
    setCurrentFrame(session.snapshots.length - 1);
    addNotification('success', 'Recording Started', 'Network-wide time travel recording is now active');
  }, [mockDevices, mockAutomatas, maxSnapshots, captureInterval, addNotification]);
  
  // Stop recording
  const handleStopRecording = useCallback(() => {
    if (recordingSession) {
      setRecordingSession({
        ...recordingSession,
        isRecording: false,
        endTime: Date.now(),
      });
    }
    setIsRecording(false);
    addNotification('info', 'Recording Stopped', `Captured ${totalFrames} network snapshots`);
  }, [recordingSession, totalFrames, addNotification]);
  
  // Navigation controls
  const handleSeek = useCallback((frame: number) => {
    setCurrentFrame(Math.max(0, Math.min(frame, totalFrames - 1)));
    setIsPlaying(false);
  }, [totalFrames]);
  
  const handleRewind = useCallback(() => {
    setCurrentFrame(0);
    setIsPlaying(false);
  }, []);
  
  const handleFastForward = useCallback(() => {
    setCurrentFrame(totalFrames - 1);
    setIsPlaying(false);
  }, [totalFrames]);
  
  const handleStepBack = useCallback(() => {
    setCurrentFrame((prev) => Math.max(0, prev - 1));
    setIsPlaying(false);
  }, []);
  
  const handleStepForward = useCallback(() => {
    setCurrentFrame((prev) => Math.min(totalFrames - 1, prev + 1));
    setIsPlaying(false);
  }, [totalFrames]);
  
  // Playback control
  const handlePlayPause = useCallback(() => {
    setIsPlaying((prev) => !prev);
  }, []);
  
  // Playback effect
  useEffect(() => {
    if (isPlaying && totalFrames > 0) {
      playbackIntervalRef.current = window.setInterval(() => {
        setCurrentFrame((prev) => {
          if (prev >= totalFrames - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, captureInterval / playbackSpeed);
    }
    
    return () => {
      if (playbackIntervalRef.current) {
        clearInterval(playbackIntervalRef.current);
      }
    };
  }, [isPlaying, totalFrames, captureInterval, playbackSpeed]);
  
  // Add bookmark
  const handleAddBookmark = useCallback(() => {
    if (!recordingSession) return;
    
    const name = prompt('Enter bookmark name:', `Bookmark at frame ${currentFrame}`);
    if (!name) return;
    
    setRecordingSession({
      ...recordingSession,
      bookmarks: [
        ...recordingSession.bookmarks,
        { frameNumber: currentFrame, name, timestamp: Date.now() },
      ],
    });
    addNotification('info', 'Bookmark Added', `Saved bookmark "${name}" at frame ${currentFrame}`);
  }, [recordingSession, currentFrame, addNotification]);
  
  // Format timestamp
  const formatTimestamp = (ts: number) => {
    const date = new Date(ts);
    return date.toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit',
    });
  };
  
  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  };
  
  // Get entity color based on id hash
  const getEntityColor = (id: string, _type: 'device' | 'automata') => {
    const colors = [
      'var(--color-primary)',
      'var(--color-secondary-400)',
      'var(--color-success)',
      'var(--color-warning)',
      '#9b59b6',
      '#e74c3c',
    ];
    const hash = id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return colors[hash % colors.length];
  };
  
  return (
    <div className="timetravel-panel timetravel-network">
      {/* Header */}
      <div className="timetravel-header">
        <div className="header-left">
          <IconTimeTravel size={20} className="header-icon pulse" />
          <div className="header-title">
            <h2>Time Travel Debugger</h2>
            <span className="header-subtitle">Network-Wide Recording &amp; Replay</span>
          </div>
        </div>
        <div className="header-right">
          {isRecording && (
            <div className="recording-indicator">
              <span className="rec-dot"></span>
              <span>REC</span>
            </div>
          )}
          <button
            className="btn btn-ghost btn-icon"
            onClick={() => setShowSettings(!showSettings)}
            title="Settings"
          >
            <IconSettings size={16} />
          </button>
        </div>
      </div>
      
      {/* Settings Panel */}
      {showSettings && (
        <div className="timetravel-settings">
          <div className="settings-row">
            <label>Capture Interval (ms)</label>
            <input
              type="number"
              value={captureInterval}
              onChange={(e) => setCaptureInterval(Math.max(10, parseInt(e.target.value) || 50))}
              min={10}
              max={1000}
            />
          </div>
          <div className="settings-row">
            <label>Max Snapshots</label>
            <input
              type="number"
              value={maxSnapshots}
              onChange={(e) => setMaxSnapshots(Math.max(100, parseInt(e.target.value) || 10000))}
              min={100}
              max={100000}
            />
          </div>
        </div>
      )}
      
      {/* Recording Controls */}
      <div className="recording-controls">
        {!recordingSession ? (
          <button 
            className="btn btn-record"
            onClick={handleStartRecording}
          >
            <IconRecord size={18} />
            <span>Start Network Recording</span>
          </button>
        ) : (
          <div className="recording-info">
            <div className="recording-stats">
              <div className="stat">
                <span className="stat-label">Duration</span>
                <span className="stat-value">
                  {formatDuration(
                    (recordingSession.endTime || Date.now()) - recordingSession.startTime
                  )}
                </span>
              </div>
              <div className="stat">
                <span className="stat-label">Frames</span>
                <span className="stat-value">{totalFrames.toLocaleString()}</span>
              </div>
              <div className="stat">
                <span className="stat-label">Devices</span>
                <span className="stat-value">{recordingSession.deviceIds.length}</span>
              </div>
            </div>
            
            {isRecording ? (
              <button 
                className="btn btn-stop"
                onClick={handleStopRecording}
              >
                <IconStop size={16} />
                <span>Stop</span>
              </button>
            ) : (
              <button 
                className="btn btn-secondary"
                onClick={() => setRecordingSession(null)}
              >
                <IconX size={16} />
                <span>Clear</span>
              </button>
            )}
          </div>
        )}
      </div>
      
      {recordingSession && totalFrames > 0 && (
        <>
          {/* Main Timeline */}
          <div className="network-timeline">
            <div className="timeline-header">
              <span className="timeline-title">Network Timeline</span>
              <div className="timeline-zoom">
                <button 
                  className="btn btn-ghost btn-icon btn-sm"
                  onClick={() => setTimelineZoom(Math.max(0.5, timelineZoom - 0.25))}
                >
                  <IconZoomOut size={12} />
                </button>
                <span>{Math.round(timelineZoom * 100)}%</span>
                <button 
                  className="btn btn-ghost btn-icon btn-sm"
                  onClick={() => setTimelineZoom(Math.min(4, timelineZoom + 0.25))}
                >
                  <IconZoomIn size={12} />
                </button>
              </div>
            </div>
            
            <div className="timeline-container" ref={timelineRef}>
              {/* Timeline tracks */}
              <div className="timeline-tracks" style={{ transform: `scaleX(${timelineZoom})` }}>
                {/* Master track */}
                <div className="timeline-track master-track">
                  <div className="track-label">
                    <IconNetwork size={12} />
                    <span>Network</span>
                  </div>
                  <div className="track-content">
                    <div 
                      className="track-bar"
                      style={{ width: '100%' }}
                    >
                      {/* Bookmarks */}
                      {recordingSession.bookmarks.map((bookmark) => (
                        <div
                          key={bookmark.frameNumber}
                          className="bookmark-marker"
                          style={{ left: `${(bookmark.frameNumber / totalFrames) * 100}%` }}
                          title={bookmark.name}
                          onClick={() => handleSeek(bookmark.frameNumber)}
                        />
                      ))}
                      
                      {/* Event markers */}
                      {recordingSession.snapshots
                        .filter((s) => s.events.length > 0)
                        .slice(0, 100)
                        .map((snapshot) => (
                          <div
                            key={snapshot.frameNumber}
                            className={`event-marker ${snapshot.events[0]?.severity || 'info'}`}
                            style={{ left: `${(snapshot.frameNumber / totalFrames) * 100}%` }}
                            title={snapshot.events[0]?.message}
                          />
                        ))}
                    </div>
                  </div>
                </div>
                
                {/* Device tracks */}
                {mockDevices.map((device) => (
                  <div key={device.id} className="timeline-track device-track">
                    <div 
                      className="track-label"
                      style={{ borderLeftColor: getEntityColor(device.id, 'device') }}
                    >
                      <IconDevice size={12} />
                      <span>{device.name}</span>
                    </div>
                    <div className="track-content">
                      <div 
                        className="track-bar"
                        style={{ 
                          backgroundColor: getEntityColor(device.id, 'device'),
                          opacity: 0.3,
                        }}
                      />
                    </div>
                  </div>
                ))}
                
                {/* Automata tracks */}
                {mockAutomatas.map((automata) => (
                  <div key={automata.id} className="timeline-track automata-track">
                    <div 
                      className="track-label"
                      style={{ borderLeftColor: getEntityColor(automata.id, 'automata') }}
                    >
                      <IconAutomata size={12} />
                      <span>{automata.name}</span>
                    </div>
                    <div className="track-content">
                      {/* State blocks */}
                      {automata.states.map((state, idx) => {
                        const startFrame = idx * Math.floor(totalFrames / automata.states.length);
                        const width = 100 / automata.states.length;
                        return (
                          <div
                            key={state}
                            className="state-block"
                            style={{
                              left: `${(startFrame / totalFrames) * 100}%`,
                              width: `${width}%`,
                              backgroundColor: getEntityColor(automata.id, 'automata'),
                            }}
                            title={state}
                          >
                            <span className="state-name">{state}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              
              {/* Playhead */}
              <div 
                className="timeline-playhead"
                style={{ left: `${(currentFrame / Math.max(1, totalFrames - 1)) * 100}%` }}
              >
                <div className="playhead-line" />
                <div className="playhead-handle" />
              </div>
              
              {/* Scrubber area */}
              <div 
                className="timeline-scrubber"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const percent = (e.clientX - rect.left) / rect.width;
                  handleSeek(Math.floor(percent * totalFrames));
                }}
              />
            </div>
            
            {/* Timeline info */}
            <div className="timeline-info">
              <span className="frame-info">
                Frame {currentFrame + 1} / {totalFrames}
              </span>
              {currentSnapshot && (
                <span className="time-info">
                  {formatTimestamp(currentSnapshot.timestamp)}
                </span>
              )}
            </div>
          </div>
          
          {/* Playback Controls */}
          <div className="playback-controls-bar">
            <div className="playback-buttons">
              <button 
                className="btn btn-ghost btn-icon"
                onClick={handleRewind}
                disabled={currentFrame === 0}
                title="Rewind to start (Home)"
              >
                <IconRewind size={18} />
              </button>
              <button 
                className="btn btn-ghost btn-icon"
                onClick={handleStepBack}
                disabled={currentFrame === 0}
                title="Step back (←)"
              >
                <IconStepBack size={18} />
              </button>
              <button 
                className={`btn btn-play ${isPlaying ? 'playing' : ''}`}
                onClick={handlePlayPause}
                title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
              >
                {isPlaying ? <IconPause size={22} /> : <IconPlay size={22} />}
              </button>
              <button 
                className="btn btn-ghost btn-icon"
                onClick={handleStepForward}
                disabled={currentFrame >= totalFrames - 1}
                title="Step forward (→)"
              >
                <IconStepForward size={18} />
              </button>
              <button 
                className="btn btn-ghost btn-icon"
                onClick={handleFastForward}
                disabled={currentFrame >= totalFrames - 1}
                title="Jump to end (End)"
              >
                <IconFastForward size={18} />
              </button>
            </div>
            
            <div className="playback-speed">
              <span>Speed:</span>
              <select
                value={playbackSpeed}
                onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}
              >
                <option value={0.1}>0.1x</option>
                <option value={0.25}>0.25x</option>
                <option value={0.5}>0.5x</option>
                <option value={1}>1x</option>
                <option value={2}>2x</option>
                <option value={4}>4x</option>
                <option value={10}>10x</option>
              </select>
            </div>
            
            <button 
              className="btn btn-ghost btn-sm"
              onClick={handleAddBookmark}
              title="Add bookmark"
            >
              🔖 Bookmark
            </button>
          </div>
          
          {/* Network State View */}
          <div className="network-state-view">
            {/* Devices Section */}
            <div className="state-section">
              <div 
                className="section-header"
                onClick={() => toggleSection('devices')}
              >
                {expandedSections.has('devices') ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                <IconDevice size={14} />
                <span>Devices ({currentSnapshot?.deviceStates.size || 0})</span>
              </div>
              
              {expandedSections.has('devices') && currentSnapshot && (
                <div className="section-content">
                  {Array.from(currentSnapshot.deviceStates.values()).map((device) => (
                    <div 
                      key={device.deviceId}
                      className={`entity-card device-card ${selectedEntityId === device.deviceId ? 'selected' : ''}`}
                      onClick={() => {
                        setSelectedEntityId(device.deviceId);
                      }}
                      style={{ borderLeftColor: getEntityColor(device.deviceId, 'device') }}
                    >
                      <div className="entity-header">
                        <span className="entity-name">{device.deviceName}</span>
                        <span className={`status-badge ${device.status}`}>{device.status}</span>
                      </div>
                      <div className="entity-metrics">
                        <div className="metric">
                          <span className="metric-label">CPU</span>
                          <div className="metric-bar">
                            <div 
                              className="metric-fill cpu"
                              style={{ width: `${device.cpuUsage || 0}%` }}
                            />
                          </div>
                          <span className="metric-value">{(device.cpuUsage || 0).toFixed(1)}%</span>
                        </div>
                        <div className="metric">
                          <span className="metric-label">MEM</span>
                          <div className="metric-bar">
                            <div 
                              className="metric-fill memory"
                              style={{ width: `${device.memoryUsage || 0}%` }}
                            />
                          </div>
                          <span className="metric-value">{(device.memoryUsage || 0).toFixed(1)}%</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            {/* Automatas Section */}
            <div className="state-section">
              <div 
                className="section-header"
                onClick={() => toggleSection('automatas')}
              >
                {expandedSections.has('automatas') ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                <IconAutomata size={14} />
                <span>Automatas ({currentSnapshot?.automataStates.size || 0})</span>
              </div>
              
              {expandedSections.has('automatas') && currentSnapshot && (
                <div className="section-content">
                  {Array.from(currentSnapshot.automataStates.values()).map((automata) => (
                    <div 
                      key={automata.automataId}
                      className={`entity-card automata-card ${selectedEntityId === automata.automataId ? 'selected' : ''}`}
                      onClick={() => {
                        setSelectedEntityId(automata.automataId);
                      }}
                      style={{ borderLeftColor: getEntityColor(automata.automataId, 'automata') }}
                    >
                      <div className="entity-header">
                        <span className="entity-name">{automata.automataName}</span>
                        <span className="state-badge">{automata.currentState}</span>
                      </div>
                      
                      {automata.lastTransition && (
                        <div className="transition-info">
                          <span className="from-state">{automata.previousState}</span>
                          <span className="arrow">→</span>
                          <span className="to-state">{automata.currentState}</span>
                          <span className="via">via {automata.lastTransition}</span>
                        </div>
                      )}
                      
                      <div className="variables-preview">
                        {Object.entries(automata.variables).slice(0, 3).map(([key, value]) => (
                          <div key={key} className="var-item">
                            <span className="var-key">{key}:</span>
                            <span className="var-value">
                              {typeof value === 'boolean' 
                                ? (value ? '✓' : '✗')
                                : typeof value === 'number'
                                  ? value.toFixed(2)
                                  : String(value)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            {/* Communications Section */}
            <div className="state-section">
              <div 
                className="section-header"
                onClick={() => toggleSection('comms')}
              >
                {expandedSections.has('comms') ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                <IconNetwork size={14} />
                <span>Communications ({currentSnapshot?.communications.length || 0})</span>
              </div>
              
              {expandedSections.has('comms') && currentSnapshot && (
                <div className="section-content">
                  {currentSnapshot.communications.length === 0 ? (
                    <div className="empty-state">No communications at this frame</div>
                  ) : (
                    currentSnapshot.communications.map((comm) => (
                      <div key={comm.id} className="comm-card">
                        <div className="comm-flow">
                          <span className="comm-source">{comm.sourceName}</span>
                          <span className="comm-arrow">→</span>
                          <span className="comm-target">{comm.targetName || 'Broadcast'}</span>
                        </div>
                        <div className="comm-details">
                          <span className="comm-channel">{comm.channel}</span>
                          <span className="comm-type">{comm.type}</span>
                        </div>
                        <div className="comm-data">
                          <code>{JSON.stringify(comm.data)}</code>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
            
            {/* Events Section */}
            <div className="state-section">
              <div 
                className="section-header"
                onClick={() => toggleSection('events')}
              >
                {expandedSections.has('events') ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                <span>📋</span>
                <span>Events ({currentSnapshot?.events.length || 0})</span>
              </div>
              
              {expandedSections.has('events') && currentSnapshot && (
                <div className="section-content">
                  {currentSnapshot.events.length === 0 ? (
                    <div className="empty-state">No events at this frame</div>
                  ) : (
                    currentSnapshot.events.map((event) => (
                      <div key={event.id} className={`event-card ${event.severity}`}>
                        <div className="event-header">
                          <span className="event-source">{event.sourceName}</span>
                          <span className={`severity-badge ${event.severity}`}>{event.severity}</span>
                        </div>
                        <div className="event-message">{event.message}</div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
          
          {/* Bookmarks List */}
          {recordingSession.bookmarks.length > 0 && (
            <div className="bookmarks-section">
              <div className="section-header">
                <span>🔖</span>
                <span>Bookmarks ({recordingSession.bookmarks.length})</span>
              </div>
              <div className="bookmarks-list">
                {recordingSession.bookmarks.map((bookmark) => (
                  <div 
                    key={bookmark.frameNumber}
                    className={`bookmark-item ${currentFrame === bookmark.frameNumber ? 'active' : ''}`}
                    onClick={() => handleSeek(bookmark.frameNumber)}
                  >
                    <span className="bookmark-name">{bookmark.name}</span>
                    <span className="bookmark-frame">Frame {bookmark.frameNumber}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
      
      {/* Empty state when no recording */}
      {!recordingSession && (
        <div className="timetravel-empty">
          <div className="empty-icon">
            <IconTimeTravel size={64} />
          </div>
          <h3>Network Time Travel</h3>
          <p>
            Record everything happening across your entire network - 
            every device, every automata, every message - and rewind 
            to any point in time for debugging and analysis.
          </p>
          <ul className="feature-list">
            <li>📹 Capture all network state simultaneously</li>
            <li>⏪ Rewind to any moment in time</li>
            <li>🔍 Inspect every device and automata state</li>
            <li>📊 Track all inter-automata communications</li>
            <li>🔖 Bookmark important moments</li>
            <li>⚡ Playback at variable speeds</li>
          </ul>
        </div>
      )}
    </div>
  );
};
