#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SRC_DIR="$ROOT_DIR/src"

usage() {
  cat <<'EOF'
ROS2 demo launcher

Usage:
  ./scripts/ros2_demo.sh actual     # gateway + server3 + ros2-bridge
  ./scripts/ros2_demo.sh demo       # gateway + server3 + ros2-bridge + ros2-emulator + ros2-sensor
  ./scripts/ros2_demo.sh logs       # follow demo logs
  ./scripts/ros2_demo.sh down       # stop ros2 stack services
EOF
}

run_make() {
  (cd "$SRC_DIR" && make "$@")
}

case "${1:-}" in
  actual)
    run_make up-ros2
    ;;
  demo)
    run_make up-ros2-demo
    ;;
  logs)
    run_make logs-ros2-demo
    ;;
  down)
    run_make down-ros2
    ;;
  *)
    usage
    ;;
esac
