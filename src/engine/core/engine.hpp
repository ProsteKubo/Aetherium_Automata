#ifndef AETHERIUM_ENGINE_HPP
#define AETHERIUM_ENGINE_HPP

#include "automata_loader.hpp"
#include "command_bus.hpp"
#include "lua_engine.hpp"
#include "protocol.hpp"
#include "protocol_v2.hpp"
#include "runtime.hpp"
#include "telemetry_log_hub.hpp"

#include <atomic>
#include <deque>
#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace aeth {

struct EngineInitOptions {
    uint32_t maxTickRate = 10;
    size_t logCapacity = 2048;
    DeviceId deviceId = 1;
    std::string deviceName = "cpp-engine";
};

struct EngineStatus {
    RunId runId = 0;
    ExecutionState executionState = ExecutionState::Unloaded;
    StateId currentState = INVALID_STATE;
    uint64_t tickCount = 0;
    uint64_t transitionCount = 0;
    uint32_t errorCount = 0;
    Timestamp uptime = 0;
};

class Engine {
public:
    using Replies = std::vector<std::unique_ptr<protocol::Message>>;

    Engine();

    Result<void> initialize(const EngineInitOptions& options = {});

    Result<RunId> loadAutomataFromFile(const std::string& filePath,
                                       protocolv2::LoadReplaceMode mode,
                                       bool startAfterLoad = false,
                                       std::optional<RunId> requestedRunId = std::nullopt);

    Result<RunId> loadAutomataFromYaml(const std::string& yaml,
                                       const std::string& basePath,
                                       protocolv2::LoadReplaceMode mode,
                                       bool startAfterLoad = false,
                                       std::optional<RunId> requestedRunId = std::nullopt);

    Result<void> start(std::optional<StateId> from = std::nullopt);
    Result<void> stop();
    Result<void> pause();
    Result<void> resume();
    Result<void> reset();

    Result<void> setInput(const std::string& name, Value value);
    Result<void> setInput(VariableId id, Value value);
    Result<void> setVariable(const std::string& name, Value value);
    Result<void> setVariable(VariableId id, Value value);

    [[nodiscard]] EngineStatus status() const;
    [[nodiscard]] std::vector<LogEvent> getLogs(const LogQuery& query = {}) const;
    void streamLogs(EventStreamCallback callback);

    void tick();

    void enqueueCommand(std::unique_ptr<protocol::Message> message);
    Replies processCommandQueue();

    Replies dispatch(const protocol::Message& message);

    [[nodiscard]] bool isLoaded() const { return runtime_.isLoaded(); }
    [[nodiscard]] bool isRunning() const { return runtime_.isRunning(); }
    [[nodiscard]] RunId activeRunId() const { return activeRunId_; }

    [[nodiscard]] DeviceId deviceId() const { return deviceId_; }
    [[nodiscard]] const std::string& deviceName() const { return deviceName_; }

private:
    void configureRuntimeCallbacks();
    void registerCommandHandlers();

    Replies ackWithStatus(const protocol::Message& request, const std::string& info = "ok");
    Replies nakWithStatus(const protocol::Message& request,
                          uint16_t reasonCode,
                          const std::string& reason);
    std::unique_ptr<protocol::StatusMessage> buildStatusMessage(DeviceId target) const;

    Result<RunId> applyLoadedAutomata(std::unique_ptr<Automata> automata,
                                      protocolv2::LoadReplaceMode mode,
                                      bool startAfterLoad,
                                      std::optional<RunId> requestedRunId);

    bool runIdMatches(const protocol::Message& message) const;
    static std::optional<RunId> extractRunId(const protocol::Message& message);

    Runtime runtime_;
    AutomataLoader loader_;
    TelemetryLogHub logHub_;
    CommandBus commandBus_;

    std::unique_ptr<Automata> loadedAutomata_;

    DeviceId deviceId_ = 1;
    std::string deviceName_ = "cpp-engine";
    std::atomic<RunId> activeRunId_{0};

    std::deque<std::unique_ptr<protocol::Message>> ingressQueue_;
    std::deque<std::unique_ptr<protocol::Message>> eventQueue_;
};

} // namespace aeth

#endif // AETHERIUM_ENGINE_HPP
