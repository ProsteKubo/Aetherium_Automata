#!/usr/bin/env bash
set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_ID="${RUN_ID:-$(date +%Y%m%d_%H%M%S)}"
LOG_ROOT="${LOG_ROOT:-$ROOT_DIR/validation_runs}"
LOG_DIR="$LOG_ROOT/$RUN_ID-hardware"
SUMMARY="$LOG_DIR/commands.tsv"
SERVER_LOG="$LOG_DIR/serial_server.log"

ESP_PORTS="${ESP_PORTS:-}"
MCXN947_PORT="${MCXN947_PORT:-}"
SERIAL_PORTS="${SERIAL_PORTS:-}"
SERIAL_BAUD_RATE="${SERIAL_BAUD_RATE:-115200}"
RUN_FLASH="${RUN_FLASH:-0}"
RUN_MCX_FLASH="${RUN_MCX_FLASH:-0}"
RUN_ESP_FLASH="${RUN_ESP_FLASH:-0}"
RUN_SERIAL_SMOKE="${RUN_SERIAL_SMOKE:-1}"
RUN_SERIAL_SERVER="${RUN_SERIAL_SERVER:-0}"
RUN_ESP_DEMO="${RUN_ESP_DEMO:-0}"
HOLD_SERIAL_SERVER_SECONDS="${HOLD_SERIAL_SERVER_SECONDS:-0}"

mkdir -p "$LOG_DIR"
printf "timestamp\tname\tstatus\tduration_s\tlog\n" > "$SUMMARY"

log_section() {
  printf "\n[%s] %s\n" "$(date -Is)" "$*" | tee -a "$LOG_DIR/run.log"
}

run_cmd() {
  local name="$1"
  shift
  local logfile="$LOG_DIR/${name}.log"
  local start end status duration

  log_section "RUN $name: $*"
  start="$(date +%s)"
  (
    set -x
    "$@"
  ) >"$logfile" 2>&1
  status=$?
  end="$(date +%s)"
  duration=$((end - start))

  printf "%s\t%s\t%s\t%s\t%s\n" "$(date -Is)" "$name" "$status" "$duration" "$logfile" >> "$SUMMARY"
  log_section "DONE $name status=$status duration=${duration}s log=$logfile"
  return "$status"
}

run_shell() {
  local name="$1"
  shift
  run_cmd "$name" bash -lc "$*"
}

join_by_comma() {
  local IFS=,
  echo "$*"
}

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]] && kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    log_section "Stopping serial server pid=$SERVER_PID"
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

log_section "Aetherium final hardware validation"
log_section "ROOT_DIR=$ROOT_DIR"
log_section "LOG_DIR=$LOG_DIR"

run_shell "git_status_short" "cd '$ROOT_DIR' && git status --short"
run_shell "tool_versions" \
  "date -Is; uname -a; arduino-cli version 2>&1 || true; pyocd --version 2>&1 || true; arm-none-eabi-gcc --version 2>/dev/null | head -5 || true; docker --version 2>/dev/null || true; podman --version 2>/dev/null || true"

run_shell "hardware_discovery_before" \
  "lsusb 2>/dev/null || true; echo '--- serial by id ---'; ls -l /dev/serial/by-id 2>/dev/null || true; echo '--- tty nodes ---'; ls -l /dev/ttyUSB* /dev/ttyACM* /dev/cu.* /dev/tty.usb* 2>/dev/null || true; echo '--- arduino boards ---'; arduino-cli board list 2>&1 || true; echo '--- pyocd probes ---'; pyocd list 2>&1 || true; echo '--- permissions ---'; id; groups; ls -l /dev/hidraw* 2>/dev/null || true"

if [[ -z "$SERIAL_PORTS" ]]; then
  detected_ports=()
  while IFS= read -r port; do
    [[ -n "$port" ]] && detected_ports+=("$port")
  done < <(ls /dev/ttyUSB* /dev/ttyACM* 2>/dev/null || true)

  if [[ -n "$ESP_PORTS" ]]; then
    IFS=',' read -r -a esp_arr <<< "$ESP_PORTS"
    detected_ports+=("${esp_arr[@]}")
  fi

  if [[ -n "$MCXN947_PORT" ]]; then
    detected_ports+=("$MCXN947_PORT")
  fi

  if [[ "${#detected_ports[@]}" -gt 0 ]]; then
    SERIAL_PORTS="$(join_by_comma "${detected_ports[@]}")"
  fi
fi

log_section "Resolved SERIAL_PORTS=${SERIAL_PORTS:-<none>}"

run_shell "start_gateway_only" "cd '$ROOT_DIR/src' && make up-gateway"

if [[ "$RUN_FLASH" == "1" || "$RUN_ESP_FLASH" == "1" ]]; then
  if [[ -n "$ESP_PORTS" ]]; then
    IFS=',' read -r -a esp_arr <<< "$ESP_PORTS"
    idx=1
    for port in "${esp_arr[@]}"; do
      run_shell "esp_flash_${idx}" "cd '$ROOT_DIR/src' && make esp-flash ESP_PORT='$port'"
      idx=$((idx + 1))
    done
  else
    log_section "RUN_ESP_FLASH requested but ESP_PORTS is empty"
  fi
fi

if [[ "$RUN_FLASH" == "1" || "$RUN_MCX_FLASH" == "1" ]]; then
  if [[ -n "$MCXN947_PORT" ]]; then
    run_shell "mcxn947_flash" "cd '$ROOT_DIR/src' && make mcxn947-flash MCXN947_PORT='$MCXN947_PORT'"
  else
    log_section "RUN_MCX_FLASH requested but MCXN947_PORT is empty"
  fi
fi

if [[ -z "$SERIAL_PORTS" ]]; then
  log_section "No serial ports resolved. Hardware smoke cannot run yet."
  run_shell "hardware_discovery_after_no_ports" \
    "lsusb 2>/dev/null || true; arduino-cli board list 2>&1 || true; pyocd list 2>&1 || true; ls -l /dev/ttyUSB* /dev/ttyACM* /dev/serial/by-id 2>/dev/null || true"
  exit 2
fi

missing_ports=()
IFS=',' read -r -a serial_port_array <<< "$SERIAL_PORTS"
for port in "${serial_port_array[@]}"; do
  if [[ ! -e "$port" ]]; then
    missing_ports+=("$port")
  fi
done

if [[ "${#missing_ports[@]}" -gt 0 ]]; then
  log_section "These configured serial ports do not exist: ${missing_ports[*]}"
  run_shell "missing_port_diagnostics" \
    "lsusb 2>/dev/null || true; echo '--- tty nodes ---'; ls -l /dev/ttyUSB* /dev/ttyACM* /dev/serial/by-id 2>/dev/null || true; echo '--- modules ---'; lsmod | rg 'cp210x|ch34|cdc_acm|usbserial' || true; echo '--- arduino ---'; arduino-cli board list 2>&1 || true"
  exit 3
fi

if [[ "$RUN_SERIAL_SMOKE" == "1" ]]; then
  log_section "Running one-shot serial smoke. This starts its own server, so no background serial server is started."
  run_shell "serial_smoke_all_ports" \
    "cd '$ROOT_DIR/src' && make serial-smoke SERIAL_SERVER_ID=final_serial_host SERIAL_PORTS='$SERIAL_PORTS' SERIAL_BAUD_RATE='$SERIAL_BAUD_RATE' ENABLE_HOST_RUNTIME_DEVICE=1"
fi

if [[ "$RUN_SERIAL_SERVER" == "1" ]]; then
  log_section "Starting host serial server in background for live screenshots"
  (
    cd "$ROOT_DIR/src/server/aetherium_server" || exit 1
    SERVER_ID=final_serial_host \
    DEVICE_PORT=4100 \
    ENABLE_SERIAL_DEVICE_TRANSPORT=1 \
    ENABLE_HOST_RUNTIME_DEVICE=1 \
    SERIAL_PORTS="$SERIAL_PORTS" \
    SERIAL_BAUD_RATE="$SERIAL_BAUD_RATE" \
    GATEWAY_WS_URL=ws://localhost:8080/socket/websocket \
    GATEWAY_AUTH_TOKEN=server_secret_token \
    mix run --no-halt
  ) >"$SERVER_LOG" 2>&1 &
  SERVER_PID=$!

  log_section "Serial server pid=$SERVER_PID log=$SERVER_LOG"
  run_shell "wait_for_serial_server" "sleep 20"
  run_shell "serial_server_log_initial" "sed -n '1,260p' '$SERVER_LOG'"

  if [[ "$HOLD_SERIAL_SERVER_SECONDS" == "forever" ]]; then
    log_section "Holding serial server until interrupted. Press Ctrl-C when screenshots/manual checks are complete."
    while true; do
      sleep 60
      run_shell "serial_server_log_heartbeat" "tail -120 '$SERVER_LOG'"
    done
  elif [[ "$HOLD_SERIAL_SERVER_SECONDS" =~ ^[0-9]+$ && "$HOLD_SERIAL_SERVER_SECONDS" -gt 0 ]]; then
    log_section "Holding serial server for ${HOLD_SERIAL_SERVER_SECONDS}s for screenshots/manual checks"
    run_shell "hold_serial_server" "sleep '$HOLD_SERIAL_SERVER_SECONDS'"
    run_shell "serial_server_log_after_hold" "tail -300 '$SERVER_LOG'"
  fi
fi

if [[ "$RUN_ESP_DEMO" == "1" && -n "$ESP_PORTS" ]]; then
  first_esp="${ESP_PORTS%%,*}"
  run_shell "esp_time_travel_demo_first_port" \
    "cd '$ROOT_DIR/src' && make esp-demo ESP_PORT='$first_esp'"
fi

if [[ "$RUN_SERIAL_SERVER" == "1" ]]; then
  run_shell "serial_server_log_final" "tail -300 '$SERVER_LOG'"
fi
run_shell "hardware_discovery_after" \
  "lsusb 2>/dev/null || true; echo '--- serial by id ---'; ls -l /dev/serial/by-id 2>/dev/null || true; echo '--- tty nodes ---'; ls -l /dev/ttyUSB* /dev/ttyACM* /dev/cu.* /dev/tty.usb* 2>/dev/null || true; echo '--- arduino boards ---'; arduino-cli board list 2>&1 || true; echo '--- pyocd probes ---'; pyocd list 2>&1 || true"

run_shell "extract_key_evidence" \
  "cd '$LOG_DIR' && { rg -n 'Device registered|Serial smoke PASS|Rewind PASS|Timeline captured|Automata loaded|Started in state|state transition|No boards found|No available debug probes|error|failed|timeout|denied|Permission' . || true; } > key_evidence.txt"

log_section "Hardware validation complete"
log_section "Summary: $SUMMARY"
log_section "Key evidence: $LOG_DIR/key_evidence.txt"
