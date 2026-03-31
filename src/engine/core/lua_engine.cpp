/**
 * Aetherium Automata - Lua Script Engine Implementation
 */

#include "lua_engine.hpp"
#include "hardware_service.hpp"

#define SOL_ALL_SAFETIES_ON 1
#define SOL_USE_LUA_HPP 0
extern "C" {
#include <lua.h>
#include <lauxlib.h>
#include <lualib.h>
}
#include <sol/sol.hpp>
#include <algorithm>
#include <chrono>
#include <random>
#include <stdexcept>
#if defined(ARDUINO)
#include <Arduino.h>
#endif

namespace aeth {

namespace {

Timestamp nowMs() {
    const auto now = std::chrono::steady_clock::now().time_since_epoch();
    return static_cast<Timestamp>(std::chrono::duration_cast<std::chrono::milliseconds>(now).count());
}

void pumpEmbeddedWatchdog() {
#if defined(ARDUINO)
    yield();
#endif
}

Value toRuntimeValue(const sol::object& obj) {
    if (obj.is<bool>()) return Value(obj.as<bool>());
    if (obj.is<int>()) return Value(static_cast<int32_t>(obj.as<int>()));
    if (obj.is<double>()) return Value(obj.as<double>());
    if (obj.is<std::string>()) return Value(obj.as<std::string>());
    throw std::runtime_error("unsupported Lua argument type");
}

Value coerceToType(const sol::object& obj, ValueType type) {
    switch (type) {
        case ValueType::Bool:
            if (obj.is<bool>()) return Value(obj.as<bool>());
            if (obj.is<int>()) return Value(obj.as<int>() != 0);
            if (obj.is<double>()) return Value(obj.as<double>() != 0.0);
            if (obj.is<std::string>()) {
                const auto s = obj.as<std::string>();
                return Value(s == "true" || s == "1" || s == "yes");
            }
            break;
        case ValueType::Int32:
            if (obj.is<int>()) return Value(static_cast<int32_t>(obj.as<int>()));
            if (obj.is<double>()) return Value(static_cast<int32_t>(obj.as<double>()));
            if (obj.is<bool>()) return Value(static_cast<int32_t>(obj.as<bool>() ? 1 : 0));
            if (obj.is<std::string>()) return Value(static_cast<int32_t>(std::stoi(obj.as<std::string>())));
            break;
        case ValueType::Int64:
            if (obj.is<int>()) return Value(static_cast<int64_t>(obj.as<int>()));
            if (obj.is<double>()) return Value(static_cast<int64_t>(obj.as<double>()));
            if (obj.is<bool>()) return Value(static_cast<int64_t>(obj.as<bool>() ? 1 : 0));
            if (obj.is<std::string>()) return Value(static_cast<int64_t>(std::stoll(obj.as<std::string>())));
            break;
        case ValueType::Float32:
            if (obj.is<int>()) return Value(static_cast<float>(obj.as<int>()));
            if (obj.is<double>()) return Value(static_cast<float>(obj.as<double>()));
            if (obj.is<bool>()) return Value(obj.as<bool>() ? 1.0f : 0.0f);
            if (obj.is<std::string>()) return Value(std::stof(obj.as<std::string>()));
            break;
        case ValueType::Float64:
            if (obj.is<int>()) return Value(static_cast<double>(obj.as<int>()));
            if (obj.is<double>()) return Value(obj.as<double>());
            if (obj.is<bool>()) return Value(obj.as<bool>() ? 1.0 : 0.0);
            if (obj.is<std::string>()) return Value(std::stod(obj.as<std::string>()));
            break;
        case ValueType::String:
            if (obj.is<std::string>()) return Value(obj.as<std::string>());
            if (obj.is<int>()) return Value(std::to_string(obj.as<int>()));
            if (obj.is<double>()) return Value(std::to_string(obj.as<double>()));
            if (obj.is<bool>()) return Value(obj.as<bool>() ? "true" : "false");
            break;
        default:
            break;
    }
    throw std::runtime_error("Lua value cannot be coerced to required variable type");
}

} // namespace

LuaScriptEngine::LuaScriptEngine() = default;

LuaScriptEngine::~LuaScriptEngine() = default;

Result<void> LuaScriptEngine::initialize(VariableStore* variables) {
    variables_ = variables;

    try {
        // Delay Lua VM creation until engine initialization so embedded targets
        // do not allocate the VM during global static construction.
        lua_ = std::make_unique<sol::state>();
        pumpEmbeddedWatchdog();

        lua_->open_libraries(
            sol::lib::base,
            sol::lib::math,
            sol::lib::string,
            sol::lib::table
        );
        pumpEmbeddedWatchdog();

        setupBuiltins();
        pumpEmbeddedWatchdog();
        syncVariablesToLua();
        clearError();

        return Result<void>::ok();
    } catch (const std::exception& e) {
        lastError_ = e.what();
        lua_.reset();
        return Result<void>::error(lastError_);
    }
}

void LuaScriptEngine::setupBuiltins() {
    // log(level, message)
    lua_->set_function("log", [this](const std::string& level, const std::string& msg) {
        if (logHandler_) {
            logHandler_(level, msg);
            return;
        }
        std::printf("[%s] %s\n", level.c_str(), msg.c_str());
    });

    auto toLuaValue = [this](const Value& val) -> sol::object {
        switch (val.type()) {
            case ValueType::Bool: return sol::make_object(*lua_, val.get<bool>());
            case ValueType::Int32: return sol::make_object(*lua_, val.get<int32_t>());
            case ValueType::Int64: return sol::make_object(*lua_, val.get<int64_t>());
            case ValueType::Float32: return sol::make_object(*lua_, val.get<float>());
            case ValueType::Float64: return sol::make_object(*lua_, val.get<double>());
            case ValueType::String: return sol::make_object(*lua_, val.get<std::string>());
            default: return sol::make_object(*lua_, sol::lua_nil);
        }
    };

    auto requireVar = [this](const std::string& name) -> Variable* {
        if (!variables_) {
            throw std::runtime_error("Variable store unavailable");
        }
        auto* var = variables_->getByName(name);
        if (!var) {
            throw std::runtime_error("Unknown variable: " + name);
        }
        return var;
    };

    lua_->set_function("check", [requireVar](const std::string& name) -> bool {
        return requireVar(name)->hasChanged();
    });
    lua_->set_function("changed", [requireVar](const std::string& name) -> bool {
        return requireVar(name)->hasChanged();
    });

    lua_->set_function("value", [requireVar, toLuaValue](const std::string& name) -> sol::object {
        return toLuaValue(requireVar(name)->value());
    });

    lua_->set_function("setVal", [requireVar](const std::string& name, sol::object obj) {
        auto* var = requireVar(name);
        if (var->direction() == VariableDirection::Input) {
            throw std::runtime_error("setVal cannot write input variable: " + name);
        }
        auto value = coerceToType(obj, var->type());
        if (!var->set(std::move(value))) {
            throw std::runtime_error("setVal rejected write: " + name);
        }
    });
    lua_->set_function("emit", [this](const std::string& name, sol::object obj) {
        (*lua_)["setVal"](name, obj);
    });

    lua_->set_function("now", []() -> uint64_t {
        return nowMs();
    });

    lua_->set_function("rand", []() -> double {
        static thread_local std::mt19937_64 generator{std::random_device{}()};
        static thread_local std::uniform_real_distribution<double> distribution(0.0, 1.0);
        return distribution(generator);
    });

    lua_->set_function("clamp", [](double x, double lo, double hi) -> double {
        if (lo > hi) std::swap(lo, hi);
        if (x < lo) return lo;
        if (x > hi) return hi;
        return x;
    });

    lua_->set_function("getInput", [this, toLuaValue](const std::string& name) -> sol::object {
        auto* var = variables_ ? variables_->getByName(name) : nullptr;
        if (!var || var->direction() != VariableDirection::Input) {
            throw std::runtime_error("getInput expects known input variable: " + name);
        }
        return toLuaValue(var->value());
    });

    lua_->set_function("setOutput", [requireVar](const std::string& name, sol::object obj) {
        auto* var = requireVar(name);
        if (var->direction() != VariableDirection::Output) {
            throw std::runtime_error("setOutput expects output variable: " + name);
        }
        auto value = coerceToType(obj, var->type());
        if (!var->set(std::move(value))) {
            throw std::runtime_error("setOutput rejected write: " + name);
        }
    });
    
    // print override for debugging
    lua_->set_function("print", [](sol::variadic_args va) {
        std::string output;
        for (auto v : va) {
            if (!output.empty()) output += "\t";
            sol::object obj = v;
            if (obj.is<std::string>()) {
                output += obj.as<std::string>();
            } else if (obj.is<double>()) {
                output += std::to_string(obj.as<double>());
            } else if (obj.is<bool>()) {
                output += obj.as<bool>() ? "true" : "false";
            } else {
                output += "[object]";
            }
        }
        std::printf("%s\n", output.c_str());
    });

    auto requireHardware = []() -> IHardwareService& {
        auto* service = hardwareService();
        if (!service) {
            static NullHardwareService fallback;
            service = &fallback;
        }
        return *service;
    };

    auto makeComponentTable = [this](sol::this_state ts, IComponent& component) -> sol::table {
        sol::state_view lua(ts);
        sol::table table = lua.create_table();

        table.set_function("invoke", [&component](sol::this_state innerTs, const std::string& method, sol::variadic_args va) -> sol::object {
            sol::state_view lua(innerTs);
            std::vector<Value> args;
            args.reserve(va.size());
            for (auto arg : va) {
                args.push_back(toRuntimeValue(sol::object(arg)));
            }
            auto result = component.invoke(method, args);
            if (result.isError()) {
                throw std::runtime_error(result.error());
            }

            const auto& value = result.value();
            switch (value.type()) {
                case ValueType::Bool: return sol::make_object(lua, value.get<bool>());
                case ValueType::Int32: return sol::make_object(lua, value.get<int32_t>());
                case ValueType::Int64: return sol::make_object(lua, value.get<int64_t>());
                case ValueType::Float32: return sol::make_object(lua, value.get<float>());
                case ValueType::Float64: return sol::make_object(lua, value.get<double>());
                case ValueType::String: return sol::make_object(lua, value.get<std::string>());
                default: return sol::make_object(lua, sol::lua_nil);
            }
        });

        for (const auto& method : component.methods()) {
            table.set_function(method, [&component, method](sol::this_state innerTs, sol::variadic_args va) -> sol::object {
                sol::state_view lua(innerTs);
                std::vector<Value> args;
                args.reserve(va.size());
                for (auto arg : va) {
                    args.push_back(toRuntimeValue(sol::object(arg)));
                }
                auto result = component.invoke(method, args);
                if (result.isError()) {
                    throw std::runtime_error(result.error());
                }
                const auto& value = result.value();
                switch (value.type()) {
                    case ValueType::Bool: return sol::make_object(lua, value.get<bool>());
                    case ValueType::Int32: return sol::make_object(lua, value.get<int32_t>());
                    case ValueType::Int64: return sol::make_object(lua, value.get<int64_t>());
                    case ValueType::Float32: return sol::make_object(lua, value.get<float>());
                    case ValueType::Float64: return sol::make_object(lua, value.get<double>());
                    case ValueType::String: return sol::make_object(lua, value.get<std::string>());
                    default: return sol::make_object(lua, sol::lua_nil);
                }
            });
        }

        return table;
    };

    sol::table gpio = lua_->create_table();
    gpio.set_function("mode", [requireHardware](int pin, const std::string& mode) {
        auto result = requireHardware().gpioMode(pin, mode);
        if (result.isError()) throw std::runtime_error(result.error());
    });
    gpio.set_function("write", [requireHardware](int pin, sol::object value) {
        bool high = false;
        if (value.is<bool>()) high = value.as<bool>();
        else if (value.is<int>()) high = value.as<int>() != 0;
        else throw std::runtime_error("gpio.write expects bool or int");
        auto result = requireHardware().gpioWrite(pin, high);
        if (result.isError()) throw std::runtime_error(result.error());
    });
    gpio.set_function("read", [requireHardware](int pin) -> int64_t {
        auto result = requireHardware().gpioRead(pin);
        if (result.isError()) throw std::runtime_error(result.error());
        return result.value();
    });
    (*lua_)["gpio"] = gpio;

    sol::table pwm = lua_->create_table();
    pwm.set_function("attach", [requireHardware](int channel, int pin, int frequencyHz, int resolutionBits) {
        auto result = requireHardware().pwmAttach(channel, pin, frequencyHz, resolutionBits);
        if (result.isError()) throw std::runtime_error(result.error());
    });
    pwm.set_function("write", [requireHardware](int channel, int duty) {
        auto result = requireHardware().pwmWrite(channel, duty);
        if (result.isError()) throw std::runtime_error(result.error());
    });
    (*lua_)["pwm"] = pwm;

    sol::table adc = lua_->create_table();
    adc.set_function("read", [requireHardware](int pin) -> int64_t {
        auto result = requireHardware().adcRead(pin);
        if (result.isError()) throw std::runtime_error(result.error());
        return result.value();
    });
    adc.set_function("read_mv", [requireHardware](int pin) -> int64_t {
        auto result = requireHardware().adcReadMilliVolts(pin);
        if (result.isError()) throw std::runtime_error(result.error());
        return result.value();
    });
    (*lua_)["adc"] = adc;

    sol::table dac = lua_->create_table();
    dac.set_function("write", [requireHardware](int pin, int value) {
        auto result = requireHardware().dacWrite(pin, value);
        if (result.isError()) throw std::runtime_error(result.error());
    });
    (*lua_)["dac"] = dac;

    sol::table i2c = lua_->create_table();
    i2c.set_function("open", [requireHardware](int bus, int sdaPin, int sclPin, sol::optional<int> frequencyHz) {
        auto result = requireHardware().i2cOpen(bus, sdaPin, sclPin, frequencyHz.value_or(400000));
        if (result.isError()) throw std::runtime_error(result.error());
    });
    i2c.set_function("scan", [requireHardware](sol::this_state ts, sol::optional<int> bus) -> sol::table {
        sol::state_view lua(ts);
        auto result = requireHardware().i2cScan(bus.value_or(0));
        if (result.isError()) throw std::runtime_error(result.error());
        sol::table table = lua.create_table();
        int index = 1;
        for (const auto address : result.value()) {
            table[index++] = address;
        }
        return table;
    });
    (*lua_)["i2c"] = i2c;

    lua_->set_function("component", [requireHardware, makeComponentTable](sol::this_state ts, const std::string& name) {
        auto* instance = requireHardware().component(name);
        if (!instance) {
            throw std::runtime_error("unknown component: " + name);
        }
        return makeComponentTable(ts, *instance);
    });
}

void LuaScriptEngine::syncVariablesToLua() {
    if (!variables_) return;
    
    for (auto* var : variables_->all()) {
        const auto& val = var->value();
        const std::string& name = var->name();
        
        switch (val.type()) {
            case ValueType::Bool:
                (*lua_)[name] = val.get<bool>();
                break;
            case ValueType::Int32:
                (*lua_)[name] = val.get<int32_t>();
                break;
            case ValueType::Int64:
                (*lua_)[name] = val.get<int64_t>();
                break;
            case ValueType::Float32:
                (*lua_)[name] = val.get<float>();
                break;
            case ValueType::Float64:
                (*lua_)[name] = val.get<double>();
                break;
            case ValueType::String:
                (*lua_)[name] = val.get<std::string>();
                break;
            default:
                break;
        }
    }
}

void LuaScriptEngine::syncVariablesFromLua() {
    if (!variables_) return;
    
    for (auto* var : variables_->all()) {
        if (var->direction() == VariableDirection::Input) continue;
        
        const std::string& name = var->name();
        sol::object obj = (*lua_)[name];
        
        if (obj.valid() && obj.get_type() != sol::type::lua_nil) {
            Value v;
            if (obj.is<bool>()) {
                v = Value(obj.as<bool>());
            } else if (obj.is<int>()) {
                v = Value(obj.as<int32_t>());
            } else if (obj.is<double>()) {
                v = Value(obj.as<double>());
            } else if (obj.is<std::string>()) {
                v = Value(obj.as<std::string>());
            } else {
                continue;
            }
            var->set(std::move(v));
        }
    }
}

Result<Value> LuaScriptEngine::execute(const CodeBlock& code) {
    if (code.isEmpty()) {
        return Result<Value>::ok(Value());
    }
    if (!lua_) {
        lastError_ = "Lua engine not initialized";
        return Result<Value>::error(lastError_);
    }
    
    syncVariablesToLua();
    
    try {
        auto result = lua_->safe_script(code.source, sol::script_pass_on_error);
        
        if (!result.valid()) {
            sol::error err = result;
            lastError_ = err.what();
            return Result<Value>::error(lastError_);
        }
        
        syncVariablesFromLua();
        
        // Convert result to Value
        sol::object obj = result;
        if (obj.get_type() == sol::type::lua_nil || !obj.valid()) {
            return Result<Value>::ok(Value());
        }
        
        if (obj.is<bool>()) {
            return Result<Value>::ok(Value(obj.as<bool>()));
        } else if (obj.is<int>()) {
            return Result<Value>::ok(Value(obj.as<int32_t>()));
        } else if (obj.is<double>()) {
            return Result<Value>::ok(Value(obj.as<double>()));
        } else if (obj.is<std::string>()) {
            return Result<Value>::ok(Value(obj.as<std::string>()));
        }
        
        return Result<Value>::ok(Value());
        
    } catch (const std::exception& e) {
        lastError_ = e.what();
        return Result<Value>::error(lastError_);
    }
}

Result<bool> LuaScriptEngine::evaluateCondition(const CodeBlock& code) {
    if (code.isEmpty()) {
        return Result<bool>::ok(true);
    }
    if (!lua_) {
        lastError_ = "Lua engine not initialized";
        return Result<bool>::error(lastError_);
    }
    
    syncVariablesToLua();
    
    try {
        // Wrap expression to ensure it returns a value
        std::string expr = "return (" + code.source + ")";
        auto result = lua_->safe_script(expr, sol::script_pass_on_error);
        
        if (!result.valid()) {
            // Try executing as-is (might be a statement that sets variables)
            result = lua_->safe_script(code.source, sol::script_pass_on_error);
            if (!result.valid()) {
                sol::error err = result;
                lastError_ = err.what();
                return Result<bool>::error(lastError_);
            }
            return Result<bool>::ok(true);
        }
        
        sol::object obj = result;
        if (obj.is<bool>()) {
            return Result<bool>::ok(obj.as<bool>());
        } else if (obj.is<int>()) {
            return Result<bool>::ok(obj.as<int>() != 0);
        } else if (obj.is<double>()) {
            return Result<bool>::ok(obj.as<double>() != 0.0);
        } else if (obj.is<std::string>()) {
            return Result<bool>::ok(!obj.as<std::string>().empty());
        }
        
        return Result<bool>::ok(obj.get_type() != sol::type::lua_nil);
        
    } catch (const std::exception& e) {
        lastError_ = e.what();
        return Result<bool>::error(lastError_);
    }
}

Result<double> LuaScriptEngine::evaluateWeight(const CodeBlock& code) {
    if (code.isEmpty()) {
        return Result<double>::ok(100.0);
    }
    if (!lua_) {
        lastError_ = "Lua engine not initialized";
        return Result<double>::error(lastError_);
    }
    
    syncVariablesToLua();
    
    try {
        std::string expr = "return (" + code.source + ")";
        auto result = lua_->safe_script(expr, sol::script_pass_on_error);
        
        if (!result.valid()) {
            sol::error err = result;
            lastError_ = err.what();
            return Result<double>::error(lastError_);
        }
        
        sol::object obj = result;
        if (obj.is<double>()) {
            return Result<double>::ok(obj.as<double>());
        } else if (obj.is<int>()) {
            return Result<double>::ok(static_cast<double>(obj.as<int>()));
        }
        
        return Result<double>::ok(100.0);
        
    } catch (const std::exception& e) {
        lastError_ = e.what();
        return Result<double>::error(lastError_);
    }
}

std::string LuaScriptEngine::lastError() const {
    return lastError_;
}

void LuaScriptEngine::clearError() {
    lastError_.clear();
}

void LuaScriptEngine::setLogHandler(std::function<void(const std::string& level,
                                                       const std::string& message)> handler) {
    logHandler_ = std::move(handler);
}

void LuaScriptEngine::collectGarbage() {
    if (lua_) {
        lua_->collect_garbage();
    }
}

} // namespace aeth
