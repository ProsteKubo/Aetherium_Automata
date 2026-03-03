#ifndef AETHERIUM_EMBEDDED_ARDUINO_AVR_NODE_HPP
#define AETHERIUM_EMBEDDED_ARDUINO_AVR_NODE_HPP

#include "AetheriumAvrPlatform.hpp"
#include "engine/core/engine.hpp"
#include "engine/core/script_engine.hpp"

#include <cstddef>
#include <cstdint>
#include <vector>

namespace aeth::embedded::arduino {

struct AvrNodeOptions {
    EngineInitOptions engineInit;
    uint32_t tickPeriodMs = 10;
    uint64_t randomSeed = 0xA37E57ULL;
};

class AetheriumAvrNode {
public:
    explicit AetheriumAvrNode(const AvrNodeOptions& options = {});

    Result<void> begin();
    void loop();

    Result<RunId> loadArtifact(const uint8_t* bytes,
                               size_t len,
                               protocolv2::LoadReplaceMode mode = protocolv2::LoadReplaceMode::HardReset,
                               bool startAfterLoad = false,
                               std::optional<RunId> requestedRunId = std::nullopt);

    Result<void> start(std::optional<StateId> from = std::nullopt);
    Result<void> stop();
    Result<void> pause();
    Result<void> resume();
    Result<void> reset();

    EngineStatus status() const;
    Engine& engine() { return engine_; }
    const Engine& engine() const { return engine_; }

private:
    Engine engine_;
    AvrNodeOptions options_;
    Timestamp lastTickMs_ = 0;
    bool initialized_ = false;
};

} // namespace aeth::embedded::arduino

#endif // AETHERIUM_EMBEDDED_ARDUINO_AVR_NODE_HPP
