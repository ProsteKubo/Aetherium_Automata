"""ROS2-side engine emulator for demos and connector validation."""

from __future__ import annotations

import base64
import os
import random
import time
from typing import Any, Dict, Optional

import rclpy
from rclpy.node import Node
from std_msgs.msg import Float32, String

from . import protocol


class EngineEmulatorNode(Node):
    def __init__(self) -> None:
        super().__init__("aetherium_ros2_engine_emulator")

        self.device_id = os.getenv("AETHERIUM_EMULATOR_DEVICE_ID", "ros2_emulator_01")
        self.source_id = int(os.getenv("AETHERIUM_EMULATOR_SOURCE_ID", "1001"))
        self.uplink_topic = os.getenv("AETHERIUM_ROS2_UPLINK_TOPIC", "/aetherium/bridge/uplink_b64")
        self.downlink_topic = os.getenv("AETHERIUM_ROS2_DOWNLINK_TOPIC", "/aetherium/bridge/downlink_b64")
        self.sensor_topic = os.getenv("AETHERIUM_EMULATOR_SENSOR_TOPIC", "/aetherium/demo/sensor_temp")
        self.hello_interval = float(os.getenv("AETHERIUM_EMULATOR_HELLO_SEC", "5.0"))
        self.ping_interval = float(os.getenv("AETHERIUM_EMULATOR_PING_SEC", "5.0"))
        self.telemetry_interval = float(os.getenv("AETHERIUM_EMULATOR_TELEMETRY_SEC", "2.0"))

        self.uplink_pub = self.create_publisher(String, self.uplink_topic, 100)
        self.create_subscription(String, self.downlink_topic, self._on_downlink, 100)
        self.create_subscription(Float32, self.sensor_topic, self._on_sensor, 20)

        self.create_timer(self.hello_interval, self._tick_hello)
        self.create_timer(self.ping_interval, self._tick_ping)
        self.create_timer(self.telemetry_interval, self._tick_telemetry)

        self._msg_id = random.randint(1, 1_000_000)
        self._sequence = 1
        self._registered = False
        self._boot_ts = protocol.now_ms()

        self._run_id: Optional[int] = None
        self._loaded_bytes = bytearray()
        self._execution_state = 4  # stopped
        self._current_state = 0
        self._transition_count = 0
        self._variables: Dict[str, Any] = {}
        self._sensor_value = 21.0

        self.get_logger().info(
            f"ROS2 emulator online (device_id={self.device_id}, source_id={self.source_id}, "
            f"downlink={self.downlink_topic}, uplink={self.uplink_topic})"
        )

        # Send initial HELLO immediately.
        self._send_hello()

    def _next_message_id(self) -> int:
        self._msg_id += 1
        return self._msg_id

    def _publish_frame(self, frame: bytes) -> None:
        msg = String()
        msg.data = base64.b64encode(frame).decode("ascii")
        self.uplink_pub.publish(msg)

    def _send_hello(self) -> None:
        hello = protocol.build_hello(
            message_id=self._next_message_id(),
            source_id=self.source_id,
            device_id=self.device_id,
            device_type=0x05,
            capabilities=0,
        )
        self._publish_frame(hello)

    def _send_status(self) -> None:
        if self._run_id is None:
            return

        status = protocol.build_status(
            message_id=self._next_message_id(),
            source_id=self.source_id,
            target_id=0,
            run_id=self._run_id,
            execution_state=self._execution_state,
            current_state=self._current_state,
            uptime_ms=max(0, protocol.now_ms() - self._boot_ts),
            transition_count=self._transition_count,
            tick_count=max(1, int((protocol.now_ms() - self._boot_ts) / 100)),
            error_count=0,
        )
        self._publish_frame(status)

    def _send_output(self, name: str, value: Any) -> None:
        if self._run_id is None:
            return

        output = protocol.build_output(
            message_id=self._next_message_id(),
            source_id=self.source_id,
            target_id=0,
            run_id=self._run_id,
            name=name,
            value=value,
        )
        self._publish_frame(output)

    def _send_state_change(self, previous_state: int, new_state: int, transition_id: int) -> None:
        if self._run_id is None:
            return

        frame = protocol.build_state_change(
            message_id=self._next_message_id(),
            source_id=self.source_id,
            target_id=0,
            run_id=self._run_id,
            previous_state=previous_state,
            new_state=new_state,
            fired_transition=transition_id,
        )
        self._publish_frame(frame)

    def _tick_hello(self) -> None:
        if not self._registered:
            self._send_hello()

    def _tick_ping(self) -> None:
        ping = protocol.build_ping(
            message_id=self._next_message_id(),
            source_id=self.source_id,
            sequence=self._sequence,
        )
        self._sequence += 1
        self._publish_frame(ping)

    def _tick_telemetry(self) -> None:
        if self._run_id is None:
            return

        telemetry = protocol.build_telemetry(
            message_id=self._next_message_id(),
            source_id=self.source_id,
            target_id=0,
            run_id=self._run_id,
            heap_free=127_000,
            heap_total=256_000,
            cpu_usage_percent=4.2 if self._execution_state == 2 else 1.1,
            tick_rate=10 if self._execution_state == 2 else 1,
        )
        self._publish_frame(telemetry)

        if self._execution_state == 2:
            self._send_output("temperature", round(float(self._sensor_value), 3))

    def _on_sensor(self, msg: Float32) -> None:
        self._sensor_value = float(msg.data)
        self._variables["temperature"] = self._sensor_value

        if self._execution_state != 2 or self._run_id is None:
            return

        prev_state = self._current_state
        if self._sensor_value > 30.0 and self._current_state != 2:
            self._current_state = 2
            self._transition_count += 1
            self._send_state_change(prev_state, self._current_state, transition_id=1)
        elif self._sensor_value < 28.0 and self._current_state != 1:
            self._current_state = 1
            self._transition_count += 1
            self._send_state_change(prev_state, self._current_state, transition_id=2)

        self._send_output("temperature", round(float(self._sensor_value), 3))

    def _on_downlink(self, msg: String) -> None:
        raw = msg.data.strip()
        if not raw:
            return

        try:
            frame_bytes = base64.b64decode(raw, validate=True)
        except Exception:
            self.get_logger().warning("Ignoring invalid downlink base64 frame")
            return

        try:
            command = protocol.parse_command(frame_bytes)
        except Exception as exc:
            self.get_logger().warning(f"Failed to parse downlink frame: {exc}")
            return

        self._handle_command(command)

    def _handle_command(self, command: Dict[str, Any]) -> None:
        msg_type = command.get("type")

        if msg_type == protocol.MT_HELLO_ACK:
            self._registered = True
            self.get_logger().info("Received HELLO_ACK from server")
            return

        if msg_type == protocol.MT_PING:
            frame = protocol.build_pong(
                message_id=self._next_message_id(),
                source_id=self.source_id,
                target_id=int(command.get("source_id", 0)),
                original_timestamp=int(command.get("timestamp", protocol.now_ms())),
                sequence=int(command.get("sequence", 0)),
            )
            self._publish_frame(frame)
            return

        if msg_type == protocol.MT_LOAD_AUTOMATA:
            self._run_id = int(command["run_id"])
            self._loaded_bytes.extend(command.get("data", b""))
            is_chunked = bool(command.get("is_chunked", False))
            chunk_index = int(command.get("chunk_index", 0))
            total_chunks = int(command.get("total_chunks", 1))
            message_id = int(command["message_id"])

            if is_chunked and chunk_index < total_chunks - 1:
                ack = protocol.build_ack(
                    message_id=self._next_message_id(),
                    source_id=self.source_id,
                    target_id=0,
                    related_message_id=message_id,
                    info="chunk_received",
                )
                self._publish_frame(ack)
            else:
                self._execution_state = 4
                self._current_state = 0
                load_ack = protocol.build_load_ack(
                    message_id=self._next_message_id(),
                    source_id=self.source_id,
                    target_id=0,
                    run_id=self._run_id,
                    success=True,
                    error="",
                    warnings=(),
                )
                self._publish_frame(load_ack)
            return

        if msg_type == protocol.MT_START:
            self._run_id = int(command.get("run_id", self._run_id or 0))
            prev = self._current_state
            self._execution_state = 2
            if self._current_state == 0:
                self._current_state = 1
                self._transition_count += 1
                self._send_state_change(prev, self._current_state, transition_id=3)
            self._send_status()
            return

        if msg_type == protocol.MT_STOP:
            self._execution_state = 4
            self._send_status()
            return

        if msg_type == protocol.MT_PAUSE:
            self._execution_state = 3
            self._send_status()
            return

        if msg_type == protocol.MT_RESUME:
            self._execution_state = 2
            self._send_status()
            return

        if msg_type == protocol.MT_RESET:
            self._execution_state = 4
            self._current_state = 0
            self._send_status()
            return

        if msg_type == protocol.MT_STATUS:
            self._send_status()
            return

        if msg_type == protocol.MT_INPUT:
            name = str(command.get("name", "input"))
            value = command.get("value")
            self._variables[name] = value
            # Echo as output so the runtime monitor gets visible signal updates.
            self._send_output(name, value)
            return

        self.get_logger().debug(f"Ignoring unsupported command type: 0x{msg_type:02x}")


def main() -> None:
    rclpy.init()
    node = EngineEmulatorNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
