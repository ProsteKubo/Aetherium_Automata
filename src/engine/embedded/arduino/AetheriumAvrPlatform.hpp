#ifndef AETHERIUM_EMBEDDED_ARDUINO_AVR_PLATFORM_HPP
#define AETHERIUM_EMBEDDED_ARDUINO_AVR_PLATFORM_HPP

#include "engine/embedded/platform/EmbeddedPlatformHooks.hpp"
#include "engine/core/runtime.hpp"

#include <cstdint>
#include <random>

namespace aeth::embedded::arduino {

class ArduinoClock : public IClock {
public:
    Timestamp now() override { return platform::millis(); }

    void sleep(uint32_t ms) override { platform::delayMs(ms); }
};

class ArduinoRandomSource : public IRandomSource {
public:
    ArduinoRandomSource()
        : gen_(0xA37E57ULL)
        , dist_(0.0, 1.0) {}

    double random() override { return dist_(gen_); }

    uint32_t randomInt(uint32_t max) override {
        if (max == 0) return 0;
        std::uniform_int_distribution<uint32_t> d(0, max - 1);
        return d(gen_);
    }

    void seed(uint64_t seedValue) override { gen_.seed(seedValue); }

private:
    std::mt19937_64 gen_;
    std::uniform_real_distribution<double> dist_;
};

} // namespace aeth::embedded::arduino

#endif // AETHERIUM_EMBEDDED_ARDUINO_AVR_PLATFORM_HPP
