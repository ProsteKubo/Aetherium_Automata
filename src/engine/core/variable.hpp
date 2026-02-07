/**
 * Aetherium Automata - Variable System
 * 
 * Variables are typed containers with direction (input/output/internal).
 * They form the communication interface between automata and the external world.
 */

#ifndef AETHERIUM_VARIABLE_HPP
#define AETHERIUM_VARIABLE_HPP

#include "types.hpp"
#include <unordered_map>
#include <functional>

namespace aeth {

// ============================================================================
// Variable Definition (static, from automata spec)
// ============================================================================

/**
 * Definition of a variable from the automata specification
 */
struct VariableSpec {
    VariableId id = INVALID_VARIABLE;
    std::string name;
    ValueType type = ValueType::Void;
    VariableDirection direction = VariableDirection::Internal;
    Value initialValue;
    std::string description;

    VariableSpec() = default;
    VariableSpec(VariableId id, std::string name, ValueType type, 
                 VariableDirection dir, Value initial = Value())
        : id(id), name(std::move(name)), type(type), 
          direction(dir), initialValue(std::move(initial)) {}
};

// ============================================================================
// Variable Instance (runtime, with current value)
// ============================================================================

/**
 * Runtime instance of a variable with current value and change tracking
 */
class Variable {
public:
    Variable() = default;
    explicit Variable(const VariableSpec& spec)
        : spec_(spec), value_(spec.initialValue), changed_(false) {}

    // Identity
    [[nodiscard]] VariableId id() const { return spec_.id; }
    [[nodiscard]] const std::string& name() const { return spec_.name; }
    [[nodiscard]] ValueType type() const { return spec_.type; }
    [[nodiscard]] VariableDirection direction() const { return spec_.direction; }

    // Value access
    [[nodiscard]] const Value& value() const { return value_; }
    [[nodiscard]] const Value& previousValue() const { return prevValue_; }

    /**
     * Set the value. Returns false if type mismatch or direction violation.
     * For inputs, use setExternal() instead.
     */
    bool set(Value newValue);

    /**
     * Set from external source (for inputs)
     */
    bool setExternal(Value newValue);

    // Change detection
    [[nodiscard]] bool hasChanged() const { return changed_; }
    void clearChanged() { changed_ = false; }
    void markChanged() { changed_ = true; }

    // Timestamp of last update
    [[nodiscard]] Timestamp lastUpdated() const { return lastUpdated_; }
    void setTimestamp(Timestamp ts) { lastUpdated_ = ts; }

    // Access control
    [[nodiscard]] bool isReadable() const {
        return spec_.direction != VariableDirection::Output;
    }
    [[nodiscard]] bool isWritable() const {
        return spec_.direction != VariableDirection::Input;
    }

    // Reset to initial value
    void reset() {
        prevValue_ = value_;
        value_ = spec_.initialValue;
        changed_ = true;
    }

private:
    VariableSpec spec_;
    Value value_;
    Value prevValue_;
    Timestamp lastUpdated_ = 0;
    bool changed_ = false;
};

// ============================================================================
// Variable Store (collection of variables for an automata)
// ============================================================================

/**
 * Callback for variable changes
 */
using VariableChangeCallback = std::function<void(const Variable&)>;

/**
 * Manages all variables for an automata instance
 */
class VariableStore {
public:
    VariableStore() = default;

    // Initialization
    void addVariable(const VariableSpec& spec);
    void clear();

    // Lookup
    [[nodiscard]] Variable* get(VariableId id);
    [[nodiscard]] const Variable* get(VariableId id) const;
    [[nodiscard]] Variable* getByName(const std::string& name);
    [[nodiscard]] const Variable* getByName(const std::string& name) const;

    // Bulk access
    [[nodiscard]] std::vector<Variable*> inputs();
    [[nodiscard]] std::vector<Variable*> outputs();
    [[nodiscard]] std::vector<Variable*> internals();
    [[nodiscard]] std::vector<Variable*> all();

    // Value operations
    bool setValue(VariableId id, Value value);
    bool setValue(const std::string& name, Value value);
    bool setExternalValue(VariableId id, Value value);
    bool setExternalValue(const std::string& name, Value value);

    [[nodiscard]] std::optional<Value> getValue(VariableId id) const;
    [[nodiscard]] std::optional<Value> getValue(const std::string& name) const;

    // Change tracking
    void clearAllChanged();
    [[nodiscard]] std::vector<Variable*> getChanged();

    // Callbacks
    void onVariableChange(VariableChangeCallback callback);

    // Reset all to initial values
    void resetAll();

    // Stats
    [[nodiscard]] size_t size() const { return variables_.size(); }
    [[nodiscard]] bool empty() const { return variables_.empty(); }

private:
    std::unordered_map<VariableId, Variable> variables_;
    std::unordered_map<std::string, VariableId> nameIndex_;
    std::vector<VariableChangeCallback> changeCallbacks_;

    void notifyChange(const Variable& var);
};

// ============================================================================
// Implementation: Variable
// ============================================================================

inline bool Variable::set(Value newValue) {
    // Check direction - can't write to inputs from code
    if (spec_.direction == VariableDirection::Input) {
        return false;
    }

    // Type checking (allow compatible types)
    if (newValue.type() != spec_.type && spec_.type != ValueType::Void) {
        // Could add type coercion here
        return false;
    }

    prevValue_ = value_;
    value_ = std::move(newValue);
    changed_ = (value_ != prevValue_);
    return true;
}

inline bool Variable::setExternal(Value newValue) {
    // External can set inputs
    if (spec_.direction == VariableDirection::Output) {
        return false; // Can't externally set outputs
    }

    prevValue_ = value_;
    value_ = std::move(newValue);
    changed_ = (value_ != prevValue_);
    return true;
}

// ============================================================================
// Implementation: VariableStore
// ============================================================================

inline void VariableStore::addVariable(const VariableSpec& spec) {
    variables_[spec.id] = Variable(spec);
    nameIndex_[spec.name] = spec.id;
}

inline void VariableStore::clear() {
    variables_.clear();
    nameIndex_.clear();
}

inline Variable* VariableStore::get(VariableId id) {
    auto it = variables_.find(id);
    return it != variables_.end() ? &it->second : nullptr;
}

inline const Variable* VariableStore::get(VariableId id) const {
    auto it = variables_.find(id);
    return it != variables_.end() ? &it->second : nullptr;
}

inline Variable* VariableStore::getByName(const std::string& name) {
    auto it = nameIndex_.find(name);
    if (it == nameIndex_.end()) return nullptr;
    return get(it->second);
}

inline const Variable* VariableStore::getByName(const std::string& name) const {
    auto it = nameIndex_.find(name);
    if (it == nameIndex_.end()) return nullptr;
    return get(it->second);
}

inline std::vector<Variable*> VariableStore::inputs() {
    std::vector<Variable*> result;
    for (auto& [id, var] : variables_) {
        if (var.direction() == VariableDirection::Input) {
            result.push_back(&var);
        }
    }
    return result;
}

inline std::vector<Variable*> VariableStore::outputs() {
    std::vector<Variable*> result;
    for (auto& [id, var] : variables_) {
        if (var.direction() == VariableDirection::Output) {
            result.push_back(&var);
        }
    }
    return result;
}

inline std::vector<Variable*> VariableStore::internals() {
    std::vector<Variable*> result;
    for (auto& [id, var] : variables_) {
        if (var.direction() == VariableDirection::Internal) {
            result.push_back(&var);
        }
    }
    return result;
}

inline std::vector<Variable*> VariableStore::all() {
    std::vector<Variable*> result;
    result.reserve(variables_.size());
    for (auto& [id, var] : variables_) {
        result.push_back(&var);
    }
    return result;
}

inline bool VariableStore::setValue(VariableId id, Value value) {
    if (auto* var = get(id)) {
        if (var->set(std::move(value))) {
            if (var->hasChanged()) {
                notifyChange(*var);
            }
            return true;
        }
    }
    return false;
}

inline bool VariableStore::setValue(const std::string& name, Value value) {
    if (auto* var = getByName(name)) {
        if (var->set(std::move(value))) {
            if (var->hasChanged()) {
                notifyChange(*var);
            }
            return true;
        }
    }
    return false;
}

inline bool VariableStore::setExternalValue(VariableId id, Value value) {
    if (auto* var = get(id)) {
        if (var->setExternal(std::move(value))) {
            if (var->hasChanged()) {
                notifyChange(*var);
            }
            return true;
        }
    }
    return false;
}

inline bool VariableStore::setExternalValue(const std::string& name, Value value) {
    if (auto* var = getByName(name)) {
        if (var->setExternal(std::move(value))) {
            if (var->hasChanged()) {
                notifyChange(*var);
            }
            return true;
        }
    }
    return false;
}

inline std::optional<Value> VariableStore::getValue(VariableId id) const {
    if (const auto* var = get(id)) {
        return var->value();
    }
    return std::nullopt;
}

inline std::optional<Value> VariableStore::getValue(const std::string& name) const {
    if (const auto* var = getByName(name)) {
        return var->value();
    }
    return std::nullopt;
}

inline void VariableStore::clearAllChanged() {
    for (auto& [id, var] : variables_) {
        var.clearChanged();
    }
}

inline std::vector<Variable*> VariableStore::getChanged() {
    std::vector<Variable*> result;
    for (auto& [id, var] : variables_) {
        if (var.hasChanged()) {
            result.push_back(&var);
        }
    }
    return result;
}

inline void VariableStore::onVariableChange(VariableChangeCallback callback) {
    changeCallbacks_.push_back(std::move(callback));
}

inline void VariableStore::notifyChange(const Variable& var) {
    for (const auto& cb : changeCallbacks_) {
        cb(var);
    }
}

inline void VariableStore::resetAll() {
    for (auto& [id, var] : variables_) {
        var.reset();
    }
}

} // namespace aeth

#endif // AETHERIUM_VARIABLE_HPP
