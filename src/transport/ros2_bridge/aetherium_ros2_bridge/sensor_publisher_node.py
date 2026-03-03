"""Demo ROS2 sensor publisher for automata interaction presentations."""

from __future__ import annotations

import math
import os
import random

import rclpy
from rclpy.node import Node
from std_msgs.msg import Float32


class DemoSensorPublisher(Node):
    def __init__(self) -> None:
        super().__init__("aetherium_demo_sensor_publisher")

        self.topic = os.getenv("AETHERIUM_EMULATOR_SENSOR_TOPIC", "/aetherium/demo/sensor_temp")
        self.period = float(os.getenv("AETHERIUM_DEMO_SENSOR_PERIOD_SEC", "0.5"))
        self.minimum = float(os.getenv("AETHERIUM_DEMO_SENSOR_MIN", "24.0"))
        self.maximum = float(os.getenv("AETHERIUM_DEMO_SENSOR_MAX", "35.0"))
        self.mode = os.getenv("AETHERIUM_DEMO_SENSOR_MODE", "wave").strip().lower()

        self.pub = self.create_publisher(Float32, self.topic, 20)
        self.create_timer(self.period, self._tick)
        self._phase = 0.0

        self.get_logger().info(
            f"Demo sensor publisher active (topic={self.topic}, mode={self.mode}, "
            f"range=[{self.minimum}, {self.maximum}], period={self.period}s)"
        )

    def _tick(self) -> None:
        value = self._next_value()
        msg = Float32()
        msg.data = float(value)
        self.pub.publish(msg)

    def _next_value(self) -> float:
        span = max(0.001, self.maximum - self.minimum)

        if self.mode == "random":
            return random.uniform(self.minimum, self.maximum)

        # default wave mode
        self._phase += 0.28
        norm = (math.sin(self._phase) + 1.0) * 0.5
        return self.minimum + norm * span


def main() -> None:
    rclpy.init()
    node = DemoSensorPublisher()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
