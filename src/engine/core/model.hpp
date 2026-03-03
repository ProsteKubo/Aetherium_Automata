/**
 * Aetherium Automata - State and Transition Model
 * 
 * Defines states and transitions with support for:
 * - Classic condition-based transitions
 * - Timed transitions (DEVS-style)
 * - Event-triggered transitions
 * - Weighted/probabilistic transitions
 */

#ifndef AETHERIUM_MODEL_HPP
#define AETHERIUM_MODEL_HPP

#include "types.hpp"
#include "variable.hpp"
#include <algorithm>
#include <vector>
#include <optional>
#include <unordered_map>

namespace aeth {

// ============================================================================
// Code Block (Lua code reference)
// ============================================================================

/**
 * Represents executable code (Lua source or bytecode reference)
 */
struct CodeBlock {
    std::string source;           // Lua source code
    std::vector<uint8_t> bytecode; // Compiled bytecode (optional)
    ValueType returnType = ValueType::Void;

    [[nodiscard]] bool isEmpty() const { 
        return source.empty() && bytecode.empty(); 
    }

    [[nodiscard]] bool hasBytecode() const { 
        return !bytecode.empty(); 
    }
};

// ============================================================================
// State Definition
// ============================================================================

/**
 * A state in the finite state machine
 */
struct State {
    StateId id = INVALID_STATE;
    std::string name;

    // Variables accessible in this state (references to automata variables)
    std::vector<VariableId> inputIds;
    std::vector<VariableId> outputIds;
    std::vector<VariableId> variableIds;

    // Code hooks
    CodeBlock onEnter;   // Executed when entering state
    CodeBlock body;      // Executed each tick while in state
    CodeBlock onExit;    // Executed when leaving state

    // Metadata
    std::string description;
    
    // Visual (for IDE, ignored by engine)
    float posX = 0;
    float posY = 0;

    State() = default;
    State(StateId id, std::string name) : id(id), name(std::move(name)) {}
};

// ============================================================================
// Transition Configuration Types
// ============================================================================

/**
 * Configuration for classic (condition-based) transitions
 */
struct ClassicConfig {
    CodeBlock condition;      // Lua expression returning bool
    bool onRisingEdge = false; // Only fire on false→true
};

/**
 * Configuration for timed transitions
 */
struct TimedConfig {
    TimedMode mode = TimedMode::After;
    uint32_t delayMs = 0;           // Primary delay
    uint32_t windowEndMs = 0;       // For window mode
    uint32_t jitterMs = 0;          // Random jitter (+/-)
    uint32_t repeatCount = 0;       // For Every mode (0 = infinite)
    CodeBlock additionalCondition;  // Optional extra guard
};

/**
 * Threshold configuration for event transitions
 */
struct ThresholdConfig {
    CompareOp op = CompareOp::Gt;
    Value value;
    bool oneShot = false;  // Only fire once per crossing
};

/**
 * Signal trigger for event transitions
 */
struct SignalTrigger {
    std::string signalName;
    VariableDirection signalType = VariableDirection::Input;
    EventTrigger triggerType = EventTrigger::OnChange;
    std::optional<ThresholdConfig> threshold;
    std::string pattern;  // For OnMatch
};

/**
 * Configuration for event-triggered transitions
 */
struct EventConfig {
    std::vector<SignalTrigger> triggers;
    bool requireAll = false;  // AND vs OR logic
    uint32_t debounceMs = 0;
    CodeBlock additionalCondition;
};

/**
 * Configuration for probabilistic transitions
 */
struct ProbabilisticConfig {
    uint16_t weight = 100;     // Fixed weight (0-10000, represents 0.00-100.00)
    CodeBlock weightExpression; // Dynamic weight (Lua returning number)
    uint16_t minWeight = 0;     // Floor for adaptive
    bool isDynamic = false;     // Use expression instead of fixed
};

// ============================================================================
// Transition Definition
// ============================================================================

/**
 * A transition between states
 */
struct Transition {
    TransitionId id = INVALID_TRANSITION;
    std::string name;
    
    StateId from = INVALID_STATE;
    StateId to = INVALID_STATE;

    // Type and configuration
    TransitionType type = TransitionType::Classic;
    
    // Type-specific config (only one active based on type)
    ClassicConfig classicConfig;
    TimedConfig timedConfig;
    EventConfig eventConfig;
    ProbabilisticConfig probConfig;

    // Execution
    CodeBlock body;      // Code to run when transition fires
    CodeBlock triggered; // Optional callback after transition completes

    // Priority and weighting
    uint8_t priority = 0;  // Lower = higher priority (0 is highest)
    
    // Weight for probabilistic selection (used when multiple enabled)
    // This is separate from probConfig and applies to any transition type
    uint16_t weight = 100;  // 0-10000 (0.00-100.00%)

    // Enabled state
    bool enabled = true;

    // Metadata
    std::string description;

    Transition() = default;
    Transition(TransitionId id, std::string name, StateId from, StateId to)
        : id(id), name(std::move(name)), from(from), to(to) {}

    // Helper to check if this is a weighted transition
    [[nodiscard]] bool isWeighted() const {
        return weight != 100 || type == TransitionType::Probabilistic;
    }
};

// ============================================================================
// Automata Definition
// ============================================================================

/**
 * Layout type for automata definition
 */
enum class LayoutType : uint8_t {
    Inline = 1,  // Code embedded in YAML
    Folder = 2   // Code in separate files
};

/**
 * Automata configuration metadata
 */
struct AutomataConfig {
    std::string name;
    std::string description;
    std::string author;
    std::string version;
    LayoutType layout = LayoutType::Inline;
    std::string location;  // For folder layout
    std::vector<std::string> tags;
};

/**
 * Complete automata definition
 */
class Automata {
public:
    Automata() = default;

    // Identity
    AutomataId id = 0;
    std::string specVersion = "0.0.1";
    AutomataConfig config;

    // Initial state
    StateId initialState = INVALID_STATE;

    // States (indexed by StateId)
    std::unordered_map<StateId, State> states;

    // Transitions (indexed by TransitionId)
    std::unordered_map<TransitionId, Transition> transitions;

    // Variables (specifications, instances created at runtime)
    std::vector<VariableSpec> variables;

    // Parent/child relationships (for nested automata)
    std::optional<AutomataId> parentId;
    std::vector<AutomataId> nestedIds;

    // ========================================================================
    // Accessors
    // ========================================================================

    [[nodiscard]] State* getState(StateId id);
    [[nodiscard]] const State* getState(StateId id) const;
    [[nodiscard]] State* getStateByName(const std::string& name);

    [[nodiscard]] Transition* getTransition(TransitionId id);
    [[nodiscard]] const Transition* getTransition(TransitionId id) const;

    [[nodiscard]] std::vector<Transition*> getTransitionsFrom(StateId stateId);
    [[nodiscard]] std::vector<const Transition*> getTransitionsFrom(StateId stateId) const;

    [[nodiscard]] const VariableSpec* getVariableSpec(VariableId id) const;
    [[nodiscard]] const VariableSpec* getVariableSpecByName(const std::string& name) const;

    // ========================================================================
    // ID generation
    // ========================================================================

    [[nodiscard]] StateId nextStateId() const;
    [[nodiscard]] TransitionId nextTransitionId() const;
    [[nodiscard]] VariableId nextVariableId() const;

    // ========================================================================
    // Mutation
    // ========================================================================

    StateId addState(State state);
    TransitionId addTransition(Transition transition);
    VariableId addVariable(VariableSpec spec);

    bool removeState(StateId id);
    bool removeTransition(TransitionId id);
    bool removeVariable(VariableId id);

    // ========================================================================
    // Validation
    // ========================================================================

    [[nodiscard]] bool isValid() const;
    [[nodiscard]] std::vector<std::string> validate() const;
};

// ============================================================================
// Implementation: Automata
// ============================================================================

inline State* Automata::getState(StateId id) {
    auto it = states.find(id);
    return it != states.end() ? &it->second : nullptr;
}

inline const State* Automata::getState(StateId id) const {
    auto it = states.find(id);
    return it != states.end() ? &it->second : nullptr;
}

inline State* Automata::getStateByName(const std::string& name) {
    for (auto& [id, state] : states) {
        if (state.name == name) return &state;
    }
    return nullptr;
}

inline Transition* Automata::getTransition(TransitionId id) {
    auto it = transitions.find(id);
    return it != transitions.end() ? &it->second : nullptr;
}

inline const Transition* Automata::getTransition(TransitionId id) const {
    auto it = transitions.find(id);
    return it != transitions.end() ? &it->second : nullptr;
}

inline std::vector<Transition*> Automata::getTransitionsFrom(StateId stateId) {
    std::vector<Transition*> result;
    for (auto& [id, t] : transitions) {
        if (t.from == stateId && t.enabled) {
            result.push_back(&t);
        }
    }
    // Sort by priority
    std::sort(result.begin(), result.end(), 
        [](const Transition* a, const Transition* b) {
            return a->priority < b->priority;
        });
    return result;
}

inline std::vector<const Transition*> Automata::getTransitionsFrom(StateId stateId) const {
    std::vector<const Transition*> result;
    for (const auto& [id, t] : transitions) {
        if (t.from == stateId && t.enabled) {
            result.push_back(&t);
        }
    }
    std::sort(result.begin(), result.end(),
        [](const Transition* a, const Transition* b) {
            return a->priority < b->priority;
        });
    return result;
}

inline const VariableSpec* Automata::getVariableSpec(VariableId id) const {
    for (const auto& v : variables) {
        if (v.id == id) return &v;
    }
    return nullptr;
}

inline const VariableSpec* Automata::getVariableSpecByName(const std::string& name) const {
    for (const auto& v : variables) {
        if (v.name == name) return &v;
    }
    return nullptr;
}

inline StateId Automata::nextStateId() const {
    StateId maxId = 0;
    for (const auto& [id, _] : states) {
        if (id > maxId) maxId = id;
    }
    return maxId + 1;
}

inline TransitionId Automata::nextTransitionId() const {
    TransitionId maxId = 0;
    for (const auto& [id, _] : transitions) {
        if (id > maxId) maxId = id;
    }
    return maxId + 1;
}

inline VariableId Automata::nextVariableId() const {
    VariableId maxId = 0;
    for (const auto& v : variables) {
        if (v.id > maxId) maxId = v.id;
    }
    return maxId + 1;
}

inline StateId Automata::addState(State state) {
    if (state.id == INVALID_STATE) {
        state.id = nextStateId();
    }
    states[state.id] = std::move(state);
    return state.id;
}

inline TransitionId Automata::addTransition(Transition transition) {
    if (transition.id == INVALID_TRANSITION) {
        transition.id = nextTransitionId();
    }
    transitions[transition.id] = std::move(transition);
    return transition.id;
}

inline VariableId Automata::addVariable(VariableSpec spec) {
    if (spec.id == INVALID_VARIABLE) {
        spec.id = nextVariableId();
    }
    variables.push_back(std::move(spec));
    return spec.id;
}

inline bool Automata::removeState(StateId id) {
    // Also remove transitions referencing this state
    for (auto it = transitions.begin(); it != transitions.end();) {
        if (it->second.from == id || it->second.to == id) {
            it = transitions.erase(it);
        } else {
            ++it;
        }
    }
    return states.erase(id) > 0;
}

inline bool Automata::removeTransition(TransitionId id) {
    return transitions.erase(id) > 0;
}

inline bool Automata::removeVariable(VariableId id) {
    auto it = std::find_if(variables.begin(), variables.end(),
        [id](const VariableSpec& v) { return v.id == id; });
    if (it != variables.end()) {
        variables.erase(it);
        return true;
    }
    return false;
}

inline bool Automata::isValid() const {
    return validate().empty();
}

inline std::vector<std::string> Automata::validate() const {
    std::vector<std::string> errors;

    if (states.empty()) {
        errors.push_back("Automata has no states");
    }

    if (initialState == INVALID_STATE && !states.empty()) {
        errors.push_back("No initial state specified");
    }

    if (initialState != INVALID_STATE && states.find(initialState) == states.end()) {
        errors.push_back("Initial state does not exist");
    }

    for (const auto& [id, t] : transitions) {
        if (states.find(t.from) == states.end()) {
            errors.push_back("Transition " + t.name + " references non-existent source state");
        }
        if (states.find(t.to) == states.end()) {
            errors.push_back("Transition " + t.name + " references non-existent target state");
        }
    }

    return errors;
}

} // namespace aeth

#endif // AETHERIUM_MODEL_HPP
