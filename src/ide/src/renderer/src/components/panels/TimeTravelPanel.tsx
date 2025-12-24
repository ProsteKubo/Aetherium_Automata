/**
 * Aetherium Automata - Time Travel Debugger Panel
 * 
 * Allows rewinding and replaying automata execution history.
 */

import React, { useState, useMemo } from 'react';
import { useExecutionStore, useGatewayStore } from '../../stores';
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
} from '../common/Icons';

export const TimeTravelPanel: React.FC = () => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  
  // Store data - get raw Map and memoize array conversion
  const devicesMap = useGatewayStore((state) => state.devices);
  const timeTravelSessions = useExecutionStore((state) => state.timeTravelSessions);
  const startTimeTravel = useExecutionStore((state) => state.startTimeTravel);
  const stopTimeTravel = useExecutionStore((state) => state.stopTimeTravel);
  const navigateTimeTravel = useExecutionStore((state) => state.navigateTimeTravel);
  
  // Memoize array conversion
  const devices = useMemo(() => Array.from(devicesMap.values()), [devicesMap]);
  
  // Get active session for selected device
  const activeSession = selectedDeviceId 
    ? timeTravelSessions.get(selectedDeviceId) 
    : undefined;
  
  const currentSnapshot = useMemo(() => {
    if (!activeSession || activeSession.currentReplayIndex < 0) return undefined;
    return activeSession.history.snapshots[activeSession.currentReplayIndex];
  }, [activeSession]);
  
  const snapshotCount = activeSession?.history.snapshots.length ?? 0;
  const currentIndex = activeSession?.currentReplayIndex ?? 0;
  
  // Handle device selection
  const handleDeviceSelect = (deviceId: string) => {
    setSelectedDeviceId(deviceId);
  };
  
  // Start recording/time travel mode
  const handleStartTimeTravel = async () => {
    if (!selectedDeviceId) return;
    await startTimeTravel(selectedDeviceId);
  };
  
  // Stop time travel mode
  const handleStopTimeTravel = () => {
    if (!activeSession) return;
    stopTimeTravel(activeSession.id);
  };
  
  // Navigation controls
  const handleSeek = (index: number) => {
    if (!activeSession) return;
    navigateTimeTravel(activeSession.id, { targetIndex: index });
  };
  
  const handleStepBack = () => {
    if (!activeSession || currentIndex <= 0) return;
    navigateTimeTravel(activeSession.id, { direction: 'backward', steps: 1 });
  };
  
  const handleStepForward = () => {
    if (!activeSession || currentIndex >= snapshotCount - 1) return;
    navigateTimeTravel(activeSession.id, { direction: 'forward', steps: 1 });
  };
  
  const handleRewind = () => {
    if (!activeSession) return;
    navigateTimeTravel(activeSession.id, { targetIndex: 0 });
  };
  
  const handleFastForward = () => {
    if (!activeSession) return;
    navigateTimeTravel(activeSession.id, { targetIndex: snapshotCount - 1 });
  };
  
  // Playback control
  const handlePlayPause = () => {
    setIsPlaying(!isPlaying);
    // TODO: Implement playback interval
  };
  
  const formatTimestamp = (ts: number) => {
    const date = new Date(ts);
    return date.toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit'
    });
  };
  
  return (
    <div className="timetravel-panel">
      <div className="panel-header">
        <IconTimeTravel size={16} />
        <span>Time Travel Debugger</span>
      </div>
      
      {/* Device Selection */}
      <div className="timetravel-device-select">
        <label className="section-label">Select Device</label>
        <div className="device-list">
          {devices.length === 0 ? (
            <div className="empty-state">No devices connected</div>
          ) : (
            devices.map((device) => (
              <button
                key={device.id}
                className={`device-item ${selectedDeviceId === device.id ? 'selected' : ''}`}
                onClick={() => handleDeviceSelect(device.id)}
              >
                <IconDevice size={14} />
                <span>{device.name}</span>
                {timeTravelSessions.has(device.id) && (
                  <span className="recording-badge">
                    <IconRecord size={10} />
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </div>
      
      {selectedDeviceId && (
        <>
          {/* Recording Controls */}
          <div className="timetravel-controls">
            {!activeSession ? (
              <button 
                className="btn btn-primary"
                onClick={handleStartTimeTravel}
              >
                <IconRecord size={14} />
                <span>Start Recording</span>
              </button>
            ) : (
              <button 
                className="btn btn-danger"
                onClick={handleStopTimeTravel}
              >
                <IconStop size={14} />
                <span>Stop Recording</span>
              </button>
            )}
          </div>
          
          {activeSession && (
            <>
              {/* Timeline */}
              <div className="timetravel-timeline">
                <label className="section-label">
                  Timeline ({snapshotCount} snapshots)
                </label>
                
                <div className="timeline-slider">
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0, snapshotCount - 1)}
                    value={currentIndex}
                    onChange={(e) => handleSeek(parseInt(e.target.value))}
                    className="timeline-range"
                  />
                  <div 
                    className="timeline-progress"
                    style={{ 
                      width: `${snapshotCount > 1 
                        ? (currentIndex / (snapshotCount - 1)) * 100 
                        : 0}%` 
                    }}
                  />
                </div>
                
                <div className="timeline-info">
                  <span>{currentIndex + 1} / {snapshotCount}</span>
                  {currentSnapshot && (
                    <span>{formatTimestamp(currentSnapshot.timestamp)}</span>
                  )}
                </div>
              </div>
              
              {/* Playback Controls */}
              <div className="playback-controls">
                <button 
                  className="btn btn-ghost btn-icon"
                  onClick={handleRewind}
                  disabled={currentIndex === 0}
                  title="Rewind to start"
                >
                  <IconRewind size={16} />
                </button>
                <button 
                  className="btn btn-ghost btn-icon"
                  onClick={handleStepBack}
                  disabled={currentIndex === 0}
                  title="Step back"
                >
                  <IconStepBack size={16} />
                </button>
                <button 
                  className="btn btn-primary btn-icon"
                  onClick={handlePlayPause}
                  title={isPlaying ? 'Pause' : 'Play'}
                >
                  {isPlaying ? <IconPause size={16} /> : <IconPlay size={16} />}
                </button>
                <button 
                  className="btn btn-ghost btn-icon"
                  onClick={handleStepForward}
                  disabled={currentIndex >= snapshotCount - 1}
                  title="Step forward"
                >
                  <IconStepForward size={16} />
                </button>
                <button 
                  className="btn btn-ghost btn-icon"
                  onClick={handleFastForward}
                  disabled={currentIndex >= snapshotCount - 1}
                  title="Jump to end"
                >
                  <IconFastForward size={16} />
                </button>
                
                <select
                  className="speed-select"
                  value={playbackSpeed}
                  onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}
                >
                  <option value={0.25}>0.25x</option>
                  <option value={0.5}>0.5x</option>
                  <option value={1}>1x</option>
                  <option value={2}>2x</option>
                  <option value={4}>4x</option>
                </select>
              </div>
              
              {/* Current Snapshot Details */}
              {currentSnapshot && (
                <div className="snapshot-details">
                  <label className="section-label">Snapshot Details</label>
                  
                  <div className="snapshot-info">
                    <div className="info-row">
                      <span className="info-label">Timestamp:</span>
                      <span className="info-value">{formatTimestamp(currentSnapshot.timestamp)}</span>
                    </div>
                    <div className="info-row">
                      <span className="info-label">Execution Cycle:</span>
                      <span className="info-value">{currentSnapshot.executionCycle}</span>
                    </div>
                    <div className="info-row">
                      <span className="info-label">Current State:</span>
                      <span className="info-value state-badge">{currentSnapshot.currentState}</span>
                    </div>
                    {currentSnapshot.previousState && (
                      <div className="info-row">
                        <span className="info-label">Previous State:</span>
                        <span className="info-value">{currentSnapshot.previousState}</span>
                      </div>
                    )}
                    {currentSnapshot.lastTransition && (
                      <div className="info-row">
                        <span className="info-label">Last Transition:</span>
                        <span className="info-value event-badge">{currentSnapshot.lastTransition}</span>
                      </div>
                    )}
                    {currentSnapshot.errorState && (
                      <div className="info-row error">
                        <span className="info-label">Error:</span>
                        <span className="info-value">{currentSnapshot.errorState}</span>
                      </div>
                    )}
                  </div>
                  
                  {/* Variables */}
                  {currentSnapshot.variables && Object.keys(currentSnapshot.variables).length > 0 && (
                    <div className="snapshot-context">
                      <label className="subsection-label">Variables</label>
                      <div className="context-vars">
                        {Object.entries(currentSnapshot.variables).map(([key, value]) => (
                          <div key={key} className="context-var">
                            <span className="var-key">{key}:</span>
                            <span className="var-value">{JSON.stringify(value)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              
              {/* Snapshot List */}
              <div className="snapshot-list">
                <label className="section-label">History</label>
                <div className="snapshot-items">
                  {activeSession.history.snapshots.slice().reverse().slice(0, 50).map((snapshot, idx) => {
                    const actualIdx = snapshotCount - 1 - idx;
                    return (
                      <div
                        key={snapshot.id}
                        className={`snapshot-item ${actualIdx === currentIndex ? 'current' : ''}`}
                        onClick={() => handleSeek(actualIdx)}
                      >
                        <span className="snapshot-time">{formatTimestamp(snapshot.timestamp)}</span>
                        <span className="snapshot-state">{snapshot.currentState}</span>
                        {snapshot.lastTransition && (
                          <span className="snapshot-event">← {snapshot.lastTransition}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
};
