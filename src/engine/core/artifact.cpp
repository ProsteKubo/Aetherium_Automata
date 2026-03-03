#include "artifact.hpp"

#include <array>
#include <cstring>

namespace aeth::ir {

namespace {

constexpr std::array<uint8_t, 8> kMagic{{'A', 'E', 'T', 'H', 'I', 'R', 'V', '1'}};
constexpr std::array<uint8_t, 8> kBytecodeMagic{{'A', 'E', 'T', 'H', 'B', 'C', '0', '1'}};

void appendU16(std::vector<uint8_t>& out, uint16_t value) {
    out.push_back(static_cast<uint8_t>((value >> 8) & 0xFF));
    out.push_back(static_cast<uint8_t>(value & 0xFF));
}

void appendU32(std::vector<uint8_t>& out, uint32_t value) {
    out.push_back(static_cast<uint8_t>((value >> 24) & 0xFF));
    out.push_back(static_cast<uint8_t>((value >> 16) & 0xFF));
    out.push_back(static_cast<uint8_t>((value >> 8) & 0xFF));
    out.push_back(static_cast<uint8_t>(value & 0xFF));
}

void appendI32(std::vector<uint8_t>& out, int32_t value) {
    appendU32(out, static_cast<uint32_t>(value));
}

void appendF32(std::vector<uint8_t>& out, float value) {
    uint32_t bits = 0;
    static_assert(sizeof(bits) == sizeof(value), "unexpected float size");
    std::memcpy(&bits, &value, sizeof(bits));
    appendU32(out, bits);
}

bool readU16(const std::vector<uint8_t>& bytes, size_t& offset, uint16_t& out) {
    if (offset + 2 > bytes.size()) return false;
    out = (static_cast<uint16_t>(bytes[offset]) << 8) |
          static_cast<uint16_t>(bytes[offset + 1]);
    offset += 2;
    return true;
}

bool readU32(const std::vector<uint8_t>& bytes, size_t& offset, uint32_t& out) {
    if (offset + 4 > bytes.size()) return false;
    out = (static_cast<uint32_t>(bytes[offset]) << 24) |
          (static_cast<uint32_t>(bytes[offset + 1]) << 16) |
          (static_cast<uint32_t>(bytes[offset + 2]) << 8) |
          static_cast<uint32_t>(bytes[offset + 3]);
    offset += 4;
    return true;
}

bool readI32(const std::vector<uint8_t>& bytes, size_t& offset, int32_t& out) {
    uint32_t raw = 0;
    if (!readU32(bytes, offset, raw)) return false;
    out = static_cast<int32_t>(raw);
    return true;
}

bool readF32(const std::vector<uint8_t>& bytes, size_t& offset, float& out) {
    uint32_t raw = 0;
    if (!readU32(bytes, offset, raw)) return false;
    static_assert(sizeof(raw) == sizeof(out), "unexpected float size");
    std::memcpy(&out, &raw, sizeof(out));
    return true;
}

bool readU8(const std::vector<uint8_t>& bytes, size_t& offset, uint8_t& out) {
    if (offset >= bytes.size()) return false;
    out = bytes[offset++];
    return true;
}

bool appendSizedString(std::vector<uint8_t>& out, const std::string& value) {
    if (value.size() > 0xFFFF) return false;
    appendU16(out, static_cast<uint16_t>(value.size()));
    out.insert(out.end(), value.begin(), value.end());
    return true;
}

bool readSizedString(const std::vector<uint8_t>& bytes, size_t& offset, std::string& out) {
    uint16_t len = 0;
    if (!readU16(bytes, offset, len)) return false;
    if (offset + len > bytes.size()) return false;
    out.assign(reinterpret_cast<const char*>(bytes.data() + offset), len);
    offset += len;
    return true;
}

Result<void> appendValue(std::vector<uint8_t>& out, const Value& value) {
    const auto type = value.type();
    out.push_back(static_cast<uint8_t>(type));

    switch (type) {
        case ValueType::Void:
            return Result<void>::ok();
        case ValueType::Bool:
            out.push_back(value.get<bool>() ? 1 : 0);
            return Result<void>::ok();
        case ValueType::Int32:
            appendI32(out, value.get<int32_t>());
            return Result<void>::ok();
        case ValueType::Float32:
            appendF32(out, value.get<float>());
            return Result<void>::ok();
        case ValueType::String: {
            const auto& s = value.get<std::string>();
            if (!appendSizedString(out, s)) {
                return Result<void>::error("bytecode value string too large");
            }
            return Result<void>::ok();
        }
        default:
            return Result<void>::error("unsupported bytecode value type");
    }
}

Result<Value> readValue(const std::vector<uint8_t>& bytes, size_t& offset) {
    uint8_t rawType = 0;
    if (!readU8(bytes, offset, rawType)) {
        return Result<Value>::error("bytecode value type truncated");
    }

    const auto type = static_cast<ValueType>(rawType);
    switch (type) {
        case ValueType::Void:
            return Result<Value>::ok(Value{});
        case ValueType::Bool: {
            uint8_t raw = 0;
            if (!readU8(bytes, offset, raw)) {
                return Result<Value>::error("bytecode bool value truncated");
            }
            return Result<Value>::ok(Value(raw != 0));
        }
        case ValueType::Int32: {
            int32_t v = 0;
            if (!readI32(bytes, offset, v)) {
                return Result<Value>::error("bytecode int32 value truncated");
            }
            return Result<Value>::ok(Value(v));
        }
        case ValueType::Float32: {
            float v = 0;
            if (!readF32(bytes, offset, v)) {
                return Result<Value>::error("bytecode float32 value truncated");
            }
            return Result<Value>::ok(Value(v));
        }
        case ValueType::String: {
            std::string s;
            if (!readSizedString(bytes, offset, s)) {
                return Result<Value>::error("bytecode string value truncated");
            }
            return Result<Value>::ok(Value(std::move(s)));
        }
        default:
            return Result<Value>::error("unsupported bytecode value type");
    }
}

} // namespace

Result<std::vector<uint8_t>> serializeArtifact(const AutomataArtifact& artifact) {
    if (artifact.header.format != ArtifactFormat::AethIrV1) {
        return Result<std::vector<uint8_t>>::error("unsupported artifact format");
    }
    if (artifact.sourceLabel.size() > 0xFFFF) {
        return Result<std::vector<uint8_t>>::error("source label too large");
    }
    if (artifact.payloadBytes.size() > 0xFFFFFFFFu) {
        return Result<std::vector<uint8_t>>::error("artifact payload too large");
    }

    std::vector<uint8_t> out;
    out.reserve(kMagic.size() + 1 + 2 + 2 + 1 + 2 + 4 + artifact.sourceLabel.size() + artifact.payloadBytes.size());

    out.insert(out.end(), kMagic.begin(), kMagic.end());
    out.push_back(static_cast<uint8_t>(artifact.header.format));
    appendU16(out, artifact.header.versionMajor);
    appendU16(out, artifact.header.versionMinor);
    out.push_back(static_cast<uint8_t>(artifact.payloadKind));
    appendU16(out, static_cast<uint16_t>(artifact.sourceLabel.size()));
    appendU32(out, static_cast<uint32_t>(artifact.payloadBytes.size()));
    out.insert(out.end(), artifact.sourceLabel.begin(), artifact.sourceLabel.end());
    out.insert(out.end(), artifact.payloadBytes.begin(), artifact.payloadBytes.end());

    return Result<std::vector<uint8_t>>::ok(std::move(out));
}

Result<AutomataArtifact> deserializeArtifact(const std::vector<uint8_t>& bytes) {
    if (bytes.size() < kMagic.size() + 1 + 2 + 2 + 1 + 2 + 4) {
        return Result<AutomataArtifact>::error("artifact too small");
    }

    if (!std::equal(kMagic.begin(), kMagic.end(), bytes.begin())) {
        return Result<AutomataArtifact>::error("invalid artifact magic");
    }

    size_t offset = kMagic.size();
    const auto format = static_cast<ArtifactFormat>(bytes[offset++]);
    if (format != ArtifactFormat::AethIrV1) {
        return Result<AutomataArtifact>::error("unknown artifact format");
    }

    AutomataArtifact artifact;
    artifact.header.format = format;

    if (!readU16(bytes, offset, artifact.header.versionMajor) ||
        !readU16(bytes, offset, artifact.header.versionMinor)) {
        return Result<AutomataArtifact>::error("artifact header truncated");
    }

    if (offset >= bytes.size()) {
        return Result<AutomataArtifact>::error("artifact payload kind missing");
    }
    artifact.payloadKind = static_cast<PayloadKind>(bytes[offset++]);

    uint16_t sourceLabelLen = 0;
    uint32_t payloadLen = 0;
    if (!readU16(bytes, offset, sourceLabelLen) || !readU32(bytes, offset, payloadLen)) {
        return Result<AutomataArtifact>::error("artifact lengths truncated");
    }

    if (offset + sourceLabelLen + payloadLen != bytes.size()) {
        return Result<AutomataArtifact>::error("artifact size mismatch");
    }

    artifact.sourceLabel.assign(reinterpret_cast<const char*>(bytes.data() + offset), sourceLabelLen);
    offset += sourceLabelLen;
    artifact.payloadBytes.assign(bytes.begin() + static_cast<std::ptrdiff_t>(offset), bytes.end());

    return Result<AutomataArtifact>::ok(std::move(artifact));
}

AutomataArtifact makeYamlArtifact(std::string yaml, std::string sourceLabel) {
    AutomataArtifact artifact;
    artifact.header.format = ArtifactFormat::AethIrV1;
    artifact.header.versionMajor = 0;
    artifact.header.versionMinor = 1;
    artifact.payloadKind = PayloadKind::YamlText;
    artifact.sourceLabel = sourceLabel.empty() ? "." : std::move(sourceLabel);
    artifact.payloadBytes.assign(yaml.begin(), yaml.end());
    return artifact;
}

Result<std::vector<uint8_t>> serializeEngineBytecodeProgram(const EngineBytecodeProgram& program) {
    if (program.name.size() > 0xFFFF) {
        return Result<std::vector<uint8_t>>::error("bytecode program name too large");
    }
    if (program.variables.size() > 0xFFFF || program.states.size() > 0xFFFF || program.transitions.size() > 0xFFFF) {
        return Result<std::vector<uint8_t>>::error("bytecode program section too large");
    }
    if (program.initialState == INVALID_STATE) {
        return Result<std::vector<uint8_t>>::error("bytecode program missing initial state");
    }

    std::vector<uint8_t> out;
    out.reserve(256);
    out.insert(out.end(), kBytecodeMagic.begin(), kBytecodeMagic.end());
    appendU16(out, program.versionMajor);
    appendU16(out, program.versionMinor);
    if (!appendSizedString(out, program.name)) {
        return Result<std::vector<uint8_t>>::error("bytecode program name too large");
    }
    appendU16(out, program.initialState);
    appendU16(out, static_cast<uint16_t>(program.variables.size()));
    appendU16(out, static_cast<uint16_t>(program.states.size()));
    appendU16(out, static_cast<uint16_t>(program.transitions.size()));

    for (const auto& v : program.variables) {
        if (v.name.size() > 0xFFFF) {
            return Result<std::vector<uint8_t>>::error("bytecode variable name too large");
        }
        appendU16(out, v.id);
        out.push_back(static_cast<uint8_t>(v.type));
        out.push_back(static_cast<uint8_t>(v.direction));
        if (!appendSizedString(out, v.name)) {
            return Result<std::vector<uint8_t>>::error("bytecode variable name too large");
        }
        auto valueRes = appendValue(out, v.initialValue);
        if (valueRes.isError()) {
            return Result<std::vector<uint8_t>>::error(valueRes.error());
        }
    }

    for (const auto& s : program.states) {
        if (s.name.empty()) {
            return Result<std::vector<uint8_t>>::error("bytecode state name cannot be empty");
        }
        appendU16(out, s.id);
        if (!appendSizedString(out, s.name)) {
            return Result<std::vector<uint8_t>>::error("bytecode state name too large");
        }
    }

    for (const auto& t : program.transitions) {
        appendU16(out, t.id);
        appendU16(out, t.from);
        appendU16(out, t.to);
        out.push_back(static_cast<uint8_t>(t.kind));
        out.push_back(t.priority);
        out.push_back(t.enabled ? 1 : 0);
        out.push_back(0); // reserved
        appendU32(out, t.delayMs);
        if (!appendSizedString(out, t.conditionExpression)) {
            return Result<std::vector<uint8_t>>::error("bytecode transition condition too large");
        }
        out.push_back(static_cast<uint8_t>(t.eventSignalDirection));
        out.push_back(static_cast<uint8_t>(t.eventTriggerType));
        out.push_back(t.eventHasThreshold ? 1 : 0);
        out.push_back(static_cast<uint8_t>(t.eventThresholdOp));
        out.push_back(t.eventThresholdOneShot ? 1 : 0);
        out.push_back(0); // reserved
        auto thresholdValueRes = appendValue(out, t.eventThresholdValue);
        if (thresholdValueRes.isError()) {
            return Result<std::vector<uint8_t>>::error("bytecode transition threshold value unsupported");
        }
        if (!appendSizedString(out, t.eventSignalName)) {
            return Result<std::vector<uint8_t>>::error("bytecode transition event signal too large");
        }
        if (!appendSizedString(out, t.eventPattern)) {
            return Result<std::vector<uint8_t>>::error("bytecode transition event pattern too large");
        }
        if (!appendSizedString(out, t.name)) {
            return Result<std::vector<uint8_t>>::error("bytecode transition name too large");
        }
    }

    return Result<std::vector<uint8_t>>::ok(std::move(out));
}

Result<EngineBytecodeProgram> deserializeEngineBytecodeProgram(const std::vector<uint8_t>& bytes) {
    if (bytes.size() < kBytecodeMagic.size() + 2 + 2 + 2 + 2 + 2 + 2 + 2) {
        return Result<EngineBytecodeProgram>::error("bytecode payload too small");
    }
    if (!std::equal(kBytecodeMagic.begin(), kBytecodeMagic.end(), bytes.begin())) {
        return Result<EngineBytecodeProgram>::error("invalid bytecode magic");
    }

    size_t offset = kBytecodeMagic.size();
    EngineBytecodeProgram program;
    if (!readU16(bytes, offset, program.versionMajor) || !readU16(bytes, offset, program.versionMinor)) {
        return Result<EngineBytecodeProgram>::error("bytecode version truncated");
    }
    if (!readSizedString(bytes, offset, program.name)) {
        return Result<EngineBytecodeProgram>::error("bytecode program name truncated");
    }
    if (!readU16(bytes, offset, program.initialState)) {
        return Result<EngineBytecodeProgram>::error("bytecode initial state truncated");
    }

    uint16_t varCount = 0;
    uint16_t stateCount = 0;
    uint16_t transitionCount = 0;
    if (!readU16(bytes, offset, varCount) || !readU16(bytes, offset, stateCount) || !readU16(bytes, offset, transitionCount)) {
        return Result<EngineBytecodeProgram>::error("bytecode counts truncated");
    }

    program.variables.reserve(varCount);
    for (uint16_t i = 0; i < varCount; ++i) {
        BytecodeVariable v;
        uint8_t rawType = 0;
        uint8_t rawDir = 0;
        if (!readU16(bytes, offset, v.id) || !readU8(bytes, offset, rawType) || !readU8(bytes, offset, rawDir) ||
            !readSizedString(bytes, offset, v.name)) {
            return Result<EngineBytecodeProgram>::error("bytecode variable entry truncated");
        }
        v.type = static_cast<ValueType>(rawType);
        v.direction = static_cast<VariableDirection>(rawDir);
        auto valueRes = readValue(bytes, offset);
        if (valueRes.isError()) {
            return Result<EngineBytecodeProgram>::error(valueRes.error());
        }
        v.initialValue = std::move(valueRes.value());
        program.variables.push_back(std::move(v));
    }

    program.states.reserve(stateCount);
    for (uint16_t i = 0; i < stateCount; ++i) {
        BytecodeState s;
        if (!readU16(bytes, offset, s.id) || !readSizedString(bytes, offset, s.name)) {
            return Result<EngineBytecodeProgram>::error("bytecode state entry truncated");
        }
        program.states.push_back(std::move(s));
    }

    program.transitions.reserve(transitionCount);
    for (uint16_t i = 0; i < transitionCount; ++i) {
        BytecodeTransition t;
        uint8_t rawKind = 0;
        uint8_t rawPriority = 0;
        uint8_t rawEnabled = 0;
        uint8_t ignoredReserved = 0;
        uint8_t rawSignalDirection = 0;
        uint8_t rawTriggerType = 0;
        uint8_t rawHasThreshold = 0;
        uint8_t rawThresholdOp = 0;
        uint8_t rawThresholdOneShot = 0;
        uint8_t ignoredReserved2 = 0;
        if (!readU16(bytes, offset, t.id) ||
            !readU16(bytes, offset, t.from) ||
            !readU16(bytes, offset, t.to) ||
            !readU8(bytes, offset, rawKind) ||
            !readU8(bytes, offset, rawPriority) ||
            !readU8(bytes, offset, rawEnabled) ||
            !readU8(bytes, offset, ignoredReserved) ||
            !readU32(bytes, offset, t.delayMs) ||
            !readSizedString(bytes, offset, t.conditionExpression) ||
            !readU8(bytes, offset, rawSignalDirection) ||
            !readU8(bytes, offset, rawTriggerType) ||
            !readU8(bytes, offset, rawHasThreshold) ||
            !readU8(bytes, offset, rawThresholdOp) ||
            !readU8(bytes, offset, rawThresholdOneShot) ||
            !readU8(bytes, offset, ignoredReserved2)) {
            return Result<EngineBytecodeProgram>::error("bytecode transition entry truncated");
        }
        auto thresholdValueRes = readValue(bytes, offset);
        if (thresholdValueRes.isError()) {
            return Result<EngineBytecodeProgram>::error(thresholdValueRes.error());
        }
        t.eventThresholdValue = std::move(thresholdValueRes.value());
        if (!readSizedString(bytes, offset, t.eventSignalName) ||
            !readSizedString(bytes, offset, t.eventPattern) ||
            !readSizedString(bytes, offset, t.name)) {
            return Result<EngineBytecodeProgram>::error("bytecode transition entry truncated");
        }
        (void) ignoredReserved;
        (void) ignoredReserved2;
        t.kind = static_cast<BytecodeTransitionKind>(rawKind);
        t.priority = rawPriority;
        t.enabled = rawEnabled != 0;
        t.eventSignalDirection = static_cast<VariableDirection>(rawSignalDirection);
        t.eventTriggerType = static_cast<EventTrigger>(rawTriggerType);
        t.eventHasThreshold = rawHasThreshold != 0;
        t.eventThresholdOp = static_cast<CompareOp>(rawThresholdOp);
        t.eventThresholdOneShot = rawThresholdOneShot != 0;
        program.transitions.push_back(std::move(t));
    }

    if (offset != bytes.size()) {
        return Result<EngineBytecodeProgram>::error("bytecode payload trailing bytes");
    }

    return Result<EngineBytecodeProgram>::ok(std::move(program));
}

Result<AutomataArtifact> makeEngineBytecodeArtifact(const EngineBytecodeProgram& program,
                                                    std::string sourceLabel) {
    auto payload = serializeEngineBytecodeProgram(program);
    if (payload.isError()) {
        return Result<AutomataArtifact>::error(payload.error());
    }

    AutomataArtifact artifact;
    artifact.header.format = ArtifactFormat::AethIrV1;
    artifact.header.versionMajor = 0;
    artifact.header.versionMinor = 1;
    artifact.payloadKind = PayloadKind::EngineBytecode;
    artifact.sourceLabel = sourceLabel.empty() ? "." : std::move(sourceLabel);
    artifact.payloadBytes = std::move(payload.value());
    return Result<AutomataArtifact>::ok(std::move(artifact));
}

} // namespace aeth::ir
