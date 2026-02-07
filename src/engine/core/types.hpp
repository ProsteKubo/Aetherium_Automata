/**
 * Aetherium Automata - Core Type Definitions
 * 
 * Minimal, portable type definitions for the automata engine.
 * Designed to work on desktop (C++17) and embedded (ESP32/Pico).
 * 
 * Design principles:
 * - Composition over inheritance
 * - Value semantics where possible
 * - No deep inheritance hierarchies
 * - Platform-agnostic core
 */

#ifndef AETHERIUM_TYPES_HPP
#define AETHERIUM_TYPES_HPP

#include <cstdint>
#include <string>
#include <variant>
#include <vector>
#include <optional>
#include <functional>

namespace aeth {

// ============================================================================
// Basic Type Aliases
// ============================================================================

using StateId = uint16_t;
using TransitionId = uint16_t;
using VariableId = uint16_t;
using AutomataId = uint32_t;
using DeviceId = uint32_t;
using RunId = uint32_t;
using Timestamp = uint64_t;  // milliseconds since epoch or boot

constexpr StateId INVALID_STATE = 0xFFFF;
constexpr TransitionId INVALID_TRANSITION = 0xFFFF;
constexpr VariableId INVALID_VARIABLE = 0xFFFF;

// ============================================================================
// Value Types
// ============================================================================

/**
 * Supported data types for variables
 */
enum class ValueType : uint8_t {
    Void = 0,
    Bool = 1,
    Int32 = 2,
    Int64 = 3,
    Float32 = 4,
    Float64 = 5,
    String = 6,
    Binary = 7,
    Table = 8  // Reserved for Lua tables
};

/**
 * Type-safe value container
 * Uses std::variant for type safety, but keeps memory footprint reasonable
 */
class Value {
public:
    using Storage = std::variant<
        std::monostate,     // Void
        bool,               // Bool
        int32_t,            // Int32
        int64_t,            // Int64
        float,              // Float32
        double,             // Float64
        std::string,        // String
        std::vector<uint8_t> // Binary
    >;

    Value() : data_(std::monostate{}) {}
    explicit Value(bool v) : data_(v) {}
    explicit Value(int32_t v) : data_(v) {}
    explicit Value(int64_t v) : data_(v) {}
    explicit Value(float v) : data_(v) {}
    explicit Value(double v) : data_(v) {}
    explicit Value(std::string v) : data_(std::move(v)) {}
    explicit Value(const char* v) : data_(std::string(v)) {}
    explicit Value(std::vector<uint8_t> v) : data_(std::move(v)) {}

    [[nodiscard]] ValueType type() const {
        return static_cast<ValueType>(data_.index());
    }

    [[nodiscard]] bool isVoid() const { return std::holds_alternative<std::monostate>(data_); }

    template <typename T>
    [[nodiscard]] bool is() const { return std::holds_alternative<T>(data_); }

    template <typename T>
    [[nodiscard]] T& get() { return std::get<T>(data_); }

    template <typename T>
    [[nodiscard]] const T& get() const { return std::get<T>(data_); }

    template <typename T>
    [[nodiscard]] std::optional<T> tryGet() const {
        if (auto* p = std::get_if<T>(&data_)) {
            return *p;
        }
        return std::nullopt;
    }

    // Conversion helpers
    [[nodiscard]] bool toBool() const;
    [[nodiscard]] int64_t toInt() const;
    [[nodiscard]] double toDouble() const;
    [[nodiscard]] std::string toString() const;

    bool operator==(const Value& other) const { return data_ == other.data_; }
    bool operator!=(const Value& other) const { return !(*this == other); }

private:
    Storage data_;
};

// ============================================================================
// Variable Direction
// ============================================================================

/**
 * Direction of data flow for a variable
 */
enum class VariableDirection : uint8_t {
    Input = 1,    // Read-only, set externally
    Output = 2,   // Write-only, for external consumption
    Internal = 3  // Read-write, local to automata
};

// ============================================================================
// Transition Types
// ============================================================================

/**
 * Types of transitions supported
 */
enum class TransitionType : uint8_t {
    Classic = 1,      // Condition-based (guard expression)
    Timed = 2,        // Time-based (delay, timeout)
    Event = 3,        // Signal-triggered
    Probabilistic = 4,// Pure weight-based (no condition)
    Immediate = 5     // Epsilon transition, always fires
};

/**
 * Timed transition modes
 */
enum class TimedMode : uint8_t {
    After = 1,    // Fire after delay from state entry
    At = 2,       // Fire at absolute time
    Every = 3,    // Periodic
    Timeout = 4,  // Fire if no other transition fires within time
    Window = 5    // Fire only during time window
};

/**
 * Event trigger types
 */
enum class EventTrigger : uint8_t {
    OnChange = 1,    // Any value change
    OnRise = 2,      // False → True
    OnFall = 3,      // True → False
    OnThreshold = 4, // Cross threshold
    OnMatch = 5      // Pattern match
};

/**
 * Comparison operators for thresholds
 */
enum class CompareOp : uint8_t {
    Eq = 1,   // ==
    Ne = 2,   // !=
    Lt = 3,   // <
    Le = 4,   // <=
    Gt = 5,   // >
    Ge = 6    // >=
};

// ============================================================================
// Execution State
// ============================================================================

/**
 * Current execution state of an automata instance
 */
enum class ExecutionState : uint8_t {
    Unloaded = 0,
    Loaded = 1,
    Running = 2,
    Paused = 3,
    Stopped = 4,
    Error = 5
};

// ============================================================================
// Result Types
// ============================================================================

/**
 * Generic result type for operations that can fail
 */
template <typename T>
class Result {
public:
    static Result<T> ok(T value) {
        Result<T> r;
        r.value_ = std::move(value);
        r.success_ = true;
        return r;
    }

    static Result<T> error(std::string message) {
        Result<T> r;
        r.error_ = std::move(message);
        r.success_ = false;
        return r;
    }

    [[nodiscard]] bool isOk() const { return success_; }
    [[nodiscard]] bool isError() const { return !success_; }

    [[nodiscard]] T& value() { return value_; }
    [[nodiscard]] const T& value() const { return value_; }
    [[nodiscard]] const std::string& error() const { return error_; }

    // Monadic operations
    template <typename Fn>
    auto map(Fn&& fn) -> Result<decltype(fn(std::declval<T>()))> {
        using U = decltype(fn(std::declval<T>()));
        if (success_) {
            return Result<U>::ok(fn(value_));
        }
        return Result<U>::error(error_);
    }

private:
    T value_{};
    std::string error_;
    bool success_ = false;
};

// Specialization for void
template <>
class Result<void> {
public:
    static Result<void> ok() {
        Result<void> r;
        r.success_ = true;
        return r;
    }

    static Result<void> error(std::string message) {
        Result<void> r;
        r.error_ = std::move(message);
        r.success_ = false;
        return r;
    }

    [[nodiscard]] bool isOk() const { return success_; }
    [[nodiscard]] bool isError() const { return !success_; }
    [[nodiscard]] const std::string& error() const { return error_; }

private:
    std::string error_;
    bool success_ = false;
};

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get string representation of ValueType
 */
inline const char* valueTypeName(ValueType t) {
    switch (t) {
        case ValueType::Void: return "void";
        case ValueType::Bool: return "bool";
        case ValueType::Int32: return "int32";
        case ValueType::Int64: return "int64";
        case ValueType::Float32: return "float32";
        case ValueType::Float64: return "float64";
        case ValueType::String: return "string";
        case ValueType::Binary: return "binary";
        case ValueType::Table: return "table";
        default: return "unknown";
    }
}

/**
 * Get string representation of TransitionType
 */
inline const char* transitionTypeName(TransitionType t) {
    switch (t) {
        case TransitionType::Classic: return "classic";
        case TransitionType::Timed: return "timed";
        case TransitionType::Event: return "event";
        case TransitionType::Probabilistic: return "probabilistic";
        case TransitionType::Immediate: return "immediate";
        default: return "unknown";
    }
}

} // namespace aeth

#endif // AETHERIUM_TYPES_HPP
