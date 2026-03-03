#ifndef AETHERIUM_EMBEDDED_ARDUINO_ESP32_SERIAL_LINK_HPP
#define AETHERIUM_EMBEDDED_ARDUINO_ESP32_SERIAL_LINK_HPP

#include "AetheriumAvrSerialLink.hpp"
#include "AetheriumEsp32Node.hpp"

namespace aeth::embedded::arduino {

class AetheriumEsp32SerialLink {
public:
#ifdef ARDUINO
    AetheriumEsp32SerialLink(AetheriumEsp32Node& node, Stream& stream)
        : link_(node, stream) {}
#else
    explicit AetheriumEsp32SerialLink(AetheriumEsp32Node& node)
        : link_(node) {}
#endif

#ifdef ARDUINO
    void attach(Stream& stream) { link_.attach(stream); }
#endif

    bool sendHello(const std::string& deviceNameOverride = {}) {
        SerialHelloOptions opts;
        opts.deviceType = protocol::DeviceType::ESP32;
        opts.deviceNameOverride = deviceNameOverride;
        return link_.sendHello(opts);
    }

    void poll() { link_.poll(); }

    [[nodiscard]] bool helloAcknowledged() const { return link_.helloAcknowledged(); }
    [[nodiscard]] uint32_t assignedId() const { return link_.assignedId(); }

private:
    AetheriumAvrSerialLink link_;
};

} // namespace aeth::embedded::arduino

#endif // AETHERIUM_EMBEDDED_ARDUINO_ESP32_SERIAL_LINK_HPP
