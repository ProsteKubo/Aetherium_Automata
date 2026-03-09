#ifndef AETHERIUM_EMBEDDED_ARDUINO_ESP32_NODE_HPP
#define AETHERIUM_EMBEDDED_ARDUINO_ESP32_NODE_HPP

#include "AetheriumAvrNode.hpp"
#include "AetheriumEsp32Hardware.hpp"
#include "engine/core/hardware_service.hpp"

namespace aeth::embedded::arduino {

using Esp32NodeOptions = AvrNodeOptions;

class AetheriumEsp32Node : public AetheriumAvrNode {
public:
    explicit AetheriumEsp32Node(const Esp32NodeOptions& options = {})
        : AetheriumAvrNode(options) {
        setHardwareService(&hardware_);
    }

    Esp32HardwareService& hardware() { return hardware_; }
    const Esp32HardwareService& hardware() const { return hardware_; }

private:
    Esp32HardwareService hardware_;
};

} // namespace aeth::embedded::arduino

#endif // AETHERIUM_EMBEDDED_ARDUINO_ESP32_NODE_HPP
