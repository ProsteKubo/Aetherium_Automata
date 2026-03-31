#include "execution_trace.hpp"

#include <filesystem>
#include <fstream>
#include <sstream>

namespace aeth {

bool FaultProfile::hasActiveEffects() const {
    return enabled &&
           (fixedDelayMs > 0 ||
            jitterMs > 0 ||
            dropProbability > 0.0 ||
            duplicateProbability > 0.0 ||
            successProbability < 1.0 ||
            (disconnectPeriodMs > 0 && disconnectDurationMs > 0));
}

void LocalTraceStore::clear() {
    records_.clear();
    nextSeq_ = 1;
}

void LocalTraceStore::push(TraceRecord record) {
    record.seq = nextSeq_++;
    records_.push_back(std::move(record));
}

Result<void> LocalTraceStore::writeJsonLines(const std::string& path) const {
    namespace fs = std::filesystem;

    std::error_code ec;
    const fs::path outputPath(path);
    if (outputPath.has_parent_path()) {
        fs::create_directories(outputPath.parent_path(), ec);
        if (ec) {
            return Result<void>::error("failed to create trace directory: " + ec.message());
        }
    }

    std::ofstream out(path, std::ios::out | std::ios::trunc);
    if (!out.is_open()) {
        return Result<void>::error("failed to open trace output: " + path);
    }

    for (const auto& record : records_) {
        std::ostringstream line;
        line << "{";
        line << "\"seq\":" << record.seq;
        line << ",\"kind\":\"" << escapeJson(record.kind) << "\"";
        line << ",\"boundary\":\"" << escapeJson(record.boundary) << "\"";
        line << ",\"category\":\"" << escapeJson(record.category) << "\"";
        line << ",\"summary\":\"" << escapeJson(record.summary) << "\"";
        line << ",\"message_type\":\"" << escapeJson(record.messageType) << "\"";
        line << ",\"source_instance\":\"" << escapeJson(record.sourceInstance) << "\"";
        line << ",\"target_instance\":\"" << escapeJson(record.targetInstance) << "\"";
        line << ",\"transport\":\"" << escapeJson(record.transport) << "\"";
        line << ",\"placement\":\"" << escapeJson(record.placement) << "\"";

        if (record.messageId) {
            line << ",\"message_id\":" << *record.messageId;
        }
        if (record.relatedMessageId) {
            line << ",\"related_message_id\":" << *record.relatedMessageId;
        }
        if (record.runId) {
            line << ",\"run_id\":" << *record.runId;
        }
        if (record.receiveTimestamp) {
            line << ",\"receive_timestamp\":" << *record.receiveTimestamp;
        }
        if (record.handleTimestamp) {
            line << ",\"handle_timestamp\":" << *record.handleTimestamp;
        }
        if (record.sendTimestamp) {
            line << ",\"send_timestamp\":" << *record.sendTimestamp;
        }
        if (record.portName) {
            line << ",\"port_name\":\"" << escapeJson(*record.portName) << "\"";
        }
        if (record.portDirection) {
            line << ",\"port_direction\":\"" << escapeJson(*record.portDirection) << "\"";
        }
        if (record.observableState) {
            line << ",\"observable_state\":\"" << escapeJson(*record.observableState) << "\"";
        }
        if (record.batteryPercent) {
            line << ",\"battery_percent\":" << *record.batteryPercent;
        }
        if (record.batteryLow) {
            line << ",\"battery_low\":" << (*record.batteryLow ? "true" : "false");
        }
        if (record.latencyBudgetMs) {
            line << ",\"latency_budget_ms\":" << *record.latencyBudgetMs;
        }
        if (record.latencyWarningMs) {
            line << ",\"latency_warning_ms\":" << *record.latencyWarningMs;
        }
        if (record.observedLatencyMs) {
            line << ",\"observed_latency_ms\":" << *record.observedLatencyMs;
        }
        if (record.latencyBudgetExceeded) {
            line << ",\"latency_budget_exceeded\":"
                 << (*record.latencyBudgetExceeded ? "true" : "false");
        }

        line << ",\"fault_actions\":[";
        for (size_t i = 0; i < record.faultActions.size(); ++i) {
            if (i > 0) {
                line << ",";
            }
            line << "\"" << escapeJson(record.faultActions[i]) << "\"";
        }
        line << "]";
        line << "}\n";

        out << line.str();
    }

    if (!out.good()) {
        return Result<void>::error("failed while writing trace output: " + path);
    }

    return Result<void>::ok();
}

const char* LocalTraceStore::messageTypeName(protocol::MessageType type) {
    using protocol::MessageType;
    switch (type) {
        case MessageType::Hello: return "hello";
        case MessageType::HelloAck: return "hello_ack";
        case MessageType::Discover: return "discover";
        case MessageType::Ping: return "ping";
        case MessageType::Pong: return "pong";
        case MessageType::Provision: return "provision";
        case MessageType::Goodbye: return "goodbye";
        case MessageType::LoadAutomata: return "load_automata";
        case MessageType::LoadAck: return "load_ack";
        case MessageType::Start: return "start";
        case MessageType::Stop: return "stop";
        case MessageType::Reset: return "reset";
        case MessageType::Status: return "status";
        case MessageType::Pause: return "pause";
        case MessageType::Resume: return "resume";
        case MessageType::Input: return "input";
        case MessageType::Output: return "output";
        case MessageType::Variable: return "variable";
        case MessageType::StateChange: return "state_change";
        case MessageType::Telemetry: return "telemetry";
        case MessageType::TransitionFired: return "transition_fired";
        case MessageType::Vendor: return "vendor";
        case MessageType::Debug: return "debug";
        case MessageType::Error: return "error";
        case MessageType::Ack: return "ack";
        case MessageType::Nak: return "nak";
        default: return "unknown";
    }
}

std::string LocalTraceStore::escapeJson(const std::string& input) {
    std::ostringstream out;
    for (char ch : input) {
        switch (ch) {
            case '\\':
                out << "\\\\";
                break;
            case '"':
                out << "\\\"";
                break;
            case '\n':
                out << "\\n";
                break;
            case '\r':
                out << "\\r";
                break;
            case '\t':
                out << "\\t";
                break;
            default:
                if (static_cast<unsigned char>(ch) < 0x20) {
                    out << "?";
                } else {
                    out << ch;
                }
                break;
        }
    }
    return out.str();
}

} // namespace aeth
