#include "AetheriumMcxn947SerialLink.hpp"

#include "AetheriumMcxn947Platform.hpp"

#include <cstddef>

namespace aeth::embedded::mcxn947 {

namespace {

constexpr uint32_t kHelloRetryIntervalMs = 3'000;
constexpr uint32_t kHelloRefreshIntervalMs = 15'000;
constexpr uint32_t kKeepAliveIntervalMs = 10'000;
constexpr uint32_t kEngineEventFlushIntervalMs = 100;

protocol::DeviceCapabilities defaultCapabilities() {
    return mcxn947Capabilities().toProtocol();
}

} // namespace

bool AetheriumMcxn947SerialLink::sendHello(const SerialHelloOptions& opts) {
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
    hello.capabilities = helloOptions_.capabilitiesOverride.value_or(defaultCapabilities());

    writeFrame(hello.serialize());
    helloAcknowledged_ = false;
    lastKeepAliveSentMs_ = 0;
    lastHelloSentMs_ = static_cast<uint32_t>(millis());
    return true;
}

void AetheriumMcxn947SerialLink::poll() {
    drainSerial();
    processRxBuffer();
    maybeFlushEngineEvents();
    maybeSendHelloRetry();
    maybeSendKeepAlive();
}

void AetheriumMcxn947SerialLink::drainSerial() {
    uint8_t byte = 0;
    while (uartReadByte(byte)) {
        rxBuffer_.push_back(byte);
        if (rxBuffer_.size() > protocol::MAX_MESSAGE_SIZE * 2) {
            rxBuffer_.erase(rxBuffer_.begin(), rxBuffer_.begin() + static_cast<std::ptrdiff_t>(rxBuffer_.size() / 2));
        }
    }
}

void AetheriumMcxn947SerialLink::writeFrame(const std::vector<uint8_t>& bytes) {
    if (!bytes.empty()) {
        uartWrite(bytes.data(), bytes.size());
    }
}

void AetheriumMcxn947SerialLink::maybeFlushEngineEvents() {
    if (!helloAcknowledged_) {
        return;
    }

    const uint32_t now = static_cast<uint32_t>(millis());
    if (lastEventFlushMs_ != 0 && (now - lastEventFlushMs_) < kEngineEventFlushIntervalMs) {
        return;
    }

    sendReplies(node_.engine().processCommandQueue());
    lastEventFlushMs_ = now;
}

void AetheriumMcxn947SerialLink::maybeSendHelloRetry() {
    const uint32_t now = static_cast<uint32_t>(millis());
    if (helloAcknowledged_) {
        if (lastInboundFrameMs_ != 0 && (now - lastInboundFrameMs_) < kHelloRefreshIntervalMs) {
            return;
        }
    } else if (lastHelloSentMs_ != 0 && (now - lastHelloSentMs_) < kHelloRetryIntervalMs) {
        return;
    }

    (void) sendHello(helloOptions_);
}

void AetheriumMcxn947SerialLink::maybeSendKeepAlive() {
    if (!helloAcknowledged_) {
        return;
    }

    const uint32_t now = static_cast<uint32_t>(millis());
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

void AetheriumMcxn947SerialLink::processRxBuffer() {
    while (true) {
        if (rxBuffer_.size() < protocol::HEADER_SIZE) {
            return;
        }

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

void AetheriumMcxn947SerialLink::handleFrame(const uint8_t* data, size_t len) {
    auto msg = protocol::MessageFactory::deserialize(data, len);
    if (!msg) {
        return;
    }

    lastInboundFrameMs_ = static_cast<uint32_t>(millis());

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
        lastHelloSentMs_ = static_cast<uint32_t>(millis());
        return;
    }

    node_.engine().enqueueCommand(std::move(msg));
    sendReplies(node_.engine().processCommandQueue());
}

void AetheriumMcxn947SerialLink::sendReplies(Engine::Replies replies) {
    for (auto& msg : replies) {
        if (!msg) {
            continue;
        }
        stampOutgoing(*msg);
        writeFrame(msg->serialize());
    }
}

void AetheriumMcxn947SerialLink::stampOutgoing(protocol::Message& msg) {
    if (msg.messageId == 0) {
        msg.messageId = nextMessageId_++;
    }
    if (msg.sourceId == 0 && assignedId_ != 0 && msg.type() != protocol::MessageType::Hello) {
        msg.sourceId = assignedId_;
    }
}

} // namespace aeth::embedded::mcxn947
