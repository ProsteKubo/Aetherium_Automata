/**
 * Aetherium Automata - Gateway Store
 * 
 * Manages gateway connection state and related data.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type {
  GatewayConfig,
  GatewayStatus,
  Server,
  Device,
  ServerId,
  DeviceId,
} from '../types';
import { IGatewayService, MockGatewayService, PhoenixGatewayService } from '../services/gateway';

// ============================================================================
// State Types
// ============================================================================

interface GatewayState {
  // Connection
  status: GatewayStatus;
  config: GatewayConfig | null;
  sessionId: string | null;
  error: string | null;
  
  // Data
  servers: Map<ServerId, Server>;
  devices: Map<DeviceId, Device>;
  
  // Loading states
  isConnecting: boolean;
  isLoadingServers: boolean;
  isLoadingDevices: boolean;
  
  // Service instance
  service: IGatewayService;
  useMockService: boolean;
}

interface GatewayActions {
  // Connection
  connect: (config: GatewayConfig) => Promise<void>;
  disconnect: () => Promise<void>;
  
  // Data fetching
  fetchServers: () => Promise<void>;
  fetchDevices: (serverId?: ServerId) => Promise<void>;
  fetchDevice: (deviceId: DeviceId) => Promise<Device>;
  
  // Device operations
  updateDevice: (deviceId: DeviceId, updates: Partial<Device>) => void;
  
  // Server operations
  updateServer: (serverId: ServerId, updates: Partial<Server>) => void;
  
  // Service switching
  setUseMockService: (useMock: boolean) => void;
  
  // Utility
  reset: () => void;
}

type GatewayStore = GatewayState & GatewayActions;

// ============================================================================
// Initial State
// ============================================================================

const initialState: Omit<GatewayState, 'service' | 'useMockService'> = {
  status: 'disconnected',
  config: null,
  sessionId: null,
  error: null,
  servers: new Map(),
  devices: new Map(),
  isConnecting: false,
  isLoadingServers: false,
  isLoadingDevices: false,
};

// ============================================================================
// Store
// ============================================================================

export const useGatewayStore = create<GatewayStore>()(
  immer((set, get) => ({
    ...initialState,
    service: new PhoenixGatewayService(), // Use Phoenix by default
    useMockService: false,
    
    // ========================================================================
    // Connection
    // ========================================================================
    
    connect: async (config: GatewayConfig) => {
      const { service } = get();
      
      set((state) => {
        state.isConnecting = true;
        state.error = null;
        state.status = 'connecting';
      });
      
      try {
        // Setup event handlers
        service.on('onConnectionChange', (status, error) => {
          set((state) => {
            state.status = status;
            if (error) state.error = error;
          });
        });
        
        service.on('onDeviceStatus', (event) => {
          set((state) => {
            const device = state.devices.get(event.deviceId);
            if (device) {
              device.status = event.currentStatus;
            }
          });
        });
        
        service.on('onDeviceMetrics', (event) => {
          set((state) => {
            const device = state.devices.get(event.deviceId);
            if (device) {
              device.metrics = event.metrics;
            }
          });
        });
        
        service.on('onServerStatus', (event) => {
          set((state) => {
            const server = state.servers.get(event.serverId);
            if (server) {
              server.status = event.currentStatus;
            }
          });
        });
        
        const response = await service.connect(config);
        
        set((state) => {
          state.config = config;
          state.sessionId = response.sessionId;
          state.status = 'connected';
          state.isConnecting = false;
        });
        
        // Auto-fetch servers and devices after connection
        await get().fetchServers();
        await get().fetchDevices();
      } catch (error) {
        set((state) => {
          state.error = error instanceof Error ? error.message : 'Connection failed';
          state.status = 'error';
          state.isConnecting = false;
        });
      }
    },
    
    disconnect: async () => {
      const { service } = get();
      
      try {
        await service.disconnect();
      } finally {
        set((state) => {
          state.status = 'disconnected';
          state.sessionId = null;
          state.servers.clear();
          state.devices.clear();
        });
      }
    },
    
    // ========================================================================
    // Data Fetching
    // ========================================================================
    
    fetchServers: async () => {
      const { service, status } = get();
      
      if (status !== 'connected') return;
      
      set((state) => {
        state.isLoadingServers = true;
      });
      
      try {
        const response = await service.listServers();
        
        set((state) => {
          state.servers.clear();
          response.servers.forEach((server) => {
            state.servers.set(server.id, server);
          });
          state.isLoadingServers = false;
        });
      } catch (error) {
        set((state) => {
          state.error = error instanceof Error ? error.message : 'Failed to fetch servers';
          state.isLoadingServers = false;
        });
      }
    },
    
    fetchDevices: async (serverId?: ServerId) => {
      const { service, status } = get();
      
      if (status !== 'connected') return;
      
      set((state) => {
        state.isLoadingDevices = true;
      });
      
      try {
        const response = await service.listDevices(serverId);
        
        set((state) => {
          if (!serverId) {
            state.devices.clear();
          }
          response.devices.forEach((device) => {
            state.devices.set(device.id, device);
          });
          state.isLoadingDevices = false;
        });
      } catch (error) {
        set((state) => {
          state.error = error instanceof Error ? error.message : 'Failed to fetch devices';
          state.isLoadingDevices = false;
        });
      }
    },
    
    fetchDevice: async (deviceId: DeviceId) => {
      const { service } = get();
      
      const response = await service.getDevice(deviceId);
      
      set((state) => {
        state.devices.set(deviceId, response.device);
      });
      
      return response.device;
    },
    
    // ========================================================================
    // Updates
    // ========================================================================
    
    updateDevice: (deviceId: DeviceId, updates: Partial<Device>) => {
      set((state) => {
        const device = state.devices.get(deviceId);
        if (device) {
          Object.assign(device, updates);
        }
      });
    },
    
    updateServer: (serverId: ServerId, updates: Partial<Server>) => {
      set((state) => {
        const server = state.servers.get(serverId);
        if (server) {
          Object.assign(server, updates);
        }
      });
    },
    
    // ========================================================================
    // Service Switching
    // ========================================================================
    
    setUseMockService: (useMock: boolean) => {
      const currentStatus = get().status;
      
      // Don't switch if connected
      if (currentStatus === 'connected') {
        console.warn('Cannot switch service while connected. Disconnect first.');
        return;
      }
      
      set((state) => {
        state.useMockService = useMock;
        state.service = useMock ? new MockGatewayService() : new PhoenixGatewayService();
      });
    },
    
    // ========================================================================
    // Utility
    // ========================================================================
    
    reset: () => {
      set((state) => {
        Object.assign(state, initialState);
      });
    },
  }))
);

// ============================================================================
// Selectors
// ============================================================================

export const selectIsConnected = (state: GatewayStore) => state.status === 'connected';
export const selectServers = (state: GatewayStore) => Array.from(state.servers.values());
export const selectDevices = (state: GatewayStore) => Array.from(state.devices.values());
export const selectDeviceById = (deviceId: DeviceId) => (state: GatewayStore) => 
  state.devices.get(deviceId);
export const selectServerById = (serverId: ServerId) => (state: GatewayStore) => 
  state.servers.get(serverId);
export const selectDevicesByServer = (serverId: ServerId) => (state: GatewayStore) =>
  Array.from(state.devices.values()).filter(d => d.serverId === serverId);
