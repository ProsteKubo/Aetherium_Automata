#ifndef AETHERIUM_PROTOCOL_V2_HPP
#define AETHERIUM_PROTOCOL_V2_HPP

#include "protocol.hpp"
#include "types.hpp"

#include <cstdint>
#include <optional>
#include <string>
#include <variant>
#include <vector>

namespace aeth::protocolv2 {

constexpr uint16_t MAGIC = 0xAE02;
constexpr uint8_t VERSION = 0x02;

enum class Outcome : uint8_t {
    None = 0,
    Ack = 1,
    Nak = 2,
    Error = 3,
    Status = 4
};

enum class LoadReplaceMode : uint8_t {
    HardReset = 0,
    CarryOverCompatible = 1
};

struct Extension {
    uint16_t type = 0;
    std::vector<uint8_t> data;
};

struct EmptyPayload {};
struct RawPayload { std::vector<uint8_t> data; };

struct HelloPayload {
    protocol::DeviceType deviceType = protocol::DeviceType::Unknown;
    uint8_t versionMajor = 0;
    uint8_t versionMinor = 0;
    uint8_t versionPatch = 0;
    uint16_t capabilities = 0;
    std::string name;
};

struct HelloAckPayload {
    DeviceId assignedId = 0;
    Timestamp serverTime = 0;
    bool accepted = true;
    std::string rejectReason;
};

struct PingPayload {
    Timestamp timestamp = 0;
    uint32_t sequenceNumber = 0;
};

struct PongPayload {
    Timestamp originalTimestamp = 0;
    Timestamp responseTimestamp = 0;
    uint32_t sequenceNumber = 0;
};

struct LoadAutomataPayload {
    protocol::AutomataFormat format = protocol::AutomataFormat::YAML;
    bool isChunked = false;
    uint16_t chunkIndex = 0;
    uint16_t totalChunks = 1;
    bool startAfterLoad = false;
    LoadReplaceMode replaceMode = LoadReplaceMode::HardReset;
    std::vector<uint8_t> data;
};

struct LoadAckPayload {
    bool success = true;
    std::string message;
    std::vector<std::string> warnings;
};

struct StartPayload {
    std::optional<StateId> startFromState;
};

struct StopPayload {
    bool saveState = false;
};

struct StatusPayload {
    ExecutionState executionState = ExecutionState::Unloaded;
    StateId currentState = INVALID_STATE;
    Timestamp uptime = 0;
    uint64_t transitionCount = 0;
    uint64_t tickCount = 0;
    uint32_t errorCount = 0;
};

struct VariablePayload {
    VariableId variableId = INVALID_VARIABLE;
    std::string variableName;
    Value value;
    Timestamp timestamp = 0;
};

struct StateChangePayload {
    StateId previousState = INVALID_STATE;
    StateId newState = INVALID_STATE;
    TransitionId firedTransition = INVALID_TRANSITION;
    Timestamp timestamp = 0;
};

struct TransitionFiredPayload {
    TransitionId transitionId = INVALID_TRANSITION;
    Timestamp timestamp = 0;
};

struct TelemetryPayload {
    Timestamp timestamp = 0;
    uint32_t heapFree = 0;
    uint32_t heapTotal = 0;
    float cpuUsage = 0.0f;
    uint32_t tickRate = 0;
    std::vector<std::pair<VariableId, Value>> variableSnapshot;
};

struct ProvisionPayload {
    std::vector<uint8_t> data;
};

struct GoodbyePayload {
    std::string reason;
};

struct VendorPayload {
    uint16_t vendorType = 0;
    std::vector<uint8_t> data;
};

struct DebugPayload {
    protocol::DebugLevel level = protocol::DebugLevel::Info;
    std::string source;
    std::string message;
    Timestamp timestamp = 0;
};

struct ErrorPayload {
    protocol::ErrorCode code = protocol::ErrorCode::Unknown;
    std::string message;
    std::optional<uint32_t> relatedMessageId;
};

struct AckPayload {
    uint32_t relatedMessageId = 0;
    std::string info;
};

struct NakPayload {
    uint32_t relatedMessageId = 0;
    uint16_t errorCode = 0;
    std::string reason;
};

using Payload = std::variant<
    EmptyPayload,
    RawPayload,
    HelloPayload,
    HelloAckPayload,
    PingPayload,
    PongPayload,
    LoadAutomataPayload,
    LoadAckPayload,
    StartPayload,
    StopPayload,
    StatusPayload,
    VariablePayload,
    StateChangePayload,
    TransitionFiredPayload,
    TelemetryPayload,
    ProvisionPayload,
    GoodbyePayload,
    VendorPayload,
    DebugPayload,
    ErrorPayload,
    AckPayload,
    NakPayload
>;

struct Frame {
    protocol::MessageType type = protocol::MessageType::Ping;
    uint32_t messageId = 0;
    DeviceId sourceId = 0;
    DeviceId targetId = 0;
    std::optional<RunId> runId;
    Outcome outcome = Outcome::None;
    Payload payload = EmptyPayload{};
    std::vector<Extension> extensions;
};

class ProtocolCodecV2 {
public:
    static Result<std::vector<uint8_t>> encode(const Frame& frame);
    static Result<Frame> decode(const uint8_t* data, size_t len);
    static Result<Frame> decode(const std::vector<uint8_t>& data) {
        return decode(data.data(), data.size());
    }

private:
    static Result<std::vector<uint8_t>> encodePayload(protocol::MessageType type,
                                                      const Payload& payload);
    static Result<Payload> decodePayload(protocol::MessageType type,
                                         const uint8_t* data,
                                         size_t len);
};

} // namespace aeth::protocolv2

#endif // AETHERIUM_PROTOCOL_V2_HPP
