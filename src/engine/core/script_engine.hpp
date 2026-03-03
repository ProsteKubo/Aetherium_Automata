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
#include <optional>
#include <vector>

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

        return evaluateExpr(code.source);
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

    void collectGarbage() override {
        // No-op for the lightweight embedded/simple script engine.
    }

    void setLogHandler(std::function<void(const std::string& level,
                                          const std::string& message)> handler) override {
        logHandler_ = std::move(handler);
    }

private:
    static std::string trimCopy(const std::string& input) {
        const auto begin = input.find_first_not_of(" \t\n\r");
        if (begin == std::string::npos) {
            return "";
        }
        const auto end = input.find_last_not_of(" \t\n\r");
        return input.substr(begin, end - begin + 1);
    }

    static std::string toLowerCopy(std::string input) {
        std::transform(input.begin(), input.end(), input.begin(),
                       [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
        return input;
    }

    static bool isIdentChar(char c) {
        const unsigned char uc = static_cast<unsigned char>(c);
        return std::isalnum(uc) || c == '_';
    }

    static bool hasEnclosingParens(const std::string& expr) {
        if (expr.size() < 2 || expr.front() != '(' || expr.back() != ')') {
            return false;
        }

        int depth = 0;
        char quote = '\0';
        bool escaped = false;
        for (size_t i = 0; i < expr.size(); ++i) {
            const char c = expr[i];
            if (quote != '\0') {
                if (escaped) {
                    escaped = false;
                    continue;
                }
                if (c == '\\') {
                    escaped = true;
                    continue;
                }
                if (c == quote) {
                    quote = '\0';
                }
                continue;
            }

            if (c == '"' || c == '\'') {
                quote = c;
                continue;
            }
            if (c == '(') {
                depth++;
            } else if (c == ')') {
                depth--;
                if (depth == 0 && i + 1 < expr.size()) {
                    return false;
                }
                if (depth < 0) {
                    return false;
                }
            }
        }
        return depth == 0;
    }

    static std::optional<size_t> findTopLevelKeyword(const std::string& expr, const std::string& keyword) {
        if (keyword.empty() || expr.size() < keyword.size()) {
            return std::nullopt;
        }

        int depth = 0;
        char quote = '\0';
        bool escaped = false;
        for (size_t i = 0; i + keyword.size() <= expr.size(); ++i) {
            const char c = expr[i];

            if (quote != '\0') {
                if (escaped) {
                    escaped = false;
                    continue;
                }
                if (c == '\\') {
                    escaped = true;
                    continue;
                }
                if (c == quote) {
                    quote = '\0';
                }
                continue;
            }

            if (c == '"' || c == '\'') {
                quote = c;
                continue;
            }
            if (c == '(') {
                depth++;
                continue;
            }
            if (c == ')') {
                if (depth > 0) depth--;
                continue;
            }

            if (depth != 0) {
                continue;
            }

            if (i > 0 && isIdentChar(expr[i - 1])) {
                continue;
            }
            if (i + keyword.size() < expr.size() && isIdentChar(expr[i + keyword.size()])) {
                continue;
            }

            const std::string candidate = toLowerCopy(expr.substr(i, keyword.size()));
            if (candidate == keyword) {
                return i;
            }
        }
        return std::nullopt;
    }

    static std::optional<std::pair<size_t, std::string>> findTopLevelCompareOp(const std::string& expr) {
        static const std::vector<std::string> kOps = {"==", "!=", ">=", "<=", ">", "<"};
        int depth = 0;
        char quote = '\0';
        bool escaped = false;
        for (size_t i = 0; i < expr.size(); ++i) {
            const char c = expr[i];
            if (quote != '\0') {
                if (escaped) {
                    escaped = false;
                    continue;
                }
                if (c == '\\') {
                    escaped = true;
                    continue;
                }
                if (c == quote) {
                    quote = '\0';
                }
                continue;
            }

            if (c == '"' || c == '\'') {
                quote = c;
                continue;
            }
            if (c == '(') {
                depth++;
                continue;
            }
            if (c == ')') {
                if (depth > 0) depth--;
                continue;
            }
            if (depth != 0) {
                continue;
            }

            for (const auto& op : kOps) {
                if (i + op.size() <= expr.size() && expr.compare(i, op.size(), op) == 0) {
                    return std::make_pair(i, op);
                }
            }
        }
        return std::nullopt;
    }

    static std::optional<std::string> parseValueHelperName(const std::string& token) {
        static const std::regex helperRegex(
            R"(^\s*(value|getVal|getval)\s*\(\s*(?:(["'])([A-Za-z_]\w*)\2|([A-Za-z_]\w*))\s*\)\s*$)");
        std::smatch match;
        if (!std::regex_match(token, match, helperRegex)) {
            return std::nullopt;
        }
        if (match[3].matched) {
            return match[3].str();
        }
        if (match[4].matched) {
            return match[4].str();
        }
        return std::nullopt;
    }

    std::optional<Value> resolveValueToken(std::string token) const {
        token = trimCopy(token);
        while (hasEnclosingParens(token)) {
            token = trimCopy(token.substr(1, token.size() - 2));
        }
        if (token.empty()) {
            return std::nullopt;
        }

        if (token.size() >= 2 &&
            ((token.front() == '"' && token.back() == '"') ||
             (token.front() == '\'' && token.back() == '\''))) {
            return Value(token.substr(1, token.size() - 2));
        }

        const auto lower = toLowerCopy(token);
        if (lower == "true") return Value(true);
        if (lower == "false") return Value(false);

        try {
            size_t pos = 0;
            long long intValue = std::stoll(token, &pos);
            if (pos == token.size()) {
                return Value(static_cast<int32_t>(intValue));
            }
        } catch (...) {}

        try {
            size_t pos = 0;
            double floatValue = std::stod(token, &pos);
            if (pos == token.size()) {
                return Value(floatValue);
            }
        } catch (...) {}

        std::string lookup = token;
        if (auto helperName = parseValueHelperName(token)) {
            lookup = *helperName;
        }

        if (variables_) {
            if (auto varValue = variables_->getValue(lookup)) {
                return *varValue;
            }
        }

        return std::nullopt;
    }

    static bool compareValues(const Value& lhs, const Value& rhs, const std::string& op) {
        if (op == "==" || op == "!=") {
            bool equal = false;
            if (lhs.is<bool>() || rhs.is<bool>()) {
                equal = lhs.toBool() == rhs.toBool();
            } else if (lhs.is<std::string>() || rhs.is<std::string>()) {
                equal = lhs.toString() == rhs.toString();
            } else {
                equal = lhs.toDouble() == rhs.toDouble();
            }
            return op == "==" ? equal : !equal;
        }

        const double a = lhs.toDouble();
        const double b = rhs.toDouble();
        if (op == ">=") return a >= b;
        if (op == "<=") return a <= b;
        if (op == ">") return a > b;
        if (op == "<") return a < b;
        return false;
    }

    Result<bool> evaluateExpr(std::string expr) const {
        expr = trimCopy(expr);
        if (expr.empty()) {
            return Result<bool>::ok(true);
        }

        while (hasEnclosingParens(expr)) {
            expr = trimCopy(expr.substr(1, expr.size() - 2));
        }
        if (expr.empty()) {
            return Result<bool>::ok(true);
        }

        if (auto pos = findTopLevelKeyword(expr, "or")) {
            const std::string left = expr.substr(0, *pos);
            const std::string right = expr.substr(*pos + 2);
            auto lhs = evaluateExpr(left);
            if (lhs.isError()) return lhs;
            if (lhs.value()) return Result<bool>::ok(true);
            auto rhs = evaluateExpr(right);
            if (rhs.isError()) return rhs;
            return Result<bool>::ok(rhs.value());
        }

        if (auto pos = findTopLevelKeyword(expr, "and")) {
            const std::string left = expr.substr(0, *pos);
            const std::string right = expr.substr(*pos + 3);
            auto lhs = evaluateExpr(left);
            if (lhs.isError()) return lhs;
            if (!lhs.value()) return Result<bool>::ok(false);
            auto rhs = evaluateExpr(right);
            if (rhs.isError()) return rhs;
            return Result<bool>::ok(rhs.value());
        }

        if (auto pos = findTopLevelKeyword(expr, "not")) {
            if (*pos == 0) {
                auto inner = evaluateExpr(expr.substr(3));
                if (inner.isError()) return inner;
                return Result<bool>::ok(!inner.value());
            }
        }

        if (auto cmp = findTopLevelCompareOp(expr)) {
            const auto& op = cmp->second;
            const std::string left = trimCopy(expr.substr(0, cmp->first));
            const std::string right = trimCopy(expr.substr(cmp->first + op.size()));
            if (left.empty() || right.empty()) {
                return Result<bool>::ok(false);
            }
            auto lhs = resolveValueToken(left);
            auto rhs = resolveValueToken(right);
            if (!lhs || !rhs) {
                return Result<bool>::ok(false);
            }
            return Result<bool>::ok(compareValues(*lhs, *rhs, op));
        }

        if (auto token = resolveValueToken(expr)) {
            return Result<bool>::ok(token->toBool());
        }

        // Unknown conditions should not pass implicitly on embedded targets.
        return Result<bool>::ok(false);
    }

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
    std::function<void(const std::string&, const std::string&)> logHandler_;
};

} // namespace aeth

#endif // AETHERIUM_SCRIPT_ENGINE_HPP
