#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_ID="${RUN_ID:-$(date +%Y%m%d_%H%M%S)}"
LOG_ROOT="${LOG_ROOT:-$ROOT_DIR/validation_runs}"
LOG_DIR="$LOG_ROOT/$RUN_ID-hw-preflight"
mkdir -p "$LOG_DIR"

UDEV_RULE_FILE="/etc/udev/rules.d/99-pyocd-nxp.rules"
SERIAL_BAUD_RATE="${SERIAL_BAUD_RATE:-115200}"
RUN_HARDWARE_VALIDATION="${RUN_HARDWARE_VALIDATION:-1}"
RUN_SERIAL_SMOKE="${RUN_SERIAL_SMOKE:-1}"
RUN_SERIAL_SERVER="${RUN_SERIAL_SERVER:-0}"
HOLD_SERIAL_SERVER_SECONDS="${HOLD_SERIAL_SERVER_SECONDS:-0}"
RUN_ESP_FLASH="${RUN_ESP_FLASH:-0}"
RUN_MCX_FLASH="${RUN_MCX_FLASH:-0}"
INSTALL_UDEV_RULES="${INSTALL_UDEV_RULES:-auto}"

log() {
  printf '[%s] %s\n' "$(date -Is)" "$*" | tee -a "$LOG_DIR/test.log"
}

run_capture() {
  local name="$1"
  shift
  log "RUN $name: $*"
  (
    set +e
    "$@"
    printf '\nexit=%s\n' "$?"
  ) >"$LOG_DIR/$name.log" 2>&1
}

install_udev_rules() {
  if [[ "$INSTALL_UDEV_RULES" == "0" ]]; then
    log "Skipping udev rule installation because INSTALL_UDEV_RULES=0"
    return 0
  fi

  if [[ "$INSTALL_UDEV_RULES" == "auto" && -f "$UDEV_RULE_FILE" ]] && rg -q '1fc9.*0143|0143.*1fc9' "$UDEV_RULE_FILE"; then
    log "pyOCD udev rule already exists at $UDEV_RULE_FILE"
    return 0
  fi

  log "Installing pyOCD udev rules for NXP MCU-LINK CMSIS-DAP"
  if ! sudo -n true 2>/dev/null; then
    log "sudo is required to install udev rules. Re-run once manually with INSTALL_UDEV_RULES=1, or use INSTALL_UDEV_RULES=0 if rules are already installed."
    return 0
  fi
  sudo tee "$UDEV_RULE_FILE" >/dev/null <<'EOF'
SUBSYSTEM=="usb", ATTR{idVendor}=="1fc9", ATTR{idProduct}=="0143", MODE="0666", GROUP="uucp", TAG+="uaccess"
KERNEL=="hidraw*", ATTRS{idVendor}=="1fc9", ATTRS{idProduct}=="0143", MODE="0666", GROUP="uucp", TAG+="uaccess"
EOF
  sudo udevadm control --reload-rules
  sudo udevadm trigger || true
}

ensure_serial_groups() {
  local missing=()
  id -nG "$USER" | tr ' ' '\n' | rg -qx 'uucp' || missing+=("uucp")
  id -nG "$USER" | tr ' ' '\n' | rg -qx 'lock' || missing+=("lock")

  if [[ "${#missing[@]}" -gt 0 ]]; then
    log "Adding $USER to missing serial groups: ${missing[*]}"
    sudo usermod -aG "$(IFS=,; echo "${missing[*]}")" "$USER"
    log "Group membership changed. Log out/in or reboot before relying on serial permissions."
  else
    log "User $USER is already in uucp and lock."
  fi
}

resolve_ports() {
  local by_id_dir="/dev/serial/by-id"
  local esp_ports=()
  local mcx_port=""
  local all_ports=()

  if [[ -d "$by_id_dir" ]]; then
    while IFS= read -r symlink; do
      local target
      target="$(readlink -f "$symlink" || true)"
      [[ -n "$target" ]] || continue

      case "$symlink" in
        *NXP*|*MCU-LINK*|*CMSIS-DAP*)
          [[ -z "$mcx_port" ]] && mcx_port="$target"
          ;;
        *Silicon*|*CP210*|*QinHeng*|*1a86*|*USB_Single_Serial*)
          esp_ports+=("$target")
          ;;
      esac
    done < <(find "$by_id_dir" -maxdepth 1 -type l -print 2>/dev/null | sort)
  fi

  if [[ "${#esp_ports[@]}" -eq 0 ]]; then
    while IFS= read -r port; do
      [[ "$port" != "$mcx_port" ]] && esp_ports+=("$port")
    done < <(ls /dev/ttyUSB* /dev/ttyACM* 2>/dev/null | sort || true)
  fi

  all_ports=("${esp_ports[@]}")
  [[ -n "$mcx_port" ]] && all_ports+=("$mcx_port")

  if [[ -z "${ESP_PORTS:-}" && "${#esp_ports[@]}" -gt 0 ]]; then
    ESP_PORTS="$(IFS=,; echo "${esp_ports[*]}")"
  fi
  if [[ -z "${MCXN947_PORT:-}" && -n "$mcx_port" ]]; then
    MCXN947_PORT="$mcx_port"
  fi
  if [[ -z "${SERIAL_PORTS:-}" && "${#all_ports[@]}" -gt 0 ]]; then
    SERIAL_PORTS="$(IFS=,; echo "${all_ports[*]}")"
  fi

  export ESP_PORTS="${ESP_PORTS:-}"
  export MCXN947_PORT="${MCXN947_PORT:-}"
  export SERIAL_PORTS="${SERIAL_PORTS:-}"

  {
    printf 'ESP_PORTS=%s\n' "${ESP_PORTS:-}"
    printf 'MCXN947_PORT=%s\n' "${MCXN947_PORT:-}"
    printf 'SERIAL_PORTS=%s\n' "${SERIAL_PORTS:-}"
  } | tee "$LOG_DIR/resolved_ports.env"
}

collect_diagnostics() {
  run_capture "system" bash -lc "date -Is; uname -a; id; groups; lsmod | rg 'cp210x|ch34|cdc_acm|usbserial' || true"
  run_capture "usb_tree" bash -lc "lsusb || true; echo '---'; lsusb -t || true"
  run_capture "serial_nodes" bash -lc "ls -l /dev/serial/by-id 2>/dev/null || true; echo '---'; ls -l /dev/ttyUSB* /dev/ttyACM* 2>/dev/null || true"
  run_capture "hidraw_nodes" bash -lc "ls -l /dev/hidraw* 2>/dev/null || true; echo '--- usb bus NXP candidates ---'; lsusb | rg 'NXP|1fc9' || true"
  run_capture "arduino_board_list" bash -lc "arduino-cli version 2>&1 || true; echo '---'; arduino-cli board list 2>&1 || true"
  run_capture "pyocd_list_user" bash -lc "pyocd --version 2>&1 || true; echo '---'; pyocd list 2>&1 || true"
  run_capture "pyocd_list_sudo" bash -lc "sudo -n pyocd list 2>&1 || true"
}

run_hardware_validation() {
  if [[ "$RUN_HARDWARE_VALIDATION" != "1" ]]; then
    log "Skipping hardware validation because RUN_HARDWARE_VALIDATION=$RUN_HARDWARE_VALIDATION"
    return 0
  fi

  if [[ -z "${SERIAL_PORTS:-}" ]]; then
    log "No serial ports resolved. Diagnostics were collected, but hardware validation cannot run."
    return 2
  fi

  log "Running scripts/final_validation_hardware.sh"
  RUN_ID="$RUN_ID" \
  LOG_ROOT="$LOG_ROOT" \
  ESP_PORTS="${ESP_PORTS:-}" \
  MCXN947_PORT="${MCXN947_PORT:-}" \
  SERIAL_PORTS="$SERIAL_PORTS" \
  SERIAL_BAUD_RATE="$SERIAL_BAUD_RATE" \
  RUN_ESP_FLASH="$RUN_ESP_FLASH" \
  RUN_MCX_FLASH="$RUN_MCX_FLASH" \
  RUN_SERIAL_SMOKE="$RUN_SERIAL_SMOKE" \
  RUN_SERIAL_SERVER="$RUN_SERIAL_SERVER" \
  HOLD_SERIAL_SERVER_SECONDS="$HOLD_SERIAL_SERVER_SECONDS" \
    "$ROOT_DIR/scripts/final_validation_hardware.sh"
}

main() {
  log "Aetherium hardware preflight and validation"
  log "Logs: $LOG_DIR"

  ensure_serial_groups
  install_udev_rules
  collect_diagnostics
  resolve_ports
  run_hardware_validation

  log "Done. Key files:"
  log "  $LOG_DIR/test.log"
  log "  $LOG_DIR/resolved_ports.env"
  log "  $LOG_ROOT/$RUN_ID-hardware"
  log "If pyOCD still reports no probes, unplug/replug the NXP board and rerun ./test.sh."
}

main "$@"
