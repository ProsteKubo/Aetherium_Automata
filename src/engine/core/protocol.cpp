/**
 * Aetherium Automata - Protocol Implementation
 * 
 * Binary serialization for protocol messages.
 */

#include "protocol.hpp"
#include <cstring>

namespace aeth {
namespace protocol {

// ============================================================================
// Value Serialization
// ============================================================================

static void writeValue(ByteWriter& writer, const Value& val) {
    writer.writeU8(static_cast<uint8_t>(val.type()));
    
    switch (val.type()) {
        case ValueType::Void:
            break;
        case ValueType::Bool:
            writer.writeU8(val.get<bool>() ? 1 : 0);
            break;
        case ValueType::Int32:
            writer.writeU32(static_cast<uint32_t>(val.get<int32_t>()));
            break;
        case ValueType::Int64:
            writer.writeU64(static_cast<uint64_t>(val.get<int64_t>()));
            break;
        case ValueType::Float32: {
            float f = val.get<float>();
            uint32_t bits;
            std::memcpy(&bits, &f, sizeof(bits));
            writer.writeU32(bits);
            break;
        }
        case ValueType::Float64: {
            double d = val.get<double>();
            uint64_t bits;
            std::memcpy(&bits, &d, sizeof(bits));
            writer.writeU64(bits);
            break;
        }
        case ValueType::String:
            writer.writeString(val.get<std::string>());
            break;
        case ValueType::Binary:
            writer.writeBytes(val.get<std::vector<uint8_t>>());
            break;
        default:
            break;
    }
}

static std::optional<Value> readValue(ByteReader& reader) {
    auto typeOpt = reader.readU8();
    if (!typeOpt) return std::nullopt;
    
    ValueType type = static_cast<ValueType>(*typeOpt);
    
    switch (type) {
        case ValueType::Void:
            return Value();
        case ValueType::Bool: {
            auto v = reader.readU8();
            if (!v) return std::nullopt;
            return Value(*v != 0);
        }
        case ValueType::Int32: {
            auto v = reader.readU32();
            if (!v) return std::nullopt;
            return Value(static_cast<int32_t>(*v));
        }
        case ValueType::Int64: {
            auto v = reader.readU64();
            if (!v) return std::nullopt;
            return Value(static_cast<int64_t>(*v));
        }
        case ValueType::Float32: {
            auto bits = reader.readU32();
            if (!bits) return std::nullopt;
            float f;
            std::memcpy(&f, &*bits, sizeof(f));
            return Value(f);
        }
        case ValueType::Float64: {
            auto bits = reader.readU64();
            if (!bits) return std::nullopt;
            double d;
            std::memcpy(&d, &*bits, sizeof(d));
            return Value(d);
        }
        case ValueType::String: {
            auto s = reader.readString();
            if (!s) return std::nullopt;
            return Value(std::move(*s));
        }
        case ValueType::Binary: {
            auto b = reader.readBytes();
            if (!b) return std::nullopt;
            return Value(std::move(*b));
        }
        default:
            return std::nullopt;
    }
}

// ============================================================================
// Hello Message
// ============================================================================

std::vector<uint8_t> HelloMessage::serialize() const {
    ByteWriter w;
    w.writeU16(header.magic);
    w.writeU8(header.version);
    w.writeU8(static_cast<uint8_t>(MessageType::Hello));
    
    // Placeholder for length (we'll fill it in at the end)
    size_t lengthPos = w.size();
    w.writeU16(0);
    
    w.writeU32(messageId);
    w.writeU32(sourceId);
    w.writeU32(targetId);
    w.writeU8(static_cast<uint8_t>(deviceType));
    w.writeU8(versionMajor);
    w.writeU8(versionMinor);
    w.writeU8(versionPatch);
    w.writeU16(capabilities.raw);
    w.writeString(name);
    
    auto result = w.finish();
    
    // Fill in length
    uint16_t length = static_cast<uint16_t>(result.size() - HEADER_SIZE);
    result[lengthPos] = static_cast<uint8_t>(length >> 8);
    result[lengthPos + 1] = static_cast<uint8_t>(length & 0xFF);
    
    return result;
}

std::optional<HelloMessage> HelloMessage::deserialize(const uint8_t* data, size_t len) {
    ByteReader r(data, len);
    
    HelloMessage msg;
    
    auto magic = r.readU16();
    auto version = r.readU8();
    auto type = r.readU8();
    auto length = r.readU16();
    
    if (!magic || !version || !type || !length) return std::nullopt;
    if (*magic != MAGIC) return std::nullopt;
    
    auto msgId = r.readU32();
    auto srcId = r.readU32();
    auto tgtId = r.readU32();
    auto devType = r.readU8();
    auto verMaj = r.readU8();
    auto verMin = r.readU8();
    auto verPat = r.readU8();
    auto caps = r.readU16();
    auto name = r.readString();
    
    if (!msgId || !srcId || !tgtId || !devType || !verMaj || !verMin || 
        !verPat || !caps || !name) return std::nullopt;
    
    msg.messageId = *msgId;
    msg.sourceId = *srcId;
    msg.targetId = *tgtId;
    msg.deviceType = static_cast<DeviceType>(*devType);
    msg.versionMajor = *verMaj;
    msg.versionMinor = *verMin;
    msg.versionPatch = *verPat;
    msg.capabilities.raw = *caps;
    msg.name = std::move(*name);
    
    return msg;
}

// ============================================================================
// HelloAck Message
// ============================================================================

std::vector<uint8_t> HelloAckMessage::serialize() const {
    ByteWriter w;
    w.writeU16(header.magic);
    w.writeU8(header.version);
    w.writeU8(static_cast<uint8_t>(MessageType::HelloAck));
    
    size_t lengthPos = w.size();
    w.writeU16(0);
    
    w.writeU32(messageId);
    w.writeU32(sourceId);
    w.writeU32(targetId);
    w.writeU32(assignedId);
    w.writeU64(serverTime);
    w.writeU8(accepted ? 1 : 0);
    w.writeString(rejectReason);
    
    auto result = w.finish();
    uint16_t length = static_cast<uint16_t>(result.size() - HEADER_SIZE);
    result[lengthPos] = static_cast<uint8_t>(length >> 8);
    result[lengthPos + 1] = static_cast<uint8_t>(length & 0xFF);
    
    return result;
}

std::optional<HelloAckMessage> HelloAckMessage::deserialize(const uint8_t* data, size_t len) {
    ByteReader r(data, len);
    r.readU16(); r.readU8(); r.readU8(); r.readU16(); // Skip header
    
    HelloAckMessage msg;
    
    auto msgId = r.readU32();
    auto srcId = r.readU32();
    auto tgtId = r.readU32();
    auto assignedId = r.readU32();
    auto serverTime = r.readU64();
    auto accepted = r.readU8();
    auto reason = r.readString();
    
    if (!msgId || !srcId || !tgtId || !assignedId || !serverTime || 
        !accepted || !reason) return std::nullopt;
    
    msg.messageId = *msgId;
    msg.sourceId = *srcId;
    msg.targetId = *tgtId;
    msg.assignedId = *assignedId;
    msg.serverTime = *serverTime;
    msg.accepted = *accepted != 0;
    msg.rejectReason = std::move(*reason);
    
    return msg;
}

// ============================================================================
// Ping/Pong Messages
// ============================================================================

std::vector<uint8_t> PingMessage::serialize() const {
    ByteWriter w;
    w.writeU16(header.magic);
    w.writeU8(header.version);
    w.writeU8(static_cast<uint8_t>(MessageType::Ping));
    
    size_t lengthPos = w.size();
    w.writeU16(0);
    
    w.writeU32(messageId);
    w.writeU32(sourceId);
    w.writeU32(targetId);
    w.writeU64(timestamp);
    w.writeU32(sequenceNumber);
    
    auto result = w.finish();
    uint16_t length = static_cast<uint16_t>(result.size() - HEADER_SIZE);
    result[lengthPos] = static_cast<uint8_t>(length >> 8);
    result[lengthPos + 1] = static_cast<uint8_t>(length & 0xFF);
    
    return result;
}

std::optional<PingMessage> PingMessage::deserialize(const uint8_t* data, size_t len) {
    ByteReader r(data, len);
    r.readU16(); r.readU8(); r.readU8(); r.readU16();
    
    PingMessage msg;
    auto msgId = r.readU32();
    auto srcId = r.readU32();
    auto tgtId = r.readU32();
    auto ts = r.readU64();
    auto seq = r.readU32();
    
    if (!msgId || !srcId || !tgtId || !ts || !seq) return std::nullopt;
    
    msg.messageId = *msgId;
    msg.sourceId = *srcId;
    msg.targetId = *tgtId;
    msg.timestamp = *ts;
    msg.sequenceNumber = *seq;
    
    return msg;
}

std::vector<uint8_t> PongMessage::serialize() const {
    ByteWriter w;
    w.writeU16(header.magic);
    w.writeU8(header.version);
    w.writeU8(static_cast<uint8_t>(MessageType::Pong));
    
    size_t lengthPos = w.size();
    w.writeU16(0);
    
    w.writeU32(messageId);
    w.writeU32(sourceId);
    w.writeU32(targetId);
    w.writeU64(originalTimestamp);
    w.writeU64(responseTimestamp);
    w.writeU32(sequenceNumber);
    
    auto result = w.finish();
    uint16_t length = static_cast<uint16_t>(result.size() - HEADER_SIZE);
    result[lengthPos] = static_cast<uint8_t>(length >> 8);
    result[lengthPos + 1] = static_cast<uint8_t>(length & 0xFF);
    
    return result;
}

std::optional<PongMessage> PongMessage::deserialize(const uint8_t* data, size_t len) {
    ByteReader r(data, len);
    r.readU16(); r.readU8(); r.readU8(); r.readU16();
    
    PongMessage msg;
    auto msgId = r.readU32();
    auto srcId = r.readU32();
    auto tgtId = r.readU32();
    auto origTs = r.readU64();
    auto respTs = r.readU64();
    auto seq = r.readU32();
    
    if (!msgId || !srcId || !tgtId || !origTs || !respTs || !seq) return std::nullopt;
    
    msg.messageId = *msgId;
    msg.sourceId = *srcId;
    msg.targetId = *tgtId;
    msg.originalTimestamp = *origTs;
    msg.responseTimestamp = *respTs;
    msg.sequenceNumber = *seq;
    
    return msg;
}

// ============================================================================
// LoadAutomata Message
// ============================================================================

std::vector<uint8_t> LoadAutomataMessage::serialize() const {
    ByteWriter w;
    w.writeU16(header.magic);
    w.writeU8(header.version);
    w.writeU8(static_cast<uint8_t>(MessageType::LoadAutomata));
    
    size_t lengthPos = w.size();
    w.writeU16(0);
    
    w.writeU32(messageId);
    w.writeU32(sourceId);
    w.writeU32(targetId);
    w.writeU32(runId);
    w.writeU8(static_cast<uint8_t>(format));
    w.writeU8(isChunked ? 1 : 0);
    w.writeU16(chunkIndex);
    w.writeU16(totalChunks);
    w.writeU8(startAfterLoad ? 1 : 0);
    w.writeU8(replaceExisting ? 1 : 0);
    w.writeBytes(data);
    
    auto result = w.finish();
    uint16_t length = static_cast<uint16_t>(result.size() - HEADER_SIZE);
    result[lengthPos] = static_cast<uint8_t>(length >> 8);
    result[lengthPos + 1] = static_cast<uint8_t>(length & 0xFF);
    
    return result;
}

std::optional<LoadAutomataMessage> LoadAutomataMessage::deserialize(const uint8_t* data, size_t len) {
    ByteReader r(data, len);
    r.readU16(); r.readU8(); r.readU8(); r.readU16();
    
    LoadAutomataMessage msg;
    auto msgId = r.readU32();
    auto srcId = r.readU32();
    auto tgtId = r.readU32();
    auto runId = r.readU32();
    auto format = r.readU8();
    auto isChunked = r.readU8();
    auto chunkIdx = r.readU16();
    auto totalChunks = r.readU16();
    auto startAfter = r.readU8();
    auto replace = r.readU8();
    auto payload = r.readBytes();
    
    if (!msgId || !srcId || !tgtId || !runId || !format || !isChunked ||
        !chunkIdx || !totalChunks || !startAfter || !replace || !payload) {
        return std::nullopt;
    }
    
    msg.messageId = *msgId;
    msg.sourceId = *srcId;
    msg.targetId = *tgtId;
    msg.runId = *runId;
    msg.format = static_cast<AutomataFormat>(*format);
    msg.isChunked = *isChunked != 0;
    msg.chunkIndex = *chunkIdx;
    msg.totalChunks = *totalChunks;
    msg.startAfterLoad = *startAfter != 0;
    msg.replaceExisting = *replace != 0;
    msg.data = std::move(*payload);
    
    return msg;
}

// ============================================================================
// LoadAck Message
// ============================================================================

std::vector<uint8_t> LoadAckMessage::serialize() const {
    ByteWriter w;
    w.writeU16(header.magic);
    w.writeU8(header.version);
    w.writeU8(static_cast<uint8_t>(MessageType::LoadAck));
    
    size_t lengthPos = w.size();
    w.writeU16(0);
    
    w.writeU32(messageId);
    w.writeU32(sourceId);
    w.writeU32(targetId);
    w.writeU32(runId);
    w.writeU8(success ? 1 : 0);
    w.writeString(errorMessage);
    w.writeU16(static_cast<uint16_t>(warnings.size()));
    for (const auto& warn : warnings) {
        w.writeString(warn);
    }
    
    auto result = w.finish();
    uint16_t length = static_cast<uint16_t>(result.size() - HEADER_SIZE);
    result[lengthPos] = static_cast<uint8_t>(length >> 8);
    result[lengthPos + 1] = static_cast<uint8_t>(length & 0xFF);
    
    return result;
}

std::optional<LoadAckMessage> LoadAckMessage::deserialize(const uint8_t* data, size_t len) {
    ByteReader r(data, len);
    r.readU16(); r.readU8(); r.readU8(); r.readU16();
    
    LoadAckMessage msg;
    auto msgId = r.readU32();
    auto srcId = r.readU32();
    auto tgtId = r.readU32();
    auto runId = r.readU32();
    auto success = r.readU8();
    auto errMsg = r.readString();
    auto warnCount = r.readU16();
    
    if (!msgId || !srcId || !tgtId || !runId || !success || !errMsg || !warnCount) {
        return std::nullopt;
    }
    
    msg.messageId = *msgId;
    msg.sourceId = *srcId;
    msg.targetId = *tgtId;
    msg.runId = *runId;
    msg.success = *success != 0;
    msg.errorMessage = std::move(*errMsg);
    
    for (uint16_t i = 0; i < *warnCount; ++i) {
        auto warn = r.readString();
        if (!warn) return std::nullopt;
        msg.warnings.push_back(std::move(*warn));
    }
    
    return msg;
}

// ============================================================================
// Start/Stop Messages
// ============================================================================

std::vector<uint8_t> StartMessage::serialize() const {
    ByteWriter w;
    w.writeU16(header.magic);
    w.writeU8(header.version);
    w.writeU8(static_cast<uint8_t>(MessageType::Start));
    
    size_t lengthPos = w.size();
    w.writeU16(0);
    
    w.writeU32(messageId);
    w.writeU32(sourceId);
    w.writeU32(targetId);
    w.writeU32(runId);
    w.writeU8(startFromState.has_value() ? 1 : 0);
    if (startFromState) {
        w.writeU16(*startFromState);
    }
    
    auto result = w.finish();
    uint16_t length = static_cast<uint16_t>(result.size() - HEADER_SIZE);
    result[lengthPos] = static_cast<uint8_t>(length >> 8);
    result[lengthPos + 1] = static_cast<uint8_t>(length & 0xFF);
    
    return result;
}

std::optional<StartMessage> StartMessage::deserialize(const uint8_t* data, size_t len) {
    ByteReader r(data, len);
    r.readU16(); r.readU8(); r.readU8(); r.readU16();
    
    StartMessage msg;
    auto msgId = r.readU32();
    auto srcId = r.readU32();
    auto tgtId = r.readU32();
    auto runId = r.readU32();
    auto hasStart = r.readU8();
    
    if (!msgId || !srcId || !tgtId || !runId || !hasStart) return std::nullopt;
    
    msg.messageId = *msgId;
    msg.sourceId = *srcId;
    msg.targetId = *tgtId;
    msg.runId = *runId;
    
    if (*hasStart) {
        auto startState = r.readU16();
        if (!startState) return std::nullopt;
        msg.startFromState = *startState;
    }
    
    return msg;
}

std::vector<uint8_t> StopMessage::serialize() const {
    ByteWriter w;
    w.writeU16(header.magic);
    w.writeU8(header.version);
    w.writeU8(static_cast<uint8_t>(MessageType::Stop));
    
    size_t lengthPos = w.size();
    w.writeU16(0);
    
    w.writeU32(messageId);
    w.writeU32(sourceId);
    w.writeU32(targetId);
    w.writeU32(runId);
    w.writeU8(saveState ? 1 : 0);
    
    auto result = w.finish();
    uint16_t length = static_cast<uint16_t>(result.size() - HEADER_SIZE);
    result[lengthPos] = static_cast<uint8_t>(length >> 8);
    result[lengthPos + 1] = static_cast<uint8_t>(length & 0xFF);
    
    return result;
}

std::optional<StopMessage> StopMessage::deserialize(const uint8_t* data, size_t len) {
    ByteReader r(data, len);
    r.readU16(); r.readU8(); r.readU8(); r.readU16();
    
    StopMessage msg;
    auto msgId = r.readU32();
    auto srcId = r.readU32();
    auto tgtId = r.readU32();
    auto runId = r.readU32();
    auto saveState = r.readU8();
    
    if (!msgId || !srcId || !tgtId || !runId || !saveState) return std::nullopt;
    
    msg.messageId = *msgId;
    msg.sourceId = *srcId;
    msg.targetId = *tgtId;
    msg.runId = *runId;
    msg.saveState = *saveState != 0;
    
    return msg;
}

// ============================================================================
// Status Message
// ============================================================================

std::vector<uint8_t> StatusMessage::serialize() const {
    ByteWriter w;
    w.writeU16(header.magic);
    w.writeU8(header.version);
    w.writeU8(static_cast<uint8_t>(MessageType::Status));
    
    size_t lengthPos = w.size();
    w.writeU16(0);
    
    w.writeU32(messageId);
    w.writeU32(sourceId);
    w.writeU32(targetId);
    w.writeU32(runId);
    w.writeU8(static_cast<uint8_t>(executionState));
    w.writeU16(currentState);
    w.writeU64(uptime);
    w.writeU64(transitionCount);
    w.writeU64(tickCount);
    w.writeU32(errorCount);
    
    auto result = w.finish();
    uint16_t length = static_cast<uint16_t>(result.size() - HEADER_SIZE);
    result[lengthPos] = static_cast<uint8_t>(length >> 8);
    result[lengthPos + 1] = static_cast<uint8_t>(length & 0xFF);
    
    return result;
}

std::optional<StatusMessage> StatusMessage::deserialize(const uint8_t* data, size_t len) {
    ByteReader r(data, len);
    r.readU16(); r.readU8(); r.readU8(); r.readU16();
    
    StatusMessage msg;
    auto msgId = r.readU32();
    auto srcId = r.readU32();
    auto tgtId = r.readU32();
    auto runId = r.readU32();
    auto execState = r.readU8();
    auto currState = r.readU16();
    auto uptime = r.readU64();
    auto transCount = r.readU64();
    auto tickCount = r.readU64();
    auto errCount = r.readU32();
    
    if (!msgId || !srcId || !tgtId || !runId || !execState || !currState ||
        !uptime || !transCount || !tickCount || !errCount) {
        return std::nullopt;
    }
    
    msg.messageId = *msgId;
    msg.sourceId = *srcId;
    msg.targetId = *tgtId;
    msg.runId = *runId;
    msg.executionState = static_cast<ExecutionState>(*execState);
    msg.currentState = *currState;
    msg.uptime = *uptime;
    msg.transitionCount = *transCount;
    msg.tickCount = *tickCount;
    msg.errorCount = *errCount;
    
    return msg;
}

// ============================================================================
// Input/Output Messages
// ============================================================================

std::vector<uint8_t> InputMessage::serialize() const {
    ByteWriter w;
    w.writeU16(header.magic);
    w.writeU8(header.version);
    w.writeU8(static_cast<uint8_t>(MessageType::Input));
    
    size_t lengthPos = w.size();
    w.writeU16(0);
    
    w.writeU32(messageId);
    w.writeU32(sourceId);
    w.writeU32(targetId);
    w.writeU32(runId);
    w.writeU16(variableId);
    w.writeString(variableName);
    writeValue(w, value);
    
    auto result = w.finish();
    uint16_t length = static_cast<uint16_t>(result.size() - HEADER_SIZE);
    result[lengthPos] = static_cast<uint8_t>(length >> 8);
    result[lengthPos + 1] = static_cast<uint8_t>(length & 0xFF);
    
    return result;
}

std::optional<InputMessage> InputMessage::deserialize(const uint8_t* data, size_t len) {
    ByteReader r(data, len);
    r.readU16(); r.readU8(); r.readU8(); r.readU16();
    
    InputMessage msg;
    auto msgId = r.readU32();
    auto srcId = r.readU32();
    auto tgtId = r.readU32();
    auto runId = r.readU32();
    auto varId = r.readU16();
    auto varName = r.readString();
    auto val = readValue(r);
    
    if (!msgId || !srcId || !tgtId || !runId || !varId || !varName || !val) {
        return std::nullopt;
    }
    
    msg.messageId = *msgId;
    msg.sourceId = *srcId;
    msg.targetId = *tgtId;
    msg.runId = *runId;
    msg.variableId = *varId;
    msg.variableName = std::move(*varName);
    msg.value = std::move(*val);
    
    return msg;
}

std::vector<uint8_t> OutputMessage::serialize() const {
    ByteWriter w;
    w.writeU16(header.magic);
    w.writeU8(header.version);
    w.writeU8(static_cast<uint8_t>(MessageType::Output));
    
    size_t lengthPos = w.size();
    w.writeU16(0);
    
    w.writeU32(messageId);
    w.writeU32(sourceId);
    w.writeU32(targetId);
    w.writeU32(runId);
    w.writeU16(variableId);
    w.writeString(variableName);
    writeValue(w, value);
    w.writeU64(timestamp);
    
    auto result = w.finish();
    uint16_t length = static_cast<uint16_t>(result.size() - HEADER_SIZE);
    result[lengthPos] = static_cast<uint8_t>(length >> 8);
    result[lengthPos + 1] = static_cast<uint8_t>(length & 0xFF);
    
    return result;
}

std::optional<OutputMessage> OutputMessage::deserialize(const uint8_t* data, size_t len) {
    ByteReader r(data, len);
    r.readU16(); r.readU8(); r.readU8(); r.readU16();
    
    OutputMessage msg;
    auto msgId = r.readU32();
    auto srcId = r.readU32();
    auto tgtId = r.readU32();
    auto runId = r.readU32();
    auto varId = r.readU16();
    auto varName = r.readString();
    auto val = readValue(r);
    auto ts = r.readU64();
    
    if (!msgId || !srcId || !tgtId || !runId || !varId || !varName || !val || !ts) {
        return std::nullopt;
    }
    
    msg.messageId = *msgId;
    msg.sourceId = *srcId;
    msg.targetId = *tgtId;
    msg.runId = *runId;
    msg.variableId = *varId;
    msg.variableName = std::move(*varName);
    msg.value = std::move(*val);
    msg.timestamp = *ts;
    
    return msg;
}

// ============================================================================
// StateChange Message
// ============================================================================

std::vector<uint8_t> StateChangeMessage::serialize() const {
    ByteWriter w;
    w.writeU16(header.magic);
    w.writeU8(header.version);
    w.writeU8(static_cast<uint8_t>(MessageType::StateChange));
    
    size_t lengthPos = w.size();
    w.writeU16(0);
    
    w.writeU32(messageId);
    w.writeU32(sourceId);
    w.writeU32(targetId);
    w.writeU32(runId);
    w.writeU16(previousState);
    w.writeU16(newState);
    w.writeU16(firedTransition);
    w.writeU64(timestamp);
    
    auto result = w.finish();
    uint16_t length = static_cast<uint16_t>(result.size() - HEADER_SIZE);
    result[lengthPos] = static_cast<uint8_t>(length >> 8);
    result[lengthPos + 1] = static_cast<uint8_t>(length & 0xFF);
    
    return result;
}

std::optional<StateChangeMessage> StateChangeMessage::deserialize(const uint8_t* data, size_t len) {
    ByteReader r(data, len);
    r.readU16(); r.readU8(); r.readU8(); r.readU16();
    
    StateChangeMessage msg;
    auto msgId = r.readU32();
    auto srcId = r.readU32();
    auto tgtId = r.readU32();
    auto runId = r.readU32();
    auto prevState = r.readU16();
    auto newState = r.readU16();
    auto firedTrans = r.readU16();
    auto ts = r.readU64();
    
    if (!msgId || !srcId || !tgtId || !runId || !prevState || !newState || 
        !firedTrans || !ts) {
        return std::nullopt;
    }
    
    msg.messageId = *msgId;
    msg.sourceId = *srcId;
    msg.targetId = *tgtId;
    msg.runId = *runId;
    msg.previousState = *prevState;
    msg.newState = *newState;
    msg.firedTransition = *firedTrans;
    msg.timestamp = *ts;
    
    return msg;
}

// ============================================================================
// Telemetry Message
// ============================================================================

std::vector<uint8_t> TelemetryMessage::serialize() const {
    ByteWriter w;
    w.writeU16(header.magic);
    w.writeU8(header.version);
    w.writeU8(static_cast<uint8_t>(MessageType::Telemetry));
    
    size_t lengthPos = w.size();
    w.writeU16(0);
    
    w.writeU32(messageId);
    w.writeU32(sourceId);
    w.writeU32(targetId);
    w.writeU32(runId);
    w.writeU64(timestamp);
    w.writeU32(heapFree);
    w.writeU32(heapTotal);
    
    // Write cpuUsage as fixed-point
    w.writeU16(static_cast<uint16_t>(cpuUsage * 100));
    w.writeU32(tickRate);
    
    // Variable snapshot
    w.writeU16(static_cast<uint16_t>(variableSnapshot.size()));
    for (const auto& [id, val] : variableSnapshot) {
        w.writeU16(id);
        writeValue(w, val);
    }
    
    auto result = w.finish();
    uint16_t length = static_cast<uint16_t>(result.size() - HEADER_SIZE);
    result[lengthPos] = static_cast<uint8_t>(length >> 8);
    result[lengthPos + 1] = static_cast<uint8_t>(length & 0xFF);
    
    return result;
}

std::optional<TelemetryMessage> TelemetryMessage::deserialize(const uint8_t* data, size_t len) {
    ByteReader r(data, len);
    r.readU16(); r.readU8(); r.readU8(); r.readU16();
    
    TelemetryMessage msg;
    auto msgId = r.readU32();
    auto srcId = r.readU32();
    auto tgtId = r.readU32();
    auto runId = r.readU32();
    auto ts = r.readU64();
    auto heapFree = r.readU32();
    auto heapTotal = r.readU32();
    auto cpuFixed = r.readU16();
    auto tickRate = r.readU32();
    auto varCount = r.readU16();
    
    if (!msgId || !srcId || !tgtId || !runId || !ts || !heapFree || !heapTotal ||
        !cpuFixed || !tickRate || !varCount) {
        return std::nullopt;
    }
    
    msg.messageId = *msgId;
    msg.sourceId = *srcId;
    msg.targetId = *tgtId;
    msg.runId = *runId;
    msg.timestamp = *ts;
    msg.heapFree = *heapFree;
    msg.heapTotal = *heapTotal;
    msg.cpuUsage = static_cast<float>(*cpuFixed) / 100.0f;
    msg.tickRate = *tickRate;
    
    for (uint16_t i = 0; i < *varCount; ++i) {
        auto id = r.readU16();
        auto val = readValue(r);
        if (!id || !val) return std::nullopt;
        msg.variableSnapshot.emplace_back(*id, std::move(*val));
    }
    
    return msg;
}

// ============================================================================
// Error Message
// ============================================================================

std::vector<uint8_t> ErrorMessage::serialize() const {
    ByteWriter w;
    w.writeU16(header.magic);
    w.writeU8(header.version);
    w.writeU8(static_cast<uint8_t>(MessageType::Error));
    
    size_t lengthPos = w.size();
    w.writeU16(0);
    
    w.writeU32(messageId);
    w.writeU32(sourceId);
    w.writeU32(targetId);
    w.writeU16(static_cast<uint16_t>(code));
    w.writeString(message);
    w.writeU8(runId.has_value() ? 1 : 0);
    if (runId) w.writeU32(*runId);
    w.writeU8(relatedMessageId.has_value() ? 1 : 0);
    if (relatedMessageId) w.writeU32(*relatedMessageId);
    
    auto result = w.finish();
    uint16_t length = static_cast<uint16_t>(result.size() - HEADER_SIZE);
    result[lengthPos] = static_cast<uint8_t>(length >> 8);
    result[lengthPos + 1] = static_cast<uint8_t>(length & 0xFF);
    
    return result;
}

std::optional<ErrorMessage> ErrorMessage::deserialize(const uint8_t* data, size_t len) {
    ByteReader r(data, len);
    r.readU16(); r.readU8(); r.readU8(); r.readU16();
    
    ErrorMessage msg;
    auto msgId = r.readU32();
    auto srcId = r.readU32();
    auto tgtId = r.readU32();
    auto code = r.readU16();
    auto message = r.readString();
    auto hasRunId = r.readU8();
    
    if (!msgId || !srcId || !tgtId || !code || !message || !hasRunId) {
        return std::nullopt;
    }
    
    msg.messageId = *msgId;
    msg.sourceId = *srcId;
    msg.targetId = *tgtId;
    msg.code = static_cast<ErrorCode>(*code);
    msg.message = std::move(*message);
    
    if (*hasRunId) {
        auto runId = r.readU32();
        if (!runId) return std::nullopt;
        msg.runId = *runId;
    }
    
    auto hasRelated = r.readU8();
    if (hasRelated && *hasRelated) {
        auto related = r.readU32();
        if (!related) return std::nullopt;
        msg.relatedMessageId = *related;
    }
    
    return msg;
}

// ============================================================================
// Debug Message
// ============================================================================

std::vector<uint8_t> DebugMessage::serialize() const {
    ByteWriter w;
    w.writeU16(header.magic);
    w.writeU8(header.version);
    w.writeU8(static_cast<uint8_t>(MessageType::Debug));
    
    size_t lengthPos = w.size();
    w.writeU16(0);
    
    w.writeU32(messageId);
    w.writeU32(sourceId);
    w.writeU32(targetId);
    w.writeU8(static_cast<uint8_t>(level));
    w.writeString(source);
    w.writeString(message);
    w.writeU64(timestamp);
    
    auto result = w.finish();
    uint16_t length = static_cast<uint16_t>(result.size() - HEADER_SIZE);
    result[lengthPos] = static_cast<uint8_t>(length >> 8);
    result[lengthPos + 1] = static_cast<uint8_t>(length & 0xFF);
    
    return result;
}

std::optional<DebugMessage> DebugMessage::deserialize(const uint8_t* data, size_t len) {
    ByteReader r(data, len);
    r.readU16(); r.readU8(); r.readU8(); r.readU16();
    
    DebugMessage msg;
    auto msgId = r.readU32();
    auto srcId = r.readU32();
    auto tgtId = r.readU32();
    auto level = r.readU8();
    auto source = r.readString();
    auto message = r.readString();
    auto ts = r.readU64();
    
    if (!msgId || !srcId || !tgtId || !level || !source || !message || !ts) {
        return std::nullopt;
    }
    
    msg.messageId = *msgId;
    msg.sourceId = *srcId;
    msg.targetId = *tgtId;
    msg.level = static_cast<DebugLevel>(*level);
    msg.source = std::move(*source);
    msg.message = std::move(*message);
    msg.timestamp = *ts;
    
    return msg;
}

// ============================================================================
// Message Factory
// ============================================================================

std::unique_ptr<Message> MessageFactory::deserialize(const uint8_t* data, size_t len) {
    if (len < HEADER_SIZE) return nullptr;
    
    ByteReader r(data, len);
    auto magic = r.readU16();
    auto version = r.readU8();
    auto type = r.readU8();
    
    if (!magic || !version || !type || *magic != MAGIC) return nullptr;
    
    MessageType msgType = static_cast<MessageType>(*type);
    
    switch (msgType) {
        case MessageType::Hello: {
            auto msg = HelloMessage::deserialize(data, len);
            if (msg) return std::make_unique<HelloMessage>(std::move(*msg));
            break;
        }
        case MessageType::HelloAck: {
            auto msg = HelloAckMessage::deserialize(data, len);
            if (msg) return std::make_unique<HelloAckMessage>(std::move(*msg));
            break;
        }
        case MessageType::Ping: {
            auto msg = PingMessage::deserialize(data, len);
            if (msg) return std::make_unique<PingMessage>(std::move(*msg));
            break;
        }
        case MessageType::Pong: {
            auto msg = PongMessage::deserialize(data, len);
            if (msg) return std::make_unique<PongMessage>(std::move(*msg));
            break;
        }
        case MessageType::LoadAutomata: {
            auto msg = LoadAutomataMessage::deserialize(data, len);
            if (msg) return std::make_unique<LoadAutomataMessage>(std::move(*msg));
            break;
        }
        case MessageType::LoadAck: {
            auto msg = LoadAckMessage::deserialize(data, len);
            if (msg) return std::make_unique<LoadAckMessage>(std::move(*msg));
            break;
        }
        case MessageType::Start: {
            auto msg = StartMessage::deserialize(data, len);
            if (msg) return std::make_unique<StartMessage>(std::move(*msg));
            break;
        }
        case MessageType::Stop: {
            auto msg = StopMessage::deserialize(data, len);
            if (msg) return std::make_unique<StopMessage>(std::move(*msg));
            break;
        }
        case MessageType::Status: {
            auto msg = StatusMessage::deserialize(data, len);
            if (msg) return std::make_unique<StatusMessage>(std::move(*msg));
            break;
        }
        case MessageType::Input: {
            auto msg = InputMessage::deserialize(data, len);
            if (msg) return std::make_unique<InputMessage>(std::move(*msg));
            break;
        }
        case MessageType::Output: {
            auto msg = OutputMessage::deserialize(data, len);
            if (msg) return std::make_unique<OutputMessage>(std::move(*msg));
            break;
        }
        case MessageType::StateChange: {
            auto msg = StateChangeMessage::deserialize(data, len);
            if (msg) return std::make_unique<StateChangeMessage>(std::move(*msg));
            break;
        }
        case MessageType::Telemetry: {
            auto msg = TelemetryMessage::deserialize(data, len);
            if (msg) return std::make_unique<TelemetryMessage>(std::move(*msg));
            break;
        }
        case MessageType::Error: {
            auto msg = ErrorMessage::deserialize(data, len);
            if (msg) return std::make_unique<ErrorMessage>(std::move(*msg));
            break;
        }
        case MessageType::Debug: {
            auto msg = DebugMessage::deserialize(data, len);
            if (msg) return std::make_unique<DebugMessage>(std::move(*msg));
            break;
        }
        default:
            break;
    }
    
    return nullptr;
}

} // namespace protocol
} // namespace aeth
