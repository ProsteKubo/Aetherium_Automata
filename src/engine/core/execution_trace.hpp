#ifndef AETHERIUM_EXECUTION_TRACE_HPP
#define AETHERIUM_EXECUTION_TRACE_HPP

#include "protocol.hpp"
#include "types.hpp"

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace aeth {

struct BatteryProfile {
    bool present = false;
    bool externalPower = true;
    double chargePercent = 100.0;
    double lowThresholdPercent = 20.0;
    double drainPerTickPercent = 0.0;
    double drainPerMessagePercent = 0.0;
};

struct LatencyProfile {
    uint32_t budgetMs = 0;
    uint32_t warningMs = 0;
};

struct DeploymentDescriptor {
    std::string instanceId = "engine.local";
    std::string placement = "host";
    std::string transport = "local";
    std::string controlPlaneInstance = "server";
    std::string targetClass = "host-runtime";
    BatteryProfile battery;
    LatencyProfile latency;
};

struct FaultProfile {
    std::string name = "production";
    bool enabled = false;
    bool applyToIngress = false;
    bool applyToEgress = true;
    uint32_t fixedDelayMs = 0;
    uint32_t jitterMs = 0;
    double dropProbability = 0.0;
    double duplicateProbability = 0.0;
    double successProbability = 1.0;
    uint32_t disconnectPeriodMs = 0;
    uint32_t disconnectDurationMs = 0;

    [[nodiscard]] bool hasActiveEffects() const;
};

struct FaultDecision {
    bool dropped = false;
    uint32_t copies = 1;
    uint32_t appliedDelayMs = 0;
    Timestamp releaseTimestamp = 0;
    std::vector<std::string> actions;
};

struct TraceRecord {
    uint64_t seq = 0;
    std::string kind;
    std::string boundary;
    std::string category;
    std::string summary;
    std::string messageType;
    std::string sourceInstance;
    std::string targetInstance;
    std::string transport;
    std::string placement;
    std::optional<uint32_t> messageId;
    std::optional<uint32_t> relatedMessageId;
    std::optional<RunId> runId;
    std::optional<Timestamp> receiveTimestamp;
    std::optional<Timestamp> handleTimestamp;
    std::optional<Timestamp> sendTimestamp;
    std::optional<std::string> portName;
    std::optional<std::string> portDirection;
    std::optional<std::string> observableState;
    std::optional<double> batteryPercent;
    std::optional<bool> batteryLow;
    std::optional<uint32_t> latencyBudgetMs;
    std::optional<uint32_t> latencyWarningMs;
    std::optional<uint32_t> observedLatencyMs;
    std::optional<bool> latencyBudgetExceeded;
    std::vector<std::string> faultActions;
};

class LocalTraceStore {
public:
    void clear();
    void push(TraceRecord record);

    [[nodiscard]] const std::vector<TraceRecord>& records() const { return records_; }

    Result<void> writeJsonLines(const std::string& path) const;

    static const char* messageTypeName(protocol::MessageType type);

private:
    static std::string escapeJson(const std::string& input);

    uint64_t nextSeq_ = 1;
    std::vector<TraceRecord> records_;
};

} // namespace aeth

#endif // AETHERIUM_EXECUTION_TRACE_HPP
