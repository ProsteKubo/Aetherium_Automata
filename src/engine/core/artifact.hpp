#ifndef AETHERIUM_ARTIFACT_HPP
#define AETHERIUM_ARTIFACT_HPP

#include "types.hpp"

#include <cstdint>
#include <string>
#include <vector>

namespace aeth::ir {

enum class ArtifactFormat : uint8_t {
    AethIrV1 = 1
};

enum class PayloadKind : uint8_t {
    YamlText = 1,
    EngineBytecode = 2
};

struct ArtifactHeader {
    ArtifactFormat format = ArtifactFormat::AethIrV1;
    uint16_t versionMajor = 0;
    uint16_t versionMinor = 1;
};

struct AutomataArtifact {
    ArtifactHeader header;
    PayloadKind payloadKind = PayloadKind::YamlText;
    std::vector<uint8_t> payloadBytes;
    std::string sourceLabel;
};

enum class BytecodeTransitionKind : uint8_t {
    Immediate = 1,
    TimedAfter = 2,
    ClassicCondition = 3,
    EventSignal = 4
};

struct BytecodeVariable {
    VariableId id = INVALID_VARIABLE;
    std::string name;
    ValueType type = ValueType::Void;
    VariableDirection direction = VariableDirection::Internal;
    Value initialValue;
};

struct BytecodeState {
    StateId id = INVALID_STATE;
    std::string name;
};

struct BytecodeTransition {
    TransitionId id = INVALID_TRANSITION;
    std::string name;
    StateId from = INVALID_STATE;
    StateId to = INVALID_STATE;
    BytecodeTransitionKind kind = BytecodeTransitionKind::Immediate;
    uint8_t priority = 0;
    bool enabled = true;
    uint32_t delayMs = 0;
    std::string conditionExpression;
    std::string eventSignalName;
    VariableDirection eventSignalDirection = VariableDirection::Input;
    EventTrigger eventTriggerType = EventTrigger::OnChange;
    bool eventHasThreshold = false;
    CompareOp eventThresholdOp = CompareOp::Gt;
    Value eventThresholdValue;
    bool eventThresholdOneShot = false;
    std::string eventPattern;
};

struct EngineBytecodeProgram {
    uint16_t versionMajor = 0;
    uint16_t versionMinor = 1;
    std::string name = "bytecode-program";
    StateId initialState = INVALID_STATE;
    std::vector<BytecodeVariable> variables;
    std::vector<BytecodeState> states;
    std::vector<BytecodeTransition> transitions;
};

Result<std::vector<uint8_t>> serializeArtifact(const AutomataArtifact& artifact);
Result<AutomataArtifact> deserializeArtifact(const std::vector<uint8_t>& bytes);
Result<std::vector<uint8_t>> serializeEngineBytecodeProgram(const EngineBytecodeProgram& program);
Result<EngineBytecodeProgram> deserializeEngineBytecodeProgram(const std::vector<uint8_t>& bytes);

AutomataArtifact makeYamlArtifact(std::string yaml, std::string sourceLabel = ".");
Result<AutomataArtifact> makeEngineBytecodeArtifact(const EngineBytecodeProgram& program,
                                                    std::string sourceLabel = ".");

} // namespace aeth::ir

#endif // AETHERIUM_ARTIFACT_HPP
