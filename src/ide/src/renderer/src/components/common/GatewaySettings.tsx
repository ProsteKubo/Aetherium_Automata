/**
 * Gateway Connection Settings Component
 * 
 * Pre-connection settings for configuring the gateway before app loads.
 */

import React, { useState, useEffect } from 'react';
import './GatewaySettings.css';

interface GatewaySettingsProps {
  onConnect: (host: string, port: string) => void;
  onSkip: () => void;
}

export const GatewaySettings: React.FC<GatewaySettingsProps> = ({ onConnect, onSkip }) => {
  const [host, setHost] = useState('localhost');
  const [port, setPort] = useState('4000');
  
  // Load from localStorage
  useEffect(() => {
    const savedHost = localStorage.getItem('gateway_host');
    const savedPort = localStorage.getItem('gateway_port');
    
    if (savedHost) setHost(savedHost);
    if (savedPort) setPort(savedPort);
  }, []);
  
  const handleConnect = () => {
    console.log('[GatewaySettings] Connect clicked with:', { host, port });
    
    // Save to localStorage
    localStorage.setItem('gateway_host', host);
    localStorage.setItem('gateway_port', port);
    
    onConnect(host, port);
  };
  
  const handleSkip = () => {
    console.log('[GatewaySettings] Skip clicked - using mock service');
    onSkip();
  };
  
  return (
    <div className="gateway-settings-overlay">
      <div className="gateway-settings-modal">
        <div className="gateway-settings-header">
          <h2>Gateway Connection Settings</h2>
          <p>Configure your gateway connection before starting</p>
        </div>
        
        <div className="gateway-settings-content">
          <div className="form-group">
            <label>Gateway Host</label>
            <input
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="localhost or 192.168.1.100"
              autoFocus
            />
            <span className="form-hint">
              The hostname or IP address of your gateway server
            </span>
          </div>
          
          <div className="form-group">
            <label>Gateway Port</label>
            <input
              type="text"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="4000"
            />
            <span className="form-hint">
              The WebSocket port (default: 4000)
            </span>
          </div>
          
          <div className="connection-preview">
            <strong>Connection URL:</strong>
            <code>ws://{host || 'localhost'}:{port || '4000'}/socket</code>
          </div>
        </div>
        
        <div className="gateway-settings-actions">
          <button className="btn btn-secondary" onClick={handleSkip}>
            Skip (Use Mock)
          </button>
          <button className="btn btn-primary" onClick={handleConnect}>
            Connect to Gateway
          </button>
        </div>
      </div>
    </div>
  );
};
