#ifndef AETHERIUM_EMBEDDED_PLATFORM_HOOKS_HPP
#define AETHERIUM_EMBEDDED_PLATFORM_HOOKS_HPP

#include "engine/core/runtime.hpp"

#include <cstdint>

#ifdef ARDUINO
#include <Arduino.h>
#endif

namespace aeth::embedded::platform {

#ifdef ARDUINO
inline Timestamp millis() {
    return static_cast<Timestamp>(::millis());
}

inline void delayMs(uint32_t ms) {
    ::delay(ms);
}

inline void yieldIfNeeded() {
    yield();
}
#elif defined(AETHERIUM_PLATFORM_MCXN947)
Timestamp millis();
void delayMs(uint32_t ms);
void yieldIfNeeded();
#else
inline Timestamp millis() { return 0; }
inline void delayMs(uint32_t ms) { (void) ms; }
inline void yieldIfNeeded() {}
#endif

} // namespace aeth::embedded::platform

#endif // AETHERIUM_EMBEDDED_PLATFORM_HOOKS_HPP
