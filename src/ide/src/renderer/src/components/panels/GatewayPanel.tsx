/**
 * Aetherium Automata - Gateway Connection Panel
 * 
 * UI for managing gateway connection, testing commands, and viewing logs.
 */

import React, { useState, useEffect } from 'react';
import { useGatewayStore, useUIStore } from '../../stores';
import './GatewayPanel.css';

export const GatewayPanel: React.FC = () => {
  const [host, setHost] = useState('localhost');
  const [port, setPort] = useState('4000');
  const [password, setPassword] = useState('');
  const [pingResult, setPingResult] = useState<string | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);

  // Command console state
  const [cmdChannel, setCmdChannel] = useState<'gateway' | 'automata'>('gateway');
  const [cmdName, setCmdName] = useState('ping');
  const [cmdPayload, setCmdPayload] = useState('{}');
  const [cmdResult, setCmdResult] = useState<string | null>(null);
  const [cmdSending, setCmdSending] = useState(false);
  
  // Gateway store state
  const status = useGatewayStore((state) => state.status);
  const config = useGatewayStore((state) => state.config);
  const devices = useGatewayStore((state) => state.devices);
  const connect = useGatewayStore((state) => state.connect);
  const disconnect = useGatewayStore((state) => state.disconnect);
  const fetchDevices = useGatewayStore((state) => state.fetchDevices);
  const service = useGatewayStore((state) => state.service);
  const addNotification = useUIStore((state) => state.addNotification);
  
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
        setPingResult('Ping not available with current service');
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
        addNotification('success', 'Device Restart', `Device restart queued: ${result.status}`);
      } else {
        addNotification('warning', 'Device Restart', 'Restart not available with current service');
      }
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : 'Restart failed');
    }
  };

  // Send arbitrary command to gateway or automata channel
  const handleSendCommand = async () => {
    setCmdSending(true);
    setCmdResult(null);
    setCommandError(null);

    let payload: Record<string, any>;
    try {
      payload = JSON.parse(cmdPayload);
    } catch {
      setCommandError('Invalid JSON payload');
      setCmdSending(false);
      return;
    }

    try {
      // Access the internal channels via the service (PhoenixGatewayService exposes them)
      const svc = service as any;
      const channel = cmdChannel === 'gateway' ? svc.channel : svc.automataChannel;

      if (!channel) {
        throw new Error(`${cmdChannel} channel not connected`);
      }

      console.log(`[CMD] Sending "${cmdName}" to ${cmdChannel}:control`, payload);

      const result = await new Promise<any>((resolve, reject) => {
        channel
          .push(cmdName, payload, 10_000)
          .receive('ok', (resp: any) => resolve(resp))
          .receive('error', (err: any) => reject(new Error(JSON.stringify(err))))
          .receive('timeout', () => reject(new Error('timeout')));
      });

      console.log(`[CMD] Response:`, result);
      setCmdResult(JSON.stringify(result, null, 2));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[CMD] Error:`, msg);
      setCommandError(msg);
    } finally {
      setCmdSending(false);
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

                        {'lastSeen' in device && (device as any).lastSeen && (
                          <div className="device-meta">
                            Last seen: {(device as any).lastSeen}
                          </div>
                        )}

                        {'temperature' in device && (device as any).temperature !== undefined && (
                          <div className="device-meta">
                            Temp: {(device as any).temperature === null ? '—' : `${(device as any).temperature}°C`}
                          </div>
                        )}

                        {'error' in device && (device as any).error && (
                          <div className="device-meta">
                            Error: {(device as any).error}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Command Console */}
            <div className="section-divider" />

            <div className="commands-section">
              <h3>Command Console</h3>
              <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '8px' }}>
                Send raw commands to channels. Watch DevTools → Network → WS → Messages.
              </p>

              <div className="form-group">
                <label>Channel</label>
                <select
                  value={cmdChannel}
                  onChange={(e) => setCmdChannel(e.target.value as 'gateway' | 'automata')}
                  style={{ width: '100%', padding: '6px' }}
                >
                  <option value="gateway">gateway:control</option>
                  <option value="automata">automata:control</option>
                </select>
              </div>

              <div className="form-group">
                <label>Command</label>
                <input
                  type="text"
                  value={cmdName}
                  onChange={(e) => setCmdName(e.target.value)}
                  placeholder="e.g. ping, list_devices, deploy"
                />
              </div>

              <div className="form-group">
                <label>Payload (JSON)</label>
                <textarea
                  value={cmdPayload}
                  onChange={(e) => setCmdPayload(e.target.value)}
                  rows={4}
                  style={{ width: '100%', fontFamily: 'monospace', fontSize: '12px' }}
                  placeholder='{"device_id": "device_cpp_01"}'
                />
              </div>

              <button
                className="btn btn-primary"
                onClick={handleSendCommand}
                disabled={cmdSending}
                style={{ marginBottom: '8px' }}
              >
                {cmdSending ? 'Sending...' : 'Send Command'}
              </button>

              {cmdResult && (
                <pre style={{ background: '#1e1e1e', padding: '8px', fontSize: '11px', overflow: 'auto', maxHeight: '200px', borderRadius: '4px' }}>
                  {cmdResult}
                </pre>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
