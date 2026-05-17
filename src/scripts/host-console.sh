#!/usr/bin/env bash
set -euo pipefail

SRC_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "${SRC_ROOT}/.." && pwd)"

HOST_GATEWAY_PORT="${HOST_GATEWAY_PORT:-8080}"
HOST_DEVICE_PORT="${HOST_DEVICE_PORT:-4100}"
HOST_SERVER_ID="${HOST_SERVER_ID:-svr_host}"
HOST_DEVICE_COUNT="${HOST_DEVICE_COUNT:-1}"
HOST_DEVICE_PREFIX="${HOST_DEVICE_PREFIX:-host_cpp}"
HOST_RUNTIME_DIR="${HOST_RUNTIME_DIR:-${SRC_ROOT}/var/host-console}"
HOST_BUILD_ENGINE="${HOST_BUILD_ENGINE:-1}"
HOST_STOP_COMPOSE="${HOST_STOP_COMPOSE:-1}"
HOST_DEPS_GET="${HOST_DEPS_GET:-1}"
HOST_GATEWAY_LOG="${HOST_GATEWAY_LOG:-filtered}"
HOST_SERVER_LOG="${HOST_SERVER_LOG:-all}"
HOST_DEVICE_LOG="${HOST_DEVICE_LOG:-all}"
HOST_LOG_DIR="${HOST_LOG_DIR:-${HOST_RUNTIME_DIR}/logs}"
COMPOSE="${COMPOSE:-docker compose}"
GATEWAY_OPERATOR_TOKEN="${GATEWAY_OPERATOR_TOKEN:-dev_secret_token}"
GATEWAY_SERVER_TOKEN="${GATEWAY_SERVER_TOKEN:-server_secret_token}"
GATEWAY_DEVICE_TOKEN="${GATEWAY_DEVICE_TOKEN:-device_secret_token}"

if [[ "${HOST_RUNTIME_DIR}" != /* ]]; then
  HOST_RUNTIME_DIR="${SRC_ROOT}/${HOST_RUNTIME_DIR}"
fi
if [[ "${HOST_LOG_DIR}" != /* ]]; then
  HOST_LOG_DIR="${SRC_ROOT}/${HOST_LOG_DIR}"
fi
HOST_COMBINED_LOG="${HOST_COMBINED_LOG:-${HOST_LOG_DIR}/host-console.log}"
if [[ "${HOST_COMBINED_LOG}" != /* ]]; then
  HOST_COMBINED_LOG="${SRC_ROOT}/${HOST_COMBINED_LOG}"
fi

pids=()
cleaning_up=0

log() {
  local line="[host-console] $*"
  printf '%s\n' "${line}"
  if [[ -d "${HOST_LOG_DIR}" ]]; then
    printf '%s\n' "${line}" >>"${HOST_COMBINED_LOG}"
  fi
}

port_open() {
  local port="$1"
  (echo >"/dev/tcp/127.0.0.1/${port}") >/dev/null 2>&1
}

wait_for_port() {
  local name="$1"
  local port="$2"
  local timeout="${3:-30}"
  local deadline=$((SECONDS + timeout))

  while (( SECONDS < deadline )); do
    if port_open "${port}"; then
      log "${name} is listening on 127.0.0.1:${port}"
      return 0
    fi
    sleep 0.25
  done

  log "ERROR: ${name} did not open 127.0.0.1:${port} within ${timeout}s"
  return 1
}

ensure_port_free() {
  local name="$1"
  local port="$2"
  if port_open "${port}"; then
    log "ERROR: ${name} port 127.0.0.1:${port} is already in use."
    log "Run 'make down' or override the port, e.g. HOST_GATEWAY_PORT=4080."
    exit 1
  fi
}

cleanup() {
  local status=$?
  if [[ "${cleaning_up}" == "1" ]]; then
    exit "${status}"
  fi
  cleaning_up=1

  if ((${#pids[@]} > 0)); then
    log "stopping ${#pids[@]} host process(es)"
    kill "${pids[@]}" >/dev/null 2>&1 || true
    wait "${pids[@]}" >/dev/null 2>&1 || true
  fi
  exit "${status}"
}

trap cleanup INT TERM EXIT

start_prefixed() {
  local name="$1"
  local dir="$2"
  local filter="${3:-all}"
  shift 3

  local gateway_filter='Unchecked dependencies|dependency is not available|Can.t continue|Mix\)|\[(error|warning)\]|error|warning|Server .*connected|Server .*disconnected|Registered automata|Deploying automata|deployment_status|state_changed|transition_fired|command_outcome|device_update|deployment_inventory|JOINED|CONNECTED|Queueing command|Flushed .*queued|Unhandled'
  local process_log="${HOST_LOG_DIR}/${name}.log"

  log "starting ${name} (log: ${process_log})"
  (
    cd "${dir}"
    if [[ "${filter}" == "gateway" ]]; then
      stdbuf -oL -eL "$@" 2>&1 \
        | sed -u "s/^/[${name}] /" \
        | tee -a "${process_log}" "${HOST_COMBINED_LOG}" \
        | grep -E --line-buffered "${gateway_filter}"
    elif [[ "${filter}" == "none" ]]; then
      stdbuf -oL -eL "$@" 2>&1 \
        | sed -u "s/^/[${name}] /" \
        | tee -a "${process_log}" "${HOST_COMBINED_LOG}" >/dev/null
    else
      stdbuf -oL -eL "$@" 2>&1 \
        | sed -u "s/^/[${name}] /" \
        | tee -a "${process_log}" "${HOST_COMBINED_LOG}"
    fi
  ) &
  pids+=("$!")
}

prepare_mix_app() {
  local name="$1"
  local dir="$2"

  if [[ "${HOST_DEPS_GET}" != "1" ]]; then
    return
  fi

  log "preparing ${name} deps (set HOST_DEPS_GET=0 to skip)"
  (
    cd "${dir}"
    mix deps.get
  )
}

mkdir -p "${HOST_RUNTIME_DIR}/gateway" "${HOST_RUNTIME_DIR}/server_time_series" "${HOST_RUNTIME_DIR}/traces" "${HOST_LOG_DIR}"
: >"${HOST_COMBINED_LOG}"

if [[ "${HOST_STOP_COMPOSE}" == "1" ]]; then
  log "stopping compose gateway/server/device containers to avoid mixed host/container state"
  (cd "${SRC_ROOT}" && ${COMPOSE} stop gateway server3 device1 device2 >/dev/null 2>&1) || true
fi

ensure_port_free "gateway" "${HOST_GATEWAY_PORT}"
ensure_port_free "server device websocket" "${HOST_DEVICE_PORT}"

if [[ "${HOST_BUILD_ENGINE}" == "1" || ! -x "${REPO_ROOT}/build/aetherium_engine" ]]; then
  log "building host C++ engine at ${REPO_ROOT}/build/aetherium_engine"
  cmake -S "${REPO_ROOT}" -B "${REPO_ROOT}/build" -DCMAKE_BUILD_TYPE=Debug
  cmake --build "${REPO_ROOT}/build" --target aetherium_engine -j "${HOST_BUILD_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}"
fi

prepare_mix_app "gateway" "${SRC_ROOT}/gateway/aetherium_gateway"
prepare_mix_app "server" "${SRC_ROOT}/server/aetherium_server"

log "gateway websocket: ws://127.0.0.1:${HOST_GATEWAY_PORT}/socket"
log "device websocket:  ws://127.0.0.1:${HOST_DEVICE_PORT}/socket/device/websocket"
log "server id:         ${HOST_SERVER_ID}"
log "runtime dir:       ${HOST_RUNTIME_DIR}"
log "combined log:      ${HOST_COMBINED_LOG}"
log "press Ctrl-C to stop all host processes"

gateway_filter="${HOST_GATEWAY_LOG}"
if [[ "${gateway_filter}" == "filtered" ]]; then
  gateway_filter="gateway"
fi

start_prefixed "gateway" "${SRC_ROOT}/gateway/aetherium_gateway" "${gateway_filter}" \
  env \
    PORT="${HOST_GATEWAY_PORT}" \
    GATEWAY_OPERATOR_TOKEN="${GATEWAY_OPERATOR_TOKEN}" \
    GATEWAY_SERVER_TOKEN="${GATEWAY_SERVER_TOKEN}" \
    GATEWAY_DEVICE_TOKEN="${GATEWAY_DEVICE_TOKEN}" \
    GATEWAY_DATA_DIR="${HOST_RUNTIME_DIR}/gateway" \
    mix phx.server

wait_for_port "gateway" "${HOST_GATEWAY_PORT}" 45

start_prefixed "server" "${SRC_ROOT}/server/aetherium_server" "${HOST_SERVER_LOG}" \
  env \
    SERVER_ID="${HOST_SERVER_ID}" \
    DEVICE_PORT="${HOST_DEVICE_PORT}" \
    ENABLE_WEBSOCKET_DEVICE_TRANSPORT=1 \
    ENABLE_SERIAL_DEVICE_TRANSPORT=0 \
    ENABLE_ROS2_DEVICE_TRANSPORT=0 \
    ENABLE_HOST_RUNTIME_DEVICE=0 \
    GATEWAY_WS_URL="ws://127.0.0.1:${HOST_GATEWAY_PORT}/socket/websocket" \
    GATEWAY_AUTH_TOKEN="${GATEWAY_SERVER_TOKEN}" \
    TIME_SERIES_DATA_DIR="${HOST_RUNTIME_DIR}/server_time_series" \
    mix run --no-halt

wait_for_port "server device websocket" "${HOST_DEVICE_PORT}" 45

for idx in $(seq 1 "${HOST_DEVICE_COUNT}"); do
  device_id="$(printf '%s_%02d' "${HOST_DEVICE_PREFIX}" "${idx}")"
  placement="$(printf 'host_device_%s' "${idx}")"
  start_prefixed "${device_id}" "${REPO_ROOT}/build" \
    "${HOST_DEVICE_LOG}" \
    env DEVICE_ID="${device_id}" ./aetherium_engine \
      --verbose \
      --instance-id "${device_id}" \
      --placement "${placement}" \
      --transport websocket \
      --control-plane-instance "${HOST_SERVER_ID}" \
      --trace-file "${HOST_RUNTIME_DIR}/traces/${device_id}.jsonl" \
      --max-ticks 1000000000 \
      --run - \
      --mode network \
      --server "ws://127.0.0.1:${HOST_DEVICE_PORT}/socket/device/websocket"
done

if wait -n "${pids[@]}"; then
  log "a host process exited normally; stopping the rest"
else
  log "a host process failed; stopping the rest"
fi
