/**
 * Aetherium Automata - Gateway Connection Panel
 * 
 * UI for managing gateway connection, testing commands, and viewing logs.
 */

import React, { useState, useEffect } from 'react';
import { useGatewayStore } from '../../stores';
import './GatewayPanel.css';

export const GatewayPanel: React.FC = () => {
  const [host, setHost] = useState('localhost');
  const [port, setPort] = useState('4000');
  const [password, setPassword] = useState('');
  const [pingResult, setPingResult] = useState<string | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  
  // Gateway store state
  const status = useGatewayStore((state) => state.status);
  const config = useGatewayStore((state) => state.config);
  const devices = useGatewayStore((state) => state.devices);
  const connect = useGatewayStore((state) => state.connect);
  const disconnect = useGatewayStore((state) => state.disconnect);
  const fetchDevices = useGatewayStore((state) => state.fetchDevices);
  const service = useGatewayStore((state) => state.service);
  
  // Load saved config on mount
  useEffect(() => {
    if (config) {
      setHost(config.host);
      setPort(config.port.toString());
    }
  }, [config]);
  
  const handleConnect = async () => {
    try {
      setCommandError(null);
      await connect({
        host,
        port: parseInt(port),
        password: password || undefined,
      });
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : 'Connection failed');
    }
  };
  
  const handleDisconnect = async () => {
    try {
      await disconnect();
      setPingResult(null);
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : 'Disconnect failed');
    }
  };
  
  const handlePing = async () => {
    try {
      setCommandError(null);
      setPingResult('Pinging...');
      
      // Use the service directly to call ping
      if ('ping' in service) {
        const result = await (service as any).ping();
        setPingResult(`${result.response} (${result.timestamp})`);
      } else {
        setPingResult('Ping not available with mock service');
      }
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : 'Ping failed');
      setPingResult(null);
    }
  };
  
  const handleListDevices = async () => {
    try {
      setCommandError(null);
      await fetchDevices();
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : 'List devices failed');
    }
  };
  
  const handleRestartDevice = async (deviceId: string) => {
    try {
      setCommandError(null);
      
      // Use the service directly to call restart
      if ('restartDevice' in service) {
        const result = await (service as any).restartDevice(deviceId);
        console.log('Restart queued:', result);
        // Show success message
        alert(`Device restart queued: ${result.status}`);
      } else {
        alert('Restart not available with mock service');
      }
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : 'Restart failed');
    }
  };
  
  const isConnected = status === 'connected';
  const isConnecting = status === 'connecting';
  
  return (
    <div className="gateway-panel">
      <div className="panel-header">
        <h2>Gateway Connection</h2>
      </div>
      
      <div className="panel-content">
        {/* Connection Form */}
        <div className="connection-form">
          <div className="form-group">
            <label>Host</label>
            <input
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              disabled={isConnected || isConnecting}
              placeholder="localhost or 192.168.1.100"
            />
          </div>
          
          <div className="form-group">
            <label>Port</label>
            <input
              type="text"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              disabled={isConnected || isConnecting}
              placeholder="4000"
            />
          </div>
          
          <div className="form-group">
            <label>Password (optional)</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isConnected || isConnecting}
              placeholder="Leave empty for default"
            />
          </div>
          
          <div className="connection-actions">
            {!isConnected ? (
              <button
                className="btn btn-primary"
                onClick={handleConnect}
                disabled={isConnecting}
              >
                {isConnecting ? 'Connecting...' : 'Connect'}
              </button>
            ) : (
              <button
                className="btn btn-secondary"
                onClick={handleDisconnect}
              >
                Disconnect
              </button>
            )}
          </div>
          
          {/* Status */}
          <div className={`connection-status status-${status}`}>
            Status: <strong>{status}</strong>
          </div>
          
          {commandError && (
            <div className="error-message">
              {commandError}
            </div>
          )}
        </div>
        
        {/* Commands Section */}
        {isConnected && (
          <>
            <div className="section-divider" />
            
            <div className="commands-section">
              <h3>Commands</h3>
              
              {/* Ping */}
              <div className="command-card">
                <div className="command-header">
                  <h4>Ping</h4>
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={handlePing}
                  >
                    Test
                  </button>
                </div>
                {pingResult && (
                  <div className="command-result">
                    {pingResult}
                  </div>
                )}
              </div>
              
              {/* List Devices */}
              <div className="command-card">
                <div className="command-header">
                  <h4>List Devices</h4>
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={handleListDevices}
                  >
                    Refresh
                  </button>
                </div>
                <div className="device-count">
                  {devices.size} device(s)
                </div>
              </div>
            </div>
            
            {/* Devices List */}
            {devices.size > 0 && (
              <>
                <div className="section-divider" />
                
                <div className="devices-section">
                  <h3>Devices</h3>
                  
                  <div className="devices-list">
                    {Array.from(devices.values()).map((device) => (
                      <div key={device.id} className="device-card">
                        <div className="device-header">
                          <div className="device-info">
                            <div className="device-name">{device.name || device.id}</div>
                            <div className={`device-status status-${device.status}`}>
                              {device.status}
                            </div>
                          </div>
                          <button
                            className="btn btn-sm btn-secondary"
                            onClick={() => handleRestartDevice(device.id)}
                          >
                            Restart
                          </button>
                        </div>
                        
                        {/* Device metadata - these fields might not be available in basic response */}
                        {device.description && (
                          <div className="device-meta">
                            {device.description}
                          </div>
                        )}
                        
                        {device.location && (
                          <div className="device-meta">
                            Location: {device.location}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};
