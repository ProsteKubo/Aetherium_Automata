/**
 * Aetherium Automata - Lua Script Engine
 * 
 * Full Lua integration using sol2 for script execution.
 */

#ifndef AETHERIUM_LUA_ENGINE_HPP
#define AETHERIUM_LUA_ENGINE_HPP

#include "runtime.hpp"

// Forward declare sol types to avoid header pollution
namespace sol {
    class state;
}

namespace aeth {

/**
 * Lua script engine using sol2 binding
 */
class LuaScriptEngine : public IScriptEngine {
public:
    LuaScriptEngine();
    ~LuaScriptEngine() override;

    Result<void> initialize(VariableStore* variables) override;
    Result<Value> execute(const CodeBlock& code) override;
    Result<bool> evaluateCondition(const CodeBlock& code) override;
    Result<double> evaluateWeight(const CodeBlock& code) override;
    std::string lastError() const override;
    void clearError() override;
    void setLogHandler(std::function<void(const std::string& level,
                                          const std::string& message)> handler) override;
    
    /**
     * Run Lua garbage collection to free memory.
     * Call periodically (e.g., every 100 ticks) to prevent memory buildup.
     */
    void collectGarbage() override;

private:
    void setupBuiltins();
    void setLuaGlobalValue(const std::string& name, const Value& value);
    void syncVariablesToLua();
    void syncVariablesFromLua();

    std::unique_ptr<sol::state> lua_;
    VariableStore* variables_ = nullptr;
    std::string lastError_;
    std::function<void(const std::string&, const std::string&)> logHandler_;
};

} // namespace aeth

#endif // AETHERIUM_LUA_ENGINE_HPP
