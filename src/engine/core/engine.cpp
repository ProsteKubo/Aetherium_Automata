#include "engine.hpp"
#include "script_engine.hpp"

#if !defined(AETHERIUM_RUNTIME_CORE_ONLY)
#include "automata_loader.hpp"
#endif

#if !defined(AETHERIUM_DISABLE_LUA_SCRIPT_ENGINE)
#include "lua_engine.hpp"
#endif

#ifdef abs
#undef abs
#endif

#include <chrono>
#include <sstream>
#include <unordered_map>
#include <unordered_set>

namespace aeth {

#if !defined(AETHERIUM_RUNTIME_CORE_ONLY)
struct EngineFrontendLoaderHandle {
    AutomataLoader loader;
};
#else
struct EngineFrontendLoaderHandle {};
#endif

namespace {

Timestamp wallClockMs() {
    const auto now = std::chrono::system_clock::now().time_since_epoch();
    return static_cast<Timestamp>(std::chrono::duration_cast<std::chrono::milliseconds>(now).count());
}

uint16_t toReasonCode(protocol::ErrorCode code) {
    return static_cast<uint16_t>(code);
}

std::string joinErrors(const std::vector<std::string>& errors) {
    std::ostringstream oss;
    for (size_t i = 0; i < errors.size(); ++i) {
        if (i > 0) {
            oss << "; ";
        }
        oss << errors[i];
    }
    return oss.str();
}

Result<std::unique_ptr<Automata>> automataFromEngineBytecode(const ir::EngineBytecodeProgram& program) {
    auto automata = std::make_unique<Automata>();
    automata->config.name = program.name;
    automata->initialState = program.initialState;

    std::unordered_set<StateId> stateIds;
    stateIds.reserve(program.states.size());

    for (const auto& s : program.states) {
        if (s.id == INVALID_STATE) {
            return Result<std::unique_ptr<Automata>>::error("bytecode state has invalid id");
        }
        if (s.name.empty()) {
            return Result<std::unique_ptr<Automata>>::error("bytecode state name cannot be empty");
        }
        if (!stateIds.insert(s.id).second) {
            return Result<std::unique_ptr<Automata>>::error("duplicate bytecode state id");
        }
        State state{s.id, s.name};
        state.onEnter.source = s.onEnterSource;
        state.body.source = s.bodySource;
        state.onExit.source = s.onExitSource;
        automata->addState(std::move(state));
    }

    std::unordered_set<VariableId> variableIds;
    variableIds.reserve(program.variables.size());
    for (const auto& v : program.variables) {
        if (v.id == INVALID_VARIABLE) {
            return Result<std::unique_ptr<Automata>>::error("bytecode variable has invalid id");
        }
        if (v.name.empty()) {
            return Result<std::unique_ptr<Automata>>::error("bytecode variable name cannot be empty");
        }
        if (!variableIds.insert(v.id).second) {
            return Result<std::unique_ptr<Automata>>::error("duplicate bytecode variable id");
        }
        if (v.type != ValueType::Void && v.initialValue.type() != ValueType::Void && v.initialValue.type() != v.type) {
            return Result<std::unique_ptr<Automata>>::error("bytecode variable initial value type mismatch");
        }

        VariableSpec spec;
        spec.id = v.id;
        spec.name = v.name;
        spec.type = v.type;
        spec.direction = v.direction;
        spec.initialValue = v.initialValue;
        automata->addVariable(std::move(spec));
    }

    std::unordered_set<TransitionId> transitionIds;
    transitionIds.reserve(program.transitions.size());
    for (const auto& t : program.transitions) {
        if (t.id == INVALID_TRANSITION) {
            return Result<std::unique_ptr<Automata>>::error("bytecode transition has invalid id");
        }
        if (!transitionIds.insert(t.id).second) {
            return Result<std::unique_ptr<Automata>>::error("duplicate bytecode transition id");
        }
        if (stateIds.find(t.from) == stateIds.end() || stateIds.find(t.to) == stateIds.end()) {
            return Result<std::unique_ptr<Automata>>::error("bytecode transition references unknown state");
        }

        Transition tr(t.id, t.name.empty() ? ("t" + std::to_string(t.id)) : t.name, t.from, t.to);
        tr.priority = t.priority;
        tr.enabled = t.enabled;
        tr.weight = t.weight;
        tr.body.source = t.bodySource;
        tr.triggered.source = t.triggeredSource;

        switch (t.kind) {
            case ir::BytecodeTransitionKind::Immediate:
                tr.type = TransitionType::Immediate;
                break;
            case ir::BytecodeTransitionKind::TimedAfter:
                tr.type = TransitionType::Timed;
                tr.timedConfig.mode = TimedMode::After;
                tr.timedConfig.delayMs = t.delayMs;
                tr.timedConfig.additionalCondition.source = t.conditionExpression;
                break;
            case ir::BytecodeTransitionKind::ClassicCondition:
                if (t.conditionExpression.empty()) {
                    return Result<std::unique_ptr<Automata>>::error("classic bytecode transition missing condition");
                }
                tr.type = TransitionType::Classic;
                tr.classicConfig.condition.source = t.conditionExpression;
                break;
            case ir::BytecodeTransitionKind::EventSignal: {
                if (t.eventSignalName.empty()) {
                    return Result<std::unique_ptr<Automata>>::error("event bytecode transition missing signal");
                }
                switch (t.eventTriggerType) {
                    case EventTrigger::OnChange:
                    case EventTrigger::OnRise:
                    case EventTrigger::OnFall:
                    case EventTrigger::OnThreshold:
                    case EventTrigger::OnMatch:
                        break;
                    default:
                        return Result<std::unique_ptr<Automata>>::error("unsupported bytecode event trigger type");
                }
                tr.type = TransitionType::Event;
                SignalTrigger trigger;
                trigger.signalName = t.eventSignalName;
                trigger.signalType = t.eventSignalDirection;
                trigger.triggerType = t.eventTriggerType;
                if (t.eventTriggerType == EventTrigger::OnThreshold) {
                    if (!t.eventHasThreshold) {
                        return Result<std::unique_ptr<Automata>>::error("threshold event bytecode transition missing threshold");
                    }
                    ThresholdConfig threshold;
                    threshold.op = t.eventThresholdOp;
                    threshold.value = t.eventThresholdValue;
                    threshold.oneShot = t.eventThresholdOneShot;
                    trigger.threshold = std::move(threshold);
                }
                if (t.eventTriggerType == EventTrigger::OnMatch) {
                    if (t.eventPattern.empty()) {
                        return Result<std::unique_ptr<Automata>>::error("match event bytecode transition missing pattern");
                    }
                    trigger.pattern = t.eventPattern;
                }
                tr.eventConfig.requireAll = false;
                tr.eventConfig.debounceMs = 0;
                tr.eventConfig.additionalCondition.source = t.conditionExpression;
                tr.eventConfig.triggers.push_back(std::move(trigger));
                break;
            }
            default:
                return Result<std::unique_ptr<Automata>>::error("unsupported bytecode transition kind");
        }

        automata->addTransition(std::move(tr));
    }

    const auto errors = automata->validate();
    if (!errors.empty()) {
        return Result<std::unique_ptr<Automata>>::error("bytecode automata invalid: " + joinErrors(errors));
    }

    return Result<std::unique_ptr<Automata>>::ok(std::move(automata));
}

std::unique_ptr<IScriptEngine> makeDefaultScriptEngine() {
#if defined(AETHERIUM_DISABLE_LUA_SCRIPT_ENGINE)
    return std::make_unique<SimpleScriptEngine>();
#else
    return std::make_unique<LuaScriptEngine>();
#endif
}

} // namespace

Engine::Engine()
    : runtime_(std::make_unique<StdClock>(),
               std::make_unique<StdRandomSource>(),
               makeDefaultScriptEngine())
    , frontendLoader_(std::make_unique<EngineFrontendLoaderHandle>())
    , logHub_(2048) {
    registerCommandHandlers();
    configureRuntimeCallbacks();
}

Engine::Engine(std::unique_ptr<IClock> clock,
               std::unique_ptr<IRandomSource> random,
               std::unique_ptr<IScriptEngine> script)
    : runtime_(std::move(clock), std::move(random), std::move(script))
    , frontendLoader_(std::make_unique<EngineFrontendLoaderHandle>())
    , logHub_(2048) {
    registerCommandHandlers();
    configureRuntimeCallbacks();
}

Engine::~Engine() = default;

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
#if defined(AETHERIUM_RUNTIME_CORE_ONLY)
    (void) filePath;
    (void) mode;
    (void) startAfterLoad;
    (void) requestedRunId;
    return Result<RunId>::error("runtime_core build does not include file/YAML loader");
#else
    if (!frontendLoader_) {
        return Result<RunId>::error("loader frontend unavailable");
    }
    auto loaded = frontendLoader_->loader.loadFromFile(filePath);
    if (loaded.isError()) {
        return Result<RunId>::error(loaded.error());
    }
    for (const auto& warn : loaded.value().warnings) {
        logHub_.log(LogLevel::Warn, "loader", warn);
    }
    return applyLoadedAutomata(std::move(loaded.value().automata), mode, startAfterLoad, requestedRunId);
#endif
}

Result<RunId> Engine::loadAutomataFromYaml(const std::string& yaml,
                                           const std::string& basePath,
                                           protocolv2::LoadReplaceMode mode,
                                           bool startAfterLoad,
                                           std::optional<RunId> requestedRunId) {
#if defined(AETHERIUM_RUNTIME_CORE_ONLY)
    (void) yaml;
    (void) basePath;
    (void) mode;
    (void) startAfterLoad;
    (void) requestedRunId;
    return Result<RunId>::error("runtime_core build does not include YAML loader");
#else
    if (!frontendLoader_) {
        return Result<RunId>::error("loader frontend unavailable");
    }
    auto loaded = frontendLoader_->loader.loadFromString(yaml, basePath);
    if (loaded.isError()) {
        return Result<RunId>::error(loaded.error());
    }
    for (const auto& warn : loaded.value().warnings) {
        logHub_.log(LogLevel::Warn, "loader", warn);
    }
    return applyLoadedAutomata(std::move(loaded.value().automata), mode, startAfterLoad, requestedRunId);
#endif
}

Result<RunId> Engine::loadAutomataFromArtifact(const ir::AutomataArtifact& artifact,
                                               protocolv2::LoadReplaceMode mode,
                                               bool startAfterLoad,
                                               std::optional<RunId> requestedRunId) {
    switch (artifact.payloadKind) {
        case ir::PayloadKind::YamlText: {
            const std::string yaml(artifact.payloadBytes.begin(), artifact.payloadBytes.end());
            const std::string basePath = artifact.sourceLabel.empty() ? "." : artifact.sourceLabel;
            return loadAutomataFromYaml(yaml, basePath, mode, startAfterLoad, requestedRunId);
        }
        case ir::PayloadKind::EngineBytecode: {
            auto program = ir::deserializeEngineBytecodeProgram(artifact.payloadBytes);
            if (program.isError()) {
                return Result<RunId>::error("engine bytecode decode failed: " + program.error());
            }
            auto automata = automataFromEngineBytecode(program.value());
            if (automata.isError()) {
                return Result<RunId>::error(automata.error());
            }
            return applyLoadedAutomata(std::move(automata.value()), mode, startAfterLoad, requestedRunId);
        }
    }

    return Result<RunId>::error("unsupported artifact payload kind");
}

Result<RunId> Engine::loadAutomataFromBytes(const std::vector<uint8_t>& bytes,
                                            protocolv2::LoadReplaceMode mode,
                                            bool startAfterLoad,
                                            std::optional<RunId> requestedRunId) {
    auto parsed = ir::deserializeArtifact(bytes);
    if (parsed.isError()) {
        return Result<RunId>::error(parsed.error());
    }
    return loadAutomataFromArtifact(parsed.value(), mode, startAfterLoad, requestedRunId);
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

void Engine::resetPendingChunkedLoad() {
    pendingChunkedLoad_ = PendingChunkedLoad{};
}

Result<bool> Engine::appendChunkedLoad(const protocol::LoadAutomataMessage& load,
                                       std::vector<uint8_t>& assembledData) {
    if (load.totalChunks == 0) {
        resetPendingChunkedLoad();
        return Result<bool>::error("chunked load has zero total_chunks");
    }
    if (load.chunkIndex >= load.totalChunks) {
        resetPendingChunkedLoad();
        return Result<bool>::error("chunked load index out of range");
    }

    auto& pending = pendingChunkedLoad_;
    const bool beginNew = (load.chunkIndex == 0);

    if (!pending.active || beginNew) {
        if (!beginNew) {
            return Result<bool>::error("chunked load missing initial chunk");
        }
        resetPendingChunkedLoad();
        pending.active = true;
        pending.sourceId = load.sourceId;
        pending.runId = load.runId;
        pending.format = load.format;
        pending.startAfterLoad = load.startAfterLoad;
        pending.replaceExisting = load.replaceExisting;
        pending.totalChunks = load.totalChunks;
        pending.nextChunkIndex = 0;
        pending.totalBytes = 0;
        pending.data.clear();
    } else {
        if (load.sourceId != pending.sourceId ||
            load.runId != pending.runId ||
            load.format != pending.format ||
            load.startAfterLoad != pending.startAfterLoad ||
            load.replaceExisting != pending.replaceExisting ||
            load.totalChunks != pending.totalChunks) {
            resetPendingChunkedLoad();
            return Result<bool>::error("chunked load metadata mismatch");
        }
    }

    if (load.chunkIndex != pending.nextChunkIndex) {
        resetPendingChunkedLoad();
        return Result<bool>::error("chunked load arrived out of order");
    }

    if (pending.totalBytes + load.data.size() > kMaxChunkedLoadBytes) {
        resetPendingChunkedLoad();
        return Result<bool>::error("chunked load exceeds assembly limit");
    }

    pending.data.insert(pending.data.end(), load.data.begin(), load.data.end());
    pending.totalBytes += load.data.size();
    pending.nextChunkIndex++;

    if (pending.nextChunkIndex < pending.totalChunks) {
        return Result<bool>::ok(false);
    }

    assembledData.swap(pending.data);
    resetPendingChunkedLoad();
    return Result<bool>::ok(true);
}

Result<RunId> Engine::applyProtocolLoad(const protocol::LoadAutomataMessage& load,
                                        const std::vector<uint8_t>& data) {
    const auto mode = load.replaceExisting
        ? protocolv2::LoadReplaceMode::HardReset
        : protocolv2::LoadReplaceMode::CarryOverCompatible;

    switch (load.format) {
        case protocol::AutomataFormat::YAML: {
            const std::string yaml(data.begin(), data.end());
            return loadAutomataFromYaml(yaml, ".", mode, load.startAfterLoad, load.runId);
        }
        case protocol::AutomataFormat::Binary:
            return loadAutomataFromBytes(data, mode, load.startAfterLoad, load.runId);
        default:
            return Result<RunId>::error("unsupported automata format");
    }
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
    switch (message.type()) {
        case protocol::MessageType::LoadAutomata:
            return static_cast<const protocol::LoadAutomataMessage&>(message).runId;
        case protocol::MessageType::LoadAck:
            return static_cast<const protocol::LoadAckMessage&>(message).runId;
        case protocol::MessageType::Start:
            return static_cast<const protocol::StartMessage&>(message).runId;
        case protocol::MessageType::Stop:
            return static_cast<const protocol::StopMessage&>(message).runId;
        case protocol::MessageType::Reset:
            return static_cast<const protocol::ResetMessage&>(message).runId;
        case protocol::MessageType::Status:
            return static_cast<const protocol::StatusMessage&>(message).runId;
        case protocol::MessageType::Pause:
            return static_cast<const protocol::PauseMessage&>(message).runId;
        case protocol::MessageType::Resume:
            return static_cast<const protocol::ResumeMessage&>(message).runId;
        case protocol::MessageType::Input:
            return static_cast<const protocol::InputMessage&>(message).runId;
        case protocol::MessageType::Output:
            return static_cast<const protocol::OutputMessage&>(message).runId;
        case protocol::MessageType::Variable:
            return static_cast<const protocol::VariableMessage&>(message).runId;
        case protocol::MessageType::StateChange:
            return static_cast<const protocol::StateChangeMessage&>(message).runId;
        case protocol::MessageType::Telemetry:
            return static_cast<const protocol::TelemetryMessage&>(message).runId;
        case protocol::MessageType::TransitionFired:
            return static_cast<const protocol::TransitionFiredMessage&>(message).runId;
        default:
            return std::nullopt;
    }
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
        const auto& ping = static_cast<const protocol::PingMessage&>(request);
        pong.originalTimestamp = ping.timestamp;
        pong.sequenceNumber = ping.sequenceNumber;
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
        const auto* load = &static_cast<const protocol::LoadAutomataMessage&>(request);

        Result<RunId> result = Result<RunId>::error("unsupported automata format");
        const bool chunked = load->isChunked || load->totalChunks > 1;

        if (chunked) {
            std::vector<uint8_t> assembledData;
            auto appendResult = engine.appendChunkedLoad(*load, assembledData);
            if (appendResult.isError()) {
                protocol::LoadAckMessage loadAck;
                loadAck.targetId = request.sourceId;
                loadAck.runId = load->runId;
                loadAck.success = false;
                loadAck.errorMessage = appendResult.error();

                Engine::Replies replies;
                replies.push_back(std::make_unique<protocol::LoadAckMessage>(loadAck));
                replies.push_back(engine.buildStatusMessage(request.sourceId));
                return replies;
            }

            if (!appendResult.value()) {
                return engine.ackWithStatus(request, "load_chunk_received");
            }

            result = engine.applyProtocolLoad(*load, assembledData);
        } else {
            engine.resetPendingChunkedLoad();
            result = engine.applyProtocolLoad(*load, load->data);
        }

        protocol::LoadAckMessage loadAck;
        loadAck.targetId = request.sourceId;
        loadAck.runId = load->runId;
        if (result.isError()) {
            loadAck.success = false;
            loadAck.errorMessage = result.error();
        } else {
            loadAck.success = true;
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
        const auto& start = static_cast<const protocol::StartMessage&>(request);
        from = start.startFromState;

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
        const auto* input = &static_cast<const protocol::InputMessage&>(request);
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
        const auto* variable = &static_cast<const protocol::VariableMessage&>(request);
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
        const auto& debug = static_cast<const protocol::DebugMessage&>(request);
        engine.logHub_.log(LogLevel::Debug, debug.source.empty() ? "remote" : debug.source, debug.message);
        return engine.ackWithStatus(request, "debug_received");
    });

    commandBus_.registerHandler(protocol::MessageType::Error, [](Engine& engine, const protocol::Message& request) {
        const auto& error = static_cast<const protocol::ErrorMessage&>(request);
        engine.logHub_.event(EventKind::Error, LogLevel::Error, "remote", error.message, error.runId);
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
