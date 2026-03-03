FROM ros:humble-ros-base

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3-pip \
    ros-humble-rclpy \
    ros-humble-std-msgs \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY aetherium_ros2_bridge /app/aetherium_ros2_bridge
COPY entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh \
  && useradd --create-home --uid 10001 appuser \
  && chown -R appuser:appuser /app

USER appuser
ENV PYTHONPATH=/app

ENTRYPOINT ["/entrypoint.sh"]
CMD ["python3", "-m", "aetherium_ros2_bridge.tcp_bridge_node"]
