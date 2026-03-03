#include "AetheriumAvrSerialLink.hpp"

#include <algorithm>

namespace aeth::embedded::arduino {

#ifdef ARDUINO
namespace {
constexpr uint32_t kHelloRetryIntervalMs = 3'000;
constexpr uint32_t kHelloRefreshIntervalMs = 15'000;
constexpr uint32_t kKeepAliveIntervalMs = 10'000;
constexpr uint32_t kEngineEventFlushIntervalMs = 100;

protocol::DeviceCapabilities defaultCapabilitiesForDeviceType(protocol::DeviceType deviceType) {
    switch (deviceType) {
        case protocol::DeviceType::ESP32:
            return esp32Capabilities().toProtocol();
        case protocol::DeviceType::Desktop:
            return desktopCapabilities().toProtocol();
        case protocol::DeviceType::Pico:
            return picoCapabilities().toProtocol();
        case protocol::DeviceType::Arduino:
            return avrUnoV1Capabilities().toProtocol();
        default:
            return avrUnoV1Capabilities().toProtocol();
    }
}
}
#endif

#ifdef ARDUINO
AetheriumAvrSerialLink::AetheriumAvrSerialLink(AetheriumAvrNode& node, Stream& stream)
    : node_(node)
    , stream_(&stream) {}
#else
AetheriumAvrSerialLink::AetheriumAvrSerialLink(AetheriumAvrNode& node)
    : node_(node) {}
#endif

#ifdef ARDUINO
void AetheriumAvrSerialLink::attach(Stream& stream) {
    stream_ = &stream;
    helloAcknowledged_ = false;
    lastKeepAliveSentMs_ = 0;
    lastEventFlushMs_ = 0;
    lastHelloSentMs_ = 0;
    lastInboundFrameMs_ = 0;
}
#endif

bool AetheriumAvrSerialLink::sendHello(const SerialHelloOptions& opts) {
#ifndef ARDUINO
    (void) opts;
    return false;
#else
    if (!stream_) {
        return false;
    }

    helloOptions_ = opts;

    protocol::HelloMessage hello;
    hello.messageId = nextMessageId_++;
    hello.sourceId = 0;
    hello.targetId = 0;
    hello.deviceType = helloOptions_.deviceType;
    hello.versionMajor = helloOptions_.versionMajor;
    hello.versionMinor = helloOptions_.versionMinor;
    hello.versionPatch = helloOptions_.versionPatch;
    hello.name = helloOptions_.deviceNameOverride.empty() ? node_.engine().deviceName() : helloOptions_.deviceNameOverride;
    hello.capabilities = helloOptions_.capabilitiesOverride.value_or(defaultCapabilitiesForDeviceType(helloOptions_.deviceType));

    writeFrame(hello.serialize());
    helloAcknowledged_ = false;
    lastKeepAliveSentMs_ = 0;
    lastHelloSentMs_ = static_cast<uint32_t>(::millis());
    return true;
#endif
}

void AetheriumAvrSerialLink::poll() {
#ifdef ARDUINO
    drainSerial();
    processRxBuffer();
    maybeFlushEngineEvents();
    maybeSendHelloRetry();
    maybeSendKeepAlive();
#endif
}

#ifdef ARDUINO
void AetheriumAvrSerialLink::drainSerial() {
    if (!stream_) {
        return;
    }

    while (stream_->available() > 0) {
        const int b = stream_->read();
        if (b < 0) {
            break;
        }
        rxBuffer_.push_back(static_cast<uint8_t>(b));
        if (rxBuffer_.size() > protocol::MAX_MESSAGE_SIZE * 2) {
            // Hard guard against unbounded growth on malformed input.
            rxBuffer_.erase(rxBuffer_.begin(), rxBuffer_.begin() + static_cast<std::ptrdiff_t>(rxBuffer_.size() / 2));
        }
    }
}

void AetheriumAvrSerialLink::writeFrame(const std::vector<uint8_t>& bytes) {
    if (!stream_ || bytes.empty()) {
        return;
    }
    stream_->write(bytes.data(), bytes.size());
}

void AetheriumAvrSerialLink::maybeFlushEngineEvents() {
    if (!stream_ || !helloAcknowledged_) {
        return;
    }

    const uint32_t now = static_cast<uint32_t>(::millis());
    if (lastEventFlushMs_ != 0 && (now - lastEventFlushMs_) < kEngineEventFlushIntervalMs) {
        return;
    }

    sendReplies(node_.engine().processCommandQueue());
    lastEventFlushMs_ = now;
}

void AetheriumAvrSerialLink::maybeSendHelloRetry() {
    if (!stream_) {
        return;
    }

    const uint32_t now = static_cast<uint32_t>(::millis());
    if (helloAcknowledged_) {
        // Healthy sessions receive periodic replies (pong/status); only refresh hello
        // when inbound traffic goes stale, e.g. after server restart.
        if (lastInboundFrameMs_ != 0 && (now - lastInboundFrameMs_) < kHelloRefreshIntervalMs) {
            return;
        }
    } else if (lastHelloSentMs_ != 0 && (now - lastHelloSentMs_) < kHelloRetryIntervalMs) {
        return;
    }

    (void) sendHello(helloOptions_);
}

void AetheriumAvrSerialLink::maybeSendKeepAlive() {
    if (!stream_ || !helloAcknowledged_) {
        return;
    }

    const uint32_t now = static_cast<uint32_t>(::millis());
    if (lastKeepAliveSentMs_ != 0 && (now - lastKeepAliveSentMs_) < kKeepAliveIntervalMs) {
        return;
    }

    protocol::PingMessage ping;
    ping.messageId = nextMessageId_++;
    ping.sourceId = assignedId_;
    ping.targetId = 0;
    ping.timestamp = now;
    ping.sequenceNumber = keepAliveSequence_++;

    writeFrame(ping.serialize());
    lastKeepAliveSentMs_ = now;
}
#endif

void AetheriumAvrSerialLink::processRxBuffer() {
    while (true) {
        if (rxBuffer_.size() < protocol::HEADER_SIZE) {
            return;
        }

        // Resync to magic if needed.
        if (!(rxBuffer_[0] == static_cast<uint8_t>((protocol::MAGIC >> 8) & 0xFF) &&
              rxBuffer_[1] == static_cast<uint8_t>(protocol::MAGIC & 0xFF))) {
            rxBuffer_.erase(rxBuffer_.begin());
            continue;
        }

        const uint16_t payloadLen =
            (static_cast<uint16_t>(rxBuffer_[4]) << 8) |
            static_cast<uint16_t>(rxBuffer_[5]);
        const size_t totalLen = protocol::HEADER_SIZE + static_cast<size_t>(payloadLen);

        if (totalLen > protocol::MAX_MESSAGE_SIZE) {
            rxBuffer_.erase(rxBuffer_.begin());
            continue;
        }
        if (rxBuffer_.size() < totalLen) {
            return;
        }

        handleFrame(rxBuffer_.data(), totalLen);
        rxBuffer_.erase(rxBuffer_.begin(), rxBuffer_.begin() + static_cast<std::ptrdiff_t>(totalLen));
    }
}

void AetheriumAvrSerialLink::handleFrame(const uint8_t* data, size_t len) {
    auto msg = protocol::MessageFactory::deserialize(data, len);
    if (!msg) {
        return;
    }

    lastInboundFrameMs_ = static_cast<uint32_t>(::millis());

    if (msg->type() == protocol::MessageType::HelloAck) {
        auto* ack = static_cast<protocol::HelloAckMessage*>(msg.get());
        if (ack->accepted) {
            assignedId_ = ack->assignedId;
            helloAcknowledged_ = true;
            lastKeepAliveSentMs_ = 0;
        } else {
            helloAcknowledged_ = false;
            lastKeepAliveSentMs_ = 0;
        }
        lastHelloSentMs_ = static_cast<uint32_t>(::millis());
        return;
    }

    node_.engine().enqueueCommand(std::move(msg));
    sendReplies(node_.engine().processCommandQueue());
}

void AetheriumAvrSerialLink::sendReplies(Engine::Replies replies) {
#ifndef ARDUINO
    (void) replies;
#else
    if (!stream_) {
        return;
    }

    for (auto& msg : replies) {
        if (!msg) continue;
        stampOutgoing(*msg);
        writeFrame(msg->serialize());
    }
#endif
}

void AetheriumAvrSerialLink::stampOutgoing(protocol::Message& msg) {
    if (msg.messageId == 0) {
        msg.messageId = nextMessageId_++;
    }
    if (msg.sourceId == 0 && assignedId_ != 0 && msg.type() != protocol::MessageType::Hello) {
        msg.sourceId = assignedId_;
    }
}

} // namespace aeth::embedded::arduino
