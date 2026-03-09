#ifndef AETHERIUM_CAPABILITIES_HPP
#define AETHERIUM_CAPABILITIES_HPP

#include "protocol.hpp"

namespace aeth {

struct EngineCapabilities {
    bool supportsLua = true;
    bool supportsTimed = true;
    bool supportsProbabilistic = true;
    bool supportsEvent = true;
    bool supportsFuzzy = false;
    bool supportsNested = false;
    bool supportsBytecode = false;
    bool hasPersistentStorage = false;
    bool hasRTC = false;

    protocol::DeviceCapabilities toProtocol() const {
        protocol::DeviceCapabilities caps;
        caps.setLua(supportsLua);
        caps.setTimed(supportsTimed);
        caps.setProbabilistic(supportsProbabilistic);
        caps.setFuzzy(supportsFuzzy);
        caps.setNested(supportsNested);
        caps.setBytecode(supportsBytecode);
        caps.setPersistentStorage(hasPersistentStorage);
        caps.setRTC(hasRTC);
        return caps;
    }
};

inline EngineCapabilities desktopCapabilities() {
    EngineCapabilities caps;
    caps.supportsLua = true;
    caps.supportsTimed = true;
    caps.supportsProbabilistic = true;
    caps.supportsEvent = true;
    caps.supportsFuzzy = true;
    caps.supportsNested = true;
    caps.supportsBytecode = true;
    caps.hasPersistentStorage = true;
    caps.hasRTC = true;
    return caps;
}

inline EngineCapabilities esp32Capabilities() {
    EngineCapabilities caps;
#if defined(AETHERIUM_DISABLE_LUA_SCRIPT_ENGINE)
    caps.supportsLua = false;
#else
    caps.supportsLua = true;
#endif
    caps.supportsTimed = true;
    caps.supportsProbabilistic = true;
    caps.supportsEvent = true;
    caps.supportsFuzzy = false;
    caps.supportsNested = false;
    caps.supportsBytecode = true;
    caps.hasPersistentStorage = true;
    caps.hasRTC = true;
    return caps;
}

inline EngineCapabilities avrUnoV1Capabilities() {
    EngineCapabilities caps;
    caps.supportsLua = false;
    caps.supportsTimed = true;
    caps.supportsProbabilistic = false;
    caps.supportsEvent = true;
    caps.supportsFuzzy = false;
    caps.supportsNested = false;
    caps.supportsBytecode = true;
    caps.hasPersistentStorage = false;
    caps.hasRTC = false;
    return caps;
}

inline EngineCapabilities picoCapabilities() {
    EngineCapabilities caps;
    caps.supportsLua = true;
    caps.supportsTimed = true;
    caps.supportsProbabilistic = true;
    caps.supportsEvent = true;
    caps.supportsFuzzy = false;
    caps.supportsNested = false;
    caps.supportsBytecode = true;
    caps.hasPersistentStorage = false;
    caps.hasRTC = false;
    return caps;
}

inline EngineCapabilities mcxn947Capabilities() {
    EngineCapabilities caps;
    caps.supportsLua = true;
    caps.supportsTimed = true;
    caps.supportsProbabilistic = true;
    caps.supportsEvent = true;
    caps.supportsFuzzy = false;
    caps.supportsNested = false;
    caps.supportsBytecode = true;
    caps.hasPersistentStorage = false;
    caps.hasRTC = false;
    return caps;
}

} // namespace aeth

#endif // AETHERIUM_CAPABILITIES_HPP
