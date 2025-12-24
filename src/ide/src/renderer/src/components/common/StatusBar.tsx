/**
 * Aetherium Automata - Status Bar Component
 */

import React from 'react';
import { useGatewayStore, useAutomataStore, useExecutionStore } from '../../stores';

export const StatusBar: React.FC = () => {
  const gatewayStatus = useGatewayStore((state) => state.status);
  const deviceCount = useGatewayStore((state) => state.devices.size);
  const serverCount = useGatewayStore((state) => state.servers.size);
  const automata = useAutomataStore((state) => 
    state.activeAutomataId ? state.automata.get(state.activeAutomataId) : null
  );
  const selectedDeviceId = useExecutionStore((state) => state.selectedDeviceId);
  
  return (
    <footer className="status-bar">
      <div className="status-bar-left">
        <div className={`status-bar-item ${gatewayStatus === 'connected' ? 'connected' : 'disconnected'}`}>
          <span 
            className={`status-indicator ${gatewayStatus === 'connected' ? 'online' : 'offline'}`}
            style={{ width: 6, height: 6 }}
          />
          <span>{gatewayStatus === 'connected' ? 'Connected' : 'Disconnected'}</span>
        </div>
        
        {gatewayStatus === 'connected' && (
          <>
            <div className="status-bar-item">
              <span>{serverCount} Server{serverCount !== 1 ? 's' : ''}</span>
            </div>
            <div className="status-bar-item">
              <span>{deviceCount} Device{deviceCount !== 1 ? 's' : ''}</span>
            </div>
          </>
        )}
      </div>
      
      <div className="status-bar-right">
        {selectedDeviceId && (
          <div className="status-bar-item">
            <span>Device: {selectedDeviceId}</span>
          </div>
        )}
        
        {automata && (
          <div className="status-bar-item">
            <span>{automata.config.name}</span>
            {automata.isDirty && (
              <span style={{ color: 'var(--color-warning)' }}>●</span>
            )}
          </div>
        )}
        
        <div className="status-bar-item">
          <span>Lua</span>
        </div>
        
        <div className="status-bar-item">
          <span>UTF-8</span>
        </div>
      </div>
    </footer>
  );
};
