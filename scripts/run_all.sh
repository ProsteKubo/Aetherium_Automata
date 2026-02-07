#!/bin/bash
# ============================================================================
# Aetherium Automata - Full System Startup Script
# ============================================================================
# 
# This script starts all components of the Aetherium Automata system.
# Run components in separate terminals or use this script with tmux.
#
# Usage:
#   ./scripts/run_all.sh gateway     # Start only gateway
#   ./scripts/run_all.sh server      # Start only server  
#   ./scripts/run_all.sh ide         # Start only IDE
#   ./scripts/run_all.sh             # Show help
#
# ============================================================================

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_banner() {
    echo -e "${BLUE}"
    echo "╔═══════════════════════════════════════════════════════════════╗"
    echo "║           Aetherium Automata - System Launcher                ║"
    echo "╚═══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

print_help() {
    print_banner
    echo -e "${YELLOW}ARCHITECTURE:${NC}"
    echo ""
    echo "  ┌─────────┐     WebSocket      ┌─────────────┐"
    echo "  │   IDE   │ ◄────────────────► │   Gateway   │"
    echo "  │ (React) │     :4000          │  (Phoenix)  │"
    echo "  └─────────┘                    └──────┬──────┘"
    echo "                                        │"
    echo "                              WebSocket │ :4000"
    echo "                                        │"
    echo "                                 ┌──────┴──────┐"
    echo "                                 │   Server    │"
    echo "                                 │  (Elixir)   │"
    echo "                                 └─────────────┘"
    echo ""
    echo -e "${YELLOW}STARTUP ORDER (use 3 separate terminals):${NC}"
    echo ""
    echo -e "  ${GREEN}Terminal 1 - Gateway:${NC}"
    echo "    cd src/gateway/aetherium_gateway"
    echo "    mix deps.get"
    echo "    mix phx.server"
    echo ""
    echo -e "  ${GREEN}Terminal 2 - Server:${NC}"
    echo "    cd src/server/aetherium_server"
    echo "    mix deps.get"
    echo "    iex -S mix    # Interactive for debugging"
    echo ""
    echo -e "  ${GREEN}Terminal 3 - IDE:${NC}"
    echo "    cd src/ide"
    echo "    npm install"
    echo "    npm run dev"
    echo ""
    echo -e "${YELLOW}PORTS:${NC}"
    echo "  • Gateway HTTP/WS: http://localhost:4000"
    echo "  • IDE Dev Server:  http://localhost:5173 (Vite)"
    echo ""
    echo -e "${YELLOW}QUICK COMMANDS:${NC}"
    echo "  ./scripts/run_all.sh gateway   - Start gateway (Phoenix)"
    echo "  ./scripts/run_all.sh server    - Start server (IEx)"
    echo "  ./scripts/run_all.sh ide       - Start IDE (Electron)"
    echo ""
}

start_gateway() {
    echo -e "${GREEN}Starting Gateway on port 4000...${NC}"
    cd "$ROOT_DIR/src/gateway/aetherium_gateway"
    mix deps.get --quiet
    echo -e "${YELLOW}Gateway starting - watch for Phoenix logs${NC}"
    mix phx.server
}

start_server() {
    echo -e "${GREEN}Starting Server (connecting to ws://localhost:4000)...${NC}"
    cd "$ROOT_DIR/src/server/aetherium_server"
    mix deps.get --quiet
    echo -e "${YELLOW}Server starting in interactive mode (IEx)${NC}"
    echo -e "${YELLOW}You can run commands like:${NC}"
    echo "  AetheriumServer.DeviceManager.list_devices()"
    echo "  AetheriumServer.AutomataRuntime.start_link(deployment_id: \"test\", automata: %{...})"
    echo ""
    iex -S mix
}

start_ide() {
    echo -e "${GREEN}Starting IDE...${NC}"
    cd "$ROOT_DIR/src/ide"
    npm install --silent
    echo -e "${YELLOW}IDE starting - Electron window will open${NC}"
    npm run dev
}

case "$1" in
    gateway)
        start_gateway
        ;;
    server)
        start_server
        ;;
    ide)
        start_ide
        ;;
    *)
        print_help
        ;;
esac
