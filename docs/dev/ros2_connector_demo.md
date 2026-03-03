# ROS2 Connector Docker Demo and Runbook

This runbook provides two ROS2 operation modes:

1. **Actual Device Mode**: run gateway + server + ROS2 bridge, connect your own ROS2 device node.
2. **Demo Mode**: run bridge + emulator + sensor publisher for presentation-ready live behavior.

## Prerequisites

- Docker Desktop / Docker Engine with `docker compose`.
- Workspace root:

```bash
cd /Users/administratorik/dev/Aetherium_Automata/src
```

## Mode A: Actual ROS2 Device

Start only the bridge stack:

```bash
make up-ros2
make logs-ros2
```

What starts:

- `gateway`
- `server3` with ROS2 connector enabled (`ENABLE_ROS2_DEVICE_TRANSPORT=1`, `ROS2_PORT=5501`)
- `ros2-bridge`

`server3` exposes connector port `5501` on host, so external ROS2 nodes can connect through the bridge process.

## Mode B: Presentation Demo (No Hardware Needed)

Start full demo stack:

```bash
make up-ros2-demo
make logs-ros2-demo
```

What starts:

- `gateway`
- `server3`
- `ros2-bridge`
- `ros2-emulator`
- `ros2-sensor`

Behavior:

- Emulator registers as a device via ROS2 connector path.
- Deploy from IDE to that device works through chunked load flow.
- Sensor publisher drives temperature values and emulator emits outputs/state changes for runtime visualization.

## Bridge Message Contract

Bridge TCP wire format (between `ros2-bridge` and server connector):

- one JSON object per line
- required field: `frame_b64` containing one base64-encoded Aetherium binary protocol frame

Example:

```json
{"frame_b64":"rgEBAAA..."}
```

ROS2 topics used internally:

- Uplink to bridge: `/aetherium/bridge/uplink_b64` (`std_msgs/String`)
- Downlink from bridge: `/aetherium/bridge/downlink_b64` (`std_msgs/String`)
- Demo sensor: `/aetherium/demo/sensor_temp` (`std_msgs/Float32`)

## Operational Commands

```bash
make down-ros2
make restart-ros2
```

## Production Notes

- The ROS2 bridge is reconnect-safe (backoff-based TCP reconnect).
- Queueing is bounded (`AETHERIUM_ROS2_QUEUE_LIMIT`) to avoid unbounded memory growth.
- Keep `server3` behind your normal gateway/auth boundary; connector ingress remains internal/private where possible.
- For production deployments, replace the emulator with real ROS2 device nodes publishing protocol frames.
