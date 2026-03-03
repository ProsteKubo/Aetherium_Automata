#include "AetheriumAvrNode.hpp"

namespace aeth::embedded::arduino {

AetheriumAvrNode::AetheriumAvrNode(const AvrNodeOptions& options)
    : engine_(std::make_unique<ArduinoClock>(),
              [seed = options.randomSeed]() {
                  auto random = std::make_unique<ArduinoRandomSource>();
                  random->seed(seed);
                  return random;
              }(),
              std::make_unique<SimpleScriptEngine>())
    , options_(options) {}

Result<void> AetheriumAvrNode::begin() {
    auto initResult = engine_.initialize(options_.engineInit);
    if (initResult.isError()) {
        return initResult;
    }

    lastTickMs_ = 0;
    initialized_ = true;
    return Result<void>::ok();
}

void AetheriumAvrNode::loop() {
    if (!initialized_) {
        return;
    }

    // Use the platform clock bound into the runtime through Engine::tick().
    // We just rate-limit loop() calls to avoid busy-spinning on MCU.
    Timestamp wall = 0;
#ifdef ARDUINO
    wall = static_cast<Timestamp>(::millis());
#endif
    if (engine_.isRunning() && (lastTickMs_ == 0 || wall - lastTickMs_ >= options_.tickPeriodMs)) {
        engine_.tick();
        lastTickMs_ = wall;
    }
}

Result<RunId> AetheriumAvrNode::loadArtifact(const uint8_t* bytes,
                                             size_t len,
                                             protocolv2::LoadReplaceMode mode,
                                             bool startAfterLoad,
                                             std::optional<RunId> requestedRunId) {
    if (!initialized_) {
        return Result<RunId>::error("avr node not initialized");
    }
    if (!bytes || len == 0) {
        return Result<RunId>::error("artifact bytes missing");
    }
    std::vector<uint8_t> copy(bytes, bytes + static_cast<std::ptrdiff_t>(len));
    return engine_.loadAutomataFromBytes(copy, mode, startAfterLoad, requestedRunId);
}

Result<void> AetheriumAvrNode::start(std::optional<StateId> from) { return engine_.start(from); }
Result<void> AetheriumAvrNode::stop() { return engine_.stop(); }
Result<void> AetheriumAvrNode::pause() { return engine_.pause(); }
Result<void> AetheriumAvrNode::resume() { return engine_.resume(); }
Result<void> AetheriumAvrNode::reset() { return engine_.reset(); }

EngineStatus AetheriumAvrNode::status() const { return engine_.status(); }

} // namespace aeth::embedded::arduino
