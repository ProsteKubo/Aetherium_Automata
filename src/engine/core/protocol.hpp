/**
 * Aetherium Automata - Protocol Message Types
 * 
 * Wire protocol for communication between devices, server, and gateway.
 * Designed to be compact and efficient for embedded devices.
 */

#ifndef AETHERIUM_PROTOCOL_HPP
#define AETHERIUM_PROTOCOL_HPP

#include "types.hpp"
#include <cstdint>
#include <vector>
#include <string>
#include <optional>
#include <memory>
#include <array>

namespace aeth {
namespace protocol {

// ============================================================================
// Protocol Constants
// ============================================================================

constexpr uint16_t MAGIC = 0xAE01;  // Aetherium v1
constexpr uint8_t VERSION = 0x01;
constexpr size_t HEADER_SIZE = 6;   // Magic(2) + Version(1) + Type(1) + Length(2)
constexpr size_t MAX_MESSAGE_SIZE = 65535;

// ============================================================================
// Message Types
// ============================================================================

enum class MessageType : uint8_t {
    // Control Plane (0x00-0x3F)
    Hello = 0x01,
    HelloAck = 0x02,
    Discover = 0x03,
    Ping = 0x04,
    Pong = 0x05,
    Provision = 0x06,
    Goodbye = 0x07,

    // Automata Plane (0x40-0x7F)
    LoadAutomata = 0x40,
    LoadAck = 0x41,
    Start = 0x42,
    Stop = 0x43,
    Reset = 0x44,
    Status = 0x45,
    Pause = 0x46,
    Resume = 0x47,

    // Data Plane (0x80-0xBF)
    Input = 0x80,
    Output = 0x81,
    Variable = 0x82,
    StateChange = 0x83,
    Telemetry = 0x84,
    TransitionFired = 0x85,

    // Extended (0xC0-0xFF)
    Vendor = 0xC0,
    Debug = 0xD0,
    Error = 0xE0,
    Ack = 0xF0,
    Nak = 0xF1
};

// ============================================================================
// Device Types
// ============================================================================

enum class DeviceType : uint8_t {
    Unknown = 0x00,
    Desktop = 0x01,
    ESP32 = 0x02,
    Pico = 0x03,
    RaspberryPi = 0x04,
    Arduino = 0x05,
    Server = 0x10,
    Gateway = 0x11
};

// ============================================================================
// Device Capabilities (bitfield)
// ============================================================================

struct DeviceCapabilities {
    uint16_t raw = 0;

    bool supportsLua() const { return raw & (1 << 0); }
    bool supportsTimed() const { return raw & (1 << 1); }
    bool supportsProbabilistic() const { return raw & (1 << 2); }
    bool supportsFuzzy() const { return raw & (1 << 3); }
    bool hasPersistentStorage() const { return raw & (1 << 4); }
    bool hasRTC() const { return raw & (1 << 5); }
    bool supportsNested() const { return raw & (1 << 6); }
    bool supportsBytecode() const { return raw & (1 << 7); }

    void setLua(bool v) { setBit(0, v); }
    void setTimed(bool v) { setBit(1, v); }
    void setProbabilistic(bool v) { setBit(2, v); }
    void setFuzzy(bool v) { setBit(3, v); }
    void setPersistentStorage(bool v) { setBit(4, v); }
    void setRTC(bool v) { setBit(5, v); }
    void setNested(bool v) { setBit(6, v); }
    void setBytecode(bool v) { setBit(7, v); }

private:
    void setBit(int bit, bool v) {
        if (v) raw |= (1 << bit);
        else raw &= ~(1 << bit);
    }
};

// ============================================================================
// Automata Format for transmission
// ============================================================================

enum class AutomataFormat : uint8_t {
    Binary = 0x01,      // AetheriumBinary format
    YAML = 0x02,        // YAML text
    JSON = 0x03,        // JSON text
    MessagePack = 0x04  // MessagePack
};

// ============================================================================
// Message Header
// ============================================================================

struct MessageHeader {
    uint16_t magic = MAGIC;
    uint8_t version = VERSION;
    MessageType type = MessageType::Ping;
    uint16_t length = 0;

    bool isValid() const { return magic == MAGIC; }
};

// ============================================================================
// Base Message
// ============================================================================

struct Message {
    MessageHeader header;
    uint32_t messageId = 0;       // For correlation
    DeviceId sourceId = 0;        // Sender device ID
    DeviceId targetId = 0;        // Target device ID (0 = broadcast)
    std::optional<uint32_t> inReplyTo;  // For responses

    virtual ~Message() = default;
    virtual MessageType type() const = 0;
    
    // Serialization (to be implemented)
    virtual std::vector<uint8_t> serialize() const = 0;
};

// ============================================================================
// Control Plane Messages
// ============================================================================

struct HelloMessage : Message {
    DeviceType deviceType = DeviceType::Unknown;
    uint8_t versionMajor = 0;
    uint8_t versionMinor = 0;
    uint8_t versionPatch = 0;
    DeviceCapabilities capabilities;
    std::string name;

    MessageType type() const override { return MessageType::Hello; }
    std::vector<uint8_t> serialize() const override;
    static std::optional<HelloMessage> deserialize(const uint8_t* data, size_t len);
};

struct HelloAckMessage : Message {
    DeviceId assignedId = 0;
    Timestamp serverTime = 0;
    bool accepted = true;
    std::string rejectReason;

    MessageType type() const override { return MessageType::HelloAck; }
    std::vector<uint8_t> serialize() const override;
    static std::optional<HelloAckMessage> deserialize(const uint8_t* data, size_t len);
};

struct PingMessage : Message {
    Timestamp timestamp = 0;
    uint32_t sequenceNumber = 0;

    MessageType type() const override { return MessageType::Ping; }
    std::vector<uint8_t> serialize() const override;
    static std::optional<PingMessage> deserialize(const uint8_t* data, size_t len);
};

struct PongMessage : Message {
    Timestamp originalTimestamp = 0;
    Timestamp responseTimestamp = 0;
    uint32_t sequenceNumber = 0;

    MessageType type() const override { return MessageType::Pong; }
    std::vector<uint8_t> serialize() const override;
    static std::optional<PongMessage> deserialize(const uint8_t* data, size_t len);
};

// ============================================================================
// Automata Plane Messages
// ============================================================================

struct LoadAutomataMessage : Message {
    RunId runId = 0;
    AutomataFormat format = AutomataFormat::Binary;
    
    // Chunking support
    bool isChunked = false;
    uint16_t chunkIndex = 0;
    uint16_t totalChunks = 1;
    
    // Flags
    bool startAfterLoad = false;
    bool replaceExisting = true;
    
    // The automata data
    std::vector<uint8_t> data;

    MessageType type() const override { return MessageType::LoadAutomata; }
    std::vector<uint8_t> serialize() const override;
    static std::optional<LoadAutomataMessage> deserialize(const uint8_t* data, size_t len);
};

struct LoadAckMessage : Message {
    RunId runId = 0;
    bool success = true;
    std::string errorMessage;
    
    // Validation results
    std::vector<std::string> warnings;

    MessageType type() const override { return MessageType::LoadAck; }
    std::vector<uint8_t> serialize() const override;
    static std::optional<LoadAckMessage> deserialize(const uint8_t* data, size_t len);
};

struct StartMessage : Message {
    RunId runId = 0;
    std::optional<StateId> startFromState;  // Optional override

    MessageType type() const override { return MessageType::Start; }
    std::vector<uint8_t> serialize() const override;
    static std::optional<StartMessage> deserialize(const uint8_t* data, size_t len);
};

struct StopMessage : Message {
    RunId runId = 0;
    bool saveState = false;  // Persist current state for resume

    MessageType type() const override { return MessageType::Stop; }
    std::vector<uint8_t> serialize() const override;
    static std::optional<StopMessage> deserialize(const uint8_t* data, size_t len);
};

struct ResetMessage : Message {
    RunId runId = 0;

    MessageType type() const override { return MessageType::Reset; }
    std::vector<uint8_t> serialize() const override;
    static std::optional<ResetMessage> deserialize(const uint8_t* data, size_t len);
};

struct StatusMessage : Message {
    RunId runId = 0;
    ExecutionState executionState = ExecutionState::Unloaded;
    StateId currentState = INVALID_STATE;
    Timestamp uptime = 0;
    uint64_t transitionCount = 0;
    uint64_t tickCount = 0;
    uint32_t errorCount = 0;

    MessageType type() const override { return MessageType::Status; }
    std::vector<uint8_t> serialize() const override;
    static std::optional<StatusMessage> deserialize(const uint8_t* data, size_t len);
};

struct PauseMessage : Message {
    RunId runId = 0;

    MessageType type() const override { return MessageType::Pause; }
    std::vector<uint8_t> serialize() const override;
    static std::optional<PauseMessage> deserialize(const uint8_t* data, size_t len);
};

struct ResumeMessage : Message {
    RunId runId = 0;

    MessageType type() const override { return MessageType::Resume; }
    std::vector<uint8_t> serialize() const override;
    static std::optional<ResumeMessage> deserialize(const uint8_t* data, size_t len);
};

// ============================================================================
// Data Plane Messages
// ============================================================================

struct InputMessage : Message {
    RunId runId = 0;
    VariableId variableId = INVALID_VARIABLE;
    std::string variableName;  // Alternative to ID
    Value value;

    MessageType type() const override { return MessageType::Input; }
    std::vector<uint8_t> serialize() const override;
    static std::optional<InputMessage> deserialize(const uint8_t* data, size_t len);
};

struct OutputMessage : Message {
    RunId runId = 0;
    VariableId variableId = INVALID_VARIABLE;
    std::string variableName;
    Value value;
    Timestamp timestamp = 0;

    MessageType type() const override { return MessageType::Output; }
    std::vector<uint8_t> serialize() const override;
    static std::optional<OutputMessage> deserialize(const uint8_t* data, size_t len);
};

struct VariableMessage : Message {
    RunId runId = 0;
    VariableId variableId = INVALID_VARIABLE;
    std::string variableName;
    Value value;
    Timestamp timestamp = 0;

    MessageType type() const override { return MessageType::Variable; }
    std::vector<uint8_t> serialize() const override;
    static std::optional<VariableMessage> deserialize(const uint8_t* data, size_t len);
};

struct StateChangeMessage : Message {
    RunId runId = 0;
    StateId previousState = INVALID_STATE;
    StateId newState = INVALID_STATE;
    TransitionId firedTransition = INVALID_TRANSITION;
    Timestamp timestamp = 0;

    MessageType type() const override { return MessageType::StateChange; }
    std::vector<uint8_t> serialize() const override;
    static std::optional<StateChangeMessage> deserialize(const uint8_t* data, size_t len);
};

struct TelemetryMessage : Message {
    RunId runId = 0;
    Timestamp timestamp = 0;
    
    // Metrics
    uint32_t heapFree = 0;
    uint32_t heapTotal = 0;
    float cpuUsage = 0;
    uint32_t tickRate = 0;  // ticks per second
    
    // Optional variable snapshot
    std::vector<std::pair<VariableId, Value>> variableSnapshot;

    MessageType type() const override { return MessageType::Telemetry; }
    std::vector<uint8_t> serialize() const override;
    static std::optional<TelemetryMessage> deserialize(const uint8_t* data, size_t len);
};

struct TransitionFiredMessage : Message {
    RunId runId = 0;
    TransitionId transitionId = INVALID_TRANSITION;
    Timestamp timestamp = 0;

    MessageType type() const override { return MessageType::TransitionFired; }
    std::vector<uint8_t> serialize() const override;
    static std::optional<TransitionFiredMessage> deserialize(const uint8_t* data, size_t len);
};

// ============================================================================
// Error and Debug Messages
// ============================================================================

enum class ErrorCode : uint16_t {
    None = 0,
    Unknown = 1,
    InvalidMessage = 2,
    InvalidState = 3,
    InvalidTransition = 4,
    InvalidVariable = 5,
    TypeMismatch = 6,
    ParseError = 7,
    LuaError = 8,
    OutOfMemory = 9,
    Timeout = 10,
    NotRunning = 11,
    AlreadyRunning = 12,
    NotLoaded = 13
};

struct ErrorMessage : Message {
    ErrorCode code = ErrorCode::Unknown;
    std::string message;
    std::optional<RunId> runId;
    std::optional<uint32_t> relatedMessageId;

    MessageType type() const override { return MessageType::Error; }
    std::vector<uint8_t> serialize() const override;
    static std::optional<ErrorMessage> deserialize(const uint8_t* data, size_t len);
};

enum class DebugLevel : uint8_t {
    Trace = 0,
    Debug = 1,
    Info = 2,
    Warn = 3,
    Error = 4
};

struct DebugMessage : Message {
    DebugLevel level = DebugLevel::Info;
    std::string source;  // Component/module name
    std::string message;
    Timestamp timestamp = 0;

    MessageType type() const override { return MessageType::Debug; }
    std::vector<uint8_t> serialize() const override;
    static std::optional<DebugMessage> deserialize(const uint8_t* data, size_t len);
};

struct AckMessage : Message {
    uint32_t relatedMessageId = 0;
    std::string info;

    MessageType type() const override { return MessageType::Ack; }
    std::vector<uint8_t> serialize() const override;
    static std::optional<AckMessage> deserialize(const uint8_t* data, size_t len);
};

struct NakMessage : Message {
    uint32_t relatedMessageId = 0;
    uint16_t reasonCode = 0;
    std::string reason;

    MessageType type() const override { return MessageType::Nak; }
    std::vector<uint8_t> serialize() const override;
    static std::optional<NakMessage> deserialize(const uint8_t* data, size_t len);
};

struct RawMessage : Message {
    MessageType rawType = MessageType::Vendor;
    std::vector<uint8_t> payload;

    MessageType type() const override { return rawType; }
    std::vector<uint8_t> serialize() const override;
    static std::optional<RawMessage> deserialize(MessageType type, const uint8_t* data, size_t len);
};

// ============================================================================
// Message Factory
// ============================================================================

class MessageFactory {
public:
    static std::unique_ptr<Message> deserialize(const uint8_t* data, size_t len);
    static std::unique_ptr<Message> deserialize(const std::vector<uint8_t>& data) {
        return deserialize(data.data(), data.size());
    }
};

// ============================================================================
// Serialization Helpers
// ============================================================================

class ByteWriter {
public:
    ByteWriter() = default;
    explicit ByteWriter(size_t reserve) { data_.reserve(reserve); }

    void writeU8(uint8_t v) { data_.push_back(v); }
    void writeU16(uint16_t v) {
        data_.push_back(static_cast<uint8_t>(v >> 8));
        data_.push_back(static_cast<uint8_t>(v & 0xFF));
    }
    void writeU32(uint32_t v) {
        writeU16(static_cast<uint16_t>(v >> 16));
        writeU16(static_cast<uint16_t>(v & 0xFFFF));
    }
    void writeU64(uint64_t v) {
        writeU32(static_cast<uint32_t>(v >> 32));
        writeU32(static_cast<uint32_t>(v & 0xFFFFFFFF));
    }
    void writeString(const std::string& s) {
        writeU16(static_cast<uint16_t>(s.size()));
        for (char c : s) {
            data_.push_back(static_cast<uint8_t>(c));
        }
    }
    void writeBytes(const uint8_t* data, size_t len) {
        writeU16(static_cast<uint16_t>(len));
        data_.insert(data_.end(), data, data + len);
    }
    void writeBytes(const std::vector<uint8_t>& v) {
        writeBytes(v.data(), v.size());
    }

    [[nodiscard]] std::vector<uint8_t> finish() { return std::move(data_); }
    [[nodiscard]] size_t size() const { return data_.size(); }

private:
    std::vector<uint8_t> data_;
};

class ByteReader {
public:
    ByteReader(const uint8_t* data, size_t len) : data_(data), len_(len), pos_(0) {}

    [[nodiscard]] bool hasMore() const { return pos_ < len_; }
    [[nodiscard]] size_t remaining() const { return len_ - pos_; }

    std::optional<uint8_t> readU8() {
        if (pos_ >= len_) return std::nullopt;
        return data_[pos_++];
    }

    std::optional<uint16_t> readU16() {
        if (pos_ + 2 > len_) return std::nullopt;
        uint16_t v = (static_cast<uint16_t>(data_[pos_]) << 8) | data_[pos_ + 1];
        pos_ += 2;
        return v;
    }

    std::optional<uint32_t> readU32() {
        auto hi = readU16();
        auto lo = readU16();
        if (!hi || !lo) return std::nullopt;
        return (static_cast<uint32_t>(*hi) << 16) | *lo;
    }

    std::optional<uint64_t> readU64() {
        auto hi = readU32();
        auto lo = readU32();
        if (!hi || !lo) return std::nullopt;
        return (static_cast<uint64_t>(*hi) << 32) | *lo;
    }

    std::optional<std::string> readString() {
        auto len = readU16();
        if (!len || pos_ + *len > len_) return std::nullopt;
        std::string s(reinterpret_cast<const char*>(data_ + pos_), *len);
        pos_ += *len;
        return s;
    }

    std::optional<std::vector<uint8_t>> readBytes() {
        auto len = readU16();
        if (!len || pos_ + *len > len_) return std::nullopt;
        std::vector<uint8_t> v(data_ + pos_, data_ + pos_ + *len);
        pos_ += *len;
        return v;
    }

private:
    const uint8_t* data_;
    size_t len_;
    size_t pos_;
};

} // namespace protocol
} // namespace aeth

#endif // AETHERIUM_PROTOCOL_HPP
