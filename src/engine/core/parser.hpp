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
#include <filesystem>
#include <string>
#include <fstream>
#include <sstream>
#include <algorithm>
#include <cctype>
#include <limits>

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
    enum class DurationDefaultUnit {
        Milliseconds,
        Seconds,
    };

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
    void parseBlackBox(ryml::ConstNodeRef node, Automata& automata, ParseContext& ctx);

    // Component parsing
    void parseStates(ryml::ConstNodeRef node, Automata& automata, ParseContext& ctx);
    void parseTransitions(ryml::ConstNodeRef node, Automata& automata, ParseContext& ctx);
    void parseVariables(ryml::ConstNodeRef node, Automata& automata, ParseContext& ctx);

    // Detail parsing
    State parseState(ryml::ConstNodeRef node, const std::string& name, Automata& automata, ParseContext& ctx);
    Transition parseTransition(ryml::ConstNodeRef node, const std::string& name, 
                               ParseContext& ctx);
    VariableSpec parseVariableSpec(ryml::ConstNodeRef node, ParseContext& ctx);
    VariableSpec parseVariableShort(const std::string& spec, ParseContext& ctx);
    CodeBlock parseCode(ryml::ConstNodeRef node);
    BlackBoxPort parseBlackBoxPort(ryml::ConstNodeRef node, ParseContext& ctx);
    BlackBoxResource parseBlackBoxResource(ryml::ConstNodeRef node, ParseContext& ctx);

    // Transition type parsing
    ClassicConfig parseClassicConfig(ryml::ConstNodeRef node, ParseContext& ctx);
    TimedConfig parseTimedConfig(ryml::ConstNodeRef node, ParseContext& ctx);
    EventConfig parseEventConfig(ryml::ConstNodeRef node, ParseContext& ctx);
    ProbabilisticConfig parseProbabilisticConfig(ryml::ConstNodeRef node, ParseContext& ctx);

    // Utility
    std::string getString(ryml::ConstNodeRef node);
    std::optional<std::string> getOptString(ryml::ConstNodeRef node, const char* key);
    int getInt(ryml::ConstNodeRef node, int defaultVal = 0);
    int parseDurationMs(ryml::ConstNodeRef node,
                        int defaultVal = 0,
                        DurationDefaultUnit defaultUnit = DurationDefaultUnit::Milliseconds);
    double getDouble(ryml::ConstNodeRef node, double defaultVal = 0.0);
    bool getBool(ryml::ConstNodeRef node, bool defaultVal = false);
    
    ValueType parseValueType(const std::string& typeStr);
    VariableDirection parseDirection(const std::string& dirStr);
    TransitionType parseTransitionType(const std::string& typeStr);
    TimedMode parseTimedMode(const std::string& modeStr);
    EventTrigger parseEventTrigger(const std::string& triggerStr);
    CompareOp parseCompareOp(const std::string& opStr);
    Value parseDefaultValue(const std::string& valStr, ValueType type);

    std::optional<ryml::ConstNodeRef> findChild(ryml::ConstNodeRef node, const char* key);
    std::string nodeKey(ryml::ConstNodeRef node);
    VariableId ensureVariable(const std::string& specText,
                              VariableDirection direction,
                              Automata& automata,
                              ParseContext& ctx);
    VariableId ensureVariable(VariableSpec spec, Automata& automata, ParseContext& ctx);
    void resolveFolderLayoutCode(Automata& automata, ParseContext& ctx);
    std::string readTextFile(const std::filesystem::path& path, ParseContext& ctx);
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
        if (root.has_child("black_box")) {
            parseBlackBox(root["black_box"], automata, ctx);
        } else if (root.has_child("contract")) {
            parseBlackBox(root["contract"], automata, ctx);
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
                } else if (child.has_child("black_box")) {
                    parseBlackBox(child["black_box"], automata, ctx);
                } else if (child.has_child("contract")) {
                    parseBlackBox(child["contract"], automata, ctx);
                }
            }
        }
    }
}

inline void AutomataParser::parseConfig(ryml::ConstNodeRef node, Automata& automata, 
                                         ParseContext& ctx) {
    if (auto n = findChild(node, "name")) {
        automata.config.name = getString(*n);
    }
    if (auto n = findChild(node, "type")) {
        std::string typeStr = getString(*n);
        automata.config.layout = (typeStr == "folder") ? LayoutType::Folder : LayoutType::Inline;
    }
    if (auto n = findChild(node, "location")) {
        automata.config.location = getString(*n);
    }
    if (auto n = findChild(node, "description")) {
        automata.config.description = getString(*n);
    }
    if (auto n = findChild(node, "author")) {
        automata.config.author = getString(*n);
    }
    if (auto n = findChild(node, "version")) {
        automata.config.version = getString(*n);
    }
    if (auto n = findChild(node, "tags"); n && (*n).is_seq()) {
        for (auto tag : (*n).children()) {
            automata.config.tags.push_back(getString(tag));
        }
    }
}

inline void AutomataParser::parseBlackBox(ryml::ConstNodeRef node,
                                          Automata& automata,
                                          ParseContext& ctx) {
    if (auto portsNode = findChild(node, "ports"); portsNode && (*portsNode).is_seq()) {
        for (auto portNode : (*portsNode).children()) {
            automata.blackBox.ports.push_back(parseBlackBoxPort(portNode, ctx));
        }
    }

    if (auto emittedNode = findChild(node, "emitted_events"); emittedNode && (*emittedNode).is_seq()) {
        for (auto eventNode : (*emittedNode).children()) {
            automata.blackBox.emittedEvents.push_back(getString(eventNode));
        }
    }

    if (auto observableNode = findChild(node, "observable_states"); observableNode && (*observableNode).is_seq()) {
        for (auto stateNode : (*observableNode).children()) {
            automata.blackBox.observableStates.push_back(getString(stateNode));
        }
    }

    if (auto resourcesNode = findChild(node, "resources"); resourcesNode && (*resourcesNode).is_seq()) {
        for (auto resourceNode : (*resourcesNode).children()) {
            automata.blackBox.resources.push_back(parseBlackBoxResource(resourceNode, ctx));
        }
    }
}

inline void AutomataParser::parseAutomataSection(ryml::ConstNodeRef node, 
                                                  Automata& automata, ParseContext& ctx) {
    // Parse states first (to build ID map)
    if (auto statesNode = findChild(node, "states")) {
        parseStates(*statesNode, automata, ctx);
    }

    // Resolve initial state
    if (auto initialNode = findChild(node, "initial_state")) {
        std::string initialName = getString(*initialNode);
        auto it = ctx.stateIds.find(initialName);
        if (it != ctx.stateIds.end()) {
            automata.initialState = it->second;
        } else {
            ctx.error("Initial state not found: " + initialName);
        }
    } else if (!automata.states.empty()) {
        // Default to the first parsed state (lowest generated state id)
        auto it = std::min_element(
            automata.states.begin(),
            automata.states.end(),
            [](const auto& a, const auto& b) { return a.first < b.first; }
        );
        automata.initialState = it->first;
    }

    // Parse transitions
    if (auto transitionsNode = findChild(node, "transitions")) {
        parseTransitions(*transitionsNode, automata, ctx);
    }

    if (automata.config.layout == LayoutType::Folder) {
        resolveFolderLayoutCode(automata, ctx);
    }
}

inline void AutomataParser::parseStates(ryml::ConstNodeRef node, Automata& automata, 
                                         ParseContext& ctx) {
    if (node.is_map() || (!node.is_seq() && node.num_children() > 0)) {
        for (auto stateNode : node.children()) {
            const std::string name = nodeKey(stateNode);
            if (name.empty()) {
                ctx.error("State entry missing name");
                continue;
            }
            // Legacy list-of-singletons shape may include a placeholder
            // `states:` key alongside concrete state entries in the same map.
            if (name == "states" && stateNode.is_keyval() && stateNode.num_children() == 0) {
                continue;
            }

            State state = parseState(stateNode, name, automata, ctx);
            state.id = ctx.nextStateId++;
            ctx.stateIds[name] = state.id;

            automata.states[state.id] = std::move(state);
        }
    } else if (node.is_seq()) {
        for (auto stateNode : node.children()) {
            std::string name;
            if (auto idNode = findChild(stateNode, "id")) {
                name = getString(*idNode);
            } else if (stateNode.is_map() && stateNode.num_children() == 1) {
                for (auto only : stateNode.children()) {
                    name = nodeKey(only);
                    stateNode = only;
                    break;
                }
            }

            if (name.empty()) {
                ctx.error("State sequence entry missing id");
                continue;
            }

            State state = parseState(stateNode, name, automata, ctx);
            state.id = ctx.nextStateId++;
            ctx.stateIds[name] = state.id;
            automata.states[state.id] = std::move(state);
        }
    }
}

inline State AutomataParser::parseState(ryml::ConstNodeRef node, const std::string& name,
                                         Automata& automata, ParseContext& ctx) {
    State state;
    state.name = name;

    // Parse inputs
    if (auto inputsNode = findChild(node, "inputs"); inputsNode && (*inputsNode).is_seq()) {
        for (auto input : (*inputsNode).children()) {
            const auto id = ensureVariable(getString(input), VariableDirection::Input, automata, ctx);
            state.inputIds.push_back(id);
        }
    }

    // Parse outputs
    if (auto outputsNode = findChild(node, "outputs"); outputsNode && (*outputsNode).is_seq()) {
        for (auto output : (*outputsNode).children()) {
            const auto id = ensureVariable(getString(output), VariableDirection::Output, automata, ctx);
            state.outputIds.push_back(id);
        }
    }

    // Parse variables
    if (auto varsNode = findChild(node, "variables"); varsNode && (*varsNode).is_seq()) {
        for (auto var : (*varsNode).children()) {
            const auto id = ensureVariable(getString(var), VariableDirection::Internal, automata, ctx);
            state.variableIds.push_back(id);
        }
    }

    // Parse code hooks
    if (auto bodyNode = findChild(node, "code")) {
        state.body = parseCode(*bodyNode);
    } else if (auto bodyTick = findChild(node, "on_tick")) {
        state.body = parseCode(*bodyTick);
    }
    if (auto onEnterNode = findChild(node, "on_enter")) {
        state.onEnter = parseCode(*onEnterNode);
    }
    if (auto onExitNode = findChild(node, "on_exit")) {
        state.onExit = parseCode(*onExitNode);
    }

    // Parse description
    if (auto descNode = findChild(node, "description")) {
        state.description = getString(*descNode);
    }

    return state;
}

inline void AutomataParser::parseTransitions(ryml::ConstNodeRef node, Automata& automata, 
                                              ParseContext& ctx) {
    if (node.is_map() || (!node.is_seq() && node.num_children() > 0)) {
        for (auto transNode : node.children()) {
            const std::string name = nodeKey(transNode);
            if (name.empty()) {
                ctx.error("Transition entry missing name");
                continue;
            }
            // Legacy list-of-singletons shape may include a placeholder
            // `transitions:` key alongside concrete transition entries.
            if (name == "transitions" && transNode.is_keyval() && transNode.num_children() == 0) {
                continue;
            }

            Transition trans = parseTransition(transNode, name, ctx);
            trans.id = ctx.nextTransitionId++;
            automata.transitions[trans.id] = std::move(trans);
        }
    } else if (node.is_seq()) {
        uint32_t index = 0;
        for (auto transNode : node.children()) {
            std::string name;
            if (auto idNode = findChild(transNode, "id")) {
                name = getString(*idNode);
            }
            if (name.empty()) {
                ++index;
                name = "transition_" + std::to_string(index);
            }
            Transition trans = parseTransition(transNode, name, ctx);
            trans.id = ctx.nextTransitionId++;
            automata.transitions[trans.id] = std::move(trans);
        }
    }
}

inline Transition AutomataParser::parseTransition(ryml::ConstNodeRef node, 
                                                   const std::string& name,
                                                   ParseContext& ctx) {
    Transition trans;
    trans.name = name;

    // Parse from/to
    if (auto fromNode = findChild(node, "from")) {
        std::string fromName = getString(*fromNode);
        auto it = ctx.stateIds.find(fromName);
        if (it != ctx.stateIds.end()) {
            trans.from = it->second;
        } else {
            ctx.error("Transition " + name + ": source state not found: " + fromName);
        }
    }

    if (auto toNode = findChild(node, "to")) {
        std::string toName = getString(*toNode);
        auto it = ctx.stateIds.find(toName);
        if (it != ctx.stateIds.end()) {
            trans.to = it->second;
        } else {
            ctx.error("Transition " + name + ": target state not found: " + toName);
        }
    }

    // Parse type
    if (auto typeNode = findChild(node, "type")) {
        trans.type = parseTransitionType(getString(*typeNode));
    }

    // Parse type-specific config
    switch (trans.type) {
        case TransitionType::Classic:
            if (auto conditionNode = findChild(node, "condition")) {
                trans.classicConfig.condition = parseCode(*conditionNode);
            }
            if (auto risingNode = findChild(node, "on_rising_edge")) {
                trans.classicConfig.onRisingEdge = getBool(*risingNode);
            }
            break;

        case TransitionType::Timed:
            if (auto timedNode = findChild(node, "timed")) {
                trans.timedConfig = parseTimedConfig(*timedNode, ctx);
            } else {
                // Simple format: just delay_ms
                if (auto delayNode = findChild(node, "delay_ms")) {
                    trans.timedConfig.delayMs = parseDurationMs(*delayNode);
                } else if (auto delayNode = findChild(node, "delayMs")) {
                    trans.timedConfig.delayMs = parseDurationMs(*delayNode);
                } else if (auto afterNode = findChild(node, "after")) {
                    // `after` is human-facing shorthand; bare numbers are seconds.
                    trans.timedConfig.delayMs = parseDurationMs(
                        *afterNode, 0, DurationDefaultUnit::Seconds);
                }
            }
            // Also check for top-level condition (additional to timer)
            if (auto conditionNode = findChild(node, "condition");
                conditionNode && trans.timedConfig.additionalCondition.isEmpty()) {
                trans.timedConfig.additionalCondition = parseCode(*conditionNode);
            }
            break;

        case TransitionType::Event:
            if (auto eventNode = findChild(node, "event")) {
                trans.eventConfig = parseEventConfig(*eventNode, ctx);
            }
            break;

        case TransitionType::Probabilistic:
            if (auto probNode = findChild(node, "probabilistic")) {
                trans.probConfig = parseProbabilisticConfig(*probNode, ctx);
            }
            break;

        default:
            break;
    }

    // Parse common fields
    if (auto bodyNode = findChild(node, "body")) {
        trans.body = parseCode(*bodyNode);
    }
    if (auto triggeredNode = findChild(node, "triggered")) {
        trans.triggered = parseCode(*triggeredNode);
    }
    if (auto priorityNode = findChild(node, "priority")) {
        trans.priority = static_cast<uint8_t>(getInt(*priorityNode));
    }
    if (auto weightNode = findChild(node, "weight")) {
        trans.weight = static_cast<uint16_t>(getDouble(*weightNode) * 100);
    }
    if (auto enabledNode = findChild(node, "enabled")) {
        trans.enabled = getBool(*enabledNode, true);
    }
    if (auto descNode = findChild(node, "description")) {
        trans.description = getString(*descNode);
    }

    return trans;
}

inline void AutomataParser::parseVariables(ryml::ConstNodeRef node, Automata& automata, 
                                            ParseContext& ctx) {
    for (auto varNode : node.children()) {
        if (varNode.is_map()) {
            VariableSpec spec = parseVariableSpec(varNode, ctx);
            ensureVariable(std::move(spec), automata, ctx);
        } else {
            VariableSpec spec = parseVariableShort(getString(varNode), ctx);
            ensureVariable(std::move(spec), automata, ctx);
        }
    }
}

inline VariableSpec AutomataParser::parseVariableSpec(ryml::ConstNodeRef node, 
                                                       ParseContext& ctx) {
    VariableSpec spec;
    spec.id = INVALID_VARIABLE;
    
    if (auto nameNode = findChild(node, "name")) {
        spec.name = getString(*nameNode);
    }
    if (auto typeNode = findChild(node, "type")) {
        spec.type = parseValueType(getString(*typeNode));
    }
    if (auto dirNode = findChild(node, "direction")) {
        spec.direction = parseDirection(getString(*dirNode));
    }
    if (auto descNode = findChild(node, "description")) {
        spec.description = getString(*descNode);
    }
    
    // Parse default/initial value
    if (auto defaultNode = findChild(node, "default")) {
        std::string defaultStr = getString(*defaultNode);
        spec.initialValue = parseDefaultValue(defaultStr, spec.type);
    }

    return spec;
}

inline VariableSpec AutomataParser::parseVariableShort(const std::string& spec, 
                                                        ParseContext& ctx) {
    VariableSpec result;
    result.id = INVALID_VARIABLE;

    // Format: "name" or "name:type"
    auto colonPos = spec.find(':');
    if (colonPos != std::string::npos) {
        result.name = spec.substr(0, colonPos);
        result.type = parseValueType(spec.substr(colonPos + 1));
    } else {
        result.name = spec;
        result.type = ValueType::String;  // Default
    }

    return result;
}

inline BlackBoxPort AutomataParser::parseBlackBoxPort(ryml::ConstNodeRef node,
                                                      ParseContext& ctx) {
    BlackBoxPort port;

    if (auto nameNode = findChild(node, "name")) {
        port.name = getString(*nameNode);
    } else {
        ctx.error("black_box port missing name");
    }
    if (auto dirNode = findChild(node, "direction")) {
        port.direction = parseDirection(getString(*dirNode));
    }
    if (auto typeNode = findChild(node, "type")) {
        port.type = parseValueType(getString(*typeNode));
    }
    if (auto observableNode = findChild(node, "observable")) {
        port.observable = getBool(*observableNode, true);
    }
    if (auto faultNode = findChild(node, "fault_injectable")) {
        port.faultInjectable = getBool(*faultNode, true);
    } else if (auto faultNode = findChild(node, "faultInjectable")) {
        port.faultInjectable = getBool(*faultNode, true);
    }
    if (auto latencyNode = findChild(node, "latency_critical")) {
        port.latencyCritical = getBool(*latencyNode, false);
    } else if (auto latencyNode = findChild(node, "latencyCritical")) {
        port.latencyCritical = getBool(*latencyNode, false);
    }
    if (auto descNode = findChild(node, "description")) {
        port.description = getString(*descNode);
    }

    return port;
}

inline BlackBoxResource AutomataParser::parseBlackBoxResource(ryml::ConstNodeRef node,
                                                              ParseContext& ctx) {
    BlackBoxResource resource;

    if (auto nameNode = findChild(node, "name")) {
        resource.name = getString(*nameNode);
    } else {
        ctx.error("black_box resource missing name");
    }
    if (auto kindNode = findChild(node, "kind")) {
        resource.kind = getString(*kindNode);
    }
    if (auto capNode = findChild(node, "capacity")) {
        resource.capacity = static_cast<uint32_t>(std::max(1, getInt(*capNode, 1)));
    }
    if (auto sharedNode = findChild(node, "shared")) {
        resource.shared = getBool(*sharedNode, true);
    }
    if (auto latencyNode = findChild(node, "latency_sensitive")) {
        resource.latencySensitive = getBool(*latencyNode, false);
    } else if (auto latencyNode = findChild(node, "latencySensitive")) {
        resource.latencySensitive = getBool(*latencyNode, false);
    }

    return resource;
}

inline CodeBlock AutomataParser::parseCode(ryml::ConstNodeRef node) {
    CodeBlock code;
    code.source = getString(node);
    return code;
}

inline TimedConfig AutomataParser::parseTimedConfig(ryml::ConstNodeRef node, 
                                                     ParseContext& ctx) {
    TimedConfig config;
    
    if (auto modeNode = findChild(node, "mode")) {
        config.mode = parseTimedMode(getString(*modeNode));
    }
    if (auto delayNode = findChild(node, "delay_ms")) {
        config.delayMs = parseDurationMs(*delayNode);
    } else if (auto delayNode = findChild(node, "delayMs")) {
        config.delayMs = parseDurationMs(*delayNode);
    } else if (auto afterNode = findChild(node, "after")) {
        // `after` is human-facing shorthand; bare numbers are seconds.
        config.delayMs = parseDurationMs(*afterNode, 0, DurationDefaultUnit::Seconds);
    }
    if (auto jitterNode = findChild(node, "jitter_ms")) {
        config.jitterMs = parseDurationMs(*jitterNode);
    } else if (auto jitterNode = findChild(node, "jitterMs")) {
        config.jitterMs = parseDurationMs(*jitterNode);
    }
    if (auto repeatNode = findChild(node, "repeat_count")) {
        config.repeatCount = getInt(*repeatNode);
    } else if (auto repeatNode = findChild(node, "repeatCount")) {
        config.repeatCount = getInt(*repeatNode);
    }
    if (auto windowNode = findChild(node, "window_end_ms")) {
        config.windowEndMs = parseDurationMs(*windowNode);
    } else if (auto windowNode = findChild(node, "windowEndMs")) {
        config.windowEndMs = parseDurationMs(*windowNode);
    } else if (auto windowNode = findChild(node, "window_end")) {
        config.windowEndMs = parseDurationMs(*windowNode, 0, DurationDefaultUnit::Seconds);
    }
    std::optional<int> absoluteMs;
    if (auto absoluteNode = findChild(node, "absolute_time_ms")) {
        absoluteMs = parseDurationMs(*absoluteNode);
    } else if (auto absoluteNode = findChild(node, "absoluteTimeMs")) {
        absoluteMs = parseDurationMs(*absoluteNode);
    } else if (auto absoluteNode = findChild(node, "at_ms")) {
        absoluteMs = parseDurationMs(*absoluteNode);
    }
    if (absoluteMs) {
        if (config.mode == TimedMode::At) {
            config.delayMs = *absoluteMs;
        } else if (*absoluteMs > 0 && config.delayMs == 0) {
            // Backward compatibility for payloads that provide only absolute time.
            config.mode = TimedMode::At;
            config.delayMs = *absoluteMs;
        }
    }
    if (auto condNode = findChild(node, "condition")) {
        config.additionalCondition = parseCode(*condNode);
    } else if (auto condNode = findChild(node, "additional_condition")) {
        config.additionalCondition = parseCode(*condNode);
    } else if (auto condNode = findChild(node, "additionalCondition")) {
        config.additionalCondition = parseCode(*condNode);
    }

    return config;
}

inline EventConfig AutomataParser::parseEventConfig(ryml::ConstNodeRef node, 
                                                     ParseContext& ctx) {
    EventConfig config;

    if (auto triggersNode = findChild(node, "triggers"); triggersNode && (*triggersNode).is_seq()) {
        for (auto triggerNode : (*triggersNode).children()) {
            SignalTrigger trigger;
            
            if (auto signalNode = findChild(triggerNode, "signal")) {
                trigger.signalName = getString(*signalNode);
            }
            if (auto triggerTypeNode = findChild(triggerNode, "trigger")) {
                trigger.triggerType = parseEventTrigger(getString(*triggerTypeNode));
            }
            if (auto threshNodeOpt = findChild(triggerNode, "threshold")) {
                auto threshNode = *threshNodeOpt;
                ThresholdConfig thresh;
                if (auto opNode = findChild(threshNode, "operator")) {
                    thresh.op = parseCompareOp(getString(*opNode));
                }
                if (auto valueNode = findChild(threshNode, "value")) {
                    // Parse as double for now
                    thresh.value = Value(getDouble(*valueNode));
                }
                trigger.threshold = thresh;
            }

            config.triggers.push_back(std::move(trigger));
        }
    }

    if (auto requireAllNode = findChild(node, "require_all")) {
        config.requireAll = getBool(*requireAllNode);
    }
    if (auto debounceNode = findChild(node, "debounce_ms")) {
        config.debounceMs = getInt(*debounceNode);
    }
    if (auto conditionNode = findChild(node, "condition")) {
        config.additionalCondition = parseCode(*conditionNode);
    }

    return config;
}

inline ProbabilisticConfig AutomataParser::parseProbabilisticConfig(ryml::ConstNodeRef node,
                                                                     ParseContext& ctx) {
    ProbabilisticConfig config;

    if (auto weightNode = findChild(node, "weight")) {
        config.weight = static_cast<uint16_t>(getDouble(*weightNode) * 100);
    }
    if (auto expressionNode = findChild(node, "weight_expression")) {
        config.weightExpression = parseCode(*expressionNode);
        config.isDynamic = true;
    }
    if (auto minWeightNode = findChild(node, "min_weight")) {
        config.minWeight = static_cast<uint16_t>(getDouble(*minWeightNode) * 100);
    }

    return config;
}

inline std::optional<ryml::ConstNodeRef> AutomataParser::findChild(ryml::ConstNodeRef node, const char* key) {
    if (node.is_map() && node.has_child(key)) {
        return node[key];
    }
    if (node.is_seq()) {
        for (auto child : node.children()) {
            if (child.is_map() && child.has_child(key)) {
                auto candidate = child[key];
                // Legacy shape: list item map holds `<key>:` plus sibling entries.
                if (candidate.is_keyval() && candidate.num_children() == 0 && child.num_children() > 1) {
                    return child;
                }
                return candidate;
            }
            if (child.has_key()) {
                const std::string childKey(child.key().str, child.key().len);
                if (childKey == key) {
                    return child;
                }
            }
        }
    }
    if (!node.is_map() && !node.is_seq() && node.num_children() > 0) {
        for (auto child : node.children()) {
            if (child.is_map() && child.has_child(key)) {
                auto candidate = child[key];
                if (candidate.is_keyval() && candidate.num_children() == 0 && child.num_children() > 1) {
                    return child;
                }
                return candidate;
            }
            if (child.has_key()) {
                const std::string childKey(child.key().str, child.key().len);
                if (childKey == key) {
                    return child;
                }
            }
        }
    }
    return std::nullopt;
}

inline std::string AutomataParser::nodeKey(ryml::ConstNodeRef node) {
    if (node.has_key()) {
        return std::string(node.key().str, node.key().len);
    }
    return "";
}

inline VariableId AutomataParser::ensureVariable(const std::string& specText,
                                                 VariableDirection direction,
                                                 Automata& automata,
                                                 ParseContext& ctx) {
    auto spec = parseVariableShort(specText, ctx);
    spec.direction = direction;
    return ensureVariable(std::move(spec), automata, ctx);
}

inline VariableId AutomataParser::ensureVariable(VariableSpec spec, Automata& automata, ParseContext& ctx) {
    auto it = ctx.varIds.find(spec.name);
    if (it != ctx.varIds.end()) {
        auto* existing = const_cast<VariableSpec*>(automata.getVariableSpec(it->second));
        if (existing) {
            if (existing->direction != spec.direction) {
                ctx.warn("Variable '" + spec.name + "' direction conflict; keeping first definition");
            }
            if (existing->type != spec.type && spec.type != ValueType::String) {
                ctx.warn("Variable '" + spec.name + "' type conflict; keeping first definition");
            }
        }
        return it->second;
    }

    if (spec.id == INVALID_VARIABLE) {
        spec.id = ctx.nextVarId++;
    }
    const auto assigned = spec.id;
    ctx.varIds[spec.name] = assigned;
    automata.variables.push_back(std::move(spec));
    return assigned;
}

inline std::string AutomataParser::readTextFile(const std::filesystem::path& path, ParseContext& ctx) {
    std::ifstream file(path);
    if (!file.is_open()) {
        ctx.error("Missing required folder-layout file: " + path.string());
        return "";
    }
    std::ostringstream ss;
    ss << file.rdbuf();
    return ss.str();
}

inline void AutomataParser::resolveFolderLayoutCode(Automata& automata, ParseContext& ctx) {
    const std::filesystem::path basePath(ctx.basePath.empty() ? "." : ctx.basePath);
    const std::filesystem::path location = automata.config.location.empty() ? "." : automata.config.location;
    const std::filesystem::path folder = basePath / location;

    for (auto& [id, state] : automata.states) {
        const auto filePath = folder / (state.name + ".lua");
        const std::string script = readTextFile(filePath, ctx);
        if (script.empty()) {
            continue;
        }
        if (state.body.isEmpty()) {
            state.body.source = script + "\nif body ~= nil then return body() end";
        }
        if (state.onEnter.isEmpty()) {
            state.onEnter.source = script + "\nif on_enter ~= nil then return on_enter() end";
        }
        if (state.onExit.isEmpty()) {
            state.onExit.source = script + "\nif on_exit ~= nil then return on_exit() end";
        }
    }

    for (auto& [id, transition] : automata.transitions) {
        const auto filePath = folder / (transition.name + ".lua");
        const std::string script = readTextFile(filePath, ctx);
        if (script.empty()) {
            continue;
        }
        if (transition.classicConfig.condition.isEmpty() && transition.type == TransitionType::Classic) {
            transition.classicConfig.condition.source = script + "\nif condition ~= nil then return condition() end\nreturn true";
        }
        if (transition.timedConfig.additionalCondition.isEmpty() && transition.type == TransitionType::Timed) {
            transition.timedConfig.additionalCondition.source = script + "\nif condition ~= nil then return condition() end\nreturn true";
        }
        if (transition.eventConfig.additionalCondition.isEmpty() && transition.type == TransitionType::Event) {
            transition.eventConfig.additionalCondition.source = script + "\nif condition ~= nil then return condition() end\nreturn true";
        }
        if (transition.body.isEmpty()) {
            transition.body.source = script + "\nif body ~= nil then return body() end";
        }
        if (transition.triggered.isEmpty()) {
            transition.triggered.source = script + "\nif triggered ~= nil then return triggered() end";
        }
    }
}

// Utility implementations
inline std::string AutomataParser::getString(ryml::ConstNodeRef node) {
    if (node.is_keyval() || node.is_val()) {
        std::string value(node.val().str, node.val().len);
        auto trim = [](std::string& s) {
            auto notSpace = [](unsigned char ch) { return !std::isspace(ch); };
            s.erase(s.begin(), std::find_if(s.begin(), s.end(), notSpace));
            s.erase(std::find_if(s.rbegin(), s.rend(), notSpace).base(), s.end());
        };

        trim(value);
        if (value.size() >= 2) {
            const char first = value.front();
            const char last = value.back();
            if ((first == '"' && last == '"') || (first == '\'' && last == '\'')) {
                value = value.substr(1, value.size() - 2);
            }
        }
        return value;
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

inline int AutomataParser::parseDurationMs(ryml::ConstNodeRef node,
                                           int defaultVal,
                                           DurationDefaultUnit defaultUnit) {
    std::string raw = getString(node);
    if (raw.empty()) return defaultVal;

    auto trim = [](std::string& s) {
        auto notSpace = [](unsigned char ch) { return !std::isspace(ch); };
        s.erase(s.begin(), std::find_if(s.begin(), s.end(), notSpace));
        s.erase(std::find_if(s.rbegin(), s.rend(), notSpace).base(), s.end());
    };

    trim(raw);
    if (raw.empty()) return defaultVal;

    std::string lower = raw;
    std::transform(lower.begin(), lower.end(), lower.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });

    long long factor = (defaultUnit == DurationDefaultUnit::Seconds) ? 1000 : 1;
    std::string number = lower;

    if (lower.size() > 2 && lower.substr(lower.size() - 2) == "ms") {
        number = lower.substr(0, lower.size() - 2);
        factor = 1;
    } else if (!lower.empty() && lower.back() == 's') {
        number = lower.substr(0, lower.size() - 1);
        factor = 1000;
    } else if (!lower.empty() && lower.back() == 'm') {
        number = lower.substr(0, lower.size() - 1);
        factor = 60 * 1000;
    } else if (!lower.empty() && lower.back() == 'h') {
        number = lower.substr(0, lower.size() - 1);
        factor = 60 * 60 * 1000;
    }

    trim(number);
    if (number.empty()) return defaultVal;

    try {
        const double value = std::stod(number);
        if (value < 0.0) return defaultVal;
        const double scaled = value * static_cast<double>(factor);
        if (scaled > static_cast<double>(std::numeric_limits<int>::max())) {
            return std::numeric_limits<int>::max();
        }
        return static_cast<int>(scaled);
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
    std::string lower = modeStr;
    std::transform(lower.begin(), lower.end(), lower.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    if (lower == "after") return TimedMode::After;
    if (lower == "at") return TimedMode::At;
    if (lower == "every" || lower == "periodic") return TimedMode::Every;
    if (lower == "timeout") return TimedMode::Timeout;
    if (lower == "window") return TimedMode::Window;
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
