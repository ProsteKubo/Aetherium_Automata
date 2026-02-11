/**
 * Aetherium Automata Engine - Main Entry Point
 */

#include "argparser.hpp"
#include "automata_validator.hpp"
#include "core/engine.hpp"
#include "core/websocket_transport.hpp"

#include <atomic>
#include <chrono>
#include <csignal>
#include <cstdlib>
#include <iostream>
#include <thread>

using namespace std::chrono_literals;

static std::atomic<bool> g_running{true};
static std::atomic<uint64_t> g_maxTransitions{0};
static std::atomic<uint64_t> g_maxTicks{10000000};
static constexpr auto TICK_DELAY = std::chrono::microseconds(100);

void signalHandler(int signal) {
    std::cout << "\nReceived signal " << signal << ", shutting down...\n";
    g_running = false;
}

bool shouldPrintLog(const aeth::LogEvent& event) {
    if (ArgParser::debugFlag) return true;
    if (ArgParser::verboseFlag && event.level >= aeth::LogLevel::Debug) return true;
    return event.level >= aeth::LogLevel::Info;
}

const char* levelName(aeth::LogLevel level) {
    switch (level) {
        case aeth::LogLevel::Trace: return "TRACE";
        case aeth::LogLevel::Debug: return "DEBUG";
        case aeth::LogLevel::Info: return "INFO";
        case aeth::LogLevel::Warn: return "WARN";
        case aeth::LogLevel::Error: return "ERROR";
        default: return "INFO";
    }
}

aeth::protocol::DebugLevel toDebugLevel(aeth::LogLevel level) {
    switch (level) {
        case aeth::LogLevel::Trace:
        case aeth::LogLevel::Debug:
            return aeth::protocol::DebugLevel::Debug;
        case aeth::LogLevel::Info:
            return aeth::protocol::DebugLevel::Info;
        case aeth::LogLevel::Warn:
            return aeth::protocol::DebugLevel::Warn;
        case aeth::LogLevel::Error:
            return aeth::protocol::DebugLevel::Error;
        default:
            return aeth::protocol::DebugLevel::Info;
    }
}

bool isControlPlaneCommand(aeth::protocol::MessageType type) {
    using aeth::protocol::MessageType;
    switch (type) {
        case MessageType::LoadAutomata:
        case MessageType::Start:
        case MessageType::Stop:
        case MessageType::Pause:
        case MessageType::Resume:
        case MessageType::Reset:
        case MessageType::Status:
        case MessageType::Input:
        case MessageType::Variable:
            return true;
        default:
            return false;
    }
}

std::string serverUrlFromArgs() {
    if (!ArgParser::serverUrl.empty()) {
        return ArgParser::serverUrl;
    }
    return "ws://localhost:4000/socket/device/websocket";
}

int runAutomata(const std::string& automataFile, bool networkMode, const std::string& serverUrl) {
    aeth::Engine engine;
    std::unique_ptr<aeth::WebSocketTransport> transport;

    aeth::EngineInitOptions initOptions;
    initOptions.maxTickRate = 10;
    initOptions.logCapacity = 4096;
    if (const char* envId = std::getenv("DEVICE_ID")) {
        initOptions.deviceName = envId;
    }

    auto initResult = engine.initialize(initOptions);
    if (initResult.isError()) {
        std::cerr << "Failed to initialize engine: " << initResult.error() << "\n";
        return 1;
    }

    engine.streamLogs([&transport](const aeth::LogEvent& event) {
        if (!shouldPrintLog(event)) {
            return;
        }
        std::cout << "[" << levelName(event.level) << "] "
                  << event.category << ": " << event.message;
        if (event.variableName) {
            std::cout << " (" << *event.variableName;
            if (event.value) {
                std::cout << "=" << event.value->toString();
            }
            std::cout << ")";
        }
        std::cout << "\n";

        if (transport && transport->isConnected()) {
            aeth::protocol::DebugMessage msg;
            msg.level = toDebugLevel(event.level);
            msg.source = event.category;
            msg.message = event.message;
            msg.timestamp = event.timestamp;
            transport->send(std::make_unique<aeth::protocol::DebugMessage>(msg));
        }
    });

    if (networkMode) {
        std::cout << "Connecting to server: " << serverUrl << "\n";
        transport = std::make_unique<aeth::WebSocketTransport>(serverUrl);
        transport->setDeviceName(initOptions.deviceName);
        auto result = transport->connect();
        if (result.isError()) {
            std::cerr << "[WARN] Initial connect failed: " << result.error() << "\n";
        }
    }

    if (!automataFile.empty()) {
        std::cout << "Loading automata from: " << automataFile << "\n";
        auto load = engine.loadAutomataFromFile(
            automataFile,
            aeth::protocolv2::LoadReplaceMode::HardReset,
            true
        );
        if (load.isError()) {
            std::cerr << "Failed to load automata: " << load.error() << "\n";
            return 1;
        }
        std::cout << "Loaded and started automata (run_id=" << load.value() << ")\n";
    } else if (networkMode) {
        std::cout << "Network mode: waiting for load/start commands...\n";
    }

    auto lastTelemetry = std::chrono::steady_clock::now();
    static constexpr auto TELEMETRY_INTERVAL = std::chrono::seconds(5);
    while (g_running && (networkMode || engine.isRunning())) {
        bool sawControlCommand = false;

        while (transport && transport->hasMessage()) {
            auto message = transport->receive();
            if (!message) {
                break;
            }

            const uint32_t myId = transport->assignedId();
            if (message->targetId != 0 && myId != 0 && message->targetId != myId) {
                continue;
            }

            if (isControlPlaneCommand(message->type())) {
                sawControlCommand = true;
            }

            engine.enqueueCommand(std::move(message));
        }

        // Prioritize control commands before executing another runtime tick.
        auto replies = engine.processCommandQueue();
        for (auto& reply : replies) {
            if (!reply) {
                continue;
            }
            if (transport && transport->isConnected()) {
                transport->send(std::move(reply));
            } else if (ArgParser::debugFlag) {
                std::cout << "[OUT] message type=" << static_cast<int>(reply->type()) << "\n";
            }
        }

        if (sawControlCommand) {
            std::this_thread::sleep_for(TICK_DELAY);
            continue;
        }

        if (engine.isRunning()) {
            engine.tick();
        }

        auto status = engine.status();
        if (status.tickCount >= g_maxTicks) {
            std::cout << "\nReached max ticks limit (" << g_maxTicks << "). Stopping.\n";
            break;
        }
        if (g_maxTransitions > 0 && status.transitionCount >= g_maxTransitions) {
            std::cout << "\nReached max transitions limit (" << g_maxTransitions << "). Stopping.\n";
            break;
        }

        if (transport && transport->isConnected() && engine.isLoaded()) {
            auto now = std::chrono::steady_clock::now();
            if (now - lastTelemetry >= TELEMETRY_INTERVAL) {
                lastTelemetry = now;

                aeth::protocol::TelemetryMessage telemetry;
                telemetry.runId = engine.activeRunId();
                telemetry.timestamp = static_cast<aeth::Timestamp>(
                    std::chrono::duration_cast<std::chrono::milliseconds>(
                        std::chrono::system_clock::now().time_since_epoch()).count());
                telemetry.heapFree = 0;
                telemetry.heapTotal = 0;
                telemetry.cpuUsage = 0.0f;
                telemetry.tickRate = 0;
                transport->send(std::make_unique<aeth::protocol::TelemetryMessage>(telemetry));
            }
        }

        std::this_thread::sleep_for(TICK_DELAY);
    }

    if (engine.isRunning() || engine.status().executionState == aeth::ExecutionState::Paused) {
        engine.stop();
    }

    if (transport) {
        transport->disconnect();
    }

    auto finalStatus = engine.status();
    std::cout << "\n=== Execution Summary ===\n";
    std::cout << "Run ID: " << finalStatus.runId << "\n";
    std::cout << "Total ticks: " << finalStatus.tickCount << "\n";
    std::cout << "Total transitions: " << finalStatus.transitionCount << "\n";
    std::cout << "Errors: " << finalStatus.errorCount << "\n";

    return 0;
}

int main(int argc, char* argv[]) {
    std::signal(SIGINT, signalHandler);
    std::signal(SIGTERM, signalHandler);

    if (!ArgParser::parse(argc, argv)) {
        return 1;
    }

    if (ArgParser::helpFlag || ArgParser::versionFlag) {
        return 0;
    }

    if (ArgParser::validateAutomataFlag) {
        if (ArgParser::automataFile.empty()) {
            std::cerr << "Error: No automata file specified\n";
            return 1;
        }

        if (AutomataValidator::validate(ArgParser::automataFile)) {
            std::cout << "Automata is valid.\n";
            return 0;
        }
        std::cout << "Automata is invalid.\n";
        return 1;
    }

    g_maxTransitions = ArgParser::maxTransitions;
    if (ArgParser::maxTicks > 0) {
        g_maxTicks = ArgParser::maxTicks;
    }

    const bool networkMode = (ArgParser::mode == EngineMode::network);

    if (ArgParser::runFlag) {
        if (ArgParser::automataFile.empty() && !networkMode) {
            std::cerr << "Error: No automata file specified\n";
            return 1;
        }
        return runAutomata(ArgParser::automataFile, networkMode, serverUrlFromArgs());
    }

    if (networkMode) {
        return runAutomata("", true, serverUrlFromArgs());
    }

    std::cerr << "Error: No action specified. Use --run <file>, --validate <file>, or --mode network\n";
    ArgParser::printHelp();
    return 1;
}
