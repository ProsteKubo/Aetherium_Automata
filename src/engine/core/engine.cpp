#include "engine.hpp"

#include <chrono>
#include <unordered_map>

namespace aeth {

namespace {

Timestamp wallClockMs() {
    const auto now = std::chrono::system_clock::now().time_since_epoch();
    return static_cast<Timestamp>(std::chrono::duration_cast<std::chrono::milliseconds>(now).count());
}

uint16_t toReasonCode(protocol::ErrorCode code) {
    return static_cast<uint16_t>(code);
}

} // namespace

Engine::Engine()
    : runtime_(std::make_unique<StdClock>(),
               std::make_unique<StdRandomSource>(),
               std::make_unique<LuaScriptEngine>())
    , logHub_(2048) {
    registerCommandHandlers();
    configureRuntimeCallbacks();
}

Result<void> Engine::initialize(const EngineInitOptions& options) {
    runtime_.setMaxTickRate(options.maxTickRate);
    logHub_.setCapacity(options.logCapacity);
    deviceId_ = options.deviceId;
    deviceName_ = options.deviceName;
    return Result<void>::ok();
}

Result<RunId> Engine::loadAutomataFromFile(const std::string& filePath,
                                           protocolv2::LoadReplaceMode mode,
                                           bool startAfterLoad,
                                           std::optional<RunId> requestedRunId) {
    auto loaded = loader_.loadFromFile(filePath);
    if (loaded.isError()) {
        return Result<RunId>::error(loaded.error());
    }
    for (const auto& warn : loaded.value().warnings) {
        logHub_.log(LogLevel::Warn, "loader", warn);
    }
    return applyLoadedAutomata(std::move(loaded.value().automata), mode, startAfterLoad, requestedRunId);
}

Result<RunId> Engine::loadAutomataFromYaml(const std::string& yaml,
                                           const std::string& basePath,
                                           protocolv2::LoadReplaceMode mode,
                                           bool startAfterLoad,
                                           std::optional<RunId> requestedRunId) {
    auto loaded = loader_.loadFromString(yaml, basePath);
    if (loaded.isError()) {
        return Result<RunId>::error(loaded.error());
    }
    for (const auto& warn : loaded.value().warnings) {
        logHub_.log(LogLevel::Warn, "loader", warn);
    }
    return applyLoadedAutomata(std::move(loaded.value().automata), mode, startAfterLoad, requestedRunId);
}

Result<RunId> Engine::applyLoadedAutomata(std::unique_ptr<Automata> automata,
                                          protocolv2::LoadReplaceMode mode,
                                          bool startAfterLoad,
                                          std::optional<RunId> requestedRunId) {
    std::unordered_map<std::string, std::pair<VariableSpec, Value>> oldValues;

    if (mode == protocolv2::LoadReplaceMode::CarryOverCompatible && runtime_.isLoaded() && loadedAutomata_) {
        for (const auto& spec : loadedAutomata_->variables) {
            auto value = runtime_.context().variables.getValue(spec.name);
            if (!value) {
                continue;
            }
            oldValues[spec.name] = std::make_pair(spec, *value);
        }
    }

    if (runtime_.state() == ExecutionState::Running || runtime_.state() == ExecutionState::Paused) {
        runtime_.stop();
    }

    loadedAutomata_ = std::move(automata);
    auto loadResult = runtime_.load(*loadedAutomata_);
    if (loadResult.isError()) {
        return Result<RunId>::error(loadResult.error());
    }

    RunId runId = requestedRunId.value_or(loadResult.value());
    activeRunId_ = runId;

    if (!oldValues.empty()) {
        for (const auto& spec : loadedAutomata_->variables) {
            auto it = oldValues.find(spec.name);
            if (it == oldValues.end()) {
                continue;
            }
            const auto& previousSpec = it->second.first;
            const auto& previousValue = it->second.second;
            if (previousSpec.type != spec.type || previousSpec.direction != spec.direction) {
                continue;
            }

            if (spec.direction == VariableDirection::Input) {
                runtime_.setInput(spec.name, previousValue);
            } else {
                runtime_.setVariable(spec.name, previousValue);
            }
        }
    }

    if (startAfterLoad) {
        auto startResult = runtime_.start();
        if (startResult.isError()) {
            return Result<RunId>::error(startResult.error());
        }
    }

    logHub_.event(EventKind::Lifecycle, LogLevel::Info, "engine", "automata loaded", runId);
    return Result<RunId>::ok(runId);
}

Result<void> Engine::start(std::optional<StateId> from) {
    return runtime_.start(from);
}

Result<void> Engine::stop() {
    return runtime_.stop();
}

Result<void> Engine::pause() {
    return runtime_.pause();
}

Result<void> Engine::resume() {
    return runtime_.resume();
}

Result<void> Engine::reset() {
    return runtime_.reset();
}

Result<void> Engine::setInput(const std::string& name, Value value) {
    return runtime_.setInput(name, std::move(value));
}

Result<void> Engine::setInput(VariableId id, Value value) {
    return runtime_.setInput(id, std::move(value));
}

Result<void> Engine::setVariable(const std::string& name, Value value) {
    return runtime_.setVariable(name, std::move(value));
}

Result<void> Engine::setVariable(VariableId id, Value value) {
    return runtime_.setVariable(id, std::move(value));
}

EngineStatus Engine::status() const {
    EngineStatus s;
    s.runId = activeRunId_;
    s.executionState = runtime_.state();
    s.currentState = runtime_.currentState();
    s.tickCount = runtime_.context().tickCount;
    s.transitionCount = runtime_.context().transitionCount;
    s.errorCount = runtime_.context().errorCount;
    if (runtime_.context().startTime > 0 && runtime_.context().lastTickTime >= runtime_.context().startTime) {
        s.uptime = runtime_.context().lastTickTime - runtime_.context().startTime;
    }
    return s;
}

std::vector<LogEvent> Engine::getLogs(const LogQuery& query) const {
    return logHub_.snapshot(query);
}

void Engine::streamLogs(EventStreamCallback callback) {
    logHub_.stream(std::move(callback));
}

void Engine::tick() {
    runtime_.tick();
}

void Engine::enqueueCommand(std::unique_ptr<protocol::Message> message) {
    if (!message) {
        return;
    }
    ingressQueue_.push_back(std::move(message));
}

Engine::Replies Engine::processCommandQueue() {
    Replies replies;

    while (!ingressQueue_.empty()) {
        auto msg = std::move(ingressQueue_.front());
        ingressQueue_.pop_front();
        if (!msg) {
            continue;
        }

        auto routed = dispatch(*msg);
        for (auto& reply : routed) {
            if (reply) replies.push_back(std::move(reply));
        }
    }

    while (!eventQueue_.empty()) {
        auto evt = std::move(eventQueue_.front());
        eventQueue_.pop_front();
        if (evt) replies.push_back(std::move(evt));
    }

    return replies;
}

Engine::Replies Engine::dispatch(const protocol::Message& message) {
    return commandBus_.route(*this, message);
}

void Engine::configureRuntimeCallbacks() {
    RuntimeCallbacks callbacks;

    callbacks.onStateChange = [this](StateId from, StateId to, TransitionId via) {
        logHub_.stateChange(from, to, via, activeRunId_);

        protocol::StateChangeMessage msg;
        msg.runId = activeRunId_;
        msg.previousState = from;
        msg.newState = to;
        msg.firedTransition = via;
        msg.timestamp = wallClockMs();
        eventQueue_.push_back(std::make_unique<protocol::StateChangeMessage>(msg));

        protocol::TransitionFiredMessage tf;
        tf.runId = activeRunId_;
        tf.transitionId = via;
        tf.timestamp = wallClockMs();
        eventQueue_.push_back(std::make_unique<protocol::TransitionFiredMessage>(tf));
    };

    callbacks.onOutputChange = [this](const Variable& var) {
        logHub_.outputChange(var.name(), var.value(), activeRunId_);

        protocol::OutputMessage msg;
        msg.runId = activeRunId_;
        msg.variableId = var.id();
        msg.variableName = var.name();
        msg.value = var.value();
        msg.timestamp = wallClockMs();
        eventQueue_.push_back(std::make_unique<protocol::OutputMessage>(msg));
    };

    callbacks.onError = [this](const std::string& error) {
        logHub_.event(EventKind::Error, LogLevel::Error, "runtime", error, activeRunId_);

        protocol::ErrorMessage msg;
        msg.code = protocol::ErrorCode::Unknown;
        msg.message = error;
        msg.runId = activeRunId_;
        eventQueue_.push_back(std::make_unique<protocol::ErrorMessage>(msg));
    };

    callbacks.onDebug = [this](const std::string& debug) {
        logHub_.log(LogLevel::Debug, "runtime", debug, activeRunId_);

        protocol::DebugMessage msg;
        msg.level = protocol::DebugLevel::Debug;
        msg.source = "runtime";
        msg.message = debug;
        msg.timestamp = wallClockMs();
        eventQueue_.push_back(std::make_unique<protocol::DebugMessage>(msg));
    };

    runtime_.setCallbacks(std::move(callbacks));
}

Engine::Replies Engine::ackWithStatus(const protocol::Message& request, const std::string& info) {
    Replies replies;

    protocol::AckMessage ack;
    ack.targetId = request.sourceId;
    ack.relatedMessageId = request.messageId;
    ack.info = info;
    replies.push_back(std::make_unique<protocol::AckMessage>(ack));

    replies.push_back(buildStatusMessage(request.sourceId));
    return replies;
}

Engine::Replies Engine::nakWithStatus(const protocol::Message& request,
                                      uint16_t reasonCode,
                                      const std::string& reason) {
    Replies replies;

    protocol::NakMessage nak;
    nak.targetId = request.sourceId;
    nak.relatedMessageId = request.messageId;
    nak.reasonCode = reasonCode;
    nak.reason = reason;
    replies.push_back(std::make_unique<protocol::NakMessage>(nak));

    replies.push_back(buildStatusMessage(request.sourceId));
    return replies;
}

std::unique_ptr<protocol::StatusMessage> Engine::buildStatusMessage(DeviceId target) const {
    auto statusMsg = std::make_unique<protocol::StatusMessage>();
    statusMsg->targetId = target;
    statusMsg->runId = activeRunId_;
    statusMsg->executionState = runtime_.state();
    statusMsg->currentState = runtime_.currentState();
    statusMsg->transitionCount = runtime_.context().transitionCount;
    statusMsg->tickCount = runtime_.context().tickCount;
    statusMsg->errorCount = runtime_.context().errorCount;
    statusMsg->uptime = status().uptime;
    return statusMsg;
}

bool Engine::runIdMatches(const protocol::Message& message) const {
    const auto runId = extractRunId(message);
    if (!runId || *runId == 0 || activeRunId_ == 0) {
        return true;
    }
    return *runId == activeRunId_.load();
}

std::optional<RunId> Engine::extractRunId(const protocol::Message& message) {
    if (auto* load = dynamic_cast<const protocol::LoadAutomataMessage*>(&message)) return load->runId;
    if (auto* loadAck = dynamic_cast<const protocol::LoadAckMessage*>(&message)) return loadAck->runId;
    if (auto* start = dynamic_cast<const protocol::StartMessage*>(&message)) return start->runId;
    if (auto* stop = dynamic_cast<const protocol::StopMessage*>(&message)) return stop->runId;
    if (auto* reset = dynamic_cast<const protocol::ResetMessage*>(&message)) return reset->runId;
    if (auto* status = dynamic_cast<const protocol::StatusMessage*>(&message)) return status->runId;
    if (auto* pause = dynamic_cast<const protocol::PauseMessage*>(&message)) return pause->runId;
    if (auto* resume = dynamic_cast<const protocol::ResumeMessage*>(&message)) return resume->runId;
    if (auto* input = dynamic_cast<const protocol::InputMessage*>(&message)) return input->runId;
    if (auto* output = dynamic_cast<const protocol::OutputMessage*>(&message)) return output->runId;
    if (auto* variable = dynamic_cast<const protocol::VariableMessage*>(&message)) return variable->runId;
    if (auto* state = dynamic_cast<const protocol::StateChangeMessage*>(&message)) return state->runId;
    if (auto* telemetry = dynamic_cast<const protocol::TelemetryMessage*>(&message)) return telemetry->runId;
    if (auto* fired = dynamic_cast<const protocol::TransitionFiredMessage*>(&message)) return fired->runId;
    return std::nullopt;
}

void Engine::registerCommandHandlers() {
    commandBus_.setDefaultHandler([](Engine& engine, const protocol::Message& request) {
        return engine.nakWithStatus(request, toReasonCode(protocol::ErrorCode::InvalidMessage), "unsupported command");
    });

    commandBus_.registerHandler(protocol::MessageType::Hello, [](Engine& engine, const protocol::Message& request) {
        protocol::HelloAckMessage ack;
        ack.targetId = request.sourceId;
        ack.assignedId = engine.deviceId();
        ack.serverTime = wallClockMs();
        ack.accepted = true;
        Engine::Replies replies;
        replies.push_back(std::make_unique<protocol::HelloAckMessage>(ack));
        replies.push_back(engine.buildStatusMessage(request.sourceId));
        return replies;
    });

    commandBus_.registerHandler(protocol::MessageType::HelloAck, [](Engine& engine, const protocol::Message& request) {
        return engine.ackWithStatus(request, "hello_ack_received");
    });

    commandBus_.registerHandler(protocol::MessageType::Discover, [](Engine& engine, const protocol::Message& request) {
        return engine.ackWithStatus(request, "discover_ack");
    });

    commandBus_.registerHandler(protocol::MessageType::Ping, [](Engine& engine, const protocol::Message& request) {
        protocol::PongMessage pong;
        pong.targetId = request.sourceId;
        if (auto* ping = dynamic_cast<const protocol::PingMessage*>(&request)) {
            pong.originalTimestamp = ping->timestamp;
            pong.sequenceNumber = ping->sequenceNumber;
        }
        pong.responseTimestamp = wallClockMs();
        Engine::Replies replies;
        replies.push_back(std::make_unique<protocol::PongMessage>(pong));
        replies.push_back(engine.buildStatusMessage(request.sourceId));
        return replies;
    });

    commandBus_.registerHandler(protocol::MessageType::Pong, [](Engine& engine, const protocol::Message& request) {
        return engine.ackWithStatus(request, "pong_received");
    });

    commandBus_.registerHandler(protocol::MessageType::Provision, [](Engine& engine, const protocol::Message& request) {
        return engine.ackWithStatus(request, "provision_ack");
    });

    commandBus_.registerHandler(protocol::MessageType::Goodbye, [](Engine& engine, const protocol::Message& request) {
        if (engine.runtime_.state() == ExecutionState::Running || engine.runtime_.state() == ExecutionState::Paused) {
            engine.runtime_.stop();
        }
        return engine.ackWithStatus(request, "goodbye_ack");
    });

    commandBus_.registerHandler(protocol::MessageType::LoadAutomata, [](Engine& engine, const protocol::Message& request) {
        auto* load = dynamic_cast<const protocol::LoadAutomataMessage*>(&request);
        if (!load) {
            return engine.nakWithStatus(request, toReasonCode(protocol::ErrorCode::InvalidMessage), "load payload mismatch");
        }

        protocol::LoadAckMessage loadAck;
        loadAck.targetId = request.sourceId;
        loadAck.runId = load->runId;

        if (load->format != protocol::AutomataFormat::YAML) {
            loadAck.success = false;
            loadAck.errorMessage = "only YAML automata format is implemented";
            Engine::Replies replies;
            replies.push_back(std::make_unique<protocol::LoadAckMessage>(loadAck));
            replies.push_back(engine.buildStatusMessage(request.sourceId));
            return replies;
        }

        const std::string yaml(reinterpret_cast<const char*>(load->data.data()), load->data.size());
        const auto mode = load->replaceExisting
            ? protocolv2::LoadReplaceMode::HardReset
            : protocolv2::LoadReplaceMode::CarryOverCompatible;

        auto result = engine.loadAutomataFromYaml(yaml, ".", mode, load->startAfterLoad, load->runId);
        if (result.isError()) {
            loadAck.success = false;
            loadAck.errorMessage = result.error();
        } else {
            loadAck.success = true;
            loadAck.errorMessage.clear();
        }

        Engine::Replies replies;
        replies.push_back(std::make_unique<protocol::LoadAckMessage>(loadAck));
        replies.push_back(engine.buildStatusMessage(request.sourceId));
        return replies;
    });

    commandBus_.registerHandler(protocol::MessageType::LoadAck, [](Engine& engine, const protocol::Message& request) {
        return engine.ackWithStatus(request, "load_ack_received");
    });

    commandBus_.registerHandler(protocol::MessageType::Start, [](Engine& engine, const protocol::Message& request) {
        if (!engine.runIdMatches(request)) {
            engine.logHub_.log(LogLevel::Warn, "command",
                               "start requested with stale run_id; applying to active run");
        }
        if (!engine.isLoaded()) {
            return engine.nakWithStatus(request, toReasonCode(protocol::ErrorCode::NotLoaded), "no automata loaded");
        }
        if (engine.runtime_.state() == ExecutionState::Running) {
            return engine.ackWithStatus(request, "already_running");
        }

        std::optional<StateId> from;
        if (const auto* start = dynamic_cast<const protocol::StartMessage*>(&request)) {
            from = start->startFromState;
        }

        auto result = engine.start(from);
        if (result.isError()) {
            return engine.nakWithStatus(request, toReasonCode(protocol::ErrorCode::InvalidState), result.error());
        }
        return engine.ackWithStatus(request, "started");
    });

    commandBus_.registerHandler(protocol::MessageType::Stop, [](Engine& engine, const protocol::Message& request) {
        if (!engine.runIdMatches(request)) {
            engine.logHub_.log(LogLevel::Warn, "command",
                               "stop requested with stale run_id; applying to active run");
        }
        if (!engine.isLoaded() || engine.runtime_.state() == ExecutionState::Stopped) {
            return engine.ackWithStatus(request, "already_stopped");
        }

        auto result = engine.stop();
        if (result.isError()) {
            return engine.nakWithStatus(request, toReasonCode(protocol::ErrorCode::NotRunning), result.error());
        }
        return engine.ackWithStatus(request, "stopped");
    });

    commandBus_.registerHandler(protocol::MessageType::Reset, [](Engine& engine, const protocol::Message& request) {
        if (!engine.isLoaded()) {
            return engine.nakWithStatus(request, toReasonCode(protocol::ErrorCode::NotLoaded), "no automata loaded");
        }
        auto result = engine.reset();
        if (result.isError()) {
            return engine.nakWithStatus(request, toReasonCode(protocol::ErrorCode::InvalidState), result.error());
        }
        return engine.ackWithStatus(request, "reset");
    });

    commandBus_.registerHandler(protocol::MessageType::Status, [](Engine& engine, const protocol::Message& request) {
        Engine::Replies replies;
        replies.push_back(engine.buildStatusMessage(request.sourceId));
        return replies;
    });

    commandBus_.registerHandler(protocol::MessageType::Pause, [](Engine& engine, const protocol::Message& request) {
        if (!engine.isLoaded()) {
            return engine.nakWithStatus(request, toReasonCode(protocol::ErrorCode::NotLoaded), "no automata loaded");
        }
        if (engine.runtime_.state() == ExecutionState::Paused) {
            return engine.ackWithStatus(request, "already_paused");
        }
        auto result = engine.pause();
        if (result.isError()) {
            return engine.nakWithStatus(request, toReasonCode(protocol::ErrorCode::NotRunning), result.error());
        }
        return engine.ackWithStatus(request, "paused");
    });

    commandBus_.registerHandler(protocol::MessageType::Resume, [](Engine& engine, const protocol::Message& request) {
        if (!engine.isLoaded()) {
            return engine.nakWithStatus(request, toReasonCode(protocol::ErrorCode::NotLoaded), "no automata loaded");
        }
        if (engine.runtime_.state() == ExecutionState::Running) {
            return engine.ackWithStatus(request, "already_running");
        }
        auto result = engine.resume();
        if (result.isError()) {
            return engine.nakWithStatus(request, toReasonCode(protocol::ErrorCode::InvalidState), result.error());
        }
        return engine.ackWithStatus(request, "resumed");
    });

    commandBus_.registerHandler(protocol::MessageType::Input, [](Engine& engine, const protocol::Message& request) {
        if (!engine.runIdMatches(request)) {
            engine.logHub_.log(LogLevel::Warn, "command",
                               "input requested with stale run_id; applying to active run");
        }
        auto* input = dynamic_cast<const protocol::InputMessage*>(&request);
        if (!input) {
            return engine.nakWithStatus(request, toReasonCode(protocol::ErrorCode::InvalidMessage), "input payload mismatch");
        }
        Result<void> result = input->variableName.empty()
            ? engine.setInput(input->variableId, input->value)
            : engine.setInput(input->variableName, input->value);
        if (result.isError()) {
            return engine.nakWithStatus(request, toReasonCode(protocol::ErrorCode::InvalidVariable), result.error());
        }
        return engine.ackWithStatus(request, "input_set");
    });

    commandBus_.registerHandler(protocol::MessageType::Output, [](Engine& engine, const protocol::Message& request) {
        return engine.ackWithStatus(request, "output_received");
    });

    commandBus_.registerHandler(protocol::MessageType::Variable, [](Engine& engine, const protocol::Message& request) {
        if (!engine.runIdMatches(request)) {
            engine.logHub_.log(LogLevel::Warn, "command",
                               "variable requested with stale run_id; applying to active run");
        }
        auto* variable = dynamic_cast<const protocol::VariableMessage*>(&request);
        if (!variable) {
            return engine.nakWithStatus(request, toReasonCode(protocol::ErrorCode::InvalidMessage), "variable payload mismatch");
        }
        Result<void> result = variable->variableName.empty()
            ? engine.setVariable(variable->variableId, variable->value)
            : engine.setVariable(variable->variableName, variable->value);
        if (result.isError()) {
            return engine.nakWithStatus(request, toReasonCode(protocol::ErrorCode::InvalidVariable), result.error());
        }
        return engine.ackWithStatus(request, "variable_set");
    });

    commandBus_.registerHandler(protocol::MessageType::StateChange, [](Engine& engine, const protocol::Message& request) {
        return engine.ackWithStatus(request, "state_change_received");
    });

    commandBus_.registerHandler(protocol::MessageType::Telemetry, [](Engine& engine, const protocol::Message& request) {
        return engine.ackWithStatus(request, "telemetry_received");
    });

    commandBus_.registerHandler(protocol::MessageType::TransitionFired, [](Engine& engine, const protocol::Message& request) {
        return engine.ackWithStatus(request, "transition_received");
    });

    commandBus_.registerHandler(protocol::MessageType::Vendor, [](Engine& engine, const protocol::Message& request) {
        return engine.ackWithStatus(request, "vendor_received");
    });

    commandBus_.registerHandler(protocol::MessageType::Debug, [](Engine& engine, const protocol::Message& request) {
        if (const auto* debug = dynamic_cast<const protocol::DebugMessage*>(&request)) {
            engine.logHub_.log(LogLevel::Debug, debug->source.empty() ? "remote" : debug->source, debug->message);
        }
        return engine.ackWithStatus(request, "debug_received");
    });

    commandBus_.registerHandler(protocol::MessageType::Error, [](Engine& engine, const protocol::Message& request) {
        if (const auto* error = dynamic_cast<const protocol::ErrorMessage*>(&request)) {
            engine.logHub_.event(EventKind::Error, LogLevel::Error, "remote", error->message, error->runId);
        }
        return engine.ackWithStatus(request, "error_received");
    });

    commandBus_.registerHandler(protocol::MessageType::Ack, [](Engine&, const protocol::Message&) {
        return Engine::Replies{};
    });

    commandBus_.registerHandler(protocol::MessageType::Nak, [](Engine&, const protocol::Message&) {
        return Engine::Replies{};
    });
}

} // namespace aeth
