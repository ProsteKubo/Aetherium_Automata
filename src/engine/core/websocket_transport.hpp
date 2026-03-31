/**
 * Aetherium Automata - WebSocket Transport
 * 
 * Connects C++ engine to Elixir server via WebSocket.
 */

#ifndef AETHERIUM_WEBSOCKET_TRANSPORT_HPP
#define AETHERIUM_WEBSOCKET_TRANSPORT_HPP

#include "transport.hpp"
#include <ixwebsocket/IXWebSocket.h>
#include <queue>
#include <mutex>
#include <condition_variable>
#include <atomic>

namespace aeth {

/**
 * WebSocket transport for server communication
 */
class WebSocketTransport : public ITransport {
public:
    WebSocketTransport(const std::string& url);
    ~WebSocketTransport() override;

    // ITransport interface
    Result<void> connect() override;
    void disconnect() override;
    [[nodiscard]] TransportState state() const override { return state_; }

    bool send(std::unique_ptr<protocol::Message> msg) override;
    bool sendRaw(const uint8_t* data, size_t len) override;
    std::unique_ptr<protocol::Message> receive() override;
    [[nodiscard]] bool hasMessage() const override;

    [[nodiscard]] std::string info() const override;
    [[nodiscard]] std::string name() const override { return "websocket"; }

    // WebSocket specific
    void setDeviceId(const std::string& deviceId) { deviceId_ = deviceId; }
    void setDeviceName(const std::string& name) { deviceName_ = name; }
    void setHelloDeploymentMetadata(protocol::DeploymentMetadataExtension deployment) {
        helloDeployment_ = std::move(deployment);
    }
    void setAssignedId(uint32_t id) { assignedId_ = id; }
    [[nodiscard]] uint32_t assignedId() const { return assignedId_; }

private:
    void onMessage(const ix::WebSocketMessagePtr& msg);
    void handleBinaryMessage(const std::string& data);
    void sendHello();

    ix::WebSocket ws_;
    std::string url_;
    std::string deviceId_;
    std::string deviceName_;
    protocol::DeploymentMetadataExtension helloDeployment_;
    
    std::atomic<TransportState> state_{TransportState::Disconnected};
    
    std::queue<std::unique_ptr<protocol::Message>> inQueue_;
    mutable std::mutex mutex_;
    std::condition_variable cv_;

    std::atomic<uint32_t> nextMsgId_{1};
    std::atomic<uint32_t> assignedId_{0};
    std::atomic<bool> shuttingDown_{false};
};

} // namespace aeth

#endif // AETHERIUM_WEBSOCKET_TRANSPORT_HPP
