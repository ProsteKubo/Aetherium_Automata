#include "telemetry_log_hub.hpp"

#include <algorithm>

#ifdef abs
#undef abs
#endif

#include <chrono>

namespace aeth {

TelemetryLogHub::TelemetryLogHub(size_t capacity)
    : capacity_(std::max<size_t>(capacity, 1)) {}

void TelemetryLogHub::setCapacity(size_t capacity) {
    std::lock_guard<std::mutex> lock(mutex_);
    capacity_ = std::max<size_t>(capacity, 1);
    while (ring_.size() > capacity_) {
        ring_.pop_front();
    }
}

uint64_t TelemetryLogHub::log(LogLevel level,
                              const std::string& category,
                              const std::string& message,
                              std::optional<RunId> runId) {
    return event(EventKind::Log, level, category, message, runId);
}

uint64_t TelemetryLogHub::event(EventKind kind,
                                LogLevel level,
                                const std::string& category,
                                const std::string& message,
                                std::optional<RunId> runId) {
    LogEvent entry;
    entry.timestamp = nowMs();
    entry.kind = kind;
    entry.level = level;
    entry.category = category;
    entry.message = message;
    entry.runId = runId;
    return push(std::move(entry));
}

uint64_t TelemetryLogHub::stateChange(StateId from,
                                      StateId to,
                                      TransitionId transition,
                                      std::optional<RunId> runId) {
    LogEvent entry;
    entry.timestamp = nowMs();
    entry.kind = EventKind::StateChange;
    entry.level = LogLevel::Info;
    entry.category = "runtime";
    entry.message = "state transition";
    entry.runId = runId;
    entry.fromState = from;
    entry.toState = to;
    entry.transitionId = transition;
    return push(std::move(entry));
}

uint64_t TelemetryLogHub::outputChange(const std::string& variable,
                                       const Value& value,
                                       std::optional<RunId> runId) {
    LogEvent entry;
    entry.timestamp = nowMs();
    entry.kind = EventKind::OutputChange;
    entry.level = LogLevel::Info;
    entry.category = "output";
    entry.message = "output changed";
    entry.runId = runId;
    entry.variableName = variable;
    entry.value = value;
    return push(std::move(entry));
}

std::vector<LogEvent> TelemetryLogHub::snapshot(const LogQuery& query) const {
    std::lock_guard<std::mutex> lock(mutex_);
    std::vector<LogEvent> result;
    result.reserve(std::min(query.maxItems, ring_.size()));

    for (const auto& e : ring_) {
        if (e.seq <= query.afterSeq) {
            continue;
        }
        result.push_back(e);
        if (result.size() >= query.maxItems) {
            break;
        }
    }

    return result;
}

void TelemetryLogHub::stream(EventStreamCallback callback) {
    if (!callback) {
        return;
    }
    std::lock_guard<std::mutex> lock(mutex_);
    streamCallbacks_.push_back(std::move(callback));
}

uint64_t TelemetryLogHub::latestSeq() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return nextSeq_ > 0 ? nextSeq_ - 1 : 0;
}

uint64_t TelemetryLogHub::push(LogEvent event) {
    std::vector<EventStreamCallback> callbacks;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        event.seq = nextSeq_++;
        ring_.push_back(event);
        while (ring_.size() > capacity_) {
            ring_.pop_front();
        }
        callbacks = streamCallbacks_;
    }

    for (const auto& cb : callbacks) {
        cb(event);
    }

    return event.seq;
}

Timestamp TelemetryLogHub::nowMs() {
    const auto now = std::chrono::system_clock::now().time_since_epoch();
    return static_cast<Timestamp>(std::chrono::duration_cast<std::chrono::milliseconds>(now).count());
}

} // namespace aeth
