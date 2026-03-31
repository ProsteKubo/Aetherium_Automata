#ifndef AETHERIUM_ENGINE_HPP
#define AETHERIUM_ENGINE_HPP

#include "artifact.hpp"
#include "command_bus.hpp"
#include "execution_trace.hpp"
#include "protocol.hpp"
#include "protocol_v2.hpp"
#include "runtime.hpp"
#include "telemetry_log_hub.hpp"

#include <atomic>
#include <deque>
#include <random>
#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace aeth {

struct EngineFrontendLoaderHandle;

struct EngineInitOptions {
    uint32_t maxTickRate = 10;
    size_t logCapacity = 2048;
    DeviceId deviceId = 1;
    std::string deviceName = "cpp-engine";
    std::optional<uint64_t> faultRandomSeed = std::nullopt;
    std::optional<std::string> traceOutputPath = std::nullopt;
    DeploymentDescriptor deployment;
    FaultProfile faultProfile;
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
    Engine(std::unique_ptr<IClock> clock,
           std::unique_ptr<IRandomSource> random,
           std::unique_ptr<IScriptEngine> script);
    ~Engine();

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

    Result<RunId> loadAutomataFromArtifact(const ir::AutomataArtifact& artifact,
                                           protocolv2::LoadReplaceMode mode,
                                           bool startAfterLoad = false,
                                           std::optional<RunId> requestedRunId = std::nullopt);

    Result<RunId> loadAutomataFromBytes(const std::vector<uint8_t>& bytes,
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
    [[nodiscard]] const DeploymentDescriptor& deploymentDescriptor() const { return deployment_; }
    [[nodiscard]] const FaultProfile& faultProfile() const { return faultProfile_; }
    [[nodiscard]] const LocalTraceStore& traceStore() const { return traceStore_; }

    void setDeploymentDescriptor(DeploymentDescriptor descriptor);
    void setFaultProfile(FaultProfile profile);
    void setTraceOutputPath(std::optional<std::string> path);
    Result<void> writeTrace() const;

    void tick();

    void enqueueCommand(std::unique_ptr<protocol::Message> message);
    Replies processCommandQueue();

    Replies dispatch(const protocol::Message& message);

    [[nodiscard]] bool isLoaded() const { return runtime_.isLoaded(); }
    [[nodiscard]] bool isRunning() const { return runtime_.isRunning(); }
    [[nodiscard]] RunId activeRunId() const { return activeRunId_; }

    [[nodiscard]] DeviceId deviceId() const { return deviceId_; }
    [[nodiscard]] const std::string& deviceName() const { return deviceName_; }
    [[nodiscard]] std::unique_ptr<protocol::TelemetryMessage> buildTelemetryMessage(DeviceId target = 0) const;

private:
    struct ScheduledIngressMessage {
        Timestamp releaseAt = 0;
        std::unique_ptr<protocol::Message> message;
        Timestamp receiveTimestamp = 0;
        std::vector<std::string> faultActions;
    };

    struct ScheduledOutboundMessage {
        Timestamp releaseAt = 0;
        std::unique_ptr<protocol::Message> message;
        std::optional<Timestamp> receiveTimestamp;
        std::optional<Timestamp> handleTimestamp;
        std::vector<std::string> faultActions;
    };

    struct PendingChunkedLoad {
        bool active = false;
        DeviceId sourceId = 0;
        RunId runId = 0;
        protocol::AutomataFormat format = protocol::AutomataFormat::Binary;
        bool startAfterLoad = false;
        bool replaceExisting = true;
        uint16_t totalChunks = 0;
        uint16_t nextChunkIndex = 0;
        size_t totalBytes = 0;
        std::vector<uint8_t> data;
    };

    static constexpr size_t kMaxChunkedLoadBytes = 128 * 1024;

    void configureRuntimeCallbacks();
    void registerCommandHandlers();
    void resetPendingChunkedLoad();
    Result<bool> appendChunkedLoad(const protocol::LoadAutomataMessage& load,
                                   std::vector<uint8_t>& assembledData);
    Result<RunId> applyProtocolLoad(const protocol::LoadAutomataMessage& load,
                                    const std::vector<uint8_t>& data);

    Replies ackWithStatus(const protocol::Message& request, const std::string& info = "ok");
    Replies nakWithStatus(const protocol::Message& request,
                          uint16_t reasonCode,
                          const std::string& reason);
    std::unique_ptr<protocol::StatusMessage> buildStatusMessage(DeviceId target) const;
    std::vector<protocol::NamedValueSnapshotEntry> collectNamedVariableSnapshot() const;
    protocol::DeploymentMetadataExtension collectDeploymentMetadataExtension() const;
    void traceLifecycleEvent(const std::string& summary,
                             const std::string& category,
                             std::optional<RunId> runId = std::nullopt);
    void traceRuntimeEvent(const std::string& kind,
                           const std::string& category,
                           const std::string& summary,
                           std::optional<RunId> runId = std::nullopt,
                           std::optional<Timestamp> handleTimestamp = std::nullopt,
                           std::optional<Timestamp> sendTimestamp = std::nullopt,
                           std::vector<std::string> faultActions = {},
                           std::optional<std::string> portName = std::nullopt,
                           std::optional<std::string> portDirection = std::nullopt,
                           std::optional<std::string> observableState = std::nullopt);
    void traceMessageEvent(const protocol::Message& message,
                           const std::string& kind,
                           const std::string& boundary,
                           const std::string& summary,
                           std::optional<Timestamp> receiveTimestamp,
                           std::optional<Timestamp> handleTimestamp,
                           std::optional<Timestamp> sendTimestamp,
                           std::vector<std::string> faultActions = {});
    void applyDeploymentMetrics(TraceRecord& record,
                                std::optional<uint32_t> observedLatencyMs = std::nullopt) const;
    void consumeBattery(double percent);
    FaultDecision decideFaultDelivery(bool forIngress, Timestamp now);
    void stageOutbound(std::unique_ptr<protocol::Message> message,
                       std::optional<Timestamp> receiveTimestamp = std::nullopt,
                       std::optional<Timestamp> handleTimestamp = std::nullopt);
    void releaseReadyOutbound(Replies& replies);

    Result<RunId> applyLoadedAutomata(std::unique_ptr<Automata> automata,
                                      protocolv2::LoadReplaceMode mode,
                                      bool startAfterLoad,
                                      std::optional<RunId> requestedRunId);

    bool runIdMatches(const protocol::Message& message) const;
    static std::optional<RunId> extractRunId(const protocol::Message& message);

    Runtime runtime_;
    std::unique_ptr<EngineFrontendLoaderHandle> frontendLoader_;
    TelemetryLogHub logHub_;
    CommandBus commandBus_;

    std::unique_ptr<Automata> loadedAutomata_;

    DeviceId deviceId_ = 1;
    std::string deviceName_ = "cpp-engine";
    std::atomic<RunId> activeRunId_{0};
    DeploymentDescriptor deployment_;
    FaultProfile faultProfile_;
    LocalTraceStore traceStore_;
    std::optional<std::string> traceOutputPath_;
    std::mt19937_64 faultRandom_{std::random_device{}()};
    double batteryPercent_ = 100.0;
    uint32_t lastObservedLatencyMs_ = 0;
    uint32_t lastIngressLatencyMs_ = 0;
    uint32_t lastEgressLatencyMs_ = 0;
    Timestamp lastSendTimestamp_ = 0;
    Timestamp lastReceiveTimestamp_ = 0;
    Timestamp lastHandleTimestamp_ = 0;

    std::deque<ScheduledIngressMessage> ingressQueue_;
    std::deque<std::unique_ptr<protocol::Message>> eventQueue_;
    std::deque<ScheduledOutboundMessage> delayedOutboundQueue_;
    PendingChunkedLoad pendingChunkedLoad_;
};

} // namespace aeth

#endif // AETHERIUM_ENGINE_HPP
