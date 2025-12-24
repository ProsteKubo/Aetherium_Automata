/**
 * Aetherium Automata - Output Panel Component
 * 
 * Shows execution logs, console output, and system messages.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useLogStore } from '../../stores';
import { IconTerminal, IconPlay, IconClear, IconDownload } from '../common/Icons';

export const OutputPanel: React.FC = () => {
  const logs = useLogStore((state) => state.logs);
  const clearLogs = useLogStore((state) => state.clearLogs);
  const [filter, setFilter] = useState('');
  const [levelFilter, setLevelFilter] = useState<string[]>(['info', 'warn', 'error', 'debug']);
  const [autoScroll, setAutoScroll] = useState(true);
  const logContainerRef = useRef<HTMLDivElement>(null);
  
  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);
  
  // Logs come from useLogStore; no mock generation.
  
  const filteredLogs = logs.filter((log) => {
    if (!levelFilter.includes(log.level)) return false;
    if (filter && !log.message.toLowerCase().includes(filter.toLowerCase()) && 
        !log.source.toLowerCase().includes(filter.toLowerCase())) {
      return false;
    }
    return true;
  });
  
  const toggleLevel = (level: string) => {
    setLevelFilter((prev) =>
      prev.includes(level) ? prev.filter((l) => l !== level) : [...prev, level]
    );
  };
  
  const exportLogs = () => {
    const content = logs.map((log) =>
      `[${new Date(log.timestamp).toISOString()}] [${log.level.toUpperCase()}] [${log.source}] ${log.message}`
    ).join('\n');
    
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aetherium-logs-${new Date().toISOString().split('T')[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };
  
  const formatTimestamp = (ts: number) => {
    const date = new Date(ts);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  };
  
  return (
    <div className="output-panel">
      <div className="output-toolbar">
        <div className="output-title">
          <IconTerminal size={14} />
          <span>Output</span>
        </div>
        
        <div className="output-filters">
          <input
            type="text"
            className="filter-input"
            placeholder="Filter logs..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          
          <div className="level-filters">
            {['info', 'warn', 'error', 'debug', 'trace'].map((level) => (
              <button
                key={level}
                className={`level-btn ${level} ${levelFilter.includes(level) ? 'active' : ''}`}
                onClick={() => toggleLevel(level)}
                title={level}
              >
                {level.charAt(0).toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        
        <div className="output-actions">
          <button
            className={`btn btn-ghost btn-icon ${autoScroll ? 'active' : ''}`}
            onClick={() => setAutoScroll(!autoScroll)}
            title="Auto-scroll"
          >
            <IconPlay size={14} />
          </button>
          <button
            className="btn btn-ghost btn-icon"
            onClick={exportLogs}
            title="Export logs"
          >
            <IconDownload size={14} />
          </button>
          <button
            className="btn btn-ghost btn-icon"
            onClick={clearLogs}
            title="Clear logs"
          >
            <IconClear size={14} />
          </button>
        </div>
      </div>
      
      <div className="output-content" ref={logContainerRef}>
        {filteredLogs.length === 0 ? (
          <div className="output-empty">
            No logs to display
          </div>
        ) : (
          filteredLogs.map((log) => (
            <div key={log.id} className={`log-entry ${log.level}`}>
              <span className="log-timestamp">{formatTimestamp(log.timestamp)}</span>
              <span className={`log-level ${log.level}`}>{log.level.toUpperCase()}</span>
              <span className="log-source">[{log.source}]</span>
              <span className="log-message">{log.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
