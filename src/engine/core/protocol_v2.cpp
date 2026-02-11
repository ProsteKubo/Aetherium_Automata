#include "protocol_v2.hpp"

#include <cstring>

namespace aeth::protocolv2 {

namespace {

class Writer {
public:
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
        data_.insert(data_.end(), s.begin(), s.end());
    }
    void writeBytes(const std::vector<uint8_t>& bytes) {
        writeU32(static_cast<uint32_t>(bytes.size()));
        data_.insert(data_.end(), bytes.begin(), bytes.end());
    }
    [[nodiscard]] std::vector<uint8_t> finish() { return std::move(data_); }
private:
    std::vector<uint8_t> data_;
};

class Reader {
public:
    Reader(const uint8_t* data, size_t len) : data_(data), len_(len) {}

    std::optional<uint8_t> readU8() {
        if (pos_ + 1 > len_) return std::nullopt;
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
        auto len = readU32();
        if (!len || pos_ + *len > len_) return std::nullopt;
        std::vector<uint8_t> bytes(data_ + pos_, data_ + pos_ + *len);
        pos_ += *len;
        return bytes;
    }
    [[nodiscard]] size_t pos() const { return pos_; }
    [[nodiscard]] size_t remaining() const { return len_ - pos_; }

private:
    const uint8_t* data_ = nullptr;
    size_t len_ = 0;
    size_t pos_ = 0;
};

void writeValue(Writer& writer, const Value& value) {
    writer.writeU8(static_cast<uint8_t>(value.type()));
    switch (value.type()) {
        case ValueType::Void:
            break;
        case ValueType::Bool:
            writer.writeU8(value.get<bool>() ? 1 : 0);
            break;
        case ValueType::Int32:
            writer.writeU32(static_cast<uint32_t>(value.get<int32_t>()));
            break;
        case ValueType::Int64:
            writer.writeU64(static_cast<uint64_t>(value.get<int64_t>()));
            break;
        case ValueType::Float32: {
            const float f = value.get<float>();
            uint32_t bits = 0;
            std::memcpy(&bits, &f, sizeof(bits));
            writer.writeU32(bits);
            break;
        }
        case ValueType::Float64: {
            const double d = value.get<double>();
            uint64_t bits = 0;
            std::memcpy(&bits, &d, sizeof(bits));
            writer.writeU64(bits);
            break;
        }
        case ValueType::String:
            writer.writeString(value.get<std::string>());
            break;
        case ValueType::Binary:
            writer.writeBytes(value.get<std::vector<uint8_t>>());
            break;
        default:
            break;
    }
}

std::optional<Value> readValue(Reader& reader) {
    auto type = reader.readU8();
    if (!type) return std::nullopt;

    switch (static_cast<ValueType>(*type)) {
        case ValueType::Void:
            return Value();
        case ValueType::Bool: {
            auto b = reader.readU8();
            if (!b) return std::nullopt;
            return Value(*b != 0);
        }
        case ValueType::Int32: {
            auto n = reader.readU32();
            if (!n) return std::nullopt;
            return Value(static_cast<int32_t>(*n));
        }
        case ValueType::Int64: {
            auto n = reader.readU64();
            if (!n) return std::nullopt;
            return Value(static_cast<int64_t>(*n));
        }
        case ValueType::Float32: {
            auto bits = reader.readU32();
            if (!bits) return std::nullopt;
            float f = 0.0f;
            std::memcpy(&f, &*bits, sizeof(f));
            return Value(f);
        }
        case ValueType::Float64: {
            auto bits = reader.readU64();
            if (!bits) return std::nullopt;
            double d = 0.0;
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

} // namespace

Result<std::vector<uint8_t>> ProtocolCodecV2::encode(const Frame& frame) {
    auto payloadRes = encodePayload(frame.type, frame.payload);
    if (payloadRes.isError()) {
        return Result<std::vector<uint8_t>>::error(payloadRes.error());
    }

    const std::vector<uint8_t> payload = payloadRes.value();

    Writer writer;
    writer.writeU16(MAGIC);
    writer.writeU8(VERSION);
    writer.writeU8(static_cast<uint8_t>(frame.type));

    uint8_t flags = 0;
    if (frame.runId.has_value()) flags |= 0x01;
    if (frame.outcome != Outcome::None) flags |= 0x02;
    if (!frame.extensions.empty()) flags |= 0x04;
    writer.writeU8(flags);
    writer.writeU8(0); // reserved

    writer.writeU32(frame.messageId);
    writer.writeU32(frame.sourceId);
    writer.writeU32(frame.targetId);

    if (frame.runId) {
        writer.writeU32(*frame.runId);
    }
    if (frame.outcome != Outcome::None) {
        writer.writeU8(static_cast<uint8_t>(frame.outcome));
    }

    writer.writeU32(static_cast<uint32_t>(payload.size()));
    writer.writeU8(static_cast<uint8_t>(frame.extensions.size()));

    for (auto b : payload) {
        writer.writeU8(b);
    }

    for (const auto& ext : frame.extensions) {
        writer.writeU16(ext.type);
        writer.writeU16(static_cast<uint16_t>(ext.data.size()));
        for (auto b : ext.data) {
            writer.writeU8(b);
        }
    }

    return Result<std::vector<uint8_t>>::ok(writer.finish());
}

Result<Frame> ProtocolCodecV2::decode(const uint8_t* data, size_t len) {
    Reader reader(data, len);

    auto magic = reader.readU16();
    auto version = reader.readU8();
    auto typeRaw = reader.readU8();
    auto flags = reader.readU8();
    auto reserved = reader.readU8();
    (void)reserved;
    if (!magic || !version || !typeRaw || !flags) {
        return Result<Frame>::error("protocol_v2: truncated header");
    }
    if (*magic != MAGIC) {
        return Result<Frame>::error("protocol_v2: bad magic");
    }
    if (*version != VERSION) {
        return Result<Frame>::error("protocol_v2: unsupported version");
    }

    auto msgId = reader.readU32();
    auto sourceId = reader.readU32();
    auto targetId = reader.readU32();
    if (!msgId || !sourceId || !targetId) {
        return Result<Frame>::error("protocol_v2: truncated envelope");
    }

    Frame frame;
    frame.type = static_cast<protocol::MessageType>(*typeRaw);
    frame.messageId = *msgId;
    frame.sourceId = *sourceId;
    frame.targetId = *targetId;

    if ((*flags & 0x01) != 0) {
        auto runId = reader.readU32();
        if (!runId) return Result<Frame>::error("protocol_v2: missing run_id");
        frame.runId = *runId;
    }

    if ((*flags & 0x02) != 0) {
        auto outcome = reader.readU8();
        if (!outcome) return Result<Frame>::error("protocol_v2: missing outcome");
        frame.outcome = static_cast<Outcome>(*outcome);
    }

    auto payloadLen = reader.readU32();
    auto extCount = reader.readU8();
    if (!payloadLen || !extCount) {
        return Result<Frame>::error("protocol_v2: truncated length fields");
    }
    if (reader.remaining() < *payloadLen) {
        return Result<Frame>::error("protocol_v2: payload length out of bounds");
    }

    const uint8_t* payloadPtr = data + reader.pos();
    auto payloadRes = decodePayload(frame.type, payloadPtr, *payloadLen);
    if (payloadRes.isError()) {
        return Result<Frame>::error(payloadRes.error());
    }
    frame.payload = payloadRes.value();

    Reader payloadReader(payloadPtr, *payloadLen);
    while (payloadReader.remaining() > 0) {
        if (!payloadReader.readU8()) {
            break;
        }
    }

    Reader extReader(payloadPtr + *payloadLen, reader.remaining() - *payloadLen);
    for (uint8_t i = 0; i < *extCount; ++i) {
        auto extType = extReader.readU16();
        auto extLen = extReader.readU16();
        if (!extType || !extLen) {
            return Result<Frame>::error("protocol_v2: malformed extension header");
        }
        if (extReader.remaining() < *extLen) {
            return Result<Frame>::error("protocol_v2: malformed extension payload");
        }
        std::vector<uint8_t> extData;
        extData.reserve(*extLen);
        for (uint16_t j = 0; j < *extLen; ++j) {
            auto b = extReader.readU8();
            if (!b) return Result<Frame>::error("protocol_v2: malformed extension byte");
            extData.push_back(*b);
        }
        frame.extensions.push_back(Extension{*extType, std::move(extData)});
    }

    return Result<Frame>::ok(std::move(frame));
}

Result<std::vector<uint8_t>> ProtocolCodecV2::encodePayload(protocol::MessageType type,
                                                            const Payload& payload) {
    Writer w;

    switch (type) {
        case protocol::MessageType::Hello: {
            if (auto* p = std::get_if<HelloPayload>(&payload)) {
                w.writeU8(static_cast<uint8_t>(p->deviceType));
                w.writeU8(p->versionMajor);
                w.writeU8(p->versionMinor);
                w.writeU8(p->versionPatch);
                w.writeU16(p->capabilities);
                w.writeString(p->name);
            }
            break;
        }
        case protocol::MessageType::HelloAck: {
            if (auto* p = std::get_if<HelloAckPayload>(&payload)) {
                w.writeU32(p->assignedId);
                w.writeU64(p->serverTime);
                w.writeU8(p->accepted ? 1 : 0);
                w.writeString(p->rejectReason);
            }
            break;
        }
        case protocol::MessageType::Ping: {
            if (auto* p = std::get_if<PingPayload>(&payload)) {
                w.writeU64(p->timestamp);
                w.writeU32(p->sequenceNumber);
            }
            break;
        }
        case protocol::MessageType::Pong: {
            if (auto* p = std::get_if<PongPayload>(&payload)) {
                w.writeU64(p->originalTimestamp);
                w.writeU64(p->responseTimestamp);
                w.writeU32(p->sequenceNumber);
            }
            break;
        }
        case protocol::MessageType::LoadAutomata: {
            if (auto* p = std::get_if<LoadAutomataPayload>(&payload)) {
                w.writeU8(static_cast<uint8_t>(p->format));
                w.writeU8(p->isChunked ? 1 : 0);
                w.writeU16(p->chunkIndex);
                w.writeU16(p->totalChunks);
                w.writeU8(p->startAfterLoad ? 1 : 0);
                w.writeU8(static_cast<uint8_t>(p->replaceMode));
                w.writeBytes(p->data);
            }
            break;
        }
        case protocol::MessageType::LoadAck: {
            if (auto* p = std::get_if<LoadAckPayload>(&payload)) {
                w.writeU8(p->success ? 1 : 0);
                w.writeString(p->message);
                w.writeU16(static_cast<uint16_t>(p->warnings.size()));
                for (const auto& warn : p->warnings) {
                    w.writeString(warn);
                }
            }
            break;
        }
        case protocol::MessageType::Start: {
            if (auto* p = std::get_if<StartPayload>(&payload)) {
                w.writeU8(p->startFromState.has_value() ? 1 : 0);
                if (p->startFromState) {
                    w.writeU16(*p->startFromState);
                }
            }
            break;
        }
        case protocol::MessageType::Stop: {
            if (auto* p = std::get_if<StopPayload>(&payload)) {
                w.writeU8(p->saveState ? 1 : 0);
            }
            break;
        }
        case protocol::MessageType::Status: {
            if (auto* p = std::get_if<StatusPayload>(&payload)) {
                w.writeU8(static_cast<uint8_t>(p->executionState));
                w.writeU16(p->currentState);
                w.writeU64(p->uptime);
                w.writeU64(p->transitionCount);
                w.writeU64(p->tickCount);
                w.writeU32(p->errorCount);
            }
            break;
        }
        case protocol::MessageType::Input:
        case protocol::MessageType::Output:
        case protocol::MessageType::Variable: {
            if (auto* p = std::get_if<VariablePayload>(&payload)) {
                w.writeU16(p->variableId);
                w.writeString(p->variableName);
                writeValue(w, p->value);
                w.writeU64(p->timestamp);
            }
            break;
        }
        case protocol::MessageType::StateChange: {
            if (auto* p = std::get_if<StateChangePayload>(&payload)) {
                w.writeU16(p->previousState);
                w.writeU16(p->newState);
                w.writeU16(p->firedTransition);
                w.writeU64(p->timestamp);
            }
            break;
        }
        case protocol::MessageType::TransitionFired: {
            if (auto* p = std::get_if<TransitionFiredPayload>(&payload)) {
                w.writeU16(p->transitionId);
                w.writeU64(p->timestamp);
            }
            break;
        }
        case protocol::MessageType::Telemetry: {
            if (auto* p = std::get_if<TelemetryPayload>(&payload)) {
                w.writeU64(p->timestamp);
                w.writeU32(p->heapFree);
                w.writeU32(p->heapTotal);
                w.writeU16(static_cast<uint16_t>(p->cpuUsage * 100));
                w.writeU32(p->tickRate);
                w.writeU16(static_cast<uint16_t>(p->variableSnapshot.size()));
                for (const auto& item : p->variableSnapshot) {
                    w.writeU16(item.first);
                    writeValue(w, item.second);
                }
            }
            break;
        }
        case protocol::MessageType::Provision: {
            if (auto* p = std::get_if<ProvisionPayload>(&payload)) {
                w.writeBytes(p->data);
            }
            break;
        }
        case protocol::MessageType::Goodbye: {
            if (auto* p = std::get_if<GoodbyePayload>(&payload)) {
                w.writeString(p->reason);
            }
            break;
        }
        case protocol::MessageType::Vendor: {
            if (auto* p = std::get_if<VendorPayload>(&payload)) {
                w.writeU16(p->vendorType);
                w.writeBytes(p->data);
            }
            break;
        }
        case protocol::MessageType::Debug: {
            if (auto* p = std::get_if<DebugPayload>(&payload)) {
                w.writeU8(static_cast<uint8_t>(p->level));
                w.writeString(p->source);
                w.writeString(p->message);
                w.writeU64(p->timestamp);
            }
            break;
        }
        case protocol::MessageType::Error: {
            if (auto* p = std::get_if<ErrorPayload>(&payload)) {
                w.writeU16(static_cast<uint16_t>(p->code));
                w.writeString(p->message);
                w.writeU8(p->relatedMessageId.has_value() ? 1 : 0);
                if (p->relatedMessageId) w.writeU32(*p->relatedMessageId);
            }
            break;
        }
        case protocol::MessageType::Ack: {
            if (auto* p = std::get_if<AckPayload>(&payload)) {
                w.writeU32(p->relatedMessageId);
                w.writeString(p->info);
            }
            break;
        }
        case protocol::MessageType::Nak: {
            if (auto* p = std::get_if<NakPayload>(&payload)) {
                w.writeU32(p->relatedMessageId);
                w.writeU16(p->errorCode);
                w.writeString(p->reason);
            }
            break;
        }
        default: {
            if (auto* p = std::get_if<RawPayload>(&payload)) {
                for (auto b : p->data) {
                    w.writeU8(b);
                }
            }
            break;
        }
    }

    return Result<std::vector<uint8_t>>::ok(w.finish());
}

Result<Payload> ProtocolCodecV2::decodePayload(protocol::MessageType type,
                                               const uint8_t* data,
                                               size_t len) {
    Reader r(data, len);

    switch (type) {
        case protocol::MessageType::Hello: {
            HelloPayload p;
            auto devType = r.readU8();
            auto vmaj = r.readU8();
            auto vmin = r.readU8();
            auto vpat = r.readU8();
            auto caps = r.readU16();
            auto name = r.readString();
            if (!devType || !vmaj || !vmin || !vpat || !caps || !name) {
                return Result<Payload>::error("protocol_v2: bad hello payload");
            }
            p.deviceType = static_cast<protocol::DeviceType>(*devType);
            p.versionMajor = *vmaj;
            p.versionMinor = *vmin;
            p.versionPatch = *vpat;
            p.capabilities = *caps;
            p.name = std::move(*name);
            return Result<Payload>::ok(p);
        }
        case protocol::MessageType::HelloAck: {
            HelloAckPayload p;
            auto id = r.readU32();
            auto ts = r.readU64();
            auto accepted = r.readU8();
            auto reason = r.readString();
            if (!id || !ts || !accepted || !reason) {
                return Result<Payload>::error("protocol_v2: bad hello_ack payload");
            }
            p.assignedId = *id;
            p.serverTime = *ts;
            p.accepted = *accepted != 0;
            p.rejectReason = std::move(*reason);
            return Result<Payload>::ok(p);
        }
        case protocol::MessageType::Ping: {
            PingPayload p;
            auto ts = r.readU64();
            auto seq = r.readU32();
            if (!ts || !seq) return Result<Payload>::error("protocol_v2: bad ping payload");
            p.timestamp = *ts;
            p.sequenceNumber = *seq;
            return Result<Payload>::ok(p);
        }
        case protocol::MessageType::Pong: {
            PongPayload p;
            auto ots = r.readU64();
            auto rts = r.readU64();
            auto seq = r.readU32();
            if (!ots || !rts || !seq) return Result<Payload>::error("protocol_v2: bad pong payload");
            p.originalTimestamp = *ots;
            p.responseTimestamp = *rts;
            p.sequenceNumber = *seq;
            return Result<Payload>::ok(p);
        }
        case protocol::MessageType::LoadAutomata: {
            LoadAutomataPayload p;
            auto fmt = r.readU8();
            auto chunked = r.readU8();
            auto chunkIndex = r.readU16();
            auto totalChunks = r.readU16();
            auto startAfter = r.readU8();
            auto replaceMode = r.readU8();
            auto payload = r.readBytes();
            if (!fmt || !chunked || !chunkIndex || !totalChunks || !startAfter || !replaceMode || !payload) {
                return Result<Payload>::error("protocol_v2: bad load_automata payload");
            }
            p.format = static_cast<protocol::AutomataFormat>(*fmt);
            p.isChunked = *chunked != 0;
            p.chunkIndex = *chunkIndex;
            p.totalChunks = *totalChunks;
            p.startAfterLoad = *startAfter != 0;
            p.replaceMode = static_cast<LoadReplaceMode>(*replaceMode);
            p.data = std::move(*payload);
            return Result<Payload>::ok(p);
        }
        case protocol::MessageType::LoadAck: {
            LoadAckPayload p;
            auto ok = r.readU8();
            auto msg = r.readString();
            auto warnCount = r.readU16();
            if (!ok || !msg || !warnCount) {
                return Result<Payload>::error("protocol_v2: bad load_ack payload");
            }
            p.success = *ok != 0;
            p.message = std::move(*msg);
            for (uint16_t i = 0; i < *warnCount; ++i) {
                auto warn = r.readString();
                if (!warn) return Result<Payload>::error("protocol_v2: bad load_ack warning");
                p.warnings.push_back(std::move(*warn));
            }
            return Result<Payload>::ok(p);
        }
        case protocol::MessageType::Start: {
            StartPayload p;
            auto hasStart = r.readU8();
            if (!hasStart) return Result<Payload>::error("protocol_v2: bad start payload");
            if (*hasStart) {
                auto state = r.readU16();
                if (!state) return Result<Payload>::error("protocol_v2: bad start state");
                p.startFromState = *state;
            }
            return Result<Payload>::ok(p);
        }
        case protocol::MessageType::Stop: {
            StopPayload p;
            auto save = r.readU8();
            if (!save) return Result<Payload>::error("protocol_v2: bad stop payload");
            p.saveState = *save != 0;
            return Result<Payload>::ok(p);
        }
        case protocol::MessageType::Status: {
            StatusPayload p;
            auto state = r.readU8();
            auto current = r.readU16();
            auto uptime = r.readU64();
            auto transitions = r.readU64();
            auto ticks = r.readU64();
            auto errors = r.readU32();
            if (!state || !current || !uptime || !transitions || !ticks || !errors) {
                return Result<Payload>::error("protocol_v2: bad status payload");
            }
            p.executionState = static_cast<ExecutionState>(*state);
            p.currentState = *current;
            p.uptime = *uptime;
            p.transitionCount = *transitions;
            p.tickCount = *ticks;
            p.errorCount = *errors;
            return Result<Payload>::ok(p);
        }
        case protocol::MessageType::Input:
        case protocol::MessageType::Output:
        case protocol::MessageType::Variable: {
            VariablePayload p;
            auto id = r.readU16();
            auto name = r.readString();
            auto value = readValue(r);
            auto ts = r.readU64();
            if (!id || !name || !value || !ts) {
                return Result<Payload>::error("protocol_v2: bad variable payload");
            }
            p.variableId = *id;
            p.variableName = std::move(*name);
            p.value = std::move(*value);
            p.timestamp = *ts;
            return Result<Payload>::ok(p);
        }
        case protocol::MessageType::StateChange: {
            StateChangePayload p;
            auto prev = r.readU16();
            auto next = r.readU16();
            auto trans = r.readU16();
            auto ts = r.readU64();
            if (!prev || !next || !trans || !ts) {
                return Result<Payload>::error("protocol_v2: bad state_change payload");
            }
            p.previousState = *prev;
            p.newState = *next;
            p.firedTransition = *trans;
            p.timestamp = *ts;
            return Result<Payload>::ok(p);
        }
        case protocol::MessageType::TransitionFired: {
            TransitionFiredPayload p;
            auto id = r.readU16();
            auto ts = r.readU64();
            if (!id || !ts) {
                return Result<Payload>::error("protocol_v2: bad transition_fired payload");
            }
            p.transitionId = *id;
            p.timestamp = *ts;
            return Result<Payload>::ok(p);
        }
        case protocol::MessageType::Telemetry: {
            TelemetryPayload p;
            auto ts = r.readU64();
            auto heapFree = r.readU32();
            auto heapTotal = r.readU32();
            auto cpuFixed = r.readU16();
            auto tickRate = r.readU32();
            auto count = r.readU16();
            if (!ts || !heapFree || !heapTotal || !cpuFixed || !tickRate || !count) {
                return Result<Payload>::error("protocol_v2: bad telemetry payload");
            }
            p.timestamp = *ts;
            p.heapFree = *heapFree;
            p.heapTotal = *heapTotal;
            p.cpuUsage = static_cast<float>(*cpuFixed) / 100.0f;
            p.tickRate = *tickRate;
            for (uint16_t i = 0; i < *count; ++i) {
                auto id = r.readU16();
                auto value = readValue(r);
                if (!id || !value) {
                    return Result<Payload>::error("protocol_v2: bad telemetry variable entry");
                }
                p.variableSnapshot.emplace_back(*id, std::move(*value));
            }
            return Result<Payload>::ok(p);
        }
        case protocol::MessageType::Provision: {
            ProvisionPayload p;
            auto bytes = r.readBytes();
            if (!bytes) return Result<Payload>::error("protocol_v2: bad provision payload");
            p.data = std::move(*bytes);
            return Result<Payload>::ok(p);
        }
        case protocol::MessageType::Goodbye: {
            GoodbyePayload p;
            auto reason = r.readString();
            if (!reason) return Result<Payload>::error("protocol_v2: bad goodbye payload");
            p.reason = std::move(*reason);
            return Result<Payload>::ok(p);
        }
        case protocol::MessageType::Vendor: {
            VendorPayload p;
            auto kind = r.readU16();
            auto bytes = r.readBytes();
            if (!kind || !bytes) return Result<Payload>::error("protocol_v2: bad vendor payload");
            p.vendorType = *kind;
            p.data = std::move(*bytes);
            return Result<Payload>::ok(p);
        }
        case protocol::MessageType::Debug: {
            DebugPayload p;
            auto level = r.readU8();
            auto source = r.readString();
            auto message = r.readString();
            auto ts = r.readU64();
            if (!level || !source || !message || !ts) {
                return Result<Payload>::error("protocol_v2: bad debug payload");
            }
            p.level = static_cast<protocol::DebugLevel>(*level);
            p.source = std::move(*source);
            p.message = std::move(*message);
            p.timestamp = *ts;
            return Result<Payload>::ok(p);
        }
        case protocol::MessageType::Error: {
            ErrorPayload p;
            auto code = r.readU16();
            auto message = r.readString();
            auto hasRelated = r.readU8();
            if (!code || !message || !hasRelated) {
                return Result<Payload>::error("protocol_v2: bad error payload");
            }
            p.code = static_cast<protocol::ErrorCode>(*code);
            p.message = std::move(*message);
            if (*hasRelated) {
                auto related = r.readU32();
                if (!related) return Result<Payload>::error("protocol_v2: bad related_message_id");
                p.relatedMessageId = *related;
            }
            return Result<Payload>::ok(p);
        }
        case protocol::MessageType::Ack: {
            AckPayload p;
            auto related = r.readU32();
            auto info = r.readString();
            if (!related || !info) return Result<Payload>::error("protocol_v2: bad ack payload");
            p.relatedMessageId = *related;
            p.info = std::move(*info);
            return Result<Payload>::ok(p);
        }
        case protocol::MessageType::Nak: {
            NakPayload p;
            auto related = r.readU32();
            auto code = r.readU16();
            auto reason = r.readString();
            if (!related || !code || !reason) return Result<Payload>::error("protocol_v2: bad nak payload");
            p.relatedMessageId = *related;
            p.errorCode = *code;
            p.reason = std::move(*reason);
            return Result<Payload>::ok(p);
        }
        default:
            return Result<Payload>::ok(RawPayload{std::vector<uint8_t>(data, data + len)});
    }
}

} // namespace aeth::protocolv2
