#include "engine/core/engine.hpp"

#include <chrono>
#include <cstdint>
#include <iostream>
#include <memory>
#include <string>
#include <thread>

namespace {

using aeth::Engine;
using aeth::Result;
namespace protocol = aeth::protocol;

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
        auto startReq = makeMessage<protocol::StartMessage>();
        startReq->runId = 42;
        auto replies = send(engine, std::move(startReq));
        expectAck(replies, "start");
    }

    {
        auto pauseReq = makeMessage<protocol::PauseMessage>();
        pauseReq->runId = 42;
        auto replies = send(engine, std::move(pauseReq));
        expectAck(replies, "pause");
    }

    {
        auto pauseReq = makeMessage<protocol::PauseMessage>();
        pauseReq->runId = 42;
        auto replies = send(engine, std::move(pauseReq));
        expectAck(replies, "pause-idempotent");
    }

    {
        auto resumeReq = makeMessage<protocol::ResumeMessage>();
        resumeReq->runId = 42;
        auto replies = send(engine, std::move(resumeReq));
        expectAck(replies, "resume");
    }

    {
        auto inputReq = makeMessage<protocol::InputMessage>();
        inputReq->runId = 42;
        inputReq->variableName = "sensor_temp";
        inputReq->value = aeth::Value(int32_t{90});
        auto replies = send(engine, std::move(inputReq));
        expectAck(replies, "set-input sensor_temp");
    }
    engine.tick();

    {
        auto inputReq = makeMessage<protocol::InputMessage>();
        inputReq->runId = 42;
        inputReq->variableName = "door_open";
        inputReq->value = aeth::Value(true);
        auto replies = send(engine, std::move(inputReq));
        expectAck(replies, "set-input door_open");
    }
    engine.tick();

    {
        auto inputReq = makeMessage<protocol::InputMessage>();
        inputReq->runId = 42;
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
        varReq->runId = 42;
        varReq->variableName = "manual_override";
        varReq->value = aeth::Value(true);
        auto replies = send(engine, std::move(varReq));
        expectAck(replies, "set-variable manual_override");
    }

    {
        auto statusReq = makeMessage<protocol::StatusMessage>();
        statusReq->runId = 42;
        auto replies = send(engine, std::move(statusReq));
        auto* status = findMessage<protocol::StatusMessage>(replies);
        require(status != nullptr, "status-after-traffic: expected STATUS");
        require(status->transitionCount >= 3, "status-after-traffic: expected >=3 transitions");
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
        resetReq->runId = 42;
        auto replies = send(engine, std::move(resetReq));
        expectAck(replies, "reset");
    }

    {
        auto stopReq = makeMessage<protocol::StopMessage>();
        stopReq->runId = 42;
        auto replies = send(engine, std::move(stopReq));
        expectAck(replies, "stop");
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
