#ifndef AETHERIUM_EMBEDDED_MCXN947_SERIAL_LINK_HPP
#define AETHERIUM_EMBEDDED_MCXN947_SERIAL_LINK_HPP

#include "AetheriumMcxn947Node.hpp"
#include "engine/core/capabilities.hpp"
#include "engine/core/protocol.hpp"

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace aeth::embedded::mcxn947 {

struct SerialHelloOptions {
    protocol::DeviceType deviceType = protocol::DeviceType::MCXN947;
    uint8_t versionMajor = 0;
    uint8_t versionMinor = 1;
    uint8_t versionPatch = 0;
    std::string deviceNameOverride;
    std::optional<protocol::DeviceCapabilities> capabilitiesOverride;
};

class AetheriumMcxn947SerialLink {
public:
    explicit AetheriumMcxn947SerialLink(AetheriumMcxn947Node& node)
        : node_(node) {}

    bool sendHello(const SerialHelloOptions& opts = {});
    void poll();

    [[nodiscard]] bool helloAcknowledged() const { return helloAcknowledged_; }
    [[nodiscard]] uint32_t assignedId() const { return assignedId_; }

private:
    void drainSerial();
    void writeFrame(const std::vector<uint8_t>& bytes);
    void maybeFlushEngineEvents();
    void maybeSendHelloRetry();
    void maybeSendKeepAlive();
    void processRxBuffer();
    void handleFrame(const uint8_t* data, size_t len);
    void sendReplies(Engine::Replies replies);
    void stampOutgoing(protocol::Message& msg);

    AetheriumMcxn947Node& node_;
    std::vector<uint8_t> rxBuffer_;
    std::atomic<uint32_t> nextMessageId_{1};
    std::atomic<uint32_t> assignedId_{0};
    SerialHelloOptions helloOptions_{};
    uint32_t keepAliveSequence_ = 1;
    uint32_t lastKeepAliveSentMs_ = 0;
    uint32_t lastEventFlushMs_ = 0;
    uint32_t lastHelloSentMs_ = 0;
    uint32_t lastInboundFrameMs_ = 0;
    bool helloAcknowledged_ = false;
};

} // namespace aeth::embedded::mcxn947

#endif // AETHERIUM_EMBEDDED_MCXN947_SERIAL_LINK_HPP
