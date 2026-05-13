#!/usr/bin/env bash
set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_ID="${RUN_ID:-$(date +%Y%m%d_%H%M%S)}"
LOG_ROOT="${LOG_ROOT:-$ROOT_DIR/validation_runs}"
LOG_DIR="$LOG_ROOT/$RUN_ID-desktop"
SUMMARY="$LOG_DIR/commands.tsv"

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

collect_snapshot() {
  local phase="$1"
  log_section "Collecting snapshot: $phase"

  run_shell "snapshot_${phase}_podman_ps" \
    "podman ps --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}\t{{.Ports}}' || true"

  run_shell "snapshot_${phase}_compose_ps" \
    "cd '$ROOT_DIR/src' && docker compose ps || true"

  run_shell "snapshot_${phase}_server_logs" \
    "cd '$ROOT_DIR/src' && docker compose logs --tail=300 server3 gateway device1 blackbox1 2>/dev/null || true"

  run_shell "snapshot_${phase}_cpp_device_2_logs" \
    "podman logs --tail=200 cpp-device-2 2>/dev/null || true"
}

log_section "Aetherium final desktop validation"
log_section "ROOT_DIR=$ROOT_DIR"
log_section "LOG_DIR=$LOG_DIR"

run_shell "git_status_short" "cd '$ROOT_DIR' && git status --short"
run_shell "tool_versions" \
  "date -Is; uname -a; cmake --version | head -1; python3 --version; node --version 2>/dev/null || true; npm --version 2>/dev/null || true; mix --version 2>/dev/null | head -3 || true; docker --version 2>/dev/null || true; podman --version 2>/dev/null || true"

run_shell "hardware_discovery_usb" \
  "lsusb 2>/dev/null || true; echo '--- serial nodes ---'; ls -l /dev/serial/by-id /dev/ttyUSB* /dev/ttyACM* /dev/cu.* /dev/tty.usb* 2>/dev/null || true; echo '--- arduino ---'; arduino-cli board list 2>&1 || true; echo '--- pyocd ---'; pyocd list 2>&1 || true; echo '--- kernel modules ---'; lsmod | rg 'cp210x|ch34|cdc_acm|usbserial' || true"

run_shell "start_core_stack" "cd '$ROOT_DIR/src' && make up"

run_shell "start_cpp_device_2" \
  "podman rm -f cpp-device-2 >/dev/null 2>&1 || true; podman run -d --name cpp-device-2 --network src_elixir-net -e DEVICE_ID=device_cpp_02 localhost/src_device1:latest --verbose --run - --mode network --server ws://172.20.0.23:4000/socket/device/websocket"

run_shell "wait_for_devices" "sleep 12"
collect_snapshot "after_start"

run_shell "e2e_cpp_device_01_bytecode" \
  "cd '$ROOT_DIR/src' && docker compose exec -T server3 sh -lc 'cd /app && mix aetherium.e2e --gateway-url ws://172.20.0.10:4000/socket/websocket --token dev_secret_token --server-id svr_03 --device-id device_cpp_01 --bytecode-smoke --timeout-ms 30000 --wait-ms 15000 --set-input enabled=true'"

run_shell "e2e_cpp_device_02_bytecode" \
  "cd '$ROOT_DIR/src' && docker compose exec -T server3 sh -lc 'cd /app && mix aetherium.e2e --gateway-url ws://172.20.0.10:4000/socket/websocket --token dev_secret_token --server-id svr_03 --device-id device_cpp_02 --bytecode-smoke --timeout-ms 30000 --wait-ms 15000 --set-input enabled=true'"

run_shell "showcase_validate" "cd '$ROOT_DIR' && scripts/validate_showcase_automata.sh validate"

run_shell "gateway_protocol_tests" \
  "cd '$ROOT_DIR/src/gateway/aetherium_gateway' && mix test test/protocol_test.exs"

run_shell "ide_typecheck" \
  "cd '$ROOT_DIR/src/ide' && npm run typecheck"

run_shell "server_target_profile_tests_allow_fail" \
  "cd '$ROOT_DIR/src/server/aetherium_server' && mix test test/automata_deploy_compiler_test.exs test/device_manager_target_profile_deploy_test.exs"

run_shell "cpp_build_and_pytest_allow_fail" \
  "cd '$ROOT_DIR' && cmake -S . -B build -DAETHERIUM_BUILD_ENGINE_SMOKE=ON && cmake --build build --target aetherium_engine aetherium_engine_command_smoke -j4 && ./build/aetherium_engine_command_smoke; smoke_status=\$?; pytest -q; pytest_status=\$?; exit \$((smoke_status != 0 || pytest_status != 0))"

run_shell "blackbox_smoke_allow_fail" \
  "cd '$ROOT_DIR/src' && make up-blackbox && make smoke-blackbox"

collect_snapshot "final"

run_shell "extract_key_evidence" \
  "cd '$LOG_DIR' && { rg -n 'E2E OK|Validated [0-9]+ showcase|tests, 0 failures|FAIL|failed|Timed out|No boards found|No available debug probes|Initial snapshot|Armed snapshot|Faulted snapshot|Final snapshot|runtime_core build does not include|target requires bytecode-compatible' . || true; } > key_evidence.txt"

log_section "Desktop validation complete"
log_section "Summary: $SUMMARY"
log_section "Key evidence: $LOG_DIR/key_evidence.txt"

