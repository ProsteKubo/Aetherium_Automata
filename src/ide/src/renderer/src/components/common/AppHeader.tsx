/**
 * Aetherium Automata - App Header Component
 */

import React from 'react';
import { useGatewayStore, selectIsConnected } from '../../stores';
import { IconZap, IconSettings, IconSearch } from './Icons';

export const AppHeader: React.FC = () => {
  const isConnected = useGatewayStore(selectIsConnected);
  const status = useGatewayStore((state) => state.status);
  
  return (
    <header className="app-header">
      <div className="app-header-left">
        <div className="app-logo">
          <IconZap size={18} className="app-logo-icon" />
          <span>AETHERIUM</span>
        </div>
      </div>
      
      <div className="app-header-center">
        <button 
          className="btn btn-ghost"
          style={{ 
            width: '300px', 
            justifyContent: 'flex-start',
            color: 'var(--color-text-tertiary)',
            fontSize: 'var(--font-size-sm)'
          }}
        >
          <IconSearch size={14} />
          <span>Search commands, files, automata...</span>
          <span style={{ marginLeft: 'auto', opacity: 0.5, fontSize: 'var(--font-size-xs)' }}>
            Ctrl+K
          </span>
        </button>
      </div>
      
      <div className="app-header-right">
        <div 
          className={`status-bar-item ${isConnected ? 'connected' : 'disconnected'}`}
          style={{ 
            padding: 'var(--spacing-1) var(--spacing-2)',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--font-size-xs)'
          }}
        >
          <span 
            className={`status-indicator ${isConnected ? 'online' : 'offline'}`} 
            style={{ width: 6, height: 6 }}
          />
          <span>{status === 'connected' ? 'Gateway Connected' : 'Disconnected'}</span>
        </div>
        
        <button className="btn btn-ghost btn-icon">
          <IconSettings size={18} />
        </button>
      </div>
    </header>
  );
};
