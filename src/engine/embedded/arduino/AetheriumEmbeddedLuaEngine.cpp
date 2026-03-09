#include "AetheriumEmbeddedLuaEngine.hpp"

#include "engine/core/hardware_service.hpp"
#include "engine/embedded/platform/EmbeddedPlatformHooks.hpp"

extern "C" {
#include <lauxlib.h>
#include <lua.h>
#include <lualib.h>
}

#ifdef ARDUINO
#include <Arduino.h>
#endif

#include <algorithm>
#include <cmath>
#include <string>
#include <utility>
#include <vector>

namespace aeth::embedded::arduino {

namespace {

EmbeddedLuaScriptEngine* engineFromUpvalue(lua_State* L, int index = 1) {
    return static_cast<EmbeddedLuaScriptEngine*>(lua_touserdata(L, lua_upvalueindex(index)));
}

Timestamp nowMs() {
    return platform::millis();
}

void yieldIfNeeded() {
    platform::yieldIfNeeded();
}

bool pushRuntimeValue(lua_State* L, const Value& value) {
    switch (value.type()) {
        case ValueType::Bool:
            lua_pushboolean(L, value.get<bool>() ? 1 : 0);
            return true;
        case ValueType::Int32:
            lua_pushinteger(L, static_cast<lua_Integer>(value.get<int32_t>()));
            return true;
        case ValueType::Int64:
            lua_pushnumber(L, static_cast<lua_Number>(value.get<int64_t>()));
            return true;
        case ValueType::Float32:
            lua_pushnumber(L, static_cast<lua_Number>(value.get<float>()));
            return true;
        case ValueType::Float64:
            lua_pushnumber(L, static_cast<lua_Number>(value.get<double>()));
            return true;
        case ValueType::String:
            lua_pushlstring(L, value.get<std::string>().c_str(), value.get<std::string>().size());
            return true;
        default:
            lua_pushnil(L);
            return false;
    }
}

Value toRuntimeValue(lua_State* L, int index) {
    const int type = lua_type(L, index);
    switch (type) {
        case LUA_TBOOLEAN:
            return Value(lua_toboolean(L, index) != 0);
        case LUA_TNUMBER: {
            const lua_Number number = lua_tonumber(L, index);
            const lua_Number integral = std::floor(number);
            if (std::fabs(number - integral) < 0.000001) {
                return Value(static_cast<int32_t>(integral));
            }
            return Value(static_cast<double>(number));
        }
        case LUA_TSTRING:
            return Value(std::string(lua_tostring(L, index)));
        default:
            return Value();
    }
}

bool coerceValue(const Variable* var, lua_State* L, int index, Value& value, std::string& error) {
    if (!var) {
        error = "variable not found";
        return false;
    }

    switch (var->type()) {
        case ValueType::Bool:
            value = Value(lua_toboolean(L, index) != 0);
            break;
        case ValueType::Int32:
            if (!lua_isnumber(L, index) && !lua_isboolean(L, index)) {
                error = "expected numeric value";
                return false;
            }
            value = Value(static_cast<int32_t>(lua_tointeger(L, index)));
            break;
        case ValueType::Int64:
            if (!lua_isnumber(L, index) && !lua_isboolean(L, index)) {
                error = "expected numeric value";
                return false;
            }
            value = Value(static_cast<int64_t>(lua_tonumber(L, index)));
            break;
        case ValueType::Float32:
            if (!lua_isnumber(L, index) && !lua_isboolean(L, index)) {
                error = "expected numeric value";
                return false;
            }
            value = Value(static_cast<float>(lua_tonumber(L, index)));
            break;
        case ValueType::Float64:
            if (!lua_isnumber(L, index) && !lua_isboolean(L, index)) {
                error = "expected numeric value";
                return false;
            }
            value = Value(static_cast<double>(lua_tonumber(L, index)));
            break;
        case ValueType::String:
            if (!lua_isstring(L, index)) {
                error = "expected string value";
                return false;
            }
            value = Value(std::string(lua_tostring(L, index)));
            break;
        default:
            value = Value();
            break;
    }
    return true;
}

int pushError(lua_State* L, const std::string& message) {
    lua_pushlstring(L, message.c_str(), message.size());
    return lua_error(L);
}

IHardwareService& requireHardware() {
    auto* service = hardwareService();
    if (!service) {
        static NullHardwareService fallback;
        service = &fallback;
    }
    return *service;
}

int luaLog(lua_State* L) {
    auto* engine = engineFromUpvalue(L);
    const char* level = luaL_checkstring(L, 1);
    const char* message = luaL_checkstring(L, 2);
    if (engine) {
        engine->emitLogMessage(level ? level : "info", message ? message : "");
    }
    return 0;
}

int luaChanged(lua_State* L) {
    auto* engine = engineFromUpvalue(L);
    const char* name = luaL_checkstring(L, 1);
    auto* var = engine ? engine->lookupVariable(name ? name : "") : nullptr;
    lua_pushboolean(L, var && var->hasChanged());
    return 1;
}

int luaValue(lua_State* L) {
    auto* engine = engineFromUpvalue(L);
    const char* name = luaL_checkstring(L, 1);
    auto* var = engine ? engine->lookupVariable(name ? name : "") : nullptr;
    if (!var) {
        lua_pushnil(L);
        return 1;
    }
    pushRuntimeValue(L, var->value());
    return 1;
}

int luaSetVal(lua_State* L) {
    auto* engine = engineFromUpvalue(L);
    const char* name = luaL_checkstring(L, 1);
    auto* var = engine ? engine->lookupVariable(name ? name : "") : nullptr;
    if (!var) {
        return pushError(L, "unknown variable");
    }
    if (var->direction() == VariableDirection::Input) {
        return pushError(L, "setVal cannot write input variable");
    }
    std::string error;
    if (!engine || !engine->setVariableValue(name ? name : "", 2, error)) {
        return pushError(L, error);
    }
    lua_pushvalue(L, 2);
    lua_setglobal(L, name);
    return 0;
}

int luaGetInput(lua_State* L) {
    auto* engine = engineFromUpvalue(L);
    const char* name = luaL_checkstring(L, 1);
    auto* var = engine ? engine->lookupVariable(name ? name : "") : nullptr;
    if (!var || var->direction() != VariableDirection::Input) {
        return pushError(L, "getInput expects input variable");
    }
    pushRuntimeValue(L, var->value());
    return 1;
}

int luaSetOutput(lua_State* L) {
    auto* engine = engineFromUpvalue(L);
    const char* name = luaL_checkstring(L, 1);
    auto* var = engine ? engine->lookupVariable(name ? name : "") : nullptr;
    if (!var || var->direction() != VariableDirection::Output) {
        return pushError(L, "setOutput expects output variable");
    }
    std::string error;
    if (!engine || !engine->setVariableValue(name ? name : "", 2, error)) {
        return pushError(L, error);
    }
    lua_pushvalue(L, 2);
    lua_setglobal(L, name);
    return 0;
}

int luaNow(lua_State* L) {
    lua_pushnumber(L, static_cast<lua_Number>(nowMs()));
    return 1;
}

int luaRand(lua_State* L) {
#ifdef ARDUINO
    lua_pushnumber(L, static_cast<lua_Number>(::random(0, 1000000)) / 1000000.0);
#else
    lua_pushnumber(L, 0.5);
#endif
    return 1;
}

int luaClamp(lua_State* L) {
    double value = luaL_checknumber(L, 1);
    double lo = luaL_checknumber(L, 2);
    double hi = luaL_checknumber(L, 3);
    if (lo > hi) {
        std::swap(lo, hi);
    }
    if (value < lo) value = lo;
    if (value > hi) value = hi;
    lua_pushnumber(L, value);
    return 1;
}

int luaPrint(lua_State* L) {
    auto* engine = engineFromUpvalue(L);
    std::string message;
    const int argc = lua_gettop(L);
    for (int i = 1; i <= argc; ++i) {
        if (!message.empty()) {
            message += '\t';
        }
        lua_getglobal(L, "tostring");
        lua_pushvalue(L, i);
        lua_call(L, 1, 1);
        if (const char* part = lua_tostring(L, -1)) {
            message += part;
        }
        lua_pop(L, 1);
    }
    if (engine) {
        engine->emitLogMessage("info", message);
    }
    return 0;
}

int luaGpioMode(lua_State* L) {
    auto result = requireHardware().gpioMode(static_cast<int>(luaL_checkinteger(L, 1)), luaL_checkstring(L, 2));
    if (result.isError()) return pushError(L, result.error());
    return 0;
}

int luaGpioWrite(lua_State* L) {
    const bool high = lua_toboolean(L, 2) != 0 || lua_tointeger(L, 2) != 0;
    auto result = requireHardware().gpioWrite(static_cast<int>(luaL_checkinteger(L, 1)), high);
    if (result.isError()) return pushError(L, result.error());
    return 0;
}

int luaGpioRead(lua_State* L) {
    auto result = requireHardware().gpioRead(static_cast<int>(luaL_checkinteger(L, 1)));
    if (result.isError()) return pushError(L, result.error());
    lua_pushnumber(L, static_cast<lua_Number>(result.value()));
    return 1;
}

int luaPwmAttach(lua_State* L) {
    auto result = requireHardware().pwmAttach(static_cast<int>(luaL_checkinteger(L, 1)),
                                              static_cast<int>(luaL_checkinteger(L, 2)),
                                              static_cast<int>(luaL_checkinteger(L, 3)),
                                              static_cast<int>(luaL_checkinteger(L, 4)));
    if (result.isError()) return pushError(L, result.error());
    return 0;
}

int luaPwmWrite(lua_State* L) {
    auto result = requireHardware().pwmWrite(static_cast<int>(luaL_checkinteger(L, 1)),
                                             static_cast<int>(luaL_checkinteger(L, 2)));
    if (result.isError()) return pushError(L, result.error());
    return 0;
}

int luaAdcRead(lua_State* L) {
    auto result = requireHardware().adcRead(static_cast<int>(luaL_checkinteger(L, 1)));
    if (result.isError()) return pushError(L, result.error());
    lua_pushnumber(L, static_cast<lua_Number>(result.value()));
    return 1;
}

int luaAdcReadMv(lua_State* L) {
    auto result = requireHardware().adcReadMilliVolts(static_cast<int>(luaL_checkinteger(L, 1)));
    if (result.isError()) return pushError(L, result.error());
    lua_pushnumber(L, static_cast<lua_Number>(result.value()));
    return 1;
}

int luaDacWrite(lua_State* L) {
    auto result = requireHardware().dacWrite(static_cast<int>(luaL_checkinteger(L, 1)),
                                             static_cast<int>(luaL_checkinteger(L, 2)));
    if (result.isError()) return pushError(L, result.error());
    return 0;
}

int luaI2cOpen(lua_State* L) {
    const int bus = static_cast<int>(luaL_checkinteger(L, 1));
    const int sda = static_cast<int>(luaL_checkinteger(L, 2));
    const int scl = static_cast<int>(luaL_checkinteger(L, 3));
    const int frequency = lua_gettop(L) >= 4 ? static_cast<int>(luaL_checkinteger(L, 4)) : 400000;
    auto result = requireHardware().i2cOpen(bus, sda, scl, frequency);
    if (result.isError()) return pushError(L, result.error());
    return 0;
}

int luaI2cScan(lua_State* L) {
    const int bus = lua_gettop(L) >= 1 ? static_cast<int>(luaL_checkinteger(L, 1)) : 0;
    auto result = requireHardware().i2cScan(bus);
    if (result.isError()) return pushError(L, result.error());
    lua_newtable(L);
    int index = 1;
    for (const auto address : result.value()) {
        lua_pushinteger(L, index++);
        lua_pushinteger(L, address);
        lua_settable(L, -3);
    }
    return 1;
}

int luaComponentInvoke(lua_State* L) {
    auto* component = static_cast<IComponent*>(lua_touserdata(L, lua_upvalueindex(1)));
    const char* method = luaL_checkstring(L, 2);
    if (!component) {
        return pushError(L, "component unavailable");
    }

    const int argc = lua_gettop(L);
    std::vector<Value> args;
    args.reserve(argc > 2 ? static_cast<size_t>(argc - 2) : 0);
    for (int i = 3; i <= argc; ++i) {
        args.push_back(toRuntimeValue(L, i));
    }

    auto result = component->invoke(method, args);
    if (result.isError()) return pushError(L, result.error());
    pushRuntimeValue(L, result.value());
    return 1;
}

int luaComponentMethod(lua_State* L) {
    auto* component = static_cast<IComponent*>(lua_touserdata(L, lua_upvalueindex(1)));
    const char* method = lua_tostring(L, lua_upvalueindex(2));
    if (!component || !method) {
        return pushError(L, "component method unavailable");
    }

    const int argc = lua_gettop(L);
    std::vector<Value> args;
    args.reserve(argc > 1 ? static_cast<size_t>(argc - 1) : 0);
    for (int i = 2; i <= argc; ++i) {
        args.push_back(toRuntimeValue(L, i));
    }

    auto result = component->invoke(method, args);
    if (result.isError()) return pushError(L, result.error());
    pushRuntimeValue(L, result.value());
    return 1;
}

int luaComponent(lua_State* L) {
    const char* name = luaL_checkstring(L, 1);
    auto* component = requireHardware().component(name ? name : "");
    if (!component) {
        return pushError(L, "unknown component");
    }

    lua_newtable(L);

    lua_pushlightuserdata(L, component);
    lua_pushcclosure(L, luaComponentInvoke, 1);
    lua_setfield(L, -2, "invoke");

    for (const auto& method : component->methods()) {
        lua_pushlightuserdata(L, component);
        lua_pushlstring(L, method.c_str(), method.size());
        lua_pushcclosure(L, luaComponentMethod, 2);
        lua_setfield(L, -2, method.c_str());
    }
    return 1;
}

} // namespace

EmbeddedLuaScriptEngine::~EmbeddedLuaScriptEngine() {
    if (state_) {
        lua_close(state_);
        state_ = nullptr;
    }
}

Result<void> EmbeddedLuaScriptEngine::initialize(VariableStore* variables) {
    variables_ = variables;
    if (state_) {
        lua_close(state_);
        state_ = nullptr;
    }

    state_ = luaL_newstate();
    if (!state_) {
        lastError_ = "luaL_newstate failed";
        return Result<void>::error(lastError_);
    }

    // Embedded targets only need the small, deterministic core libraries.
    luaL_requiref(state_, "_G", luaopen_base, 1);
    lua_pop(state_, 1);
    luaL_requiref(state_, LUA_TABLIBNAME, luaopen_table, 1);
    lua_pop(state_, 1);
    luaL_requiref(state_, LUA_STRLIBNAME, luaopen_string, 1);
    lua_pop(state_, 1);
    luaL_requiref(state_, LUA_MATHLIBNAME, luaopen_math, 1);
    lua_pop(state_, 1);
    yieldIfNeeded();
    bindBuiltins();
    bindHardwareTables();
    syncVariablesToLua();
    clearError();
    return Result<void>::ok();
}

Variable* EmbeddedLuaScriptEngine::lookupVariable(const std::string& name) const {
    return variables_ ? variables_->getByName(name) : nullptr;
}

bool EmbeddedLuaScriptEngine::setVariableValue(const std::string& name, int luaIndex, std::string& error) const {
    if (!state_ || !variables_) {
        error = "variable store unavailable";
        return false;
    }

    const auto* var = variables_->getByName(name);
    Value value;
    if (!coerceValue(var, state_, luaIndex, value, error)) {
        return false;
    }
    if (!variables_->setValue(name, std::move(value))) {
        error = "variable rejected write";
        return false;
    }
    return true;
}

void EmbeddedLuaScriptEngine::emitLogMessage(const std::string& level, const std::string& message) const {
    if (logHandler_) {
        logHandler_(level, message);
    }
}

Result<Value> EmbeddedLuaScriptEngine::execute(const CodeBlock& code) {
    if (code.isEmpty()) {
        return Result<Value>::ok(Value());
    }
    if (!state_) {
        lastError_ = "Lua engine not initialized";
        return Result<Value>::error(lastError_);
    }

    syncVariablesToLua();
    if (luaL_loadstring(state_, code.source.c_str()) != 0) {
        lastError_ = lua_tostring(state_, -1);
        lua_pop(state_, 1);
        return Result<Value>::error(lastError_);
    }
    if (lua_pcall(state_, 0, LUA_MULTRET, 0) != 0) {
        lastError_ = lua_tostring(state_, -1);
        lua_pop(state_, 1);
        return Result<Value>::error(lastError_);
    }

    Value result;
    if (lua_gettop(state_) > 0) {
        result = toRuntimeValue(state_, -1);
        lua_pop(state_, lua_gettop(state_));
    }
    syncVariablesFromLua();
    return Result<Value>::ok(result);
}

Result<bool> EmbeddedLuaScriptEngine::evaluateCondition(const CodeBlock& code) {
    if (code.isEmpty()) {
        return Result<bool>::ok(true);
    }
    if (!state_) {
        lastError_ = "Lua engine not initialized";
        return Result<bool>::error(lastError_);
    }

    syncVariablesToLua();
    std::string expr = "return (" + code.source + ")";
    if (luaL_loadstring(state_, expr.c_str()) != 0) {
        lua_pop(state_, 1);
        if (luaL_loadstring(state_, code.source.c_str()) != 0) {
            lastError_ = lua_tostring(state_, -1);
            lua_pop(state_, 1);
            return Result<bool>::error(lastError_);
        }
    }
    if (lua_pcall(state_, 0, LUA_MULTRET, 0) != 0) {
        lastError_ = lua_tostring(state_, -1);
        lua_pop(state_, 1);
        return Result<bool>::error(lastError_);
    }

    bool result = true;
    if (lua_gettop(state_) > 0) {
        if (lua_isboolean(state_, -1)) {
            result = lua_toboolean(state_, -1) != 0;
        } else if (lua_isnumber(state_, -1)) {
            result = lua_tonumber(state_, -1) != 0.0;
        } else if (lua_isstring(state_, -1)) {
            result = std::string(lua_tostring(state_, -1)).empty() == false;
        } else if (lua_isnil(state_, -1)) {
            result = false;
        }
    }
    lua_pop(state_, lua_gettop(state_));
    syncVariablesFromLua();
    return Result<bool>::ok(result);
}

Result<double> EmbeddedLuaScriptEngine::evaluateWeight(const CodeBlock& code) {
    if (code.isEmpty()) {
        return Result<double>::ok(100.0);
    }
    if (!state_) {
        lastError_ = "Lua engine not initialized";
        return Result<double>::error(lastError_);
    }

    syncVariablesToLua();
    std::string expr = "return (" + code.source + ")";
    if (luaL_loadstring(state_, expr.c_str()) != 0) {
        lastError_ = lua_tostring(state_, -1);
        lua_pop(state_, 1);
        return Result<double>::error(lastError_);
    }
    if (lua_pcall(state_, 0, 1, 0) != 0) {
        lastError_ = lua_tostring(state_, -1);
        lua_pop(state_, 1);
        return Result<double>::error(lastError_);
    }

    const double result = lua_isnumber(state_, -1) ? static_cast<double>(lua_tonumber(state_, -1)) : 100.0;
    lua_pop(state_, 1);
    return Result<double>::ok(result);
}

std::string EmbeddedLuaScriptEngine::lastError() const {
    return lastError_;
}

void EmbeddedLuaScriptEngine::clearError() {
    lastError_.clear();
}

void EmbeddedLuaScriptEngine::collectGarbage() {
    if (state_) {
        lua_gc(state_, LUA_GCCOLLECT, 0);
    }
}

void EmbeddedLuaScriptEngine::setLogHandler(std::function<void(const std::string& level,
                                                               const std::string& message)> handler) {
    logHandler_ = std::move(handler);
}

void EmbeddedLuaScriptEngine::bindBuiltins() {
    lua_pushlightuserdata(state_, this);
    lua_pushcclosure(state_, luaLog, 1);
    lua_setglobal(state_, "log");

    lua_pushlightuserdata(state_, this);
    lua_pushcclosure(state_, luaChanged, 1);
    lua_setglobal(state_, "check");

    lua_pushlightuserdata(state_, this);
    lua_pushcclosure(state_, luaChanged, 1);
    lua_setglobal(state_, "changed");

    lua_pushlightuserdata(state_, this);
    lua_pushcclosure(state_, luaValue, 1);
    lua_setglobal(state_, "value");

    lua_pushlightuserdata(state_, this);
    lua_pushcclosure(state_, luaSetVal, 1);
    lua_setglobal(state_, "setVal");

    lua_pushlightuserdata(state_, this);
    lua_pushcclosure(state_, luaSetVal, 1);
    lua_setglobal(state_, "emit");

    lua_pushlightuserdata(state_, this);
    lua_pushcclosure(state_, luaGetInput, 1);
    lua_setglobal(state_, "getInput");

    lua_pushlightuserdata(state_, this);
    lua_pushcclosure(state_, luaSetOutput, 1);
    lua_setglobal(state_, "setOutput");

    lua_pushcfunction(state_, luaNow);
    lua_setglobal(state_, "now");

    lua_pushcfunction(state_, luaRand);
    lua_setglobal(state_, "rand");

    lua_pushcfunction(state_, luaClamp);
    lua_setglobal(state_, "clamp");

    lua_pushlightuserdata(state_, this);
    lua_pushcclosure(state_, luaPrint, 1);
    lua_setglobal(state_, "print");

    lua_pushcfunction(state_, luaComponent);
    lua_setglobal(state_, "component");
}

void EmbeddedLuaScriptEngine::bindHardwareTables() {
    lua_newtable(state_);
    lua_pushcfunction(state_, luaGpioMode);
    lua_setfield(state_, -2, "mode");
    lua_pushcfunction(state_, luaGpioWrite);
    lua_setfield(state_, -2, "write");
    lua_pushcfunction(state_, luaGpioRead);
    lua_setfield(state_, -2, "read");
    lua_setglobal(state_, "gpio");

    lua_newtable(state_);
    lua_pushcfunction(state_, luaPwmAttach);
    lua_setfield(state_, -2, "attach");
    lua_pushcfunction(state_, luaPwmWrite);
    lua_setfield(state_, -2, "write");
    lua_setglobal(state_, "pwm");

    lua_newtable(state_);
    lua_pushcfunction(state_, luaAdcRead);
    lua_setfield(state_, -2, "read");
    lua_pushcfunction(state_, luaAdcReadMv);
    lua_setfield(state_, -2, "read_mv");
    lua_setglobal(state_, "adc");

    lua_newtable(state_);
    lua_pushcfunction(state_, luaDacWrite);
    lua_setfield(state_, -2, "write");
    lua_setglobal(state_, "dac");

    lua_newtable(state_);
    lua_pushcfunction(state_, luaI2cOpen);
    lua_setfield(state_, -2, "open");
    lua_pushcfunction(state_, luaI2cScan);
    lua_setfield(state_, -2, "scan");
    lua_setglobal(state_, "i2c");
}

void EmbeddedLuaScriptEngine::syncVariablesToLua() {
    if (!state_ || !variables_) {
        return;
    }

    for (auto* var : variables_->all()) {
        pushRuntimeValue(state_, var->value());
        lua_setglobal(state_, var->name().c_str());
    }
}

void EmbeddedLuaScriptEngine::syncVariablesFromLua() {
    if (!state_ || !variables_) {
        return;
    }

    for (auto* var : variables_->all()) {
        if (var->direction() == VariableDirection::Input) {
            continue;
        }
        lua_getglobal(state_, var->name().c_str());
        if (!lua_isnil(state_, -1)) {
            std::string error;
            setVariableValue(var->name(), -1, error);
        }
        lua_pop(state_, 1);
    }
}

} // namespace aeth::embedded::arduino
