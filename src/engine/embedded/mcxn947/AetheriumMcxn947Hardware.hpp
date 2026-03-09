#ifndef AETHERIUM_EMBEDDED_MCXN947_HARDWARE_HPP
#define AETHERIUM_EMBEDDED_MCXN947_HARDWARE_HPP

#include "AetheriumMcxn947Platform.hpp"
#include "engine/core/hardware_service.hpp"

#if defined(AETHERIUM_PLATFORM_MCXN947)
#include "fsl_device_registers.h"
#endif

#include <array>
#include <string>

namespace aeth::embedded::mcxn947 {

class Mcxn947HardwareService final : public IHardwareService {
public:
    Result<void> gpioMode(int pin, const std::string& mode) override {
        int portIndex = 0;
        int pinIndex = 0;
        if (!decodePin(pin, portIndex, pinIndex)) {
            return Result<void>::error("invalid mcxn947 encoded pin");
        }

#if defined(AETHERIUM_PLATFORM_MCXN947)
        static GPIO_Type* const gpioPorts[] = GPIO_BASE_PTRS;
        static PORT_Type* const portRegs[] = PORT_BASE_PTRS;
        GPIO_Type* gpio = gpioPorts[portIndex];
        PORT_Type* portReg = portRegs[portIndex];

        uint32_t pcr = PORT_PCR_MUX(0U) | PORT_PCR_IBE(1U);
        const uint32_t mask = (1UL << pinIndex);
        const std::string lowered = normalize(mode);

        if (lowered == "output") {
            gpio->PDDR |= mask;
        } else if (lowered == "input") {
            gpio->PDDR &= ~mask;
        } else if (lowered == "input_pullup") {
            pcr |= PORT_PCR_PE(1U) | PORT_PCR_PS(1U) | PORT_PCR_PV(1U);
            gpio->PDDR &= ~mask;
        } else if (lowered == "input_pulldown") {
            pcr |= PORT_PCR_PE(1U);
            gpio->PDDR &= ~mask;
        } else {
            return Result<void>::error("unsupported gpio mode");
        }

        portReg->PCR[pinIndex] = pcr;
        return Result<void>::ok();
#else
        (void) mode;
        return Result<void>::error("mcxn947 gpio unavailable outside target build");
#endif
    }

    Result<void> gpioWrite(int pin, bool high) override {
        int portIndex = 0;
        int pinIndex = 0;
        if (!decodePin(pin, portIndex, pinIndex)) {
            return Result<void>::error("invalid mcxn947 encoded pin");
        }

#if defined(AETHERIUM_PLATFORM_MCXN947)
        static GPIO_Type* const gpioPorts[] = GPIO_BASE_PTRS;
        GPIO_Type* gpio = gpioPorts[portIndex];
        const uint32_t mask = (1UL << pinIndex);
        if (high) {
            gpio->PSOR = mask;
        } else {
            gpio->PCOR = mask;
        }
        return Result<void>::ok();
#else
        (void) high;
        return Result<void>::error("mcxn947 gpio unavailable outside target build");
#endif
    }

    Result<int64_t> gpioRead(int pin) override {
        int portIndex = 0;
        int pinIndex = 0;
        if (!decodePin(pin, portIndex, pinIndex)) {
            return Result<int64_t>::error("invalid mcxn947 encoded pin");
        }

#if defined(AETHERIUM_PLATFORM_MCXN947)
        static GPIO_Type* const gpioPorts[] = GPIO_BASE_PTRS;
        GPIO_Type* gpio = gpioPorts[portIndex];
        const uint32_t value = (gpio->PDIR >> pinIndex) & 0x1U;
        return Result<int64_t>::ok(static_cast<int64_t>(value));
#else
        return Result<int64_t>::error("mcxn947 gpio unavailable outside target build");
#endif
    }

    Result<void> pwmAttach(int, int, int, int) override {
        return Result<void>::error("unsupported on mcxn947_v1");
    }
    Result<void> pwmWrite(int, int) override { return Result<void>::error("unsupported on mcxn947_v1"); }
    Result<int64_t> adcRead(int) override { return Result<int64_t>::error("unsupported on mcxn947_v1"); }
    Result<int64_t> adcReadMilliVolts(int) override {
        return Result<int64_t>::error("unsupported on mcxn947_v1");
    }
    Result<void> dacWrite(int, int) override { return Result<void>::error("unsupported on mcxn947_v1"); }
    Result<void> i2cOpen(int, int, int, int) override {
        return Result<void>::error("unsupported on mcxn947_v1");
    }
    Result<std::vector<int>> i2cScan(int) override {
        return Result<std::vector<int>>::error("unsupported on mcxn947_v1");
    }

    std::vector<std::string> componentNames() const override { return {}; }
    IComponent* component(const std::string&) override { return nullptr; }

private:
    static std::string normalize(const std::string& mode) {
        std::string lowered = mode;
        for (char& ch : lowered) {
            if (ch >= 'A' && ch <= 'Z') {
                ch = static_cast<char>(ch - 'A' + 'a');
            }
        }
        return lowered;
    }
};

} // namespace aeth::embedded::mcxn947

#endif // AETHERIUM_EMBEDDED_MCXN947_HARDWARE_HPP
