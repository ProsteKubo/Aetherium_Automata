#ifndef AETHERIUM_EMBEDDED_MCXN947_NODE_HPP
#define AETHERIUM_EMBEDDED_MCXN947_NODE_HPP

#include "AetheriumMcxn947Hardware.hpp"
#include "engine/embedded/arduino/AetheriumAvrNode.hpp"

namespace aeth::embedded::mcxn947 {

using Mcxn947NodeOptions = aeth::embedded::arduino::AvrNodeOptions;

class AetheriumMcxn947Node : public aeth::embedded::arduino::AetheriumAvrNode {
public:
    explicit AetheriumMcxn947Node(const Mcxn947NodeOptions& options = {})
        : aeth::embedded::arduino::AetheriumAvrNode(options) {
        setHardwareService(&hardware_);
    }

    Mcxn947HardwareService& hardware() { return hardware_; }
    const Mcxn947HardwareService& hardware() const { return hardware_; }

private:
    Mcxn947HardwareService hardware_;
};

} // namespace aeth::embedded::mcxn947

#endif // AETHERIUM_EMBEDDED_MCXN947_NODE_HPP
