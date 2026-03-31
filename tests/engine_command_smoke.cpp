#include "engine/core/engine.hpp"
#include "engine/core/artifact.hpp"

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <iostream>
#include <memory>
#include <string>
#include <thread>
#include <vector>

namespace {

using aeth::Engine;
using aeth::Result;
namespace protocol = aeth::protocol;
namespace ir = aeth::ir;

[[noreturn]] void fail(const std::string& msg) {
    std::cerr << "[FAIL] " << msg << "\n";
    std::exit(1);
}

void require(bool condition, const std::string& msg) {
    if (!condition) {
        fail(msg);
    }
}

template <typename T>
T* findMessage(const Engine::Replies& replies) {
    for (const auto& m : replies) {
        if (!m) {
            continue;
        }
        if (auto* casted = dynamic_cast<T*>(m.get())) {
            return casted;
        }
    }
    return nullptr;
}

const aeth::Value* findSnapshotValue(const protocol::StatusMessage& status, const std::string& name) {
    for (const auto& entry : status.variableSnapshot) {
        if (entry.variableName == name) {
            return &entry.value;
        }
    }
    return nullptr;
}

uint32_t nextMessageId() {
    static uint32_t id = 1;
    return id++;
}

template <typename T>
std::unique_ptr<T> makeMessage() {
    auto msg = std::make_unique<T>();
    msg->messageId = nextMessageId();
    msg->sourceId = 9001;
    return msg;
}

Engine::Replies send(Engine& engine, std::unique_ptr<protocol::Message> msg) {
    engine.enqueueCommand(std::move(msg));
    return engine.processCommandQueue();
}

std::vector<std::vector<uint8_t>> chunkBytes(const std::vector<uint8_t>& bytes, size_t chunkSize) {
    std::vector<std::vector<uint8_t>> chunks;
    if (chunkSize == 0) {
        return chunks;
    }
    for (size_t offset = 0; offset < bytes.size(); offset += chunkSize) {
        const size_t end = std::min(bytes.size(), offset + chunkSize);
        chunks.emplace_back(bytes.begin() + static_cast<std::ptrdiff_t>(offset),
                            bytes.begin() + static_cast<std::ptrdiff_t>(end));
    }
    return chunks;
}

void expectAck(const Engine::Replies& replies, const std::string& ctx) {
    require(findMessage<protocol::AckMessage>(replies) != nullptr, ctx + ": expected ACK");
    require(findMessage<protocol::StatusMessage>(replies) != nullptr, ctx + ": expected STATUS snapshot");
}

void expectNak(const Engine::Replies& replies, const std::string& ctx) {
    require(findMessage<protocol::NakMessage>(replies) != nullptr, ctx + ": expected NAK");
    require(findMessage<protocol::StatusMessage>(replies) != nullptr, ctx + ": expected STATUS snapshot");
}

const char* kYaml = R"YAML(
version: 0.0.1

config:
  name: Command Smoke Runtime
  type: inline

variables:
  - name: sensor_temp
    type: int
    direction: input
    default: 20

  - name: threshold
    type: int
    direction: input
    default: 60

  - name: door_open
    type: bool
    direction: input
    default: false

  - name: cmd_reset
    type: bool
    direction: input
    default: false

  - name: over_temp
    type: bool
    direction: output
    default: false

  - name: latch_count
    type: int
    direction: output
    default: 0

  - name: manual_override
    type: bool
    direction: output
    default: false

automata:
  initial_state: Idle

  states:
    Idle:
      on_enter: |
        setVal("over_temp", false)

    Armed:
      on_enter: |
        log("debug", "armed")

    Latched:
      on_enter: |
        setVal("over_temp", true)
        setVal("latch_count", value("latch_count") + 1)

    Resetting:
      on_enter: |
        setVal("over_temp", false)

  transitions:
    arm_when_hot:
      from: Idle
      to: Armed
      type: classic
      condition: value("sensor_temp") >= value("threshold")

    latch_on_door_open:
      from: Armed
      to: Latched
      type: event
      event:
        triggers:
          - signal: door_open
            trigger: on_rise

    reset_command:
      from: Latched
      to: Resetting
      type: event
      event:
        triggers:
          - signal: cmd_reset
            trigger: on_rise

    settle_to_idle:
      from: Resetting
      to: Idle
      type: timed
      after: 5
)YAML";

ir::EngineBytecodeProgram makeBytecodeProgram() {
    ir::EngineBytecodeProgram program;
    program.name = "Bytecode Smoke Runtime";
    program.initialState = 1;

    ir::BytecodeVariable inputEnabled;
    inputEnabled.id = 1;
    inputEnabled.name = "enabled";
    inputEnabled.type = aeth::ValueType::Bool;
    inputEnabled.direction = aeth::VariableDirection::Input;
    inputEnabled.initialValue = aeth::Value(false);
    program.variables.push_back(inputEnabled);

    ir::BytecodeVariable outputFlag;
    outputFlag.id = 2;
    outputFlag.name = "latched";
    outputFlag.type = aeth::ValueType::Bool;
    outputFlag.direction = aeth::VariableDirection::Output;
    outputFlag.initialValue = aeth::Value(false);
    program.variables.push_back(outputFlag);

    program.states.push_back(ir::BytecodeState{1, "Idle"});
    program.states.push_back(ir::BytecodeState{2, "Running"});

    ir::BytecodeTransition transition;
    transition.id = 1;
    transition.name = "to_running";
    transition.from = 1;
    transition.to = 2;
    transition.kind = ir::BytecodeTransitionKind::Immediate;
    transition.priority = 0;
    transition.enabled = true;
    transition.delayMs = 0;
    program.transitions.push_back(transition);

    return program;
}

ir::EngineBytecodeProgram makeClassicConditionBytecodeProgram() {
    ir::EngineBytecodeProgram program;
    program.name = "Bytecode Classic Runtime";
    program.initialState = 1;

    ir::BytecodeVariable enabled;
    enabled.id = 1;
    enabled.name = "enabled";
    enabled.type = aeth::ValueType::Bool;
    enabled.direction = aeth::VariableDirection::Input;
    enabled.initialValue = aeth::Value(false);
    program.variables.push_back(enabled);

    ir::BytecodeVariable armed;
    armed.id = 2;
    armed.name = "armed";
    armed.type = aeth::ValueType::Bool;
    armed.direction = aeth::VariableDirection::Input;
    armed.initialValue = aeth::Value(false);
    program.variables.push_back(armed);

    program.states.push_back(ir::BytecodeState{1, "Idle"});
    program.states.push_back(ir::BytecodeState{2, "Running"});

    ir::BytecodeTransition gate;
    gate.id = 1;
    gate.name = "gate";
    gate.from = 1;
    gate.to = 2;
    gate.kind = ir::BytecodeTransitionKind::ClassicCondition;
    gate.priority = 0;
    gate.enabled = true;
    gate.conditionExpression = "(enabled == true) and (armed == true)";
    program.transitions.push_back(gate);

    return program;
}

ir::EngineBytecodeProgram makeEventBytecodeProgram() {
    ir::EngineBytecodeProgram program;
    program.name = "Bytecode Event Runtime";
    program.initialState = 1;

    ir::BytecodeVariable pulse;
    pulse.id = 1;
    pulse.name = "pulse";
    pulse.type = aeth::ValueType::Bool;
    pulse.direction = aeth::VariableDirection::Input;
    pulse.initialValue = aeth::Value(false);
    program.variables.push_back(pulse);

    program.states.push_back(ir::BytecodeState{1, "Idle"});
    program.states.push_back(ir::BytecodeState{2, "Triggered"});

    ir::BytecodeTransition evt;
    evt.id = 1;
    evt.name = "on_pulse_rise";
    evt.from = 1;
    evt.to = 2;
    evt.kind = ir::BytecodeTransitionKind::EventSignal;
    evt.priority = 0;
    evt.enabled = true;
    evt.eventSignalName = "pulse";
    evt.eventSignalDirection = aeth::VariableDirection::Input;
    evt.eventTriggerType = aeth::EventTrigger::OnRise;
    program.transitions.push_back(evt);

    return program;
}

ir::EngineBytecodeProgram makeEventThresholdBytecodeProgram() {
    ir::EngineBytecodeProgram program;
    program.name = "Bytecode Event Threshold Runtime";
    program.initialState = 1;

    ir::BytecodeVariable temp;
    temp.id = 1;
    temp.name = "temp";
    temp.type = aeth::ValueType::Int32;
    temp.direction = aeth::VariableDirection::Input;
    temp.initialValue = aeth::Value(int32_t{0});
    program.variables.push_back(temp);

    program.states.push_back(ir::BytecodeState{1, "Idle"});
    program.states.push_back(ir::BytecodeState{2, "Hot"});

    ir::BytecodeTransition evt;
    evt.id = 1;
    evt.name = "over_threshold";
    evt.from = 1;
    evt.to = 2;
    evt.kind = ir::BytecodeTransitionKind::EventSignal;
    evt.priority = 0;
    evt.enabled = true;
    evt.eventSignalName = "temp";
    evt.eventSignalDirection = aeth::VariableDirection::Input;
    evt.eventTriggerType = aeth::EventTrigger::OnThreshold;
    evt.eventHasThreshold = true;
    evt.eventThresholdOp = aeth::CompareOp::Gt;
    evt.eventThresholdValue = aeth::Value(int32_t{10});
    evt.eventThresholdOneShot = false;
    program.transitions.push_back(evt);

    return program;
}

} // namespace

int main() {
    Engine engine;
    aeth::EngineInitOptions init;
    init.maxTickRate = 1000;
    init.logCapacity = 512;
    auto initRes = engine.initialize(init);
    require(initRes.isOk(), "engine initialize failed: " + initRes.error());

    {
        auto statusReq = makeMessage<protocol::StatusMessage>();
        auto replies = send(engine, std::move(statusReq));
        require(findMessage<protocol::StatusMessage>(replies) != nullptr, "status request: expected STATUS");
    }

    {
        auto startReq = makeMessage<protocol::StartMessage>();
        startReq->runId = 1;
        auto replies = send(engine, std::move(startReq));
        expectNak(replies, "start-before-load");
    }

    {
        auto loadReq = makeMessage<protocol::LoadAutomataMessage>();
        loadReq->runId = 42;
        loadReq->format = protocol::AutomataFormat::YAML;
        loadReq->replaceExisting = true;
        loadReq->startAfterLoad = false;
        loadReq->data.assign(kYaml, kYaml + std::char_traits<char>::length(kYaml));

        auto replies = send(engine, std::move(loadReq));
        auto* loadAck = findMessage<protocol::LoadAckMessage>(replies);
        require(loadAck != nullptr, "load: expected LoadAck");
        require(loadAck->success, "load: expected success=true, got error: " + loadAck->errorMessage);
    }

    {
        auto artifact = ir::makeYamlArtifact(kYaml, ".");
        auto encoded = ir::serializeArtifact(artifact);
        require(encoded.isOk(), "artifact encode failed: " + encoded.error());

        auto decoded = ir::deserializeArtifact(encoded.value());
        require(decoded.isOk(), "artifact decode failed: " + decoded.error());
        require(decoded.value().payloadKind == ir::PayloadKind::YamlText, "artifact roundtrip: payload kind mismatch");
        require(decoded.value().payloadBytes.size() == artifact.payloadBytes.size(),
                "artifact roundtrip: payload size mismatch");
    }

    {
        auto artifact = ir::makeYamlArtifact(kYaml, ".");
        auto encoded = ir::serializeArtifact(artifact);
        require(encoded.isOk(), "binary-load artifact encode failed: " + encoded.error());

        auto loadReq = makeMessage<protocol::LoadAutomataMessage>();
        loadReq->runId = 43;
        loadReq->format = protocol::AutomataFormat::Binary;
        loadReq->replaceExisting = true;
        loadReq->startAfterLoad = false;
        loadReq->data = encoded.value();

        auto replies = send(engine, std::move(loadReq));
        auto* loadAck = findMessage<protocol::LoadAckMessage>(replies);
        require(loadAck != nullptr, "binary load: expected LoadAck");
        require(loadAck->success, "binary load: expected success=true, got error: " + loadAck->errorMessage);
    }

    {
        auto startReq = makeMessage<protocol::StartMessage>();
        startReq->runId = 43;
        auto replies = send(engine, std::move(startReq));
        expectAck(replies, "start");
    }

    {
        auto pauseReq = makeMessage<protocol::PauseMessage>();
        pauseReq->runId = 43;
        auto replies = send(engine, std::move(pauseReq));
        expectAck(replies, "pause");
    }

    {
        auto pauseReq = makeMessage<protocol::PauseMessage>();
        pauseReq->runId = 43;
        auto replies = send(engine, std::move(pauseReq));
        expectAck(replies, "pause-idempotent");
    }

    {
        auto resumeReq = makeMessage<protocol::ResumeMessage>();
        resumeReq->runId = 43;
        auto replies = send(engine, std::move(resumeReq));
        expectAck(replies, "resume");
    }

    {
        auto inputReq = makeMessage<protocol::InputMessage>();
        inputReq->runId = 43;
        inputReq->variableName = "sensor_temp";
        inputReq->value = aeth::Value(int32_t{90});
        auto replies = send(engine, std::move(inputReq));
        expectAck(replies, "set-input sensor_temp");
    }
    engine.tick();

    {
        auto inputReq = makeMessage<protocol::InputMessage>();
        inputReq->runId = 43;
        inputReq->variableName = "door_open";
        inputReq->value = aeth::Value(true);
        auto replies = send(engine, std::move(inputReq));
        expectAck(replies, "set-input door_open");
    }
    engine.tick();

    {
        auto statusReq = makeMessage<protocol::StatusMessage>();
        statusReq->runId = 43;
        auto replies = send(engine, std::move(statusReq));
        auto* status = findMessage<protocol::StatusMessage>(replies);
        require(status != nullptr, "status-latched: expected STATUS");
        require(status->currentState != aeth::INVALID_STATE, "status-latched: expected current state");

        const auto* overTemp = findSnapshotValue(*status, "over_temp");
        require(overTemp != nullptr, "status-latched: missing over_temp snapshot");
        require(overTemp->type() == aeth::ValueType::Bool && overTemp->get<bool>(),
                "status-latched: expected over_temp=true");

        const auto* latchCount = findSnapshotValue(*status, "latch_count");
        require(latchCount != nullptr, "status-latched: missing latch_count snapshot");
        require(latchCount->type() == aeth::ValueType::Int32 && latchCount->get<int32_t>() >= 1,
                "status-latched: expected latch_count>=1");
    }

    {
        auto inputReq = makeMessage<protocol::InputMessage>();
        inputReq->runId = 43;
        inputReq->variableName = "cmd_reset";
        inputReq->value = aeth::Value(true);
        auto replies = send(engine, std::move(inputReq));
        expectAck(replies, "set-input cmd_reset");
    }
    engine.tick();
    std::this_thread::sleep_for(std::chrono::milliseconds(8));
    engine.tick();

    {
        auto varReq = makeMessage<protocol::VariableMessage>();
        varReq->runId = 43;
        varReq->variableName = "manual_override";
        varReq->value = aeth::Value(true);
        auto replies = send(engine, std::move(varReq));
        expectAck(replies, "set-variable manual_override");
    }

    {
        auto statusReq = makeMessage<protocol::StatusMessage>();
        statusReq->runId = 43;
        auto replies = send(engine, std::move(statusReq));
        auto* status = findMessage<protocol::StatusMessage>(replies);
        require(status != nullptr, "status-after-traffic: expected STATUS");
        require(status->transitionCount >= 2, "status-after-traffic: expected >=2 transitions");
    }

    {
        auto unsupported = makeMessage<protocol::RawMessage>();
        unsupported->rawType = static_cast<protocol::MessageType>(0x09);
        auto replies = send(engine, std::move(unsupported));
        expectNak(replies, "unsupported-command");
    }

    {
        auto vendor = makeMessage<protocol::RawMessage>();
        vendor->rawType = protocol::MessageType::Vendor;
        auto replies = send(engine, std::move(vendor));
        expectAck(replies, "vendor-command");
    }

    {
        auto resetReq = makeMessage<protocol::ResetMessage>();
        resetReq->runId = 43;
        auto replies = send(engine, std::move(resetReq));
        expectAck(replies, "reset");
    }

    {
        auto stopReq = makeMessage<protocol::StopMessage>();
        stopReq->runId = 43;
        auto replies = send(engine, std::move(stopReq));
        expectAck(replies, "stop");
    }

    {
        auto program = makeBytecodeProgram();
        auto bytecode = ir::serializeEngineBytecodeProgram(program);
        require(bytecode.isOk(), "engine bytecode encode failed: " + bytecode.error());

        auto decodedProgram = ir::deserializeEngineBytecodeProgram(bytecode.value());
        require(decodedProgram.isOk(), "engine bytecode decode failed: " + decodedProgram.error());
        require(decodedProgram.value().states.size() == 2, "engine bytecode roundtrip: state count mismatch");
        require(decodedProgram.value().transitions.size() == 1, "engine bytecode roundtrip: transition count mismatch");

        auto artifactRes = ir::makeEngineBytecodeArtifact(program, ".");
        require(artifactRes.isOk(), "engine bytecode artifact build failed: " + artifactRes.error());
        auto encodedArtifact = ir::serializeArtifact(artifactRes.value());
        require(encodedArtifact.isOk(), "engine bytecode artifact encode failed: " + encodedArtifact.error());

        auto loadReq = makeMessage<protocol::LoadAutomataMessage>();
        loadReq->runId = 44;
        loadReq->format = protocol::AutomataFormat::Binary;
        loadReq->replaceExisting = true;
        loadReq->startAfterLoad = false;
        loadReq->data = encodedArtifact.value();

        auto replies = send(engine, std::move(loadReq));
        auto* loadAck = findMessage<protocol::LoadAckMessage>(replies);
        require(loadAck != nullptr, "engine bytecode load: expected LoadAck");
        require(loadAck->success, "engine bytecode load: expected success=true, got error: " + loadAck->errorMessage);
    }

    {
        auto program = makeBytecodeProgram();
        auto artifactRes = ir::makeEngineBytecodeArtifact(program, ".");
        require(artifactRes.isOk(), "chunked bytecode artifact build failed: " + artifactRes.error());
        auto encodedArtifact = ir::serializeArtifact(artifactRes.value());
        require(encodedArtifact.isOk(), "chunked bytecode artifact encode failed: " + encodedArtifact.error());

        auto chunks = chunkBytes(encodedArtifact.value(), 9);
        require(chunks.size() >= 2, "chunked bytecode test expected >=2 chunks");

        for (size_t i = 0; i < chunks.size(); ++i) {
            auto loadReq = makeMessage<protocol::LoadAutomataMessage>();
            loadReq->runId = 48;
            loadReq->format = protocol::AutomataFormat::Binary;
            loadReq->replaceExisting = true;
            loadReq->startAfterLoad = false;
            loadReq->isChunked = true;
            loadReq->chunkIndex = static_cast<uint16_t>(i);
            loadReq->totalChunks = static_cast<uint16_t>(chunks.size());
            loadReq->data = chunks[i];

            auto replies = send(engine, std::move(loadReq));
            if (i + 1 < chunks.size()) {
                expectAck(replies, "chunked-load intermediate chunk");
                require(findMessage<protocol::LoadAckMessage>(replies) == nullptr,
                        "chunked-load intermediate chunk: unexpected LoadAck");
            } else {
                auto* loadAck = findMessage<protocol::LoadAckMessage>(replies);
                require(loadAck != nullptr, "chunked-load final chunk: expected LoadAck");
                require(loadAck->success,
                        "chunked-load final chunk: expected success=true, got error: " + loadAck->errorMessage);
            }
        }
    }

    {
        auto program = makeBytecodeProgram();
        auto artifactRes = ir::makeEngineBytecodeArtifact(program, ".");
        require(artifactRes.isOk(), "out-of-order bytecode artifact build failed: " + artifactRes.error());
        auto encodedArtifact = ir::serializeArtifact(artifactRes.value());
        require(encodedArtifact.isOk(), "out-of-order bytecode artifact encode failed: " + encodedArtifact.error());
        auto chunks = chunkBytes(encodedArtifact.value(), 11);
        require(chunks.size() >= 2, "out-of-order chunk test expected >=2 chunks");

        auto outOfOrder = makeMessage<protocol::LoadAutomataMessage>();
        outOfOrder->runId = 49;
        outOfOrder->format = protocol::AutomataFormat::Binary;
        outOfOrder->replaceExisting = true;
        outOfOrder->startAfterLoad = false;
        outOfOrder->isChunked = true;
        outOfOrder->chunkIndex = 1;
        outOfOrder->totalChunks = static_cast<uint16_t>(chunks.size());
        outOfOrder->data = chunks[1];

        auto replies = send(engine, std::move(outOfOrder));
        auto* loadAck = findMessage<protocol::LoadAckMessage>(replies);
        require(loadAck != nullptr, "out-of-order chunk: expected LoadAck");
        require(!loadAck->success, "out-of-order chunk: expected failure");
    }

    {
        auto startReq = makeMessage<protocol::StartMessage>();
        startReq->runId = 44;
        auto replies = send(engine, std::move(startReq));
        expectAck(replies, "start-bytecode");
    }
    engine.tick();
    std::this_thread::sleep_for(std::chrono::milliseconds(2));
    engine.tick();

    {
        auto inputReq = makeMessage<protocol::InputMessage>();
        inputReq->runId = 44;
        inputReq->variableName = "enabled";
        inputReq->value = aeth::Value(true);
        auto replies = send(engine, std::move(inputReq));
        expectAck(replies, "set-input enabled bytecode");
    }

    {
        auto statusReq = makeMessage<protocol::StatusMessage>();
        statusReq->runId = 44;
        auto replies = send(engine, std::move(statusReq));
        auto* status = findMessage<protocol::StatusMessage>(replies);
        require(status != nullptr, "status-bytecode: expected STATUS");
        require(status->currentState != aeth::INVALID_STATE, "status-bytecode: expected current state");
        require(status->transitionCount >= 1, "status-bytecode: expected transition");
    }

    {
        auto program = makeClassicConditionBytecodeProgram();
        auto artifactRes = ir::makeEngineBytecodeArtifact(program, ".");
        require(artifactRes.isOk(), "classic bytecode artifact build failed: " + artifactRes.error());
        auto encodedArtifact = ir::serializeArtifact(artifactRes.value());
        require(encodedArtifact.isOk(), "classic bytecode artifact encode failed: " + encodedArtifact.error());

        auto loadReq = makeMessage<protocol::LoadAutomataMessage>();
        loadReq->runId = 45;
        loadReq->format = protocol::AutomataFormat::Binary;
        loadReq->replaceExisting = true;
        loadReq->startAfterLoad = false;
        loadReq->data = encodedArtifact.value();

        auto replies = send(engine, std::move(loadReq));
        auto* loadAck = findMessage<protocol::LoadAckMessage>(replies);
        require(loadAck != nullptr, "classic bytecode load: expected LoadAck");
        require(loadAck->success, "classic bytecode load: expected success=true, got error: " + loadAck->errorMessage);
    }

    {
        auto startReq = makeMessage<protocol::StartMessage>();
        startReq->runId = 45;
        auto replies = send(engine, std::move(startReq));
        expectAck(replies, "start-classic-bytecode");
    }
    engine.tick();

    {
        auto statusReq = makeMessage<protocol::StatusMessage>();
        statusReq->runId = 45;
        auto replies = send(engine, std::move(statusReq));
        auto* status = findMessage<protocol::StatusMessage>(replies);
        require(status != nullptr, "status-classic-bytecode-before: expected STATUS");
        require(status->transitionCount == 0, "status-classic-bytecode-before: expected no transition");
    }

    {
        auto inputReq = makeMessage<protocol::InputMessage>();
        inputReq->runId = 45;
        inputReq->variableName = "enabled";
        inputReq->value = aeth::Value(true);
        auto replies = send(engine, std::move(inputReq));
        expectAck(replies, "set-input enabled classic bytecode");
    }
    engine.tick();
    std::this_thread::sleep_for(std::chrono::milliseconds(2));
    engine.tick();

    {
        auto statusReq = makeMessage<protocol::StatusMessage>();
        statusReq->runId = 45;
        auto replies = send(engine, std::move(statusReq));
        auto* status = findMessage<protocol::StatusMessage>(replies);
        require(status != nullptr, "status-classic-bytecode-mid: expected STATUS");
        require(status->transitionCount == 0, "status-classic-bytecode-mid: expected no transition yet");
    }

    {
        auto inputReq = makeMessage<protocol::InputMessage>();
        inputReq->runId = 45;
        inputReq->variableName = "armed";
        inputReq->value = aeth::Value(true);
        auto replies = send(engine, std::move(inputReq));
        expectAck(replies, "set-input armed classic bytecode");
    }
    engine.tick();
    std::this_thread::sleep_for(std::chrono::milliseconds(2));
    engine.tick();

    {
        auto statusReq = makeMessage<protocol::StatusMessage>();
        statusReq->runId = 45;
        auto replies = send(engine, std::move(statusReq));
        auto* status = findMessage<protocol::StatusMessage>(replies);
        require(status != nullptr, "status-classic-bytecode-after: expected STATUS");
        require(status->transitionCount >= 1, "status-classic-bytecode-after: expected transition");
    }

    {
        auto program = makeEventBytecodeProgram();
        auto artifactRes = ir::makeEngineBytecodeArtifact(program, ".");
        require(artifactRes.isOk(), "event bytecode artifact build failed: " + artifactRes.error());
        auto encodedArtifact = ir::serializeArtifact(artifactRes.value());
        require(encodedArtifact.isOk(), "event bytecode artifact encode failed: " + encodedArtifact.error());

        auto loadReq = makeMessage<protocol::LoadAutomataMessage>();
        loadReq->runId = 46;
        loadReq->format = protocol::AutomataFormat::Binary;
        loadReq->replaceExisting = true;
        loadReq->startAfterLoad = false;
        loadReq->data = encodedArtifact.value();

        auto replies = send(engine, std::move(loadReq));
        auto* loadAck = findMessage<protocol::LoadAckMessage>(replies);
        require(loadAck != nullptr, "event bytecode load: expected LoadAck");
        require(loadAck->success, "event bytecode load: expected success=true, got error: " + loadAck->errorMessage);
    }

    {
        auto startReq = makeMessage<protocol::StartMessage>();
        startReq->runId = 46;
        auto replies = send(engine, std::move(startReq));
        expectAck(replies, "start-event-bytecode");
    }
    engine.tick();

    {
        auto statusReq = makeMessage<protocol::StatusMessage>();
        statusReq->runId = 46;
        auto replies = send(engine, std::move(statusReq));
        auto* status = findMessage<protocol::StatusMessage>(replies);
        require(status != nullptr, "status-event-bytecode-before: expected STATUS");
        require(status->transitionCount == 0, "status-event-bytecode-before: expected no transition");
    }

    {
        auto inputReq = makeMessage<protocol::InputMessage>();
        inputReq->runId = 46;
        inputReq->variableName = "pulse";
        inputReq->value = aeth::Value(true);
        auto replies = send(engine, std::move(inputReq));
        expectAck(replies, "set-input pulse event bytecode");
    }
    engine.tick();
    std::this_thread::sleep_for(std::chrono::milliseconds(2));
    engine.tick();

    {
        auto statusReq = makeMessage<protocol::StatusMessage>();
        statusReq->runId = 46;
        auto replies = send(engine, std::move(statusReq));
        auto* status = findMessage<protocol::StatusMessage>(replies);
        require(status != nullptr, "status-event-bytecode-after: expected STATUS");
        require(status->transitionCount >= 1, "status-event-bytecode-after: expected transition");
    }

    {
        auto program = makeEventThresholdBytecodeProgram();
        auto artifactRes = ir::makeEngineBytecodeArtifact(program, ".");
        require(artifactRes.isOk(), "event-threshold bytecode artifact build failed: " + artifactRes.error());
        auto encodedArtifact = ir::serializeArtifact(artifactRes.value());
        require(encodedArtifact.isOk(), "event-threshold bytecode artifact encode failed: " + encodedArtifact.error());

        auto loadReq = makeMessage<protocol::LoadAutomataMessage>();
        loadReq->runId = 47;
        loadReq->format = protocol::AutomataFormat::Binary;
        loadReq->replaceExisting = true;
        loadReq->startAfterLoad = false;
        loadReq->data = encodedArtifact.value();

        auto replies = send(engine, std::move(loadReq));
        auto* loadAck = findMessage<protocol::LoadAckMessage>(replies);
        require(loadAck != nullptr, "event-threshold bytecode load: expected LoadAck");
        require(loadAck->success, "event-threshold bytecode load: expected success=true, got error: " + loadAck->errorMessage);
    }

    {
        auto startReq = makeMessage<protocol::StartMessage>();
        startReq->runId = 47;
        auto replies = send(engine, std::move(startReq));
        expectAck(replies, "start-event-threshold-bytecode");
    }
    engine.tick();

    {
        auto inputReq = makeMessage<protocol::InputMessage>();
        inputReq->runId = 47;
        inputReq->variableName = "temp";
        inputReq->value = aeth::Value(int32_t{9});
        auto replies = send(engine, std::move(inputReq));
        expectAck(replies, "set-input temp=9 event threshold bytecode");
    }
    engine.tick();
    std::this_thread::sleep_for(std::chrono::milliseconds(2));
    engine.tick();

    {
        auto statusReq = makeMessage<protocol::StatusMessage>();
        statusReq->runId = 47;
        auto replies = send(engine, std::move(statusReq));
        auto* status = findMessage<protocol::StatusMessage>(replies);
        require(status != nullptr, "status-event-threshold-bytecode-mid: expected STATUS");
        require(status->transitionCount == 0, "status-event-threshold-bytecode-mid: expected no transition");
    }

    {
        auto inputReq = makeMessage<protocol::InputMessage>();
        inputReq->runId = 47;
        inputReq->variableName = "temp";
        inputReq->value = aeth::Value(int32_t{11});
        auto replies = send(engine, std::move(inputReq));
        expectAck(replies, "set-input temp=11 event threshold bytecode");
    }
    engine.tick();
    std::this_thread::sleep_for(std::chrono::milliseconds(2));
    engine.tick();

    {
        auto statusReq = makeMessage<protocol::StatusMessage>();
        statusReq->runId = 47;
        auto replies = send(engine, std::move(statusReq));
        auto* status = findMessage<protocol::StatusMessage>(replies);
        require(status != nullptr, "status-event-threshold-bytecode-after: expected STATUS");
        require(status->transitionCount >= 1, "status-event-threshold-bytecode-after: expected transition");
    }

    {
        auto goodbye = makeMessage<protocol::RawMessage>();
        goodbye->rawType = protocol::MessageType::Goodbye;
        auto replies = send(engine, std::move(goodbye));
        expectAck(replies, "goodbye");
    }

    std::cout << "engine_command_smoke: PASS\n";
    return 0;
}
