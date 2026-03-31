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
  ConnectorStatus,
  ServerId,
  DeviceId,
} from '../types';
import { IGatewayService, PhoenixGatewayService } from '../services/gateway';

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
  connectors: Map<string, ConnectorStatus>;
  
  // Loading states
  isConnecting: boolean;
  isLoadingServers: boolean;
  isLoadingDevices: boolean;
  
  // Service instance
  service: IGatewayService;
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
  
  // Utility
  reset: () => void;
}

type GatewayStore = GatewayState & GatewayActions;

let gatewayEventUnsubscribers: Array<() => void> = [];

function clearGatewayEventSubscriptions(): void {
  gatewayEventUnsubscribers.forEach((unsubscribe) => unsubscribe());
  gatewayEventUnsubscribers = [];
}

// ============================================================================
// Initial State
// ============================================================================

const initialState: Omit<GatewayState, 'service'> = {
  status: 'disconnected',
  config: null,
  sessionId: null,
  error: null,
  servers: new Map(),
  devices: new Map(),
  connectors: new Map(),
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
    
    // ========================================================================
    // Connection
    // ========================================================================
    
    connect: async (config: GatewayConfig) => {
      const { service } = get();

      clearGatewayEventSubscriptions();
      
      set((state) => {
        state.isConnecting = true;
        state.error = null;
        state.status = 'connecting';
      });
      
      try {
        // Setup event handlers
        gatewayEventUnsubscribers.push(service.on('onConnectionChange', (status, error) => {
          set((state) => {
            state.status = status;
            if (error) state.error = error;
          });
        }));

        gatewayEventUnsubscribers.push(service.on('onDeviceList', (devices) => {
          set((state) => {
            const nextDevices = new Map<DeviceId, Device>();
            devices.forEach((device) => {
              nextDevices.set(device.id, { ...device });
            });
            state.devices = nextDevices;
          });
        }));
        
        gatewayEventUnsubscribers.push(service.on('onDeviceStatus', (event) => {
          set((state) => {
            const nextDevices = new Map(state.devices);
            const device = nextDevices.get(event.deviceId);
            if (device) {
              nextDevices.set(event.deviceId, {
                ...device,
                status: event.currentStatus,
                error:
                  event.reason !== undefined
                    ? event.currentStatus === 'error'
                      ? event.reason
                      : null
                    : device.error,
              });
            } else if (event.currentStatus === 'offline') {
              // Create a minimal device entry for offline devices if they don't exist
              // This ensures the UI can show devices that have disconnected
              const offlineDevice: Device = {
                id: event.deviceId,
                name: event.deviceId,
                status: event.currentStatus,
                serverId: 'default_server' as ServerId,
                address: 'unknown',
                port: 0,
                capabilities: [],
                engineVersion: 'unknown',
                tags: [],
                error: event.reason || null,
                lastSeen: new Date().toISOString(),
              };
              nextDevices.set(event.deviceId, offlineDevice);
            }
            state.devices = nextDevices;
          });
        }));
        
        gatewayEventUnsubscribers.push(service.on('onDeviceMetrics', (event) => {
          set((state) => {
            const nextDevices = new Map(state.devices);
            const device = nextDevices.get(event.deviceId);
            if (device) {
              nextDevices.set(event.deviceId, { ...device, metrics: event.metrics });
              state.devices = nextDevices;
            }
          });
        }));
        
        gatewayEventUnsubscribers.push(service.on('onServerStatus', (event) => {
          // Try to fetch full server info from the service (if available) and upsert into store.
          service.getServer(event.serverId).then((srv) => {
            set((state) => {
              const nextServers = new Map(state.servers);
              nextServers.set(srv.id, srv);
              state.servers = nextServers;
            });
          }).catch(() => {
            // Fallback: ensure we at least create/update a minimal server record
            set((state) => {
              const nextServers = new Map(state.servers);
              const server = nextServers.get(event.serverId);
              if (server) {
                nextServers.set(event.serverId, {
                  ...server,
                  status: event.currentStatus,
                });
              } else {
                nextServers.set(event.serverId, {
                  id: event.serverId,
                  name: event.serverId,
                  description: '',
                  address: state.config?.host ?? 'unknown',
                  port: state.config?.port ?? 0,
                  status: event.currentStatus,
                  deviceIds: event.affectedDevices ?? [],
                  maxDevices: 10000,
                  lastSeen: Date.now(),
                  latency: 0,
                  tags: [],
                });
              }
              state.servers = nextServers;
            });
          });
        }));

        gatewayEventUnsubscribers.push(service.on('onConnectorStatus', (event) => {
          set((state) => {
            const nextConnectors = new Map(state.connectors);
            const serverId = (event.server_id ?? event.serverId ?? 'default_server') as ServerId;
            const tsRaw = event.timestamp;
            const timestamp =
              typeof tsRaw === 'number'
                ? tsRaw
                : typeof tsRaw === 'string'
                  ? Date.parse(tsRaw)
                  : Date.now();

            event.connectors.forEach((connector) => {
              const key = `${serverId}:${connector.id}`;
              nextConnectors.set(key, {
                ...connector,
                serverId,
                timestamp: Number.isNaN(timestamp) ? Date.now() : timestamp,
              });
            });

            state.connectors = nextConnectors;
          });
        }));
        
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
        const message = error instanceof Error ? error.message : 'Connection failed';
        set((state) => {
          state.error = message;
          state.status = 'error';
          state.isConnecting = false;
        });
        throw error instanceof Error ? error : new Error(message);
      }
    },
    
    disconnect: async () => {
      const { service } = get();
      
      try {
        await service.disconnect();
      } finally {
        clearGatewayEventSubscriptions();
        set((state) => {
          state.status = 'disconnected';
          state.sessionId = null;
          state.servers = new Map();
          state.devices = new Map();
          state.connectors = new Map();
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
          const nextServers = new Map<ServerId, Server>();
          response.servers.forEach((server) => {
            nextServers.set(server.id, server);
          });
          state.servers = nextServers;
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
          const nextDevices = serverId ? new Map(state.devices) : new Map<DeviceId, Device>();
          response.devices.forEach((device) => {
            nextDevices.set(device.id, device);
          });
          state.devices = nextDevices;
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
        const nextDevices = new Map(state.devices);
        nextDevices.set(deviceId, response.device);
        state.devices = nextDevices;
      });
      
      return response.device;
    },
    
    // ========================================================================
    // Updates
    // ========================================================================
    
    updateDevice: (deviceId: DeviceId, updates: Partial<Device>) => {
      set((state) => {
        const nextDevices = new Map(state.devices);
        const device = nextDevices.get(deviceId);
        if (device) {
          nextDevices.set(deviceId, { ...device, ...updates });
          state.devices = nextDevices;
        }
      });
    },
    
    updateServer: (serverId: ServerId, updates: Partial<Server>) => {
      set((state) => {
        const nextServers = new Map(state.servers);
        const server = nextServers.get(serverId);
        if (server) {
          nextServers.set(serverId, { ...server, ...updates });
          state.servers = nextServers;
        }
      });
    },
    
    // ========================================================================
    // Utility
    // ========================================================================
    
    reset: () => {
      clearGatewayEventSubscriptions();
      set((state) => {
        state.status = initialState.status;
        state.config = initialState.config;
        state.sessionId = initialState.sessionId;
        state.error = initialState.error;
        state.servers = new Map();
        state.devices = new Map();
        state.connectors = new Map();
        state.isConnecting = initialState.isConnecting;
        state.isLoadingServers = initialState.isLoadingServers;
        state.isLoadingDevices = initialState.isLoadingDevices;
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
export const selectConnectors = (state: GatewayStore) => Array.from(state.connectors.values());
export const selectDeviceById = (deviceId: DeviceId) => (state: GatewayStore) => 
  state.devices.get(deviceId);
export const selectServerById = (serverId: ServerId) => (state: GatewayStore) => 
  state.servers.get(serverId);
export const selectDevicesByServer = (serverId: ServerId) => (state: GatewayStore) =>
  Array.from(state.devices.values()).filter(d => d.serverId === serverId);
