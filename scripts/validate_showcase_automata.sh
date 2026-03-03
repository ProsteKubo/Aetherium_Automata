#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CATALOG_FILE="$ROOT_DIR/example/automata/showcase/CATALOG.txt"
ENGINE_BIN="${AETHERIUM_ENGINE_BIN:-$ROOT_DIR/build/aetherium_engine}"

usage() {
  cat <<USAGE
Usage:
  $(basename "$0") list
  $(basename "$0") validate

Environment:
  AETHERIUM_ENGINE_BIN   Optional path to engine binary (defaults to build/aetherium_engine)
USAGE
}

read_catalog() {
  if [[ ! -f "$CATALOG_FILE" ]]; then
    echo "Catalog not found: $CATALOG_FILE" >&2
    exit 1
  fi

  grep -vE '^\s*(#|$)' "$CATALOG_FILE"
}

cmd_list() {
  read_catalog
}

cmd_validate() {
  if [[ ! -x "$ENGINE_BIN" ]]; then
    echo "Engine binary not executable: $ENGINE_BIN" >&2
    echo "Build it first (for example: cmake --build build --target aetherium_engine)." >&2
    exit 1
  fi

  local total=0

  while IFS= read -r rel_path; do
    local abs_path="$ROOT_DIR/$rel_path"
    ((total += 1))

    if [[ ! -f "$abs_path" ]]; then
      echo "[FAIL] Missing file: $rel_path" >&2
      exit 1
    fi

    echo "[VALIDATE] $rel_path"
    "$ENGINE_BIN" --validate "$abs_path" >/dev/null
  done < <(read_catalog)

  echo "Validated $total showcase automata file(s)."
}

main() {
  local cmd="${1:-list}"

  case "$cmd" in
    list)
      cmd_list
      ;;
    validate)
      cmd_validate
      ;;
    -h|--help|help)
      usage
      ;;
    *)
      echo "Unknown command: $cmd" >&2
      usage
      exit 1
      ;;
  esac
}

main "$@"
