#ifndef AETHERIUM_EMBEDDED_ARDUINO_ESP32_HARDWARE_HPP
#define AETHERIUM_EMBEDDED_ARDUINO_ESP32_HARDWARE_HPP

#include "engine/core/hardware_service.hpp"

#include <memory>
#include <cctype>
#include <algorithm>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

#ifdef ARDUINO
#include <Arduino.h>
#include <Wire.h>
#if __has_include(<Adafruit_GFX.h>) && __has_include(<Adafruit_SSD1306.h>)
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#define AETHERIUM_HAS_ADAFRUIT_SSD1306 1
#else
#define AETHERIUM_HAS_ADAFRUIT_SSD1306 0
#endif
#else
#define AETHERIUM_HAS_ADAFRUIT_SSD1306 0
#endif

namespace aeth::embedded::arduino {

class GenericComponent final : public IComponent {
public:
    using Handler = std::function<Result<Value>(const std::vector<Value>& args)>;

    GenericComponent(std::string componentName,
                     std::vector<std::pair<std::string, Handler>> handlers)
        : name_(std::move(componentName)) {
        for (auto& entry : handlers) {
            methods_.push_back(entry.first);
            handlers_.emplace(std::move(entry.first), std::move(entry.second));
        }
    }

    const std::string& name() const override { return name_; }
    std::vector<std::string> methods() const override { return methods_; }

    Result<Value> invoke(const std::string& method, const std::vector<Value>& args) override {
        auto it = handlers_.find(method);
        if (it == handlers_.end()) {
            return Result<Value>::error("unknown component method: " + method);
        }
        return it->second(args);
    }

private:
    std::string name_;
    std::vector<std::string> methods_;
    std::unordered_map<std::string, Handler> handlers_;
};

class Esp32HardwareService;

class Ssd1306TextComponent final : public IComponent {
public:
    explicit Ssd1306TextComponent(Esp32HardwareService& hardware)
        : hardware_(hardware) {}

    const std::string& name() const override {
        static const std::string kName = "ssd1306_text";
        return kName;
    }

    std::vector<std::string> methods() const override {
        return {"init", "clear", "line", "show", "set_text_size", "invert"};
    }

    Result<Value> invoke(const std::string& method, const std::vector<Value>& args) override;

private:
    Result<Value> init(const std::vector<Value>& args);
    Result<Value> clear();
    Result<Value> line(const std::vector<Value>& args);
    Result<Value> show();
    Result<Value> setTextSize(const std::vector<Value>& args);
    Result<Value> invert(const std::vector<Value>& args);
    Result<void> redraw();
    Result<void> ensureReady() const;
    int visibleLineCount() const;

    Esp32HardwareService& hardware_;
    int width_ = 128;
    int height_ = 64;
    int address_ = 0x3C;
    int bus_ = 0;
    int textSize_ = 1;
    bool initialized_ = false;
    bool inverted_ = false;
    std::vector<std::string> lines_;
#if AETHERIUM_HAS_ADAFRUIT_SSD1306
    std::unique_ptr<Adafruit_SSD1306> display_;
#endif
};

class Esp32HardwareService final : public IHardwareService {
public:
    Esp32HardwareService() {
        registerComponent(std::make_unique<GenericComponent>(
            "i2c_scanner",
            std::vector<std::pair<std::string, GenericComponent::Handler>>{
                {"scan", [this](const std::vector<Value>& args) -> Result<Value> {
                    const int bus = args.empty() ? 0 : static_cast<int>(args.front().toInt());
                    auto result = i2cScan(bus);
                    if (result.isError()) {
                        return Result<Value>::error(result.error());
                    }
                    std::string joined;
                    for (size_t i = 0; i < result.value().size(); ++i) {
                        if (i > 0) joined += ",";
                        joined += std::to_string(result.value()[i]);
                    }
                    return Result<Value>::ok(Value(joined));
                }}
            }));
        registerComponent(std::make_unique<Ssd1306TextComponent>(*this));
    }

    Result<void> gpioMode(int pin, const std::string& mode) override {
#ifdef ARDUINO
        const auto lowered = normalize(mode);
        uint8_t resolved = OUTPUT;
        if (lowered == "input") resolved = INPUT;
        else if (lowered == "input_pullup") resolved = INPUT_PULLUP;
#if defined(INPUT_PULLDOWN)
        else if (lowered == "input_pulldown") resolved = INPUT_PULLDOWN;
#endif
        ::pinMode(pin, resolved);
        return Result<void>::ok();
#else
        (void) pin;
        (void) mode;
        return Result<void>::error("gpio unavailable outside Arduino");
#endif
    }

    Result<void> gpioWrite(int pin, bool high) override {
#ifdef ARDUINO
        ::digitalWrite(pin, high ? HIGH : LOW);
        return Result<void>::ok();
#else
        (void) pin;
        (void) high;
        return Result<void>::error("gpio unavailable outside Arduino");
#endif
    }

    Result<int64_t> gpioRead(int pin) override {
#ifdef ARDUINO
        return Result<int64_t>::ok(static_cast<int64_t>(::digitalRead(pin)));
#else
        (void) pin;
        return Result<int64_t>::error("gpio unavailable outside Arduino");
#endif
    }

    Result<void> pwmAttach(int channel, int pin, int frequencyHz, int resolutionBits) override {
#if defined(ESP32)
        if (!ledcAttachChannel(pin, frequencyHz, resolutionBits, channel)) {
            return Result<void>::error("ledc attach failed");
        }
        return Result<void>::ok();
#else
        (void) channel;
        (void) pin;
        (void) frequencyHz;
        (void) resolutionBits;
        return Result<void>::error("pwm unavailable on this target");
#endif
    }

    Result<void> pwmWrite(int channel, int duty) override {
#if defined(ESP32)
        ::ledcWrite(channel, duty);
        return Result<void>::ok();
#else
        (void) channel;
        (void) duty;
        return Result<void>::error("pwm unavailable on this target");
#endif
    }

    Result<int64_t> adcRead(int pin) override {
#ifdef ARDUINO
        return Result<int64_t>::ok(static_cast<int64_t>(::analogRead(pin)));
#else
        (void) pin;
        return Result<int64_t>::error("adc unavailable outside Arduino");
#endif
    }

    Result<int64_t> adcReadMilliVolts(int pin) override {
#if defined(ESP32)
        return Result<int64_t>::ok(static_cast<int64_t>(::analogReadMilliVolts(pin)));
#else
        return adcRead(pin);
#endif
    }

    Result<void> dacWrite(int pin, int value) override {
#if defined(ESP32)
        if (pin != 25 && pin != 26) {
            return Result<void>::error("ESP32 DAC supports pins 25 and 26 only");
        }
        ::dacWrite(pin, value);
        return Result<void>::ok();
#else
        (void) pin;
        (void) value;
        return Result<void>::error("dac unavailable on this target");
#endif
    }

    Result<void> i2cOpen(int bus, int sdaPin, int sclPin, int frequencyHz) override {
#ifdef ARDUINO
        auto& wire = wireFor(bus);
        wire.begin(sdaPin, sclPin, static_cast<uint32_t>(frequencyHz));
        buses_[bus] = BusConfig{sdaPin, sclPin, frequencyHz, true};
        return Result<void>::ok();
#else
        (void) bus;
        (void) sdaPin;
        (void) sclPin;
        (void) frequencyHz;
        return Result<void>::error("i2c unavailable outside Arduino");
#endif
    }

    Result<std::vector<int>> i2cScan(int bus) override {
#ifdef ARDUINO
        auto& wire = wireFor(bus);
        auto busIt = buses_.find(bus);
        if (busIt == buses_.end() || !busIt->second.opened) {
            auto beginResult = i2cOpen(bus, defaultSdaFor(bus), defaultSclFor(bus), 400000);
            if (beginResult.isError()) {
                return Result<std::vector<int>>::error(beginResult.error());
            }
        }

        std::vector<int> addresses;
        for (uint8_t address = 1; address < 127; ++address) {
            wire.beginTransmission(address);
            if (wire.endTransmission() == 0) {
                addresses.push_back(address);
            }
        }
        return Result<std::vector<int>>::ok(std::move(addresses));
#else
        (void) bus;
        return Result<std::vector<int>>::error("i2c unavailable outside Arduino");
#endif
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

    void registerComponent(std::unique_ptr<IComponent> component) {
        if (!component) return;
        components_[component->name()] = std::move(component);
    }

#ifdef ARDUINO
    TwoWire& wireForBus(int bus) { return wireFor(bus); }
#endif

    int defaultSdaPin(int bus) const { return defaultSdaFor(bus); }
    int defaultSclPin(int bus) const { return defaultSclFor(bus); }

private:
    struct BusConfig {
        int sdaPin = -1;
        int sclPin = -1;
        int frequencyHz = 400000;
        bool opened = false;
    };

    static std::string normalize(std::string value) {
        for (auto& ch : value) {
            ch = static_cast<char>(::tolower(static_cast<unsigned char>(ch)));
        }
        return value;
    }

#ifdef ARDUINO
    TwoWire& wireFor(int bus) {
#if defined(ESP32)
        if (bus == 1) {
            return Wire1;
        }
#endif
        return Wire;
    }
#endif

    int defaultSdaFor(int bus) const {
        (void) bus;
        return 21;
    }

    int defaultSclFor(int bus) const {
        (void) bus;
        return 22;
    }

    std::unordered_map<int, BusConfig> buses_;
    std::unordered_map<std::string, std::unique_ptr<IComponent>> components_;
};

inline Result<Value> Ssd1306TextComponent::invoke(const std::string& method, const std::vector<Value>& args) {
    if (method == "init") return init(args);
    if (method == "clear") return clear();
    if (method == "line") return line(args);
    if (method == "show") return show();
    if (method == "set_text_size") return setTextSize(args);
    if (method == "invert") return invert(args);
    return Result<Value>::error("unknown component method: " + method);
}

inline Result<Value> Ssd1306TextComponent::init(const std::vector<Value>& args) {
    width_ = args.size() > 0 ? static_cast<int>(args[0].toInt()) : 128;
    height_ = args.size() > 1 ? static_cast<int>(args[1].toInt()) : 64;
    address_ = args.size() > 2 ? static_cast<int>(args[2].toInt()) : 0x3C;
    bus_ = args.size() > 3 ? static_cast<int>(args[3].toInt()) : 0;
    const int sda = args.size() > 4 ? static_cast<int>(args[4].toInt()) : hardware_.defaultSdaPin(bus_);
    const int scl = args.size() > 5 ? static_cast<int>(args[5].toInt()) : hardware_.defaultSclPin(bus_);
    const int frequency = args.size() > 6 ? static_cast<int>(args[6].toInt()) : 400000;

    auto i2cResult = hardware_.i2cOpen(bus_, sda, scl, frequency);
    if (i2cResult.isError()) {
        return Result<Value>::error(i2cResult.error());
    }

#if AETHERIUM_HAS_ADAFRUIT_SSD1306
    display_ = std::make_unique<Adafruit_SSD1306>(width_, height_, &hardware_.wireForBus(bus_), -1);
    if (!display_ || !display_->begin(SSD1306_SWITCHCAPVCC, static_cast<uint8_t>(address_))) {
        initialized_ = false;
        display_.reset();
        return Result<Value>::error("ssd1306 init failed");
    }

    initialized_ = true;
    inverted_ = false;
    lines_.assign(static_cast<size_t>(std::max(1, visibleLineCount())), "");
    display_->clearDisplay();
    display_->setTextWrap(false);
    display_->setTextColor(SSD1306_WHITE);
    display_->setTextSize(textSize_);
    display_->display();
    return Result<Value>::ok(Value(true));
#else
    (void) sda;
    (void) scl;
    (void) frequency;
    initialized_ = false;
    return Result<Value>::error(
        "ssd1306_text requires Adafruit SSD1306 and Adafruit GFX Library");
#endif
}

inline Result<Value> Ssd1306TextComponent::clear() {
    if (auto ready = ensureReady(); ready.isError()) {
        return Result<Value>::error(ready.error());
    }
    lines_.assign(static_cast<size_t>(std::max(1, visibleLineCount())), "");
    auto draw = redraw();
    if (draw.isError()) {
        return Result<Value>::error(draw.error());
    }
    return Result<Value>::ok(Value(true));
}

inline Result<Value> Ssd1306TextComponent::line(const std::vector<Value>& args) {
    if (auto ready = ensureReady(); ready.isError()) {
        return Result<Value>::error(ready.error());
    }
    if (args.size() < 2) {
        return Result<Value>::error("ssd1306_text.line expects row and text");
    }

    const int row = static_cast<int>(args[0].toInt());
    const std::string text = args[1].toString();
    const int maxLines = std::max(1, visibleLineCount());
    if (row < 0 || row >= maxLines) {
        return Result<Value>::error("ssd1306_text.line row out of range");
    }

    if (static_cast<int>(lines_.size()) < maxLines) {
        lines_.resize(static_cast<size_t>(maxLines));
    }
    lines_[static_cast<size_t>(row)] = text;

    auto draw = redraw();
    if (draw.isError()) {
        return Result<Value>::error(draw.error());
    }
    return Result<Value>::ok(Value(true));
}

inline Result<Value> Ssd1306TextComponent::show() {
    if (auto ready = ensureReady(); ready.isError()) {
        return Result<Value>::error(ready.error());
    }
    auto draw = redraw();
    if (draw.isError()) {
        return Result<Value>::error(draw.error());
    }
    return Result<Value>::ok(Value(true));
}

inline Result<Value> Ssd1306TextComponent::setTextSize(const std::vector<Value>& args) {
    if (args.empty()) {
        return Result<Value>::error("ssd1306_text.set_text_size expects a size");
    }

    textSize_ = std::max(1, static_cast<int>(args[0].toInt()));
    if (auto ready = ensureReady(); ready.isError()) {
        return Result<Value>::error(ready.error());
    }

    lines_.resize(static_cast<size_t>(std::max(1, visibleLineCount())));
    auto draw = redraw();
    if (draw.isError()) {
        return Result<Value>::error(draw.error());
    }
    return Result<Value>::ok(Value(static_cast<int32_t>(textSize_)));
}

inline Result<Value> Ssd1306TextComponent::invert(const std::vector<Value>& args) {
    if (auto ready = ensureReady(); ready.isError()) {
        return Result<Value>::error(ready.error());
    }
    inverted_ = !args.empty() && args[0].toBool();
#if AETHERIUM_HAS_ADAFRUIT_SSD1306
    display_->invertDisplay(inverted_);
#endif
    return Result<Value>::ok(Value(inverted_));
}

inline Result<void> Ssd1306TextComponent::redraw() {
    if (auto ready = ensureReady(); ready.isError()) {
        return ready;
    }

#if AETHERIUM_HAS_ADAFRUIT_SSD1306
    display_->clearDisplay();
    display_->setTextSize(textSize_);
    display_->setTextColor(SSD1306_WHITE);
    display_->setTextWrap(false);

    const int lineHeight = std::max(8, 8 * textSize_);
    const int maxLines = std::max(1, visibleLineCount());
    for (int row = 0; row < maxLines; ++row) {
        const size_t index = static_cast<size_t>(row);
        const std::string text = index < lines_.size() ? lines_[index] : "";
        display_->setCursor(0, row * lineHeight);
        display_->println(text.c_str());
    }
    display_->display();
#endif
    return Result<void>::ok();
}

inline Result<void> Ssd1306TextComponent::ensureReady() const {
#if AETHERIUM_HAS_ADAFRUIT_SSD1306
    if (initialized_ && display_) {
        return Result<void>::ok();
    }
    return Result<void>::error("ssd1306_text not initialized");
#else
    return Result<void>::error(
        "ssd1306_text requires Adafruit SSD1306 and Adafruit GFX Library");
#endif
}

inline int Ssd1306TextComponent::visibleLineCount() const {
    return std::max(1, height_ / std::max(8, 8 * textSize_));
}

} // namespace aeth::embedded::arduino

#endif // AETHERIUM_EMBEDDED_ARDUINO_ESP32_HARDWARE_HPP
