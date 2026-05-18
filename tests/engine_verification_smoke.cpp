#include "engine/core/artifact.hpp"
#include "engine/core/engine.hpp"

#include <chrono>
#include <cstdlib>
#include <iostream>
#include <memory>
#include <optional>
#include <string>
#include <thread>

namespace {

using aeth::Engine;
namespace ir = aeth::ir;
namespace protocolv2 = aeth::protocolv2;

constexpr const char* kFixtureRoot = "example/automata/showcase/18_engine_verification/";

[[noreturn]] void fail(const std::string& msg) {
    std::cerr << "[FAIL] " << msg << "\n";
    std::exit(1);
}

void require(bool condition, const std::string& msg) {
    if (!condition) {
        fail(msg);
    }
}

void pass(const std::string& name) {
    std::cout << "[PASS] " << name << "\n";
}

std::unique_ptr<Engine> makeStartedEngine(const std::string& filename) {
    auto engine = std::make_unique<Engine>();
    aeth::EngineInitOptions init;
    init.maxTickRate = 1000;
    init.logCapacity = 512;

    auto initRes = engine->initialize(init);
    require(initRes.isOk(), filename + ": initialize failed: " + initRes.error());

    const std::string path = std::string(kFixtureRoot) + filename;
    auto loadRes = engine->loadAutomataFromFile(path, protocolv2::LoadReplaceMode::HardReset, true);
    require(loadRes.isOk(), filename + ": load failed: " + loadRes.error());

    return engine;
}

std::optional<aeth::Value> snapshotValue(const Engine& engine, const std::string& name) {
    auto telemetry = engine.buildTelemetryMessage();
    for (const auto& entry : telemetry->namedVariableSnapshot) {
        if (entry.variableName == name) {
            return entry.value;
        }
    }
    return std::nullopt;
}

std::string stringOutput(const Engine& engine, const std::string& name) {
    auto value = snapshotValue(engine, name);
    require(value.has_value(), "missing output snapshot: " + name);
    require(value->type() == aeth::ValueType::String, name + ": expected string output");
    return value->get<std::string>();
}

bool boolOutput(const Engine& engine, const std::string& name) {
    auto value = snapshotValue(engine, name);
    require(value.has_value(), "missing output snapshot: " + name);
    require(value->type() == aeth::ValueType::Bool, name + ": expected bool output");
    return value->get<bool>();
}

int32_t intOutput(const Engine& engine, const std::string& name) {
    auto value = snapshotValue(engine, name);
    require(value.has_value(), "missing output snapshot: " + name);
    require(value->type() == aeth::ValueType::Int32, name + ": expected int output");
    return value->get<int32_t>();
}

void tickUntilTransitions(Engine& engine, uint64_t minTransitions, int maxTicks, const std::string& ctx) {
    for (int i = 0; i < maxTicks && engine.status().transitionCount < minTransitions; ++i) {
        engine.tick();
        std::this_thread::sleep_for(std::chrono::milliseconds(2));
    }
    require(engine.status().transitionCount >= minTransitions,
            ctx + ": expected at least " + std::to_string(minTransitions) + " transitions");
    require(engine.status().errorCount == 0, ctx + ": expected no engine errors");
}

ir::EngineBytecodeProgram makeBytecodeSubsetProgram() {
    ir::EngineBytecodeProgram program;
    program.name = "Engine Verify 05 - Bytecode Artifact Runtime";
    program.initialState = 1;

    ir::BytecodeVariable armed;
    armed.id = 1;
    armed.name = "armed";
    armed.type = aeth::ValueType::Bool;
    armed.direction = aeth::VariableDirection::Input;
    armed.initialValue = aeth::Value(false);
    program.variables.push_back(armed);

    ir::BytecodeVariable pulse;
    pulse.id = 2;
    pulse.name = "pulse";
    pulse.type = aeth::ValueType::Bool;
    pulse.direction = aeth::VariableDirection::Input;
    pulse.initialValue = aeth::Value(false);
    program.variables.push_back(pulse);

    program.states.push_back(ir::BytecodeState{1, "Idle"});
    program.states.push_back(ir::BytecodeState{2, "Armed"});
    program.states.push_back(ir::BytecodeState{3, "Pulsed"});

    ir::BytecodeTransition arm;
    arm.id = 1;
    arm.name = "arm_when_enabled";
    arm.from = 1;
    arm.to = 2;
    arm.kind = ir::BytecodeTransitionKind::ClassicCondition;
    arm.priority = 0;
    arm.enabled = true;
    arm.conditionExpression = "armed == true";
    program.transitions.push_back(arm);

    ir::BytecodeTransition pulseEvent;
    pulseEvent.id = 2;
    pulseEvent.name = "pulse_event";
    pulseEvent.from = 2;
    pulseEvent.to = 3;
    pulseEvent.kind = ir::BytecodeTransitionKind::EventSignal;
    pulseEvent.priority = 0;
    pulseEvent.enabled = true;
    pulseEvent.eventSignalName = "pulse";
    pulseEvent.eventSignalDirection = aeth::VariableDirection::Input;
    pulseEvent.eventTriggerType = aeth::EventTrigger::OnRise;
    program.transitions.push_back(pulseEvent);

    return program;
}

std::unique_ptr<Engine> makeStartedBytecodeEngine() {
    auto engine = std::make_unique<Engine>();
    aeth::EngineInitOptions init;
    init.maxTickRate = 1000;
    init.logCapacity = 512;

    auto initRes = engine->initialize(init);
    require(initRes.isOk(), "bytecode artifact: initialize failed: " + initRes.error());

    auto artifact = ir::makeEngineBytecodeArtifact(makeBytecodeSubsetProgram(), "engine_verification_smoke");
    require(artifact.isOk(), "bytecode artifact: build failed: " + artifact.error());

    auto encoded = ir::serializeArtifact(artifact.value());
    require(encoded.isOk(), "bytecode artifact: serialize failed: " + encoded.error());

    auto loadRes = engine->loadAutomataFromBytes(
        encoded.value(), protocolv2::LoadReplaceMode::HardReset, true);
    require(loadRes.isOk(), "bytecode artifact: load failed: " + loadRes.error());

    return engine;
}

void testLuaHooksOutputs() {
    auto engine = makeStartedEngine("01_lua_hooks_outputs.yaml");

    tickUntilTransitions(*engine, 1, 20, "lua hooks outputs");

    require(boolOutput(*engine, "done"), "lua hooks outputs: expected done=true");
    require(stringOutput(*engine, "phase") == "done", "lua hooks outputs: expected phase=done");
    pass("01_lua_hooks_outputs");
}

void testTimedPriorityTimeout() {
    auto engine = makeStartedEngine("02_timed_priority_timeout.yaml");

    tickUntilTransitions(*engine, 1, 1800, "timed priority timeout");

    require(stringOutput(*engine, "path") == "timeout", "timed priority timeout: expected timeout path");
    pass("02_timed_priority_timeout");
}

void testEventEdgesThreshold() {
    {
        auto engine = makeStartedEngine("03_event_edges_threshold.yaml");

        auto setRise = engine->setInput("command", aeth::Value(true));
        require(setRise.isOk(), "event threshold: command=true failed: " + setRise.error());
        tickUntilTransitions(*engine, 1, 5, "event threshold rise");
        require(stringOutput(*engine, "event_seen") == "rise", "event threshold: expected rise");

        auto setPressure = engine->setInput("pressure", aeth::Value(int32_t{95}));
        require(setPressure.isOk(), "event threshold: pressure=95 failed: " + setPressure.error());
        tickUntilTransitions(*engine, 2, 5, "event threshold pressure");
        require(stringOutput(*engine, "event_seen") == "pressure", "event threshold: expected pressure");
    }

    {
        auto engine = makeStartedEngine("03_event_edges_threshold.yaml");

        auto setRise = engine->setInput("command", aeth::Value(true));
        require(setRise.isOk(), "event fall: command=true failed: " + setRise.error());
        tickUntilTransitions(*engine, 1, 5, "event fall rise");
        require(stringOutput(*engine, "event_seen") == "rise", "event fall: expected rise before fall");

        auto setPressure = engine->setInput("pressure", aeth::Value(int32_t{95}));
        require(setPressure.isOk(), "event fall: pressure=95 failed: " + setPressure.error());
        tickUntilTransitions(*engine, 2, 5, "event fall pressure");
        require(stringOutput(*engine, "event_seen") == "pressure",
                "event fall: expected pressure before fall");

        auto setFall = engine->setInput("command", aeth::Value(false));
        require(setFall.isOk(), "event fall: command=false failed: " + setFall.error());
        tickUntilTransitions(*engine, 3, 5, "event fall command=false");
        require(stringOutput(*engine, "event_seen") == "fall", "event fall: expected fall");
    }

    {
        // Verify threshold fires on state ENTRY even when the value was already above
        // the threshold before entering the state.  This tests the isEntryTick path
        // introduced by the OnThreshold state-entry fix.
        auto engine = makeStartedEngine("03_event_edges_threshold.yaml");

        // Set pressure above threshold while still in WaitingRise (before any transition)
        auto setPressure = engine->setInput("pressure", aeth::Value(int32_t{95}));
        require(setPressure.isOk(), "event threshold entry: pressure=95 failed: " + setPressure.error());

        // Tick a couple of times to flush the hasChanged flag (stays in WaitingRise)
        engine->tick();
        engine->tick();
        require(engine->status().transitionCount == 0,
                "event threshold entry: expected no transition yet (command not risen)");

        // Now trigger the rise to enter WaitingFall; pressure is already at 95
        auto setRise = engine->setInput("command", aeth::Value(true));
        require(setRise.isOk(), "event threshold entry: command=true failed: " + setRise.error());
        tickUntilTransitions(*engine, 1, 5, "event threshold entry: command rise");
        require(stringOutput(*engine, "event_seen") == "rise", "event threshold entry: expected rise");

        // On the first tick in WaitingFall the pressure_threshold must fire even though
        // pressure.hasChanged() is false (value was set two ticks ago, in WaitingRise).
        tickUntilTransitions(*engine, 2, 5, "event threshold entry: threshold on entry");
        require(stringOutput(*engine, "event_seen") == "pressure",
                "event threshold entry: expected pressure trip on state entry");
    }

    pass("03_event_edges_threshold");
}

void testEventEdgesThresholdHostDriver() {
    auto engine = makeStartedEngine("03_event_edges_threshold_host.yaml");

    tickUntilTransitions(*engine, 4, 4200, "event threshold host driver");
    require(stringOutput(*engine, "driver_step") == "done",
            "event threshold host driver: expected done");
    pass("03_event_edges_threshold_host");
}

void testWeightedProbabilistic() {
    auto engine = makeStartedEngine("04_weighted_probabilistic.yaml");

    tickUntilTransitions(*engine, 1, 10, "weighted probabilistic choose");
    const auto firstPath = stringOutput(*engine, "selected_path");
    require(firstPath == "A" || firstPath == "B", "weighted probabilistic: expected A or B");

    tickUntilTransitions(*engine, 2, 10, "weighted probabilistic return");
    require(intOutput(*engine, "a_count") + intOutput(*engine, "b_count") >= 1,
            "weighted probabilistic: expected branch counter increment");

    pass("04_weighted_probabilistic");
}

void testWeightedProbabilisticHostObserver() {
    auto engine = makeStartedEngine("04_weighted_probabilistic_host.yaml");

    auto setPath = engine->setInput("selected_path", aeth::Value(std::string("A")));
    require(setPath.isOk(), "weighted host observer: selected_path=A failed: " + setPath.error());
    auto setCount = engine->setInput("a_count", aeth::Value(int32_t{1}));
    require(setCount.isOk(), "weighted host observer: a_count=1 failed: " + setCount.error());

    tickUntilTransitions(*engine, 1, 5, "weighted host observer");
    require(stringOutput(*engine, "observed_path") == "A",
            "weighted host observer: expected observed_path=A");
    require(intOutput(*engine, "observed_total") == 1,
            "weighted host observer: expected observed_total=1");
    pass("04_weighted_probabilistic_host");
}

void testBytecodeSubsetIr() {
    auto engine = makeStartedEngine("05_bytecode_subset_ir.yaml");

    auto arm = engine->setInput("armed", aeth::Value(true));
    require(arm.isOk(), "bytecode subset ir: armed=true failed: " + arm.error());
    tickUntilTransitions(*engine, 1, 5, "bytecode subset ir armed");

    auto pulse = engine->setInput("pulse", aeth::Value(true));
    require(pulse.isOk(), "bytecode subset ir: pulse=true failed: " + pulse.error());
    tickUntilTransitions(*engine, 2, 5, "bytecode subset ir pulse");

    pass("05_bytecode_subset_yaml");
}

void testBytecodeArtifactIr() {
    auto engine = makeStartedBytecodeEngine();

    engine->tick();
    require(engine->status().transitionCount == 0,
            "bytecode artifact: expected no transition before inputs");

    auto arm = engine->setInput("armed", aeth::Value(true));
    require(arm.isOk(), "bytecode artifact: armed=true failed: " + arm.error());
    tickUntilTransitions(*engine, 1, 5, "bytecode artifact armed");

    auto pulse = engine->setInput("pulse", aeth::Value(true));
    require(pulse.isOk(), "bytecode artifact: pulse=true failed: " + pulse.error());
    tickUntilTransitions(*engine, 2, 5, "bytecode artifact pulse");

    pass("05_bytecode_artifact_ir");
}

void testBytecodeSubsetIrHostDriver() {
    auto engine = makeStartedEngine("05_bytecode_subset_ir_host.yaml");

    tickUntilTransitions(*engine, 3, 1000, "bytecode subset host driver");
    require(stringOutput(*engine, "driver_phase") == "done",
            "bytecode subset host driver: expected done");
    pass("05_bytecode_subset_ir_host");
}

} // namespace

int main() {
    testLuaHooksOutputs();
    testTimedPriorityTimeout();
    testEventEdgesThreshold();
    testEventEdgesThresholdHostDriver();
    testWeightedProbabilistic();
    testWeightedProbabilisticHostObserver();
    testBytecodeSubsetIr();
    testBytecodeArtifactIr();
    testBytecodeSubsetIrHostDriver();
    return 0;
}
