"""ROS2 <-> TCP bridge for Aetherium ROS2 connector sessions."""

from __future__ import annotations

import json
import os
import queue
import socket
import threading
import time
from typing import Optional

import rclpy
from rclpy.node import Node
from std_msgs.msg import String


class Ros2TcpBridge(Node):
    def __init__(self) -> None:
        super().__init__("aetherium_ros2_tcp_bridge")

        self.server_host = os.getenv("AETHERIUM_ROS2_CONNECTOR_HOST", "server3")
        self.server_port = int(os.getenv("AETHERIUM_ROS2_CONNECTOR_PORT", "5501"))
        self.uplink_topic = os.getenv("AETHERIUM_ROS2_UPLINK_TOPIC", "/aetherium/bridge/uplink_b64")
        self.downlink_topic = os.getenv("AETHERIUM_ROS2_DOWNLINK_TOPIC", "/aetherium/bridge/downlink_b64")
        self.status_topic = os.getenv("AETHERIUM_ROS2_STATUS_TOPIC", "/aetherium/bridge/status")
        self.queue_limit = int(os.getenv("AETHERIUM_ROS2_QUEUE_LIMIT", "500"))
        self.reconnect_base = float(os.getenv("AETHERIUM_ROS2_RECONNECT_BASE_SEC", "1.0"))
        self.reconnect_max = float(os.getenv("AETHERIUM_ROS2_RECONNECT_MAX_SEC", "15.0"))

        self.downlink_pub = self.create_publisher(String, self.downlink_topic, 100)
        self.status_pub = self.create_publisher(String, self.status_topic, 10)
        self.create_subscription(String, self.uplink_topic, self._on_uplink, 100)

        self._sock_lock = threading.Lock()
        self._socket: Optional[socket.socket] = None
        self._reader_thread: Optional[threading.Thread] = None
        self._running = True
        self._connected = False
        self._next_connect_try = time.monotonic()
        self._backoff = self.reconnect_base

        self._tx_queue: "queue.Queue[str]" = queue.Queue(maxsize=max(1, self.queue_limit))
        self.create_timer(0.1, self._tick_connect)
        self.create_timer(0.02, self._tick_flush)

        self.get_logger().info(
            f"ROS2 TCP bridge configured for {self.server_host}:{self.server_port} "
            f"(uplink={self.uplink_topic}, downlink={self.downlink_topic})"
        )

    def destroy_node(self) -> bool:
        self._running = False
        self._disconnect()
        return super().destroy_node()

    def _on_uplink(self, msg: String) -> None:
        raw = msg.data.strip()
        if not raw:
            return

        payload = raw if raw.startswith("{") else json.dumps({"frame_b64": raw}, separators=(",", ":"))
        line = payload + "\n"

        try:
            self._tx_queue.put_nowait(line)
        except queue.Full:
            self.get_logger().warning("Bridge TX queue full, dropping oldest frame")
            try:
                _ = self._tx_queue.get_nowait()
            except queue.Empty:
                pass
            try:
                self._tx_queue.put_nowait(line)
            except queue.Full:
                pass

    def _tick_connect(self) -> None:
        if self._connected:
            return

        if time.monotonic() < self._next_connect_try:
            return

        self._connect()

    def _connect(self) -> None:
        try:
            sock = socket.create_connection((self.server_host, self.server_port), timeout=3.0)
            sock.settimeout(1.0)
        except OSError as exc:
            self.get_logger().warning(
                f"Bridge connect failed to {self.server_host}:{self.server_port}: {exc}"
            )
            self._schedule_reconnect()
            return

        with self._sock_lock:
            self._socket = sock
            self._connected = True
            self._backoff = self.reconnect_base

        self._publish_status("connected")
        self.get_logger().info(f"Bridge connected to {self.server_host}:{self.server_port}")

        self._reader_thread = threading.Thread(target=self._reader_loop, daemon=True)
        self._reader_thread.start()

    def _schedule_reconnect(self) -> None:
        self._connected = False
        self._next_connect_try = time.monotonic() + self._backoff
        self._backoff = min(self._backoff * 2.0, self.reconnect_max)

    def _disconnect(self) -> None:
        with self._sock_lock:
            sock = self._socket
            self._socket = None
            self._connected = False

        if sock is not None:
            try:
                sock.close()
            except OSError:
                pass

    def _tick_flush(self) -> None:
        if not self._connected:
            return

        while True:
            try:
                line = self._tx_queue.get_nowait()
            except queue.Empty:
                return

            if not self._send_line(line):
                return

    def _send_line(self, line: str) -> bool:
        data = line.encode("utf-8")
        with self._sock_lock:
            sock = self._socket

        if sock is None:
            self._schedule_reconnect()
            return False

        try:
            sock.sendall(data)
            return True
        except OSError as exc:
            self.get_logger().warning(f"Bridge send failed: {exc}")
            self._publish_status("disconnected")
            self._disconnect()
            self._schedule_reconnect()
            return False

    def _reader_loop(self) -> None:
        buffer = b""

        while self._running:
            with self._sock_lock:
                sock = self._socket

            if sock is None:
                return

            try:
                chunk = sock.recv(4096)
            except socket.timeout:
                continue
            except OSError as exc:
                self.get_logger().warning(f"Bridge recv failed: {exc}")
                break

            if not chunk:
                self.get_logger().warning("Bridge remote socket closed")
                break

            buffer += chunk
            while b"\n" in buffer:
                line, buffer = buffer.split(b"\n", 1)
                self._handle_downlink_line(line.decode("utf-8", errors="replace").strip())

        self._publish_status("disconnected")
        self._disconnect()
        self._schedule_reconnect()

    def _handle_downlink_line(self, line: str) -> None:
        if not line:
            return

        frame_b64: Optional[str] = None
        if line.startswith("{"):
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                self.get_logger().warning("Bridge downlink JSON decode error")
                return
            frame_b64 = payload.get("frame_b64")
        else:
            frame_b64 = line

        if not frame_b64:
            return

        msg = String()
        msg.data = frame_b64
        self.downlink_pub.publish(msg)

    def _publish_status(self, status: str) -> None:
        msg = String()
        msg.data = status
        self.status_pub.publish(msg)


def main() -> None:
    rclpy.init()
    node = Ros2TcpBridge()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
