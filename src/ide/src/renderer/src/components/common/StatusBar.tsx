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
        <div className={`status-bar-item status-pill ${gatewayStatus === 'connected' ? 'connected' : 'disconnected'}`}>
          <span className={`status-indicator ${gatewayStatus === 'connected' ? 'online' : 'offline'}`} />
          <span>{gatewayStatus === 'connected' ? 'SYSTEM_ONLINE' : 'SYSTEM_OFFLINE'}</span>
        </div>

        {gatewayStatus === 'connected' && (
          <>
            <div className="status-bar-item">
              <span>NODES: {serverCount + deviceCount}</span>
            </div>
            <div className="status-bar-item">
              <span>LATENCY: 14MS</span>
            </div>
            <div className="status-bar-item">
              <span>UPLINK: 450MBPS</span>
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
            {automata.isDirty && <span className="status-dirty-dot">●</span>}
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
