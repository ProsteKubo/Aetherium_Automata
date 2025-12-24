# Gateway Frontend Integration - Quick Start

## Overview

The Aetherium Automata IDE now has Phoenix Channels integration for connecting to the Elixir gateway backend, with a **hybrid approach**: Phoenix for gateway/device operations, Mock for automata operations.

## ⚠️ Important Notes

### Content Security Policy (CSP) Fixed
The CSP in `index.html` has been updated to allow WebSocket connections:
```html
connect-src 'self' ws: wss: ws://* wss://*
```

### Hybrid Service Architecture
- **Gateway/Device operations** → Uses `PhoenixGatewayService` (real backend)
- **Automata operations** → Uses `MockGatewayService` (local mock)

This is because the backend doesn't support automata management yet. All automata CRUD operations use the mock service internally.

### Gateway Settings Dialog
On first launch, a settings dialog appears asking you to configure the gateway connection. You can:
- **Connect to Gateway** - Enter host/port and connect
- **Skip (Use Mock)** - Skip and use mock service for everything

Settings are saved to localStorage and won't appear again unless you clear browser data.

## What's Implemented

### 1. **PhoenixGatewayService** (`src/services/gateway/PhoenixGatewayService.ts`)
- Real-time WebSocket connection using Phoenix Channels
- Connects to `ws://<host>:<port>/socket` with password authentication
- Implements 3 working commands:
  - `ping` - Test connectivity
  - `list_devices` - Fetch device list
  - `restart_device` - Queue a device restart
- Event handlers for:
  - `log` - Backend log messages
  - `alert` - Device alerts (crashes, disconnects, errors)
  - `device_list` - Device list updates
  - `device_telemetry` - Real-time device metrics
  - `automata_state_change` - State machine transitions

### 2. **Gateway Panel** (`src/components/panels/GatewayPanel.tsx`)
- Connection form with host, port, and password
- Connection status indicator
- Command testing buttons (Ping, List Devices)
- Live device list with restart buttons
- Error handling and display

### 3. **UI Integration**
- New "Gateway" icon in Activity Bar
- Panel routing in App.tsx
- Store integration with PhoenixGatewayService as default

## How to Use

### Step 1: Start Your Elixir Gateway
```bash
cd src/gateway/aetherium_gateway
mix phx.server
```

### Step 2: Start the IDE
```bash
cd src/ide
npm run dev
```

### Step 3: Connect to Gateway
1. Click the **Gateway icon** in the Activity Bar (looks like a window/grid)
2. Enter connection details:
   - **Host**: `localhost` (or IP like `192.168.1.100`)
   - **Port**: `4000`
   - **Password**: Leave empty or enter your token
3. Click **Connect**

### Step 4: Test Commands
Once connected:
- Click **Test** on the Ping card to test connectivity
- Click **Refresh** on List Devices to fetch devices
- Click **Restart** on any device to queue a restart

## Connection URL Format

The service connects to:
```
ws://<host>:<port>/socket
```

Example:
- Local: `ws://localhost:4000/socket`
- Network: `ws://192.168.1.100:4000/socket`

## Authentication

The password is sent as a token parameter:
```javascript
Socket('ws://localhost:4000/socket', {
  params: { token: 'YOUR_PASSWORD' }
})
```

## Event Handling

The service automatically listens for these backend events:

| Event | Description |
|-------|-------------|
| `log` | Backend logs (info, warning, error) |
| `alert` | Device alerts (crash, disconnect, errors) |
| `device_list` | Updated device list |
| `device_telemetry` | Real-time device metrics |
| `automata_state_change` | State machine transitions |

## Service Switching

The gateway store can switch between Phoenix and Mock services:

```typescript
// In your code
const setUseMockService = useGatewayStore((state) => state.setUseMockService);

// Use mock service (for testing without backend)
setUseMockService(true);

// Use Phoenix service (real backend)
setUseMockService(false); // Default
```

**Note**: Cannot switch while connected. Disconnect first.

## Next Steps

As you implement more commands on the backend, add them to `PhoenixGatewayService.ts`:

```typescript
async newCommand(param: string): Promise<ResponseType> {
  return await this.sendCommand<ResponseType>('command_name', {
    param_name: param,
  });
}
```

Then call from the UI:
```typescript
const service = useGatewayStore((state) => state.service);
const result = await (service as PhoenixGatewayService).newCommand('value');
```

## Troubleshooting

### Connection Failed
- Check Elixir server is running: `mix phx.server`
- Check port is correct (default: 4000)
- Check firewall allows WebSocket connections

### Authentication Failed
- Check password/token matches backend config
- Look at backend logs for auth errors

### Commands Timeout
- Check network connectivity
- Check backend is responding (see Elixir logs)
- Default timeout is 5000ms

## File Structure

```
src/ide/src/renderer/src/
├── services/gateway/
│   ├── PhoenixGatewayService.ts  # Phoenix implementation
│   ├── MockGatewayService.ts     # Mock for testing
│   └── IGatewayService.ts        # Interface
├── components/panels/
│   ├── GatewayPanel.tsx          # Connection UI
│   └── GatewayPanel.css          # Styles
├── stores/
│   └── gatewayStore.ts           # State management
└── types/
    └── automata.ts               # Added 'gateway' to PanelId
```

## API Reference

See the main API spec document for complete command and event details.

### Quick Command Reference

```typescript
// Ping
await service.ping();
// Returns: {response: "pong", timestamp: "2025-01-15T10:30:00Z"}

// List Devices
await service.listDevicesCommand();
// Returns: {devices: [...]}

// Restart Device
await service.restartDevice('dev_001');
// Returns: {status: "restart_queued"}
```

## Development Notes

- Phoenix library version: `^1.8.3` (already in package.json)
- Service uses immer-based Zustand store for state management
- All commands use Promise-based API with timeout
- Events are handled via Phoenix Channel `.on()` callbacks
