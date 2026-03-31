/**
 * Aetherium Automata - Transport Layer
 * 
 * Abstract transport for communication with server/gateway.
 * Implementations: Console (testing), MQTT, Serial, WebSocket
 */

#ifndef AETHERIUM_TRANSPORT_HPP
#define AETHERIUM_TRANSPORT_HPP

#include "compat_mutex.hpp"
#include "types.hpp"
#include "protocol.hpp"
#include <queue>
#include <functional>
#include <memory>

namespace aeth {

// Forward declarations
class ExecutionContext;

// ============================================================================
// Transport State
// ============================================================================

enum class TransportState {
    Disconnected,
    Connecting,
    Connected,
    Error
};

// ============================================================================
// Transport Interface
// ============================================================================

/**
 * Callback for received messages
 */
using MessageCallback = std::function<void(std::unique_ptr<protocol::Message>)>;

/**
 * Abstract transport interface
 */
class ITransport {
public:
    virtual ~ITransport() = default;

    // ========================================================================
    // Connection
    // ========================================================================

    virtual Result<void> connect() = 0;
    virtual void disconnect() = 0;
    [[nodiscard]] virtual TransportState state() const = 0;
    [[nodiscard]] virtual bool isConnected() const {
        return state() == TransportState::Connected;
    }

    // ========================================================================
    // Messaging
    // ========================================================================

    /**
     * Send a message. Non-blocking.
     * Returns false if transport is not connected or queue is full.
     */
    virtual bool send(std::unique_ptr<protocol::Message> msg) = 0;

    /**
     * Send raw bytes (for testing/low-level)
     */
    virtual bool sendRaw(const uint8_t* data, size_t len) = 0;

    /**
     * Poll for incoming messages. Call regularly.
     * Returns received message or nullptr if none available.
     */
    virtual std::unique_ptr<protocol::Message> receive() = 0;

    /**
     * Check if there are messages waiting
     */
    [[nodiscard]] virtual bool hasMessage() const = 0;

    // ========================================================================
    // Async callbacks (optional)
    // ========================================================================

    /**
     * Set callback for received messages (alternative to polling)
     */
    virtual void onMessage(MessageCallback callback) {
        messageCallback_ = std::move(callback);
    }

    /**
     * Set callback for connection state changes
     */
    virtual void onStateChange(std::function<void(TransportState)> callback) {
        stateCallback_ = std::move(callback);
    }

    // ========================================================================
    // Info
    // ========================================================================

    [[nodiscard]] virtual std::string info() const = 0;
    [[nodiscard]] virtual std::string name() const = 0;

protected:
    MessageCallback messageCallback_;
    std::function<void(TransportState)> stateCallback_;

    void notifyMessage(std::unique_ptr<protocol::Message> msg) {
        if (messageCallback_) {
            messageCallback_(std::move(msg));
        }
    }

    void notifyStateChange(TransportState newState) {
        if (stateCallback_) {
            stateCallback_(newState);
        }
    }
};

// ============================================================================
// Console Transport (for testing)
// ============================================================================

/**
 * Simple transport using stdin/stdout for testing
 */
class ConsoleTransport : public ITransport {
public:
    ConsoleTransport() = default;

    Result<void> connect() override;
    void disconnect() override;
    [[nodiscard]] TransportState state() const override { return state_; }

    bool send(std::unique_ptr<protocol::Message> msg) override;
    bool sendRaw(const uint8_t* data, size_t len) override;
    std::unique_ptr<protocol::Message> receive() override;
    [[nodiscard]] bool hasMessage() const override;

    [[nodiscard]] std::string info() const override { return "Console Transport"; }
    [[nodiscard]] std::string name() const override { return "console"; }

    // Testing helpers
    void injectMessage(std::unique_ptr<protocol::Message> msg);
    void injectInput(const std::string& line);

private:
    TransportState state_ = TransportState::Disconnected;
    std::queue<std::unique_ptr<protocol::Message>> inQueue_;
    std::queue<std::string> inputLines_;
    mutable compat::Mutex mutex_;
};

// ============================================================================
// Message Router
// ============================================================================

/**
 * Routes messages to appropriate handlers based on type
 */
class MessageRouter {
public:
    using Handler = std::function<void(protocol::Message&)>;

    void registerHandler(protocol::MessageType type, Handler handler) {
        handlers_[type] = std::move(handler);
    }

    void route(protocol::Message& msg) {
        auto it = handlers_.find(msg.type());
        if (it != handlers_.end()) {
            it->second(msg);
        } else if (defaultHandler_) {
            defaultHandler_(msg);
        }
    }

    void setDefaultHandler(Handler handler) {
        defaultHandler_ = std::move(handler);
    }

private:
    std::unordered_map<protocol::MessageType, Handler> handlers_;
    Handler defaultHandler_;
};

// ============================================================================
// Device Client
// ============================================================================

/**
 * Client that manages device communication with server
 */
class DeviceClient {
public:
    DeviceClient(std::unique_ptr<ITransport> transport, 
                 protocol::DeviceType deviceType,
                 const std::string& deviceName);

    // Connection management
    Result<void> connect();
    void disconnect();
    [[nodiscard]] bool isConnected() const;
    [[nodiscard]] DeviceId deviceId() const { return deviceId_; }

    // Messaging
    bool sendOutput(const std::string& varName, const Value& value, RunId runId);
    bool sendStateChange(StateId from, StateId to, TransitionId via, RunId runId);
    bool sendStatus(const ExecutionContext& ctx);
    bool sendTelemetry(const ExecutionContext& ctx);
    bool sendError(protocol::ErrorCode code, const std::string& message);

    // Receiving
    void poll();  // Call regularly to process incoming messages

    // Handlers
    void onLoadAutomata(std::function<void(const protocol::LoadAutomataMessage&)> handler);
    void onStart(std::function<void(const protocol::StartMessage&)> handler);
    void onStop(std::function<void(const protocol::StopMessage&)> handler);
    void onInput(std::function<void(const protocol::InputMessage&)> handler);
    void onPing(std::function<void(const protocol::PingMessage&)> handler);

private:
    void handleHelloAck(protocol::Message& msg);
    void handlePing(protocol::Message& msg);

    std::unique_ptr<ITransport> transport_;
    MessageRouter router_;
    
    protocol::DeviceType deviceType_;
    std::string deviceName_;
    DeviceId deviceId_ = 0;
    uint32_t nextMessageId_ = 1;
    
    // Handlers
    std::function<void(const protocol::LoadAutomataMessage&)> loadHandler_;
    std::function<void(const protocol::StartMessage&)> startHandler_;
    std::function<void(const protocol::StopMessage&)> stopHandler_;
    std::function<void(const protocol::InputMessage&)> inputHandler_;
    std::function<void(const protocol::PingMessage&)> pingHandler_;
};

// ============================================================================
// Implementation: ConsoleTransport
// ============================================================================

inline Result<void> ConsoleTransport::connect() {
    state_ = TransportState::Connected;
    notifyStateChange(state_);
    return Result<void>::ok();
}

inline void ConsoleTransport::disconnect() {
    state_ = TransportState::Disconnected;
    notifyStateChange(state_);
}

inline bool ConsoleTransport::send(std::unique_ptr<protocol::Message> msg) {
    if (!isConnected()) return false;
    
    auto bytes = msg->serialize();
    // For console, just print a summary
    std::printf("[OUT] Type: 0x%02X, Size: %zu\n", 
                static_cast<uint8_t>(msg->type()), bytes.size());
    return true;
}

inline bool ConsoleTransport::sendRaw(const uint8_t* data, size_t len) {
    if (!isConnected()) return false;
    
    std::printf("[RAW] Size: %zu bytes\n", len);
    return true;
}

inline std::unique_ptr<protocol::Message> ConsoleTransport::receive() {
    compat::LockGuard<compat::Mutex> lock(mutex_);
    
    if (inQueue_.empty()) return nullptr;
    
    auto msg = std::move(inQueue_.front());
    inQueue_.pop();
    return msg;
}

inline bool ConsoleTransport::hasMessage() const {
    compat::LockGuard<compat::Mutex> lock(mutex_);
    return !inQueue_.empty();
}

inline void ConsoleTransport::injectMessage(std::unique_ptr<protocol::Message> msg) {
    compat::LockGuard<compat::Mutex> lock(mutex_);
    inQueue_.push(std::move(msg));
}

inline void ConsoleTransport::injectInput(const std::string& line) {
    compat::LockGuard<compat::Mutex> lock(mutex_);
    inputLines_.push(line);
}

} // namespace aeth

#endif // AETHERIUM_TRANSPORT_HPP
