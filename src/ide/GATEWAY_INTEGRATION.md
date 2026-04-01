# Gateway Frontend Integration - Quick Start

## Overview

The IDE uses Phoenix Channels as the real backend integration path.

- `PhoenixGatewayService` is the active implementation used by the store.
- Gateway/server/device operations and automata-oriented runtime flows are expected to come from live Phoenix-backed services.
- Older mock-oriented notes are obsolete and should not be treated as the current architecture.

## Important Notes

### Content Security Policy (CSP)
The renderer CSP allows WebSocket connections:

```html
connect-src 'self' ws: wss: ws://* wss://*
```

### Current Service Architecture

- `PhoenixGatewayService` is the default service.
- `gatewayStore` is wired to Phoenix by default.
- Backend capabilities are broader than the original minimal quick-start examples and continue to evolve with the gateway/server contract.

### Gateway Settings Dialog
On first launch, a settings dialog asks for gateway connection details. Settings are saved to local storage.

## What's Implemented

### 1. `PhoenixGatewayService` (`src/services/gateway/PhoenixGatewayService.ts`)

- Real-time Phoenix socket/channel connection
- Device/server/connector synchronization
- Deployment and runtime command support
- Snapshot, replay, analyzer, and monitor event handling
- Reconnect handling, command outcome tracking, and snapshot caching

### 2. `GatewayPanel` (`src/components/panels/GatewayPanel.tsx`)

- Connection settings and status
- Command invocation/testing surface
- Device and backend visibility
- Error reporting for failed commands and connection issues

### 3. Store/UI integration

- `gatewayStore` initializes Phoenix by default
- Device/server/connector events are pushed into live store state
- Runtime-facing panels consume Phoenix-backed data

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
