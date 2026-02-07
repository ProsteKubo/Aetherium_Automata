/**
 * Aetherium Automata - Lua Script Engine Implementation
 */

#include "lua_engine.hpp"

#define SOL_ALL_SAFETIES_ON 1
#include <sol/sol.hpp>

namespace aeth {

LuaScriptEngine::LuaScriptEngine() 
    : lua_(std::make_unique<sol::state>()) {
}

LuaScriptEngine::~LuaScriptEngine() = default;

Result<void> LuaScriptEngine::initialize(VariableStore* variables) {
    variables_ = variables;
    
    // Open standard libraries
    lua_->open_libraries(
        sol::lib::base,
        sol::lib::math,
        sol::lib::string,
        sol::lib::table
    );
    
    setupBuiltins();
    syncVariablesToLua();
    
    return Result<void>::ok();
}

void LuaScriptEngine::setupBuiltins() {
    // log(level, message) - Log a message
    lua_->set_function("log", [](const std::string& level, const std::string& msg) {
        std::printf("[%s] %s\n", level.c_str(), msg.c_str());
    });
    
    // value(name) - Get variable value
    lua_->set_function("value", [this](const std::string& name) -> sol::object {
        if (!variables_) return sol::make_object(*lua_, sol::lua_nil);
        
        auto val = variables_->getValue(name);
        if (!val) return sol::make_object(*lua_, sol::lua_nil);
        
        switch (val->type()) {
            case ValueType::Bool:
                return sol::make_object(*lua_, val->get<bool>());
            case ValueType::Int32:
                return sol::make_object(*lua_, val->get<int32_t>());
            case ValueType::Int64:
                return sol::make_object(*lua_, val->get<int64_t>());
            case ValueType::Float32:
                return sol::make_object(*lua_, val->get<float>());
            case ValueType::Float64:
                return sol::make_object(*lua_, val->get<double>());
            case ValueType::String:
                return sol::make_object(*lua_, val->get<std::string>());
            default:
                return sol::make_object(*lua_, sol::lua_nil);
        }
    });
    
    // setVal(name, value) - Set variable value
    lua_->set_function("setVal", [this](const std::string& name, sol::object val) {
        if (!variables_) return;
        
        Value v;
        if (val.is<bool>()) {
            v = Value(val.as<bool>());
        } else if (val.is<int>()) {
            v = Value(val.as<int32_t>());
        } else if (val.is<double>()) {
            v = Value(val.as<double>());
        } else if (val.is<std::string>()) {
            v = Value(val.as<std::string>());
        } else {
            return;
        }
        
        variables_->setValue(name, std::move(v));
    });
    
    // getInput(name) - Get input value (direct implementation, no nested Lua call)
    lua_->set_function("getInput", [this](const std::string& name) -> sol::object {
        if (!variables_) return sol::make_object(*lua_, sol::lua_nil);
        
        auto val = variables_->getValue(name);
        if (!val) return sol::make_object(*lua_, sol::lua_nil);
        
        switch (val->type()) {
            case ValueType::Bool:
                return sol::make_object(*lua_, val->get<bool>());
            case ValueType::Int32:
                return sol::make_object(*lua_, val->get<int32_t>());
            case ValueType::Int64:
                return sol::make_object(*lua_, val->get<int64_t>());
            case ValueType::Float32:
                return sol::make_object(*lua_, val->get<float>());
            case ValueType::Float64:
                return sol::make_object(*lua_, val->get<double>());
            case ValueType::String:
                return sol::make_object(*lua_, val->get<std::string>());
            default:
                return sol::make_object(*lua_, sol::lua_nil);
        }
    });
    
    // setOutput(name, value) - Set output value (direct implementation, no nested Lua call)
    lua_->set_function("setOutput", [this](const std::string& name, sol::object val) {
        if (!variables_) return;
        
        Value v;
        if (val.is<bool>()) {
            v = Value(val.as<bool>());
        } else if (val.is<int>()) {
            v = Value(val.as<int32_t>());
        } else if (val.is<double>()) {
            v = Value(val.as<double>());
        } else if (val.is<std::string>()) {
            v = Value(val.as<std::string>());
        } else {
            return;
        }
        
        variables_->setValue(name, std::move(v));
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

void LuaScriptEngine::collectGarbage() {
    lua_->collect_garbage();
}

} // namespace aeth
