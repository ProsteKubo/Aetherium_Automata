#ifndef AETHERIUM_EMBEDDED_MCXN947_PLATFORM_HPP
#define AETHERIUM_EMBEDDED_MCXN947_PLATFORM_HPP

#include "engine/core/types.hpp"

#include <cstddef>
#include <cstdint>

namespace aeth::embedded::mcxn947 {

struct UartConfig {
    uint32_t baudRate = 115200;
};

constexpr int encodePin(int port, int pin) { return (port * 32) + pin; }

Result<void> initializePlatform(const UartConfig& uart = {});
Timestamp millis();
void delayMs(uint32_t ms);
void yieldIfNeeded();

bool decodePin(int encodedPin, int& port, int& pin);
bool uartReadByte(uint8_t& byte);
void uartWrite(const uint8_t* data, size_t len);
void setStatusLed(bool on);

} // namespace aeth::embedded::mcxn947

#endif // AETHERIUM_EMBEDDED_MCXN947_PLATFORM_HPP
