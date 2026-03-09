#ifndef AETHERIUM_EMBEDDED_ARDUINO_LUA_ENGINE_HPP
#define AETHERIUM_EMBEDDED_ARDUINO_LUA_ENGINE_HPP

#include "engine/core/runtime.hpp"

struct lua_State;

namespace aeth::embedded::arduino {

class EmbeddedLuaScriptEngine final : public IScriptEngine {
public:
    EmbeddedLuaScriptEngine() = default;
    ~EmbeddedLuaScriptEngine() override;

    Result<void> initialize(VariableStore* variables) override;
    Result<Value> execute(const CodeBlock& code) override;
    Result<bool> evaluateCondition(const CodeBlock& code) override;
    Result<double> evaluateWeight(const CodeBlock& code) override;
    std::string lastError() const override;
    void clearError() override;
    void collectGarbage() override;
    void setLogHandler(std::function<void(const std::string& level,
                                          const std::string& message)> handler) override;

    Variable* lookupVariable(const std::string& name) const;
    bool setVariableValue(const std::string& name, int luaIndex, std::string& error) const;
    void emitLogMessage(const std::string& level, const std::string& message) const;

private:
    void bindBuiltins();
    void bindHardwareTables();
    void syncVariablesToLua();
    void syncVariablesFromLua();

    lua_State* state_ = nullptr;
    VariableStore* variables_ = nullptr;
    std::string lastError_;
    std::function<void(const std::string&, const std::string&)> logHandler_;
};

} // namespace aeth::embedded::arduino

#endif // AETHERIUM_EMBEDDED_ARDUINO_LUA_ENGINE_HPP
