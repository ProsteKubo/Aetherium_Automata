/**
 * Aetherium Automata Engine - Main Entry Point
 * 
 * Runs automata on local device with optional network connectivity.
 */

#include "argparser.hpp"
#include "automata_validator.hpp"
#include "core/aetherium.hpp"
#include "core/lua_engine.hpp"
#include "core/websocket_transport.hpp"
#include <iostream>
#include <csignal>
#include <atomic>
#include <thread>
#include <chrono>
#include <cstdlib>

// Global flag for graceful shutdown
static std::atomic<bool> g_running{true};
static std::atomic<uint64_t> g_maxTransitions{0};  // 0 = unlimited
static std::atomic<uint64_t> g_maxTicks{10000000};  // Default: 10 million ticks max
static constexpr auto TICK_DELAY = std::chrono::microseconds(100);  // 100us = 10k ticks/sec max

void signalHandler(int signal) {
    std::cout << "\nReceived signal " << signal << ", shutting down...\n";
    g_running = false;
}

void printStateChange(aeth::StateId from, aeth::StateId to, aeth::TransitionId via) {
    std::cout << "[STATE] " << from << " -> " << to << " (via transition " << via << ")\n";
}

void printOutput(const aeth::Variable& var) {
    std::cout << "[OUTPUT] " << var.name() << " = " << var.value().toString() << "\n";
}

void printError(const std::string& error) {
    std::cerr << "[ERROR] " << error << "\n";
}

void printDebug(const std::string& msg) {
    if (ArgParser::verboseFlag || ArgParser::debugFlag) {
        std::cout << "[DEBUG] " << msg << "\n";
    }
}

int runAutomata(const std::string& automataFile, bool networkMode, const std::string& serverUrl) {
    aeth::AutomataParser parser;
    std::unique_ptr<aeth::Automata> loadedAutomata;
    
    // Create runtime components
    auto clock = std::make_unique<aeth::StdClock>();
    auto random = std::make_unique<aeth::StdRandomSource>();
    auto script = std::make_unique<aeth::LuaScriptEngine>();  // Real Lua!
    
    // Create runtime
    aeth::Runtime runtime(std::move(clock), std::move(random), std::move(script));

    // Protocol run_id used for network messages (server-defined)
    std::atomic<aeth::RunId> protocolRunId{0};
    
    // Connect to server if in network mode
    std::unique_ptr<aeth::WebSocketTransport> transport;
    if (networkMode) {
        std::cout << "Connecting to server: " << serverUrl << "\n";
        transport = std::make_unique<aeth::WebSocketTransport>(serverUrl);

        // Prefer stable identity if provided (e.g., docker env)
        if (const char* envId = std::getenv("DEVICE_ID")) {
            transport->setDeviceId(envId);
            transport->setDeviceName(envId);
        }

        // Non-fatal: transport will keep retrying
        auto connectResult = transport->connect();
        if (connectResult.isError()) {
            std::cerr << "[WARN] Initial connect failed: " << connectResult.error() << "\n";
        }
    }

    // Set callbacks
    aeth::RuntimeCallbacks callbacks;
    callbacks.onStateChange = printStateChange;
    callbacks.onOutputChange = printOutput;
    callbacks.onError = printError;
    callbacks.onDebug = printDebug;
    runtime.setCallbacks(callbacks);
    
    // Set tick rate (10 ticks per second)
    runtime.setMaxTickRate(10);
    
    if (!automataFile.empty()) {
        std::cout << "Loading automata from: " << automataFile << "\n";
        auto result = parser.parseFile(automataFile);
        if (!result.success()) {
            std::cerr << "Failed to parse automata:\n";
            for (const auto& err : result.errors) {
                std::cerr << "  - " << err << "\n";
            }
            return 1;
        }

        for (const auto& warn : result.warnings) {
            std::cout << "[WARN] " << warn << "\n";
        }

        std::cout << "Loaded automata: " << result.automata->config.name << "\n";
        std::cout << "  States: " << result.automata->states.size() << "\n";
        std::cout << "  Transitions: " << result.automata->transitions.size() << "\n";
        std::cout << "  Variables: " << result.automata->variables.size() << "\n";

        loadedAutomata = std::move(result.automata);

        auto loadResult = runtime.load(*loadedAutomata);
        if (loadResult.isError()) {
            std::cerr << "Failed to load automata: " << loadResult.error() << "\n";
            return 1;
        }

        // In detached mode, run_id is purely local; in network mode it will be overridden by server
        protocolRunId = loadResult.value();
        std::cout << "Automata loaded with run ID: " << loadResult.value() << "\n";

        auto startResult = runtime.start();
        if (startResult.isError()) {
            std::cerr << "Failed to start automata: " << startResult.error() << "\n";
            return 1;
        }

        const aeth::State* initialState = loadedAutomata->getState(runtime.currentState());
        std::cout << "Started in state: " << (initialState ? initialState->name : "unknown") << "\n";
    } else {
        if (networkMode) {
            std::cout << "Network mode: waiting for server deploy/start commands...\n";
        }
    }
    
    if (g_maxTransitions > 0) {
        std::cout << "Running for max " << g_maxTransitions << " transitions...\n\n";
    } else {
        std::cout << "Running... (Ctrl+C to stop, max " << g_maxTicks << " ticks)\n\n";
    }
    
    // Replace default callbacks with versions that also emit protocol events
    if (transport) {
        auto* transportPtr = transport.get();

        callbacks.onStateChange = [transportPtr, &protocolRunId](aeth::StateId from, aeth::StateId to, aeth::TransitionId via) {
            printStateChange(from, to, via);
            if (transportPtr && transportPtr->isConnected()) {
                aeth::protocol::StateChangeMessage msg;
                msg.previousState = from;
                msg.newState = to;
                msg.firedTransition = via;
                msg.runId = protocolRunId.load();
                msg.timestamp = std::chrono::duration_cast<std::chrono::milliseconds>(
                                  std::chrono::system_clock::now().time_since_epoch())
                                  .count();
                transportPtr->send(std::make_unique<aeth::protocol::StateChangeMessage>(msg));
            }
        };

        callbacks.onOutputChange = [transportPtr, &protocolRunId](const aeth::Variable& var) {
            printOutput(var);
            if (transportPtr && transportPtr->isConnected()) {
                aeth::protocol::OutputMessage msg;
                msg.runId = protocolRunId.load();
                msg.variableId = 0;
                msg.variableName = var.name();
                msg.value = var.value();
                msg.timestamp = std::chrono::duration_cast<std::chrono::milliseconds>(
                                  std::chrono::system_clock::now().time_since_epoch())
                                  .count();
                transportPtr->send(std::make_unique<aeth::protocol::OutputMessage>(msg));
            }
        };

        runtime.setCallbacks(callbacks);
    }

    auto lastTelemetry = std::chrono::steady_clock::now();
    static constexpr auto TELEMETRY_INTERVAL = std::chrono::seconds(5);

    // Run loop with termination check
    while (g_running && (networkMode || runtime.isRunning())) {
        if (runtime.isRunning()) {
            runtime.tick();
        }
        
        // Check tick limit (safety stop)
        if (runtime.context().tickCount >= g_maxTicks) {
            std::cout << "\nReached max ticks limit (" << g_maxTicks << "). Stopping.\n";
            break;
        }
        
        // Check transition limit (only applies when running)
        if (runtime.isRunning() && g_maxTransitions > 0 && runtime.context().transitionCount >= g_maxTransitions) {
            std::cout << "\nReached max transitions limit (" << g_maxTransitions << ")\n";
            break;
        }
        
        // Check for incoming messages from server
        while (transport && transport->hasMessage()) {
            auto msg = transport->receive();
            if (!msg) break;

            // Target filtering: accept broadcast (0) or our assigned ID (after HelloAck)
            const uint32_t myId = transport->assignedId();
            if (msg->targetId != 0 && myId != 0 && msg->targetId != myId) {
                continue;
            }

            switch (msg->type()) {
                case aeth::protocol::MessageType::HelloAck: {
                    auto* ack = dynamic_cast<aeth::protocol::HelloAckMessage*>(msg.get());
                    if (ack && ack->accepted) {
                        std::cout << "[SERVER] HelloAck accepted, assigned_id=" << ack->assignedId << "\n";
                    }
                    break;
                }
                case aeth::protocol::MessageType::LoadAutomata: {
                    auto* load = dynamic_cast<aeth::protocol::LoadAutomataMessage*>(msg.get());
                    if (!load) break;

                    std::string yaml(reinterpret_cast<const char*>(load->data.data()), load->data.size());
                    auto parseRes = parser.parseString(yaml);

                    aeth::protocol::LoadAckMessage reply;
                    reply.targetId = msg->sourceId;
                    reply.runId = load->runId;

                    if (!parseRes.success()) {
                        reply.success = false;
                        reply.errorMessage = "parse failed";
                        for (const auto& e : parseRes.errors) {
                            reply.warnings.push_back(e);
                        }
                    } else {
                        // Stop current run if any
                        runtime.stop();
                        loadedAutomata = std::move(parseRes.automata);

                        auto lr = runtime.load(*loadedAutomata);
                        if (lr.isError()) {
                            reply.success = false;
                            reply.errorMessage = lr.error();
                        } else {
                            protocolRunId = load->runId;
                            reply.success = true;
                            reply.errorMessage.clear();
                            for (const auto& w : parseRes.warnings) {
                                reply.warnings.push_back(w);
                            }
                            std::cout << "[SERVER] Loaded automata from network (run_id=" << load->runId << ")\n";
                        }
                    }

                    if (transport && transport->isConnected()) {
                        transport->send(std::make_unique<aeth::protocol::LoadAckMessage>(reply));
                    }
                    break;
                }
                case aeth::protocol::MessageType::Start: {
                    auto* start = dynamic_cast<aeth::protocol::StartMessage*>(msg.get());
                    if (!start) break;
                    if (!runtime.isLoaded()) {
                        std::cout << "[SERVER] Start ignored (no automata loaded)\n";
                        break;
                    }
                    if (protocolRunId != 0 && start->runId != 0 && start->runId != protocolRunId.load()) {
                        break;
                    }
                    auto sr = runtime.start();
                    if (sr.isError()) {
                        std::cout << "[SERVER] Start failed: " << sr.error() << "\n";
                    }
                    break;
                }
                case aeth::protocol::MessageType::Stop: {
                    auto* stop = dynamic_cast<aeth::protocol::StopMessage*>(msg.get());
                    if (!stop) break;
                    if (protocolRunId != 0 && stop->runId != 0 && stop->runId != protocolRunId.load()) {
                        break;
                    }
                    runtime.stop();
                    break;
                }
                case aeth::protocol::MessageType::Input: {
                    auto* input = dynamic_cast<aeth::protocol::InputMessage*>(msg.get());
                    if (!input) break;
                    if (protocolRunId != 0 && input->runId != 0 && input->runId != protocolRunId.load()) {
                        break;
                    }
                    auto ir = runtime.setInput(input->variableName, input->value);
                    if (ir.isError()) {
                        std::cout << "[SERVER] setInput failed: " << ir.error() << "\n";
                    }
                    break;
                }
                case aeth::protocol::MessageType::Ping: {
                    auto* ping = dynamic_cast<aeth::protocol::PingMessage*>(msg.get());
                    if (!ping) break;
                    aeth::protocol::PongMessage pong;
                    pong.targetId = msg->sourceId;
                    pong.originalTimestamp = ping->timestamp;
                    pong.responseTimestamp = std::chrono::duration_cast<std::chrono::milliseconds>(
                                              std::chrono::system_clock::now().time_since_epoch())
                                              .count();
                    pong.sequenceNumber = ping->sequenceNumber;
                    if (transport && transport->isConnected()) {
                        transport->send(std::make_unique<aeth::protocol::PongMessage>(pong));
                    }
                    break;
                }
                default:
                    if (ArgParser::debugFlag) {
                        std::cout << "[SERVER] Unhandled message type: " << static_cast<int>(msg->type()) << "\n";
                    }
                    break;
            }
        }

        // Periodic telemetry
        if (transport && transport->isConnected() && runtime.isLoaded()) {
            auto now = std::chrono::steady_clock::now();
            if (now - lastTelemetry >= TELEMETRY_INTERVAL) {
                lastTelemetry = now;

                aeth::protocol::TelemetryMessage t;
                t.runId = protocolRunId.load();
                t.timestamp = std::chrono::duration_cast<std::chrono::milliseconds>(
                                 std::chrono::system_clock::now().time_since_epoch())
                                 .count();
                t.heapFree = 0;
                t.heapTotal = 0;
                t.cpuUsage = 0.0f;
                t.tickRate = 0;
                transport->send(std::make_unique<aeth::protocol::TelemetryMessage>(t));
            }
        }
        
        // Print tick info in debug mode
        if (ArgParser::debugFlag && runtime.isRunning() && runtime.context().tickCount % 100 == 0) {
            std::cout << "[TICK] " << runtime.context().tickCount 
                      << " transitions: " << runtime.context().transitionCount << "\n";
        }
        
        // Small delay to prevent CPU spinning
        std::this_thread::sleep_for(TICK_DELAY);
    }
    
    // Stop and print summary
    runtime.stop();
    
    if (transport) {
        transport->disconnect();
    }
    
    std::cout << "\n=== Execution Summary ===\n";
    std::cout << "Total ticks: " << runtime.context().tickCount << "\n";
    std::cout << "Total transitions: " << runtime.context().transitionCount << "\n";
    std::cout << "Errors: " << runtime.context().errorCount << "\n";
    
    return 0;
}

int main(const int argc, char* argv[]) {
    // Setup signal handlers
    std::signal(SIGINT, signalHandler);
    std::signal(SIGTERM, signalHandler);
    
    // Parse arguments
    if (!ArgParser::parse(argc, argv)) {
        return 1;
    }
    
    // Handle help/version flags (already handled in parse)
    if (ArgParser::helpFlag || ArgParser::versionFlag) {
        return 0;
    }
    
    // Validate mode
    if (ArgParser::validateAutomataFlag) {
        if (ArgParser::automataFile.empty()) {
            std::cerr << "Error: No automata file specified\n";
            return 1;
        }
        
        // Use old validator for compatibility
        if (AutomataValidator::validate(ArgParser::automataFile)) {
            std::cout << "Automata is valid.\n";
            return 0;
        } else {
            std::cout << "Automata is invalid.\n";
            return 1;
        }
    }
    
    // Run mode
    if (ArgParser::runFlag) {
        bool networkMode = (ArgParser::mode == EngineMode::network);
        if (ArgParser::automataFile.empty() && !networkMode) {
            std::cerr << "Error: No automata file specified\n";
            return 1;
        }
        
        // Set max transitions and ticks if specified
        g_maxTransitions = ArgParser::maxTransitions;
        if (ArgParser::maxTicks > 0) {
            g_maxTicks = ArgParser::maxTicks;
        }
        
        // Determine server URL
        std::string serverUrl = "ws://localhost:4000/socket/device/websocket";
        if (!ArgParser::serverUrl.empty()) {
            serverUrl = ArgParser::serverUrl;
        }

        return runAutomata(ArgParser::automataFile, networkMode, serverUrl);
    }
    
    // No action specified
    std::cerr << "Error: No action specified. Use --run <file> or --validate <file>\n";
    ArgParser::printHelp();
    return 1;
}
