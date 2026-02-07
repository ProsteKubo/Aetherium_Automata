/**
 * Aetherium Automata - Script Engine Implementation
 * 
 * Basic script engine for condition evaluation and code execution.
 * Currently implements a simple expression evaluator.
 * TODO: Full Lua integration for production use.
 */

#ifndef AETHERIUM_SCRIPT_ENGINE_HPP
#define AETHERIUM_SCRIPT_ENGINE_HPP

#include "runtime.hpp"
#include <sstream>
#include <regex>

namespace aeth {

/**
 * Simple script engine that evaluates basic expressions.
 * For full Lua support, use LuaScriptEngine instead.
 */
class SimpleScriptEngine : public IScriptEngine {
public:
    SimpleScriptEngine() = default;

    Result<void> initialize(VariableStore* variables) override {
        variables_ = variables;
        return Result<void>::ok();
    }

    Result<Value> execute(const CodeBlock& code) override {
        if (code.isEmpty()) {
            return Result<Value>::ok(Value());
        }

        // For now, just log execution and return void
        // Full Lua implementation would go here
        lastExecution_ = code.source;
        
        // Try to parse simple assignments: varname = value
        std::regex assignRegex(R"((\w+)\s*=\s*(.+))");
        std::smatch match;
        if (std::regex_match(code.source, match, assignRegex)) {
            std::string varName = match[1];
            std::string valueStr = match[2];
            
            // Try to set variable
            Value val = parseValue(valueStr);
            if (variables_) {
                variables_->setValue(varName, val);
            }
        }
        
        return Result<Value>::ok(Value());
    }

    Result<bool> evaluateCondition(const CodeBlock& code) override {
        if (code.isEmpty()) {
            return Result<bool>::ok(true);  // Empty condition is always true
        }

        // Simple expression evaluation
        // Support: true, false, variable names, comparisons
        std::string expr = code.source;
        
        // Trim whitespace
        expr.erase(0, expr.find_first_not_of(" \t\n\r"));
        expr.erase(expr.find_last_not_of(" \t\n\r") + 1);

        // Check for literals
        if (expr == "true" || expr == "1") {
            return Result<bool>::ok(true);
        }
        if (expr == "false" || expr == "0") {
            return Result<bool>::ok(false);
        }

        // Check for simple comparisons: var > value, var == value, etc
        std::regex compRegex(R"((\w+)\s*(==|!=|>=|<=|>|<)\s*(.+))");
        std::smatch match;
        if (std::regex_match(expr, match, compRegex)) {
            std::string varName = match[1];
            std::string op = match[2];
            std::string valueStr = match[3];

            if (variables_) {
                auto varValue = variables_->getValue(varName);
                if (varValue) {
                    double lhs = varValue->toDouble();
                    double rhs = parseValue(valueStr).toDouble();

                    if (op == "==") return Result<bool>::ok(lhs == rhs);
                    if (op == "!=") return Result<bool>::ok(lhs != rhs);
                    if (op == ">=") return Result<bool>::ok(lhs >= rhs);
                    if (op == "<=") return Result<bool>::ok(lhs <= rhs);
                    if (op == ">") return Result<bool>::ok(lhs > rhs);
                    if (op == "<") return Result<bool>::ok(lhs < rhs);
                }
            }
        }

        // Check if it's a variable name
        if (variables_) {
            auto varValue = variables_->getValue(expr);
            if (varValue) {
                return Result<bool>::ok(varValue->toBool());
            }
        }

        // Default to true for unrecognized expressions
        return Result<bool>::ok(true);
    }

    Result<double> evaluateWeight(const CodeBlock& code) override {
        if (code.isEmpty()) {
            return Result<double>::ok(100.0);
        }

        // Try to parse as number
        try {
            double val = std::stod(code.source);
            return Result<double>::ok(val);
        } catch (...) {
            // Not a number, try evaluating as expression
        }

        // Try to get from variable
        if (variables_) {
            auto varValue = variables_->getValue(code.source);
            if (varValue) {
                return Result<double>::ok(varValue->toDouble());
            }
        }

        return Result<double>::ok(100.0);
    }

    std::string lastError() const override {
        return lastError_;
    }

    void clearError() override {
        lastError_.clear();
    }

private:
    Value parseValue(const std::string& str) {
        std::string s = str;
        // Trim
        s.erase(0, s.find_first_not_of(" \t\n\r\"'"));
        s.erase(s.find_last_not_of(" \t\n\r\"'") + 1);

        if (s == "true") return Value(true);
        if (s == "false") return Value(false);

        // Try as integer
        try {
            size_t pos;
            int64_t ival = std::stoll(s, &pos);
            if (pos == s.length()) {
                return Value(static_cast<int32_t>(ival));
            }
        } catch (...) {}

        // Try as double
        try {
            size_t pos;
            double dval = std::stod(s, &pos);
            if (pos == s.length()) {
                return Value(dval);
            }
        } catch (...) {}

        // Return as string
        return Value(s);
    }

    VariableStore* variables_ = nullptr;
    std::string lastError_;
    std::string lastExecution_;
};

} // namespace aeth

#endif // AETHERIUM_SCRIPT_ENGINE_HPP
