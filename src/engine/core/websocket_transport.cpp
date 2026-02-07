/**
 * Aetherium Automata - WebSocket Transport Implementation
 */

#include "websocket_transport.hpp"
#include <iostream>
#include <chrono>
#include <thread>

namespace aeth {

WebSocketTransport::WebSocketTransport(const std::string& url)
    : url_(url), deviceName_("cpp-engine") {
    
    // Generate a simple device ID
    auto now = std::chrono::system_clock::now();
    auto epoch = now.time_since_epoch();
    auto millis = std::chrono::duration_cast<std::chrono::milliseconds>(epoch).count();
    deviceId_ = "device-" + std::to_string(millis % 1000000);
}

WebSocketTransport::~WebSocketTransport() {
    disconnect();
}

Result<void> WebSocketTransport::connect() {
    if (state_ == TransportState::Connected) {
        return Result<void>::ok();
    }
    
    state_ = TransportState::Connecting;
    notifyStateChange(state_);
    
    // Set up WebSocket callbacks
    ws_.setUrl(url_);
    
    ws_.setOnMessageCallback([this](const ix::WebSocketMessagePtr& msg) {
        onMessage(msg);
    });
    
    // Configure WebSocket
    ws_.setPingInterval(30);  // Ping every 30 seconds
    ws_.enableAutomaticReconnection();
    ws_.setMaxWaitBetweenReconnectionRetries(5000);  // 5 seconds max
    
    // Start connection (auto-reconnect will keep trying even if the server is down)
    ws_.start();

    // Best-effort wait for initial connection (don't treat timeout as fatal)
    int attempts = 0;
    while (ws_.getReadyState() != ix::ReadyState::Open && attempts < 20) {
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
        attempts++;
    }

    if (ws_.getReadyState() == ix::ReadyState::Open) {
        state_ = TransportState::Connected;
        notifyStateChange(state_);
        sendHello();
        std::cout << "[WS] Connected to " << url_ << std::endl;
    } else {
        state_ = TransportState::Connecting;
        notifyStateChange(state_);
        std::cout << "[WS] Connecting to " << url_ << " (will retry)" << std::endl;
    }

    return Result<void>::ok();
}

void WebSocketTransport::disconnect() {
    if (state_ == TransportState::Disconnected) {
        return;
    }
    
    ws_.stop();
    state_ = TransportState::Disconnected;
    notifyStateChange(state_);
    
    std::cout << "[WS] Disconnected" << std::endl;
}

void WebSocketTransport::onMessage(const ix::WebSocketMessagePtr& msg) {
    switch (msg->type) {
        case ix::WebSocketMessageType::Open:
            std::cout << "[WS] Connection opened" << std::endl;
            state_ = TransportState::Connected;
            notifyStateChange(state_);
            sendHello();
            break;
            
        case ix::WebSocketMessageType::Close:
            std::cout << "[WS] Connection closed: " << msg->closeInfo.reason << std::endl;
            state_ = TransportState::Disconnected;
            notifyStateChange(state_);
            break;
            
        case ix::WebSocketMessageType::Error:
            std::cerr << "[WS] Error: " << msg->errorInfo.reason << std::endl;
            state_ = TransportState::Error;
            notifyStateChange(state_);
            break;
            
        case ix::WebSocketMessageType::Message:
            if (msg->binary) {
                handleBinaryMessage(msg->str);
            } else {
                // Text message - could be JSON from Phoenix
                std::cout << "[WS] Text: " << msg->str << std::endl;
            }
            break;
            
        case ix::WebSocketMessageType::Ping:
        case ix::WebSocketMessageType::Pong:
        case ix::WebSocketMessageType::Fragment:
            // Handled automatically
            break;
    }
}

void WebSocketTransport::handleBinaryMessage(const std::string& data) {
    if (data.empty()) return;
    
    auto message = protocol::MessageFactory::deserialize(
        reinterpret_cast<const uint8_t*>(data.data()), 
        data.size()
    );
    
    if (message) {
        if (message->type() == protocol::MessageType::HelloAck) {
            if (auto* ack = dynamic_cast<protocol::HelloAckMessage*>(message.get())) {
                assignedId_ = ack->assignedId;
            }
        }
        std::lock_guard<std::mutex> lock(mutex_);
        inQueue_.push(std::move(message));
        cv_.notify_one();
    } else {
        std::cerr << "[WS] Failed to deserialize message, size=" << data.size() << std::endl;
    }
}

void WebSocketTransport::sendHello() {
    protocol::HelloMessage hello;
    hello.messageId = nextMsgId_++;
    hello.deviceType = protocol::DeviceType::Desktop;
    hello.versionMajor = 0;
    hello.versionMinor = 2;
    hello.versionPatch = 0;
    hello.name = deviceName_;
    hello.capabilities.setLua(true);
    hello.capabilities.setTimed(true);
    hello.capabilities.setProbabilistic(true);
    
    send(std::make_unique<protocol::HelloMessage>(hello));
}

bool WebSocketTransport::send(std::unique_ptr<protocol::Message> msg) {
    if (!isConnected()) {
        return false;
    }

    if (msg->messageId == 0) {
        msg->messageId = nextMsgId_++;
    }
    if (msg->sourceId == 0 && assignedId_ != 0 && msg->type() != protocol::MessageType::Hello) {
        msg->sourceId = assignedId_;
    }
    
    auto bytes = msg->serialize();
    return sendRaw(bytes.data(), bytes.size());
}

bool WebSocketTransport::sendRaw(const uint8_t* data, size_t len) {
    if (!isConnected()) {
        return false;
    }
    
    std::string payload(reinterpret_cast<const char*>(data), len);
    auto result = ws_.sendBinary(payload);
    
    return result.success;
}

std::unique_ptr<protocol::Message> WebSocketTransport::receive() {
    std::lock_guard<std::mutex> lock(mutex_);
    
    if (inQueue_.empty()) {
        return nullptr;
    }
    
    auto msg = std::move(inQueue_.front());
    inQueue_.pop();
    return msg;
}

bool WebSocketTransport::hasMessage() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return !inQueue_.empty();
}

std::string WebSocketTransport::info() const {
    return "WebSocket Transport: " + url_;
}

} // namespace aeth
