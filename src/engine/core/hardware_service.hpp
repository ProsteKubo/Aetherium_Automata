#ifndef AETHERIUM_HARDWARE_SERVICE_HPP
#define AETHERIUM_HARDWARE_SERVICE_HPP

#include "types.hpp"

#include <memory>
#include <string>
#include <utility>
#include <vector>

namespace aeth {

class IComponent {
public:
    virtual ~IComponent() = default;

    virtual const std::string& name() const = 0;
    virtual std::vector<std::string> methods() const = 0;
    virtual Result<Value> invoke(const std::string& method, const std::vector<Value>& args) = 0;
};

class IHardwareService {
public:
    virtual ~IHardwareService() = default;

    virtual Result<void> gpioMode(int pin, const std::string& mode) = 0;
    virtual Result<void> gpioWrite(int pin, bool high) = 0;
    virtual Result<int64_t> gpioRead(int pin) = 0;

    virtual Result<void> pwmAttach(int channel, int pin, int frequencyHz, int resolutionBits) = 0;
    virtual Result<void> pwmWrite(int channel, int duty) = 0;

    virtual Result<int64_t> adcRead(int pin) = 0;
    virtual Result<int64_t> adcReadMilliVolts(int pin) = 0;
    virtual Result<void> dacWrite(int pin, int value) = 0;

    virtual Result<void> i2cOpen(int bus, int sdaPin, int sclPin, int frequencyHz) = 0;
    virtual Result<std::vector<int>> i2cScan(int bus) = 0;

    virtual std::vector<std::string> componentNames() const = 0;
    virtual IComponent* component(const std::string& name) = 0;
};

inline IHardwareService*& hardwareServiceSlot() {
    static IHardwareService* service = nullptr;
    return service;
}

inline void setHardwareService(IHardwareService* service) { hardwareServiceSlot() = service; }
inline IHardwareService* hardwareService() { return hardwareServiceSlot(); }

class NullHardwareService final : public IHardwareService {
public:
    Result<void> gpioMode(int, const std::string&) override { return Result<void>::error("hardware service unavailable"); }
    Result<void> gpioWrite(int, bool) override { return Result<void>::error("hardware service unavailable"); }
    Result<int64_t> gpioRead(int) override { return Result<int64_t>::error("hardware service unavailable"); }
    Result<void> pwmAttach(int, int, int, int) override { return Result<void>::error("hardware service unavailable"); }
    Result<void> pwmWrite(int, int) override { return Result<void>::error("hardware service unavailable"); }
    Result<int64_t> adcRead(int) override { return Result<int64_t>::error("hardware service unavailable"); }
    Result<int64_t> adcReadMilliVolts(int) override { return Result<int64_t>::error("hardware service unavailable"); }
    Result<void> dacWrite(int, int) override { return Result<void>::error("hardware service unavailable"); }
    Result<void> i2cOpen(int, int, int, int) override { return Result<void>::error("hardware service unavailable"); }
    Result<std::vector<int>> i2cScan(int) override {
        return Result<std::vector<int>>::error("hardware service unavailable");
    }
    std::vector<std::string> componentNames() const override { return {}; }
    IComponent* component(const std::string&) override { return nullptr; }
};

} // namespace aeth

#endif // AETHERIUM_HARDWARE_SERVICE_HPP
