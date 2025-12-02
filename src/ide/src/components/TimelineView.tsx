import { useState, useRef, useEffect } from 'react';
import { Play, Pause, SkipBack, SkipForward, StepBack, StepForward, Clock, Bookmark, Trash2 } from 'lucide-react';
import type { ExecutionSnapshot } from './AutomataIDE';

type TimelineViewProps = {
  snapshots: ExecutionSnapshot[];
  currentIndex: number;
  isPlaying: boolean;
  playbackSpeed: number;
  onSeek: (index: number) => void;
  onPlay: () => void;
  onPause: () => void;
  onStepForward: () => void;
  onStepBackward: () => void;
  onSpeedChange: (speed: number) => void;
  onClear: () => void;
  onBookmark: (index: number) => void;
  bookmarks: Set<number>;
};

export function TimelineView({
  snapshots,
  currentIndex,
  isPlaying,
  playbackSpeed,
  onSeek,
  onPlay,
  onPause,
  onStepForward,
  onStepBackward,
  onSpeedChange,
  onClear,
  onBookmark,
  bookmarks
}: TimelineViewProps) {
  const timelineRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { 
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const formatDuration = (start: number, end: number) => {
    const diff = end - start;
    if (diff < 1000) return `${diff}ms`;
    if (diff < 60000) return `${(diff / 1000).toFixed(2)}s`;
    return `${Math.floor(diff / 60000)}m ${Math.floor((diff % 60000) / 1000)}s`;
  };

  const handleTimelineClick = (e: React.MouseEvent) => {
    if (!timelineRef.current || snapshots.length === 0) return;
    
    const rect = timelineRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = x / rect.width;
    const index = Math.floor(percentage * snapshots.length);
    
    onSeek(Math.max(0, Math.min(snapshots.length - 1, index)));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    handleTimelineClick(e);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      handleTimelineClick(e);
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  useEffect(() => {
    if (isDragging) {
      const handleGlobalMouseUp = () => setIsDragging(false);
      window.addEventListener('mouseup', handleGlobalMouseUp);
      return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
    }
  }, [isDragging]);

  const getEventColor = (type: string) => {
    switch (type) {
      case 'transition': return '#4a9eff';
      case 'input': return '#16825d';
      case 'output': return '#c586c0';
      case 'variable': return '#dcdcaa';
      case 'state_enter': return '#569cd6';
      case 'state_exit': return '#858585';
      case 'error': return '#f48771';
      default: return '#cccccc';
    }
  };

  const currentSnapshot = snapshots[currentIndex];
  const duration = snapshots.length > 0 
    ? snapshots[snapshots.length - 1].timestamp - snapshots[0].timestamp 
    : 0;

  return (
    <div className="h-full bg-[#1e1e1e] flex flex-col border-t border-[#3e3e42]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[#3e3e42] flex items-center justify-between">
        <div className="flex items-center gap-2 text-[#cccccc]">
          <Clock className="size-4" />
          <span className="text-sm">Time Travel Debugger</span>
          {currentSnapshot && (
            <span className="text-xs text-[#858585]">
              {formatTime(currentSnapshot.timestamp)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="text-xs text-[#858585]">
            {currentIndex + 1} / {snapshots.length} snapshots
          </div>
          <button
            onClick={onClear}
            disabled={snapshots.length === 0}
            className="p-1.5 text-[#cccccc] hover:bg-[#3e3e42] disabled:text-[#858585] rounded transition-colors"
            title="Clear history"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      </div>

      {/* Playback Controls */}
      <div className="px-4 py-3 border-b border-[#3e3e42] flex items-center gap-2">
        <button
          onClick={() => onSeek(0)}
          disabled={snapshots.length === 0 || currentIndex === 0}
          className="p-2 text-[#cccccc] hover:bg-[#3e3e42] disabled:text-[#858585] rounded transition-colors"
          title="Jump to start"
        >
          <SkipBack className="size-4" />
        </button>

        <button
          onClick={onStepBackward}
          disabled={snapshots.length === 0 || currentIndex === 0}
          className="p-2 text-[#cccccc] hover:bg-[#3e3e42] disabled:text-[#858585] rounded transition-colors"
          title="Step backward"
        >
          <StepBack className="size-4" />
        </button>

        {isPlaying ? (
          <button
            onClick={onPause}
            className="p-2 bg-[#0e639c] hover:bg-[#1177bb] text-white rounded transition-colors"
            title="Pause"
          >
            <Pause className="size-4" />
          </button>
        ) : (
          <button
            onClick={onPlay}
            disabled={snapshots.length === 0}
            className="p-2 bg-[#16825d] hover:bg-[#1a9970] disabled:bg-[#3c3c3c] disabled:text-[#858585] text-white rounded transition-colors"
            title="Play"
          >
            <Play className="size-4" />
          </button>
        )}

        <button
          onClick={onStepForward}
          disabled={snapshots.length === 0 || currentIndex >= snapshots.length - 1}
          className="p-2 text-[#cccccc] hover:bg-[#3e3e42] disabled:text-[#858585] rounded transition-colors"
          title="Step forward"
        >
          <StepForward className="size-4" />
        </button>

        <button
          onClick={() => onSeek(snapshots.length - 1)}
          disabled={snapshots.length === 0 || currentIndex >= snapshots.length - 1}
          className="p-2 text-[#cccccc] hover:bg-[#3e3e42] disabled:text-[#858585] rounded transition-colors"
          title="Jump to end"
        >
          <SkipForward className="size-4" />
        </button>

        <div className="w-px h-6 bg-[#3e3e42] mx-2" />

        <button
          onClick={() => currentSnapshot && onBookmark(currentIndex)}
          disabled={snapshots.length === 0}
          className={`p-2 rounded transition-colors ${
            bookmarks.has(currentIndex)
              ? 'bg-[#cca700] text-white'
              : 'text-[#cccccc] hover:bg-[#3e3e42]'
          }`}
          title="Bookmark"
        >
          <Bookmark className="size-4" />
        </button>

        <div className="w-px h-6 bg-[#3e3e42] mx-2" />

        {/* Playback Speed */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#858585]">Speed:</span>
          <select
            value={playbackSpeed}
            onChange={(e) => onSpeedChange(Number(e.target.value))}
            className="px-2 py-1 bg-[#3c3c3c] text-white border border-[#3e3e42] rounded text-xs"
          >
            <option value={0.25}>0.25x</option>
            <option value={0.5}>0.5x</option>
            <option value={1}>1x</option>
            <option value={2}>2x</option>
            <option value={4}>4x</option>
            <option value={8}>8x</option>
          </select>
        </div>

        {duration > 0 && (
          <div className="ml-auto text-xs text-[#858585]">
            Total: {formatDuration(snapshots[0].timestamp, snapshots[snapshots.length - 1].timestamp)}
          </div>
        )}
      </div>

      {/* Timeline Scrubber */}
      <div className="px-4 py-4 border-b border-[#3e3e42]">
        <div 
          ref={timelineRef}
          className="relative h-16 bg-[#252526] rounded cursor-pointer"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
        >
          {/* Event markers */}
          {snapshots.map((snapshot, i) => {
            const position = (i / (snapshots.length - 1 || 1)) * 100;
            const isBookmarked = bookmarks.has(i);
            
            return (
              <div key={i} className="absolute top-0 bottom-0" style={{ left: `${position}%` }}>
                {/* Event type indicator */}
                <div 
                  className="absolute top-2 w-1 h-12 opacity-60 hover:opacity-100 transition-opacity"
                  style={{ 
                    backgroundColor: getEventColor(snapshot.event.type),
                    left: '-1px'
                  }}
                  title={`${snapshot.event.type}: ${snapshot.event.description}`}
                />
                
                {/* Bookmark indicator */}
                {isBookmarked && (
                  <Bookmark 
                    className="absolute -top-1 size-3 fill-[#cca700] text-[#cca700]" 
                    style={{ left: '-6px' }}
                  />
                )}
              </div>
            );
          })}

          {/* Current position indicator */}
          {snapshots.length > 0 && (
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-[#4a9eff] z-10"
              style={{ left: `${(currentIndex / (snapshots.length - 1 || 1)) * 100}%` }}
            >
              <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-3 h-3 bg-[#4a9eff] rounded-full" />
              <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-3 h-3 bg-[#4a9eff] rounded-full" />
            </div>
          )}
        </div>

        {/* Time labels */}
        {snapshots.length > 1 && (
          <div className="flex justify-between mt-2 text-xs text-[#858585]">
            <span>{formatTime(snapshots[0].timestamp)}</span>
            <span>{formatTime(snapshots[snapshots.length - 1].timestamp)}</span>
          </div>
        )}
      </div>

      {/* Snapshot Details */}
      <div className="flex-1 overflow-y-auto">
        {currentSnapshot ? (
          <div className="p-4 space-y-4">
            {/* Event Info */}
            <div>
              <div className="text-[#cccccc] text-sm mb-2 flex items-center gap-2">
                <div 
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: getEventColor(currentSnapshot.event.type) }}
                />
                Event: {currentSnapshot.event.type}
              </div>
              <div className="text-white text-sm mb-1">{currentSnapshot.event.description}</div>
              {currentSnapshot.event.details && (
                <div className="text-[#858585] text-xs font-mono bg-[#252526] rounded p-2 mt-2">
                  {JSON.stringify(currentSnapshot.event.details, null, 2)}
                </div>
              )}
            </div>

            {/* Current State */}
            <div>
              <div className="text-[#cccccc] text-sm mb-2">Current State</div>
              <div className="px-3 py-2 bg-[#252526] rounded">
                <div className="text-[#569cd6]">{currentSnapshot.currentState}</div>
              </div>
            </div>

            {/* Variables */}
            {Object.keys(currentSnapshot.variables).length > 0 && (
              <div>
                <div className="text-[#cccccc] text-sm mb-2">Variables</div>
                <div className="space-y-1">
                  {Object.entries(currentSnapshot.variables).map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between px-3 py-2 bg-[#252526] rounded text-sm">
                      <span className="text-[#dcdcaa]">{key}</span>
                      <span className="text-white font-mono">{JSON.stringify(value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Inputs */}
            {Object.keys(currentSnapshot.inputs).length > 0 && (
              <div>
                <div className="text-[#cccccc] text-sm mb-2">Inputs</div>
                <div className="space-y-1">
                  {Object.entries(currentSnapshot.inputs).map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between px-3 py-2 bg-[#252526] rounded text-sm">
                      <span className="text-[#16825d]">{key}</span>
                      <span className="text-white font-mono">{JSON.stringify(value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Outputs */}
            {Object.keys(currentSnapshot.outputs).length > 0 && (
              <div>
                <div className="text-[#cccccc] text-sm mb-2">Outputs</div>
                <div className="space-y-1">
                  {Object.entries(currentSnapshot.outputs).map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between px-3 py-2 bg-[#252526] rounded text-sm">
                      <span className="text-[#c586c0]">{key}</span>
                      <span className="text-white font-mono">{JSON.stringify(value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Stack Trace */}
            {currentSnapshot.stackTrace && currentSnapshot.stackTrace.length > 0 && (
              <div>
                <div className="text-[#cccccc] text-sm mb-2">Execution Path</div>
                <div className="space-y-1">
                  {currentSnapshot.stackTrace.map((frame, i) => (
                    <div key={i} className="px-3 py-2 bg-[#252526] rounded text-xs text-[#858585] font-mono">
                      {frame}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-[#858585] text-sm">
            No snapshots recorded. Run your automata to start recording.
          </div>
        )}
      </div>
    </div>
  );
}
