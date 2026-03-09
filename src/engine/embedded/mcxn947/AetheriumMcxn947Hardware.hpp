#ifndef AETHERIUM_EMBEDDED_MCXN947_HARDWARE_HPP
#define AETHERIUM_EMBEDDED_MCXN947_HARDWARE_HPP

#include "AetheriumMcxn947Platform.hpp"
#include "engine/core/hardware_service.hpp"

#if defined(AETHERIUM_PLATFORM_MCXN947)
#include "board.h"
#include "fsl_device_registers.h"
#include "fsl_tsi_v6.h"
#endif

#include <algorithm>
#include <array>
#include <memory>
#include <string>
#include <unordered_map>
#include <utility>

namespace aeth::embedded::mcxn947 {

class TouchPadComponent final : public IComponent {
public:
    const std::string& name() const override {
        static const std::string kName = "touch_pad";
        return kName;
    }

    std::vector<std::string> methods() const override {
        return {"init", "raw", "baseline", "delta", "pressed", "threshold", "set_threshold"};
    }

    Result<Value> invoke(const std::string& method, const std::vector<Value>& args) override {
        if (method == "init") return init(args);
        if (method == "raw") return raw();
        if (method == "baseline") return baseline();
        if (method == "delta") return delta();
        if (method == "pressed") return pressed(args);
        if (method == "threshold") return threshold();
        if (method == "set_threshold") return setThreshold(args);
        return Result<Value>::error("unknown component method: " + method);
    }

private:
    static constexpr uint8_t kTouchPort = 1U;
    static constexpr uint8_t kTouchPin = 3U;
    static constexpr uint8_t kTouchChannel = BOARD_TSI_ELECTRODE_1;

    Result<Value> init(const std::vector<Value>& args) {
        auto ready = ensureReady();
        if (ready.isError()) {
            return Result<Value>::error(ready.error());
        }

        if (!args.empty()) {
            threshold_ = clampThreshold(static_cast<int>(args[0].toInt()));
        }

        uint32_t total = 0;
        for (int sample = 0; sample < 8; ++sample) {
            auto measurement = scanRaw();
            if (measurement.isError()) {
                return Result<Value>::error(measurement.error());
            }
            total += measurement.value();
        }

        baseline_ = static_cast<uint16_t>(total / 8U);
        if (args.empty()) {
            threshold_ = defaultThresholdFor(baseline_);
        }
        initialized_ = true;
        return Result<Value>::ok(Value(static_cast<int64_t>(baseline_)));
    }

    Result<Value> raw() {
        auto measurement = measureRaw();
        if (measurement.isError()) {
            return Result<Value>::error(measurement.error());
        }
        return Result<Value>::ok(Value(static_cast<int64_t>(measurement.value())));
    }

    Result<Value> baseline() {
        auto ready = ensureInitialized();
        if (ready.isError()) {
            return Result<Value>::error(ready.error());
        }
        return Result<Value>::ok(Value(static_cast<int64_t>(baseline_)));
    }

    Result<Value> delta() {
        auto measurement = measureRaw();
        if (measurement.isError()) {
            return Result<Value>::error(measurement.error());
        }
        const int64_t deltaValue =
            baseline_ > measurement.value() ? static_cast<int64_t>(baseline_ - measurement.value()) : 0LL;
        return Result<Value>::ok(Value(deltaValue));
    }

    Result<Value> pressed(const std::vector<Value>& args) {
        auto measurement = measureRaw();
        if (measurement.isError()) {
            return Result<Value>::error(measurement.error());
        }

        int thresholdValue = threshold_;
        if (!args.empty()) {
            thresholdValue = clampThreshold(static_cast<int>(args[0].toInt()));
        }

        const uint16_t rawValue = measurement.value();
        const bool isPressed =
            baseline_ > rawValue && static_cast<int>(baseline_ - rawValue) >= thresholdValue;
        return Result<Value>::ok(Value(isPressed));
    }

    Result<Value> threshold() {
        auto ready = ensureInitialized();
        if (ready.isError()) {
            return Result<Value>::error(ready.error());
        }
        return Result<Value>::ok(Value(static_cast<int64_t>(threshold_)));
    }

    Result<Value> setThreshold(const std::vector<Value>& args) {
        if (args.empty()) {
            return Result<Value>::error("touch_pad.set_threshold expects a threshold");
        }
        auto ready = ensureInitialized();
        if (ready.isError()) {
            return Result<Value>::error(ready.error());
        }
        threshold_ = clampThreshold(static_cast<int>(args[0].toInt()));
        return Result<Value>::ok(Value(static_cast<int64_t>(threshold_)));
    }

    Result<void> ensureReady() {
#if defined(AETHERIUM_PLATFORM_MCXN947)
        if (hardwareReady_) {
            return Result<void>::ok();
        }

        static PORT_Type* const portRegs[] = PORT_BASE_PTRS;
        portRegs[kTouchPort]->PCR[kTouchPin] = PORT_PCR_MUX(0U);

        tsi_selfCap_config_t config{};
        TSI_GetSelfCapModeDefaultConfig(&config);
        TSI_InitSelfCapMode(TSI0, &config);
        TSI_EnableHardwareTriggerScan(TSI0, false);
        TSI_EnableModule(TSI0, true);
        TSI_SetSelfCapMeasuredChannel(TSI0, kTouchChannel);
        TSI_ClearStatusFlags(TSI0, static_cast<uint32_t>(kTSI_EndOfScanFlag | kTSI_OutOfRangeFlag));

        hardwareReady_ = true;
        return Result<void>::ok();
#else
        return Result<void>::error("touch_pad unavailable outside mcxn947 target build");
#endif
    }

    Result<void> ensureInitialized() {
        if (initialized_) {
            return Result<void>::ok();
        }
        auto initResult = init({});
        return initResult.isError() ? Result<void>::error(initResult.error()) : Result<void>::ok();
    }

    Result<uint16_t> measureRaw() {
        auto ready = ensureInitialized();
        if (ready.isError()) {
            return Result<uint16_t>::error(ready.error());
        }
        return scanRaw();
    }

    Result<uint16_t> scanRaw() {
#if defined(AETHERIUM_PLATFORM_MCXN947)
        TSI_SetSelfCapMeasuredChannel(TSI0, kTouchChannel);
        TSI_ClearStatusFlags(TSI0, static_cast<uint32_t>(kTSI_EndOfScanFlag | kTSI_OutOfRangeFlag));
        TSI_StartSoftwareTrigger(TSI0);

        const Timestamp start = millis();
        while ((TSI_GetStatusFlags(TSI0) & static_cast<uint32_t>(kTSI_EndOfScanFlag)) == 0U) {
            if ((millis() - start) > 25U) {
                return Result<uint16_t>::error("touch_pad scan timeout");
            }
            yieldIfNeeded();
        }

        lastRaw_ = TSI_GetCounter(TSI0);
        TSI_ClearStatusFlags(TSI0, static_cast<uint32_t>(kTSI_EndOfScanFlag | kTSI_OutOfRangeFlag));
        return Result<uint16_t>::ok(lastRaw_);
#else
        return Result<uint16_t>::error("touch_pad unavailable outside mcxn947 target build");
#endif
    }

    static int clampThreshold(int threshold) {
        return std::max(8, std::min(threshold, 2048));
    }

    static int defaultThresholdFor(uint16_t baseline) {
        const int scaled = static_cast<int>(baseline / 16U);
        return std::max(40, std::min(scaled, 400));
    }

    bool hardwareReady_ = false;
    bool initialized_ = false;
    uint16_t baseline_ = 0;
    uint16_t lastRaw_ = 0;
    int threshold_ = 120;
};

class Mcxn947HardwareService final : public IHardwareService {
public:
    Mcxn947HardwareService() {
        registerComponent(std::make_unique<TouchPadComponent>());
    }

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

    std::vector<std::string> componentNames() const override {
        std::vector<std::string> names;
        names.reserve(components_.size());
        for (const auto& entry : components_) {
            names.push_back(entry.first);
        }
        return names;
    }

    IComponent* component(const std::string& name) override {
        auto it = components_.find(name);
        return it == components_.end() ? nullptr : it->second.get();
    }

private:
    void registerComponent(std::unique_ptr<IComponent> component) {
        if (!component) return;
        components_[component->name()] = std::move(component);
    }

    static std::string normalize(const std::string& mode) {
        std::string lowered = mode;
        for (char& ch : lowered) {
            if (ch >= 'A' && ch <= 'Z') {
                ch = static_cast<char>(ch - 'A' + 'a');
            }
        }
        return lowered;
    }

    std::unordered_map<std::string, std::unique_ptr<IComponent>> components_;
};

} // namespace aeth::embedded::mcxn947

#endif // AETHERIUM_EMBEDDED_MCXN947_HARDWARE_HPP
