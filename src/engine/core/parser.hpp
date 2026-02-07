/**
 * Aetherium Automata - YAML Parser
 * 
 * Parses automata definitions from YAML format into the core model.
 * Supports both inline and folder layouts.
 */

#ifndef AETHERIUM_PARSER_HPP
#define AETHERIUM_PARSER_HPP

#include "types.hpp"
#include "model.hpp"
#include <ryml.hpp>
#include <string>
#include <fstream>
#include <sstream>

namespace aeth {

// ============================================================================
// Parser Result
// ============================================================================

struct ParseResult {
    std::unique_ptr<Automata> automata;
    std::vector<std::string> errors;
    std::vector<std::string> warnings;

    [[nodiscard]] bool success() const { return automata != nullptr && errors.empty(); }
};

// ============================================================================
// YAML Parser
// ============================================================================

class AutomataParser {
public:
    AutomataParser() = default;

    /**
     * Parse automata from YAML file
     */
    ParseResult parseFile(const std::string& filePath);

    /**
     * Parse automata from YAML string
     */
    ParseResult parseString(const std::string& yaml, const std::string& basePath = "");

private:
    // Context during parsing
    struct ParseContext {
        std::string basePath;
        std::vector<std::string> errors;
        std::vector<std::string> warnings;
        
        // ID tracking
        StateId nextStateId = 1;
        TransitionId nextTransitionId = 1;
        VariableId nextVarId = 1;
        
        // Name to ID maps
        std::unordered_map<std::string, StateId> stateIds;
        std::unordered_map<std::string, VariableId> varIds;

        void error(const std::string& msg) { errors.push_back(msg); }
        void warn(const std::string& msg) { warnings.push_back(msg); }
    };

    // Top-level parsing
    void parseRoot(ryml::ConstNodeRef root, Automata& automata, ParseContext& ctx);
    void parseConfig(ryml::ConstNodeRef node, Automata& automata, ParseContext& ctx);
    void parseAutomataSection(ryml::ConstNodeRef node, Automata& automata, ParseContext& ctx);

    // Component parsing
    void parseStates(ryml::ConstNodeRef node, Automata& automata, ParseContext& ctx);
    void parseTransitions(ryml::ConstNodeRef node, Automata& automata, ParseContext& ctx);
    void parseVariables(ryml::ConstNodeRef node, Automata& automata, ParseContext& ctx);

    // Detail parsing
    State parseState(ryml::ConstNodeRef node, const std::string& name, ParseContext& ctx);
    Transition parseTransition(ryml::ConstNodeRef node, const std::string& name, 
                               const Automata& automata, ParseContext& ctx);
    VariableSpec parseVariableSpec(ryml::ConstNodeRef node, ParseContext& ctx);
    VariableSpec parseVariableShort(const std::string& spec, ParseContext& ctx);
    CodeBlock parseCode(ryml::ConstNodeRef node);

    // Transition type parsing
    ClassicConfig parseClassicConfig(ryml::ConstNodeRef node, ParseContext& ctx);
    TimedConfig parseTimedConfig(ryml::ConstNodeRef node, ParseContext& ctx);
    EventConfig parseEventConfig(ryml::ConstNodeRef node, ParseContext& ctx);
    ProbabilisticConfig parseProbabilisticConfig(ryml::ConstNodeRef node, ParseContext& ctx);

    // Utility
    std::string getString(ryml::ConstNodeRef node);
    std::optional<std::string> getOptString(ryml::ConstNodeRef node, const char* key);
    int getInt(ryml::ConstNodeRef node, int defaultVal = 0);
    double getDouble(ryml::ConstNodeRef node, double defaultVal = 0.0);
    bool getBool(ryml::ConstNodeRef node, bool defaultVal = false);
    
    ValueType parseValueType(const std::string& typeStr);
    VariableDirection parseDirection(const std::string& dirStr);
    TransitionType parseTransitionType(const std::string& typeStr);
    TimedMode parseTimedMode(const std::string& modeStr);
    EventTrigger parseEventTrigger(const std::string& triggerStr);
    CompareOp parseCompareOp(const std::string& opStr);
    Value parseDefaultValue(const std::string& valStr, ValueType type);
};

// ============================================================================
// Implementation
// ============================================================================

inline ParseResult AutomataParser::parseFile(const std::string& filePath) {
    std::ifstream file(filePath);
    if (!file.is_open()) {
        ParseResult result;
        result.errors.push_back("Failed to open file: " + filePath);
        return result;
    }

    std::stringstream buffer;
    buffer << file.rdbuf();
    
    // Extract base path
    std::string basePath = filePath;
    auto pos = basePath.find_last_of("/\\");
    if (pos != std::string::npos) {
        basePath = basePath.substr(0, pos);
    } else {
        basePath = ".";
    }

    return parseString(buffer.str(), basePath);
}

inline ParseResult AutomataParser::parseString(const std::string& yaml, 
                                                const std::string& basePath) {
    ParseResult result;
    ParseContext ctx;
    ctx.basePath = basePath;

    try {
        // Convert std::string to c4::csubstr explicitly
        c4::csubstr yamlView(yaml.c_str(), yaml.size());
        ryml::Tree tree = ryml::parse_in_arena(yamlView);
        ryml::ConstNodeRef root = tree.rootref();

        result.automata = std::make_unique<Automata>();
        parseRoot(root, *result.automata, ctx);

        result.errors = std::move(ctx.errors);
        result.warnings = std::move(ctx.warnings);

        if (!result.errors.empty()) {
            result.automata.reset();
        }
    } catch (const std::exception& e) {
        result.errors.push_back(std::string("YAML parse error: ") + e.what());
    }

    return result;
}

inline void AutomataParser::parseRoot(ryml::ConstNodeRef root, Automata& automata, 
                                       ParseContext& ctx) {
    // Handle both list-of-singletons and direct map formats
    if (root.is_map()) {
        // Direct map format
        if (root.has_child("version")) {
            automata.specVersion = getString(root["version"]);
        }
        if (root.has_child("config")) {
            parseConfig(root["config"], automata, ctx);
        }
        if (root.has_child("automata")) {
            parseAutomataSection(root["automata"], automata, ctx);
        }
        if (root.has_child("variables")) {
            parseVariables(root["variables"], automata, ctx);
        }
    } else if (root.is_seq()) {
        // List-of-singletons format
        for (auto child : root.children()) {
            if (child.is_map()) {
                if (child.has_child("version")) {
                    automata.specVersion = getString(child["version"]);
                } else if (child.has_child("config")) {
                    parseConfig(child["config"], automata, ctx);
                } else if (child.has_child("automata")) {
                    parseAutomataSection(child["automata"], automata, ctx);
                } else if (child.has_child("variables")) {
                    parseVariables(child["variables"], automata, ctx);
                }
            }
        }
    }
}

inline void AutomataParser::parseConfig(ryml::ConstNodeRef node, Automata& automata, 
                                         ParseContext& ctx) {
    if (node.has_child("name")) {
        automata.config.name = getString(node["name"]);
    }
    if (node.has_child("type")) {
        std::string typeStr = getString(node["type"]);
        automata.config.layout = (typeStr == "folder") ? LayoutType::Folder : LayoutType::Inline;
    }
    if (node.has_child("location")) {
        automata.config.location = getString(node["location"]);
    }
    if (node.has_child("description")) {
        automata.config.description = getString(node["description"]);
    }
    if (node.has_child("author")) {
        automata.config.author = getString(node["author"]);
    }
    if (node.has_child("version")) {
        automata.config.version = getString(node["version"]);
    }
    if (node.has_child("tags") && node["tags"].is_seq()) {
        for (auto tag : node["tags"].children()) {
            automata.config.tags.push_back(getString(tag));
        }
    }
}

inline void AutomataParser::parseAutomataSection(ryml::ConstNodeRef node, 
                                                  Automata& automata, ParseContext& ctx) {
    // Parse initial_state
    if (node.has_child("initial_state")) {
        std::string initialName = getString(node["initial_state"]);
        // Will resolve after states are parsed
        ctx.stateIds["__initial__"] = 0;  // Placeholder
    }

    // Parse states first (to build ID map)
    if (node.has_child("states")) {
        parseStates(node["states"], automata, ctx);
    }

    // Resolve initial state
    if (node.has_child("initial_state")) {
        std::string initialName = getString(node["initial_state"]);
        auto it = ctx.stateIds.find(initialName);
        if (it != ctx.stateIds.end()) {
            automata.initialState = it->second;
        } else {
            ctx.error("Initial state not found: " + initialName);
        }
    } else if (!automata.states.empty()) {
        // Default to first state
        automata.initialState = automata.states.begin()->first;
    }

    // Parse transitions
    if (node.has_child("transitions")) {
        parseTransitions(node["transitions"], automata, ctx);
    }
}

inline void AutomataParser::parseStates(ryml::ConstNodeRef node, Automata& automata, 
                                         ParseContext& ctx) {
    for (auto stateNode : node.children()) {
        std::string name;
        name.assign(stateNode.key().str, stateNode.key().len);
        
        State state = parseState(stateNode, name, ctx);
        state.id = ctx.nextStateId++;
        ctx.stateIds[name] = state.id;
        
        automata.states[state.id] = std::move(state);
    }
}

inline State AutomataParser::parseState(ryml::ConstNodeRef node, const std::string& name, 
                                         ParseContext& ctx) {
    State state;
    state.name = name;

    // Parse inputs
    if (node.has_child("inputs") && node["inputs"].is_seq()) {
        for (auto input : node["inputs"].children()) {
            VariableSpec spec = parseVariableShort(getString(input), ctx);
            spec.direction = VariableDirection::Input;
            state.inputIds.push_back(spec.id);
        }
    }

    // Parse outputs
    if (node.has_child("outputs") && node["outputs"].is_seq()) {
        for (auto output : node["outputs"].children()) {
            VariableSpec spec = parseVariableShort(getString(output), ctx);
            spec.direction = VariableDirection::Output;
            state.outputIds.push_back(spec.id);
        }
    }

    // Parse variables
    if (node.has_child("variables") && node["variables"].is_seq()) {
        for (auto var : node["variables"].children()) {
            VariableSpec spec = parseVariableShort(getString(var), ctx);
            spec.direction = VariableDirection::Internal;
            state.variableIds.push_back(spec.id);
        }
    }

    // Parse code hooks
    if (node.has_child("code")) {
        state.body = parseCode(node["code"]);
    }
    if (node.has_child("on_enter")) {
        state.onEnter = parseCode(node["on_enter"]);
    }
    if (node.has_child("on_exit")) {
        state.onExit = parseCode(node["on_exit"]);
    }

    // Parse description
    if (node.has_child("description")) {
        state.description = getString(node["description"]);
    }

    return state;
}

inline void AutomataParser::parseTransitions(ryml::ConstNodeRef node, Automata& automata, 
                                              ParseContext& ctx) {
    for (auto transNode : node.children()) {
        std::string name;
        name.assign(transNode.key().str, transNode.key().len);
        
        Transition trans = parseTransition(transNode, name, automata, ctx);
        trans.id = ctx.nextTransitionId++;
        
        automata.transitions[trans.id] = std::move(trans);
    }
}

inline Transition AutomataParser::parseTransition(ryml::ConstNodeRef node, 
                                                   const std::string& name,
                                                   const Automata& automata,
                                                   ParseContext& ctx) {
    Transition trans;
    trans.name = name;

    // Parse from/to
    if (node.has_child("from")) {
        std::string fromName = getString(node["from"]);
        auto it = ctx.stateIds.find(fromName);
        if (it != ctx.stateIds.end()) {
            trans.from = it->second;
        } else {
            ctx.error("Transition " + name + ": source state not found: " + fromName);
        }
    }

    if (node.has_child("to")) {
        std::string toName = getString(node["to"]);
        auto it = ctx.stateIds.find(toName);
        if (it != ctx.stateIds.end()) {
            trans.to = it->second;
        } else {
            ctx.error("Transition " + name + ": target state not found: " + toName);
        }
    }

    // Parse type
    if (node.has_child("type")) {
        trans.type = parseTransitionType(getString(node["type"]));
    }

    // Parse type-specific config
    switch (trans.type) {
        case TransitionType::Classic:
            if (node.has_child("condition")) {
                trans.classicConfig.condition = parseCode(node["condition"]);
            }
            if (node.has_child("on_rising_edge")) {
                trans.classicConfig.onRisingEdge = getBool(node["on_rising_edge"]);
            }
            break;

        case TransitionType::Timed:
            if (node.has_child("timed")) {
                trans.timedConfig = parseTimedConfig(node["timed"], ctx);
            } else {
                // Simple format: just delay_ms
                if (node.has_child("delay_ms")) {
                    trans.timedConfig.delayMs = getInt(node["delay_ms"]);
                }
            }
            // Also check for top-level condition (additional to timer)
            if (node.has_child("condition") && trans.timedConfig.additionalCondition.isEmpty()) {
                trans.timedConfig.additionalCondition = parseCode(node["condition"]);
            }
            break;

        case TransitionType::Event:
            if (node.has_child("event")) {
                trans.eventConfig = parseEventConfig(node["event"], ctx);
            }
            break;

        case TransitionType::Probabilistic:
            if (node.has_child("probabilistic")) {
                trans.probConfig = parseProbabilisticConfig(node["probabilistic"], ctx);
            }
            break;

        default:
            break;
    }

    // Parse common fields
    if (node.has_child("body")) {
        trans.body = parseCode(node["body"]);
    }
    if (node.has_child("triggered")) {
        trans.triggered = parseCode(node["triggered"]);
    }
    if (node.has_child("priority")) {
        trans.priority = static_cast<uint8_t>(getInt(node["priority"]));
    }
    if (node.has_child("weight")) {
        trans.weight = static_cast<uint16_t>(getDouble(node["weight"]) * 100);
    }
    if (node.has_child("enabled")) {
        trans.enabled = getBool(node["enabled"], true);
    }
    if (node.has_child("description")) {
        trans.description = getString(node["description"]);
    }

    return trans;
}

inline void AutomataParser::parseVariables(ryml::ConstNodeRef node, Automata& automata, 
                                            ParseContext& ctx) {
    for (auto varNode : node.children()) {
        if (varNode.is_map()) {
            VariableSpec spec = parseVariableSpec(varNode, ctx);
            automata.variables.push_back(std::move(spec));
        } else {
            VariableSpec spec = parseVariableShort(getString(varNode), ctx);
            automata.variables.push_back(std::move(spec));
        }
    }
}

inline VariableSpec AutomataParser::parseVariableSpec(ryml::ConstNodeRef node, 
                                                       ParseContext& ctx) {
    VariableSpec spec;
    spec.id = ctx.nextVarId++;
    
    if (node.has_child("name")) {
        spec.name = getString(node["name"]);
    }
    if (node.has_child("type")) {
        spec.type = parseValueType(getString(node["type"]));
    }
    if (node.has_child("direction")) {
        spec.direction = parseDirection(getString(node["direction"]));
    }
    if (node.has_child("description")) {
        spec.description = getString(node["description"]);
    }
    
    // Parse default/initial value
    if (node.has_child("default")) {
        std::string defaultStr = getString(node["default"]);
        spec.initialValue = parseDefaultValue(defaultStr, spec.type);
    }

    ctx.varIds[spec.name] = spec.id;
    return spec;
}

inline VariableSpec AutomataParser::parseVariableShort(const std::string& spec, 
                                                        ParseContext& ctx) {
    VariableSpec result;
    result.id = ctx.nextVarId++;

    // Format: "name" or "name:type"
    auto colonPos = spec.find(':');
    if (colonPos != std::string::npos) {
        result.name = spec.substr(0, colonPos);
        result.type = parseValueType(spec.substr(colonPos + 1));
    } else {
        result.name = spec;
        result.type = ValueType::String;  // Default
    }

    ctx.varIds[result.name] = result.id;
    return result;
}

inline CodeBlock AutomataParser::parseCode(ryml::ConstNodeRef node) {
    CodeBlock code;
    code.source = getString(node);
    return code;
}

inline TimedConfig AutomataParser::parseTimedConfig(ryml::ConstNodeRef node, 
                                                     ParseContext& ctx) {
    TimedConfig config;
    
    if (node.has_child("mode")) {
        config.mode = parseTimedMode(getString(node["mode"]));
    }
    if (node.has_child("delay_ms")) {
        config.delayMs = getInt(node["delay_ms"]);
    }
    if (node.has_child("jitter_ms")) {
        config.jitterMs = getInt(node["jitter_ms"]);
    }
    if (node.has_child("repeat_count")) {
        config.repeatCount = getInt(node["repeat_count"]);
    }
    if (node.has_child("condition")) {
        config.additionalCondition = parseCode(node["condition"]);
    }

    return config;
}

inline EventConfig AutomataParser::parseEventConfig(ryml::ConstNodeRef node, 
                                                     ParseContext& ctx) {
    EventConfig config;

    if (node.has_child("triggers") && node["triggers"].is_seq()) {
        for (auto triggerNode : node["triggers"].children()) {
            SignalTrigger trigger;
            
            if (triggerNode.has_child("signal")) {
                trigger.signalName = getString(triggerNode["signal"]);
            }
            if (triggerNode.has_child("trigger")) {
                trigger.triggerType = parseEventTrigger(getString(triggerNode["trigger"]));
            }
            if (triggerNode.has_child("threshold")) {
                auto threshNode = triggerNode["threshold"];
                ThresholdConfig thresh;
                if (threshNode.has_child("operator")) {
                    thresh.op = parseCompareOp(getString(threshNode["operator"]));
                }
                if (threshNode.has_child("value")) {
                    // Parse as double for now
                    thresh.value = Value(getDouble(threshNode["value"]));
                }
                trigger.threshold = thresh;
            }

            config.triggers.push_back(std::move(trigger));
        }
    }

    if (node.has_child("require_all")) {
        config.requireAll = getBool(node["require_all"]);
    }
    if (node.has_child("debounce_ms")) {
        config.debounceMs = getInt(node["debounce_ms"]);
    }
    if (node.has_child("condition")) {
        config.additionalCondition = parseCode(node["condition"]);
    }

    return config;
}

inline ProbabilisticConfig AutomataParser::parseProbabilisticConfig(ryml::ConstNodeRef node,
                                                                     ParseContext& ctx) {
    ProbabilisticConfig config;

    if (node.has_child("weight")) {
        config.weight = static_cast<uint16_t>(getDouble(node["weight"]) * 100);
    }
    if (node.has_child("weight_expression")) {
        config.weightExpression = parseCode(node["weight_expression"]);
        config.isDynamic = true;
    }
    if (node.has_child("min_weight")) {
        config.minWeight = static_cast<uint16_t>(getDouble(node["min_weight"]) * 100);
    }

    return config;
}

// Utility implementations
inline std::string AutomataParser::getString(ryml::ConstNodeRef node) {
    if (node.is_keyval() || node.is_val()) {
        return std::string(node.val().str, node.val().len);
    }
    return "";
}

inline std::optional<std::string> AutomataParser::getOptString(ryml::ConstNodeRef node, 
                                                                const char* key) {
    if (node.has_child(key)) {
        return getString(node[key]);
    }
    return std::nullopt;
}

inline int AutomataParser::getInt(ryml::ConstNodeRef node, int defaultVal) {
    std::string s = getString(node);
    if (s.empty()) return defaultVal;
    try {
        return std::stoi(s);
    } catch (...) {
        return defaultVal;
    }
}

inline double AutomataParser::getDouble(ryml::ConstNodeRef node, double defaultVal) {
    std::string s = getString(node);
    if (s.empty()) return defaultVal;
    try {
        return std::stod(s);
    } catch (...) {
        return defaultVal;
    }
}

inline bool AutomataParser::getBool(ryml::ConstNodeRef node, bool defaultVal) {
    std::string s = getString(node);
    if (s == "true" || s == "yes" || s == "1") return true;
    if (s == "false" || s == "no" || s == "0") return false;
    return defaultVal;
}

inline ValueType AutomataParser::parseValueType(const std::string& typeStr) {
    if (typeStr == "bool" || typeStr == "boolean") return ValueType::Bool;
    if (typeStr == "int" || typeStr == "int32") return ValueType::Int32;
    if (typeStr == "int64" || typeStr == "long") return ValueType::Int64;
    if (typeStr == "float" || typeStr == "float32") return ValueType::Float32;
    if (typeStr == "double" || typeStr == "float64") return ValueType::Float64;
    if (typeStr == "string") return ValueType::String;
    if (typeStr == "binary" || typeStr == "bytes") return ValueType::Binary;
    if (typeStr == "table") return ValueType::Table;
    return ValueType::String;  // Default
}

inline Value AutomataParser::parseDefaultValue(const std::string& valStr, ValueType type) {
    switch (type) {
        case ValueType::Bool:
            return Value(valStr == "true" || valStr == "yes" || valStr == "1");
        case ValueType::Int32:
            try { return Value(std::stoi(valStr)); }
            catch (...) { return Value(int32_t{0}); }
        case ValueType::Int64:
            try { return Value(static_cast<int64_t>(std::stoll(valStr))); }
            catch (...) { return Value(int64_t{0}); }
        case ValueType::Float32:
            try { return Value(std::stof(valStr)); }
            catch (...) { return Value(0.0f); }
        case ValueType::Float64:
            try { return Value(std::stod(valStr)); }
            catch (...) { return Value(0.0); }
        case ValueType::String:
            return Value(valStr);
        default:
            return Value();
    }
}

inline VariableDirection AutomataParser::parseDirection(const std::string& dirStr) {
    if (dirStr == "input" || dirStr == "in") return VariableDirection::Input;
    if (dirStr == "output" || dirStr == "out") return VariableDirection::Output;
    return VariableDirection::Internal;
}

inline TransitionType AutomataParser::parseTransitionType(const std::string& typeStr) {
    if (typeStr == "classic" || typeStr == "condition") return TransitionType::Classic;
    if (typeStr == "timed" || typeStr == "timer") return TransitionType::Timed;
    if (typeStr == "event" || typeStr == "signal") return TransitionType::Event;
    if (typeStr == "probabilistic" || typeStr == "random") return TransitionType::Probabilistic;
    if (typeStr == "immediate" || typeStr == "epsilon") return TransitionType::Immediate;
    return TransitionType::Classic;  // Default
}

inline TimedMode AutomataParser::parseTimedMode(const std::string& modeStr) {
    if (modeStr == "after") return TimedMode::After;
    if (modeStr == "at") return TimedMode::At;
    if (modeStr == "every" || modeStr == "periodic") return TimedMode::Every;
    if (modeStr == "timeout") return TimedMode::Timeout;
    if (modeStr == "window") return TimedMode::Window;
    return TimedMode::After;  // Default
}

inline EventTrigger AutomataParser::parseEventTrigger(const std::string& triggerStr) {
    if (triggerStr == "on_change" || triggerStr == "change") return EventTrigger::OnChange;
    if (triggerStr == "on_rise" || triggerStr == "rise") return EventTrigger::OnRise;
    if (triggerStr == "on_fall" || triggerStr == "fall") return EventTrigger::OnFall;
    if (triggerStr == "on_threshold" || triggerStr == "threshold") return EventTrigger::OnThreshold;
    if (triggerStr == "on_match" || triggerStr == "match") return EventTrigger::OnMatch;
    return EventTrigger::OnChange;  // Default
}

inline CompareOp AutomataParser::parseCompareOp(const std::string& opStr) {
    if (opStr == "==" || opStr == "eq") return CompareOp::Eq;
    if (opStr == "!=" || opStr == "ne") return CompareOp::Ne;
    if (opStr == "<" || opStr == "lt") return CompareOp::Lt;
    if (opStr == "<=" || opStr == "le") return CompareOp::Le;
    if (opStr == ">" || opStr == "gt") return CompareOp::Gt;
    if (opStr == ">=" || opStr == "ge") return CompareOp::Ge;
    return CompareOp::Eq;  // Default
}

} // namespace aeth

#endif // AETHERIUM_PARSER_HPP
