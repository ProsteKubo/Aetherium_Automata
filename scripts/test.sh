#!/bin/bash
# ============================================================================
# Aetherium Automata - Test Runner Script
# ============================================================================
# This script helps run tests for different components in isolation.
#
# Usage:
#   ./scripts/test.sh [component] [options]
#
# Components:
#   gateway    - Test gateway Elixir modules
#   server     - Test server Elixir modules  
#   protocol   - Test protocol encoding/decoding
#   ide        - Test IDE TypeScript components
#   all        - Run all tests
#
# Options:
#   --watch    - Watch mode for continuous testing
#   --verbose  - Verbose output
#   --filter   - Filter specific test (Elixir only)
# ============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_header() {
    echo -e "\n${BLUE}════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}\n"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_info() {
    echo -e "${YELLOW}→ $1${NC}"
}

# Test Gateway
test_gateway() {
    print_header "Testing Gateway (Elixir)"
    cd "$PROJECT_ROOT/src/gateway/aetherium_gateway"
    
    if [ "$FILTER" != "" ]; then
        print_info "Running filtered tests: $FILTER"
        mix test --only "$FILTER" ${VERBOSE:+--trace}
    else
        print_info "Running all gateway tests..."
        mix test ${VERBOSE:+--trace}
    fi
}

# Test Server
test_server() {
    print_header "Testing Server (Elixir)"
    cd "$PROJECT_ROOT/src/server/aetherium_server"
    
    if [ "$FILTER" != "" ]; then
        print_info "Running filtered tests: $FILTER"
        mix test --only "$FILTER" ${VERBOSE:+--trace}
    else
        print_info "Running all server tests..."
        mix test ${VERBOSE:+--trace}
    fi
}

# Test Protocol (both gateway and server)
test_protocol() {
    print_header "Testing Protocol"
    
    print_info "Testing Gateway Protocol..."
    cd "$PROJECT_ROOT/src/gateway/aetherium_gateway"
    mix test test/protocol_test.exs ${VERBOSE:+--trace}
    
    print_info "Testing Server Protocol..."
    cd "$PROJECT_ROOT/src/server/aetherium_server"
    mix test test/protocol_test.exs ${VERBOSE:+--trace}
}

# Test IDE
test_ide() {
    print_header "Testing IDE (TypeScript)"
    cd "$PROJECT_ROOT/src/ide"
    
    if [ "$WATCH" == "true" ]; then
        print_info "Running tests in watch mode..."
        npm run test:watch
    else
        print_info "Running IDE tests..."
        npm test
    fi
}

# Interactive test with IEx
test_interactive() {
    print_header "Interactive Testing (IEx)"
    
    echo "Select component to test interactively:"
    echo "  1) Gateway"
    echo "  2) Server"
    echo ""
    read -p "Enter choice [1-2]: " choice
    
    case $choice in
        1)
            cd "$PROJECT_ROOT/src/gateway/aetherium_gateway"
            print_info "Starting Gateway IEx session..."
            iex -S mix
            ;;
        2)
            cd "$PROJECT_ROOT/src/server/aetherium_server"
            print_info "Starting Server IEx session..."
            iex -S mix
            ;;
        *)
            print_error "Invalid choice"
            exit 1
            ;;
    esac
}

# Test all components
test_all() {
    print_header "Running All Tests"
    
    test_gateway
    test_server
    test_ide
    
    print_success "All tests completed!"
}

# Parse arguments
COMPONENT="${1:-all}"
WATCH="false"
VERBOSE=""
FILTER=""

shift || true

while [[ $# -gt 0 ]]; do
    case $1 in
        --watch)
            WATCH="true"
            shift
            ;;
        --verbose)
            VERBOSE="true"
            shift
            ;;
        --filter)
            FILTER="$2"
            shift 2
            ;;
        *)
            print_error "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Run tests based on component
case $COMPONENT in
    gateway)
        test_gateway
        ;;
    server)
        test_server
        ;;
    protocol)
        test_protocol
        ;;
    ide)
        test_ide
        ;;
    interactive|iex)
        test_interactive
        ;;
    all)
        test_all
        ;;
    *)
        echo "Usage: $0 [gateway|server|protocol|ide|interactive|all] [--watch] [--verbose] [--filter name]"
        exit 1
        ;;
esac
