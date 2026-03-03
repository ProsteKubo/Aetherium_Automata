/**
 * Aetherium Automata Engine - Core Header
 * 
 * This is the main include file for the Aetherium engine.
 * It provides all necessary types and classes for automata execution.
 * 
 * Architecture:
 * - types.hpp:     Basic type definitions and enums
 * - variable.hpp:  Variable system with change tracking
 * - model.hpp:     Automata model (states, transitions)
 * - protocol.hpp:  Wire protocol for communication
 * - transport.hpp: Transport layer abstraction
 * - runtime.hpp:   Execution engine
 * - parser.hpp:    YAML parsing
 * 
 * Usage:
 *   #include "core/aetherium.hpp"
 *   
 *   aeth::AutomataParser parser;
 *   auto result = parser.parseFile("my_automata.yaml");
 *   if (result.success()) {
 *       aeth::Runtime runtime(
 *           std::make_unique<aeth::StdClock>(),
 *           std::make_unique<aeth::StdRandomSource>(),
 *           std::make_unique<MyLuaEngine>()
 *       );
 *       runtime.load(*result.automata);
 *       runtime.run();
 *   }
 */

#ifndef AETHERIUM_HPP
#define AETHERIUM_HPP

// Core types
#include "types.hpp"

// Variable system
#include "variable.hpp"

// Model (states, transitions, automata)
#include "model.hpp"

// Protocol definitions
#include "protocol.hpp"
#include "protocol_v2.hpp"
#include "artifact.hpp"
#include "capabilities.hpp"

// Transport layer
#include "transport.hpp"

// Runtime engine
#include "runtime.hpp"

// YAML parser
#include "parser.hpp"
#include "automata_loader.hpp"
#include "telemetry_log_hub.hpp"
#include "command_bus.hpp"
#include "engine.hpp"

namespace aeth {

/**
 * Version information
 */
struct Version {
    static constexpr int MAJOR = 0;
    static constexpr int MINOR = 2;
    static constexpr int PATCH = 0;
    
    static const char* string() { return "0.2.0"; }
    static const char* specVersion() { return "0.0.1"; }
};

} // namespace aeth

#endif // AETHERIUM_HPP
