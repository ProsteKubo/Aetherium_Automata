#ifndef AETHERIUM_TELEMETRY_LOG_HUB_HPP
#define AETHERIUM_TELEMETRY_LOG_HUB_HPP

#include "compat_mutex.hpp"
#include "types.hpp"
#include <cstdint>
#include <deque>
#include <functional>

#ifdef abs
#undef abs
#endif

#include <optional>
#include <string>
#include <vector>

namespace aeth {

enum class LogLevel : uint8_t {
    Trace = 0,
    Debug = 1,
    Info = 2,
    Warn = 3,
    Error = 4
};

enum class EventKind : uint8_t {
    Log = 0,
    StateChange = 1,
    OutputChange = 2,
    TransitionFired = 3,
    Error = 4,
    Lifecycle = 5
};

struct LogEvent {
    uint64_t seq = 0;
    Timestamp timestamp = 0;
    EventKind kind = EventKind::Log;
    LogLevel level = LogLevel::Info;
    std::string category;
    std::string message;
    std::optional<RunId> runId;
    std::optional<StateId> fromState;
    std::optional<StateId> toState;
    std::optional<TransitionId> transitionId;
    std::optional<std::string> variableName;
    std::optional<Value> value;
};

struct LogQuery {
    uint64_t afterSeq = 0;
    size_t maxItems = 200;
};

using EventStreamCallback = std::function<void(const LogEvent&)>;

class TelemetryLogHub {
public:
    explicit TelemetryLogHub(size_t capacity = 2048);

    void setCapacity(size_t capacity);

    uint64_t log(LogLevel level,
                 const std::string& category,
                 const std::string& message,
                 std::optional<RunId> runId = std::nullopt);

    uint64_t event(EventKind kind,
                   LogLevel level,
                   const std::string& category,
                   const std::string& message,
                   std::optional<RunId> runId = std::nullopt);

    uint64_t stateChange(StateId from,
                         StateId to,
                         TransitionId transition,
                         std::optional<RunId> runId = std::nullopt);

    uint64_t outputChange(const std::string& variable,
                          const Value& value,
                          std::optional<RunId> runId = std::nullopt);

    std::vector<LogEvent> snapshot(const LogQuery& query = {}) const;

    void stream(EventStreamCallback callback);

    [[nodiscard]] uint64_t latestSeq() const;

private:
    uint64_t push(LogEvent event);
    static Timestamp nowMs();

    mutable compat::Mutex mutex_;
    std::deque<LogEvent> ring_;
    std::vector<EventStreamCallback> streamCallbacks_;
    size_t capacity_;
    uint64_t nextSeq_ = 1;
};

} // namespace aeth

#endif // AETHERIUM_TELEMETRY_LOG_HUB_HPP
