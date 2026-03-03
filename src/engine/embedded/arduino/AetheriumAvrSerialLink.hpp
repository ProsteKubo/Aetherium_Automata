#ifndef AETHERIUM_EMBEDDED_ARDUINO_AVR_SERIAL_LINK_HPP
#define AETHERIUM_EMBEDDED_ARDUINO_AVR_SERIAL_LINK_HPP

#include "AetheriumAvrNode.hpp"
#include "engine/core/capabilities.hpp"
#include "engine/core/protocol.hpp"

#ifdef ARDUINO
#include <Arduino.h>
#endif

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace aeth::embedded::arduino {

struct SerialHelloOptions {
    protocol::DeviceType deviceType = protocol::DeviceType::Arduino;
    uint8_t versionMajor = 0;
    uint8_t versionMinor = 2;
    uint8_t versionPatch = 0;
    std::string deviceNameOverride;
    std::optional<protocol::DeviceCapabilities> capabilitiesOverride;
};

class AetheriumAvrSerialLink {
public:
#ifdef ARDUINO
    AetheriumAvrSerialLink(AetheriumAvrNode& node, Stream& stream);
#else
    explicit AetheriumAvrSerialLink(AetheriumAvrNode& node);
#endif

#ifdef ARDUINO
    void attach(Stream& stream);
#endif

    bool sendHello(const SerialHelloOptions& opts = {});
    void poll();

    [[nodiscard]] bool helloAcknowledged() const { return helloAcknowledged_; }
    [[nodiscard]] uint32_t assignedId() const { return assignedId_; }

private:
#ifdef ARDUINO
    void drainSerial();
    void writeFrame(const std::vector<uint8_t>& bytes);
    void maybeFlushEngineEvents();
    void maybeSendHelloRetry();
    void maybeSendKeepAlive();
#endif
    void processRxBuffer();
    void handleFrame(const uint8_t* data, size_t len);
    void sendReplies(Engine::Replies replies);
    void stampOutgoing(protocol::Message& msg);

    AetheriumAvrNode& node_;
#ifdef ARDUINO
    Stream* stream_ = nullptr;
#endif
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

} // namespace aeth::embedded::arduino

#endif // AETHERIUM_EMBEDDED_ARDUINO_AVR_SERIAL_LINK_HPP
