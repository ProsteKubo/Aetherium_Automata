#include <Arduino.h>
#include <memory>

#include "AetheriumEsp32Node.hpp"
#include "AetheriumEsp32SerialLink.hpp"

#ifndef AETHERIUM_SERIAL_DEBUG
#define AETHERIUM_SERIAL_DEBUG 0
#endif

namespace {
#if defined(LED_BUILTIN)
constexpr int kLedPin = LED_BUILTIN;
#else
constexpr int kLedPin = 2;
#endif
} // namespace

aeth::embedded::arduino::Esp32NodeOptions makeNodeOptions() {
  aeth::embedded::arduino::Esp32NodeOptions opts;
  opts.engineInit.maxTickRate = 200;
  opts.engineInit.logCapacity = 256;
  opts.engineInit.deviceId = 1;
  opts.engineInit.deviceName = "esp32-v1";
  opts.tickPeriodMs = 5;
  opts.randomSeed = 0xE532A37ULL;
  return opts;
}

std::unique_ptr<aeth::embedded::arduino::AetheriumEsp32Node> g_node;
std::unique_ptr<aeth::embedded::arduino::AetheriumEsp32SerialLink> g_link;
String g_deviceName = "esp32-v1";

String computeDeviceName() {
#if defined(ESP32)
  const uint64_t mac = ESP.getEfuseMac();
  const uint32_t suffix = static_cast<uint32_t>(mac & 0x00FFFFFFULL);
  return String("esp32-") + String(suffix, HEX);
#else
  return String("esp32-v1");
#endif
}

void applyLedPattern(const aeth::EngineStatus& status, bool helloAcknowledged) {
  const unsigned long now = millis();
  bool on = false;

  if (!helloAcknowledged) {
    // Link not established yet: short heartbeat pulse.
    on = (now % 1200UL) < 80UL;
  } else {
    switch (status.executionState) {
      case aeth::ExecutionState::Running:
        // Fast blink when automata is running.
        on = ((now / 250UL) % 2UL) == 0UL;
        break;
      case aeth::ExecutionState::Paused:
        // Solid on while paused.
        on = true;
        break;
      case aeth::ExecutionState::Loaded:
        // Slow blink while loaded but not running.
        on = ((now / 1000UL) % 2UL) == 0UL;
        break;
      case aeth::ExecutionState::Error:
        // Distinct fast pulse on error.
        on = ((now / 90UL) % 2UL) == 0UL;
        break;
      default:
        on = false;
        break;
    }
  }

  digitalWrite(kLedPin, on ? HIGH : LOW);
}

void setup() {
  Serial.begin(115200);
  delay(250);
  pinMode(kLedPin, OUTPUT);
  digitalWrite(kLedPin, LOW);

  g_deviceName = computeDeviceName();

#if AETHERIUM_SERIAL_DEBUG
  Serial.println("Aetherium ESP32 setup: construct node");
#endif
  g_node = std::make_unique<aeth::embedded::arduino::AetheriumEsp32Node>(makeNodeOptions());

#if AETHERIUM_SERIAL_DEBUG
  Serial.println("Aetherium ESP32 setup: begin()");
#endif
  auto res = g_node->begin();
  if (res.isError()) {
#if AETHERIUM_SERIAL_DEBUG
    Serial.print("Aetherium ESP32 node init failed: ");
    Serial.println(res.error().c_str());
#endif
    return;
  }

#if AETHERIUM_SERIAL_DEBUG
  Serial.print("Aetherium ESP32 node scaffold initialized as ");
  Serial.println(g_deviceName);
#endif

#if AETHERIUM_SERIAL_DEBUG
  Serial.println("Aetherium ESP32 setup: serial link init");
#endif
  g_link = std::make_unique<aeth::embedded::arduino::AetheriumEsp32SerialLink>(*g_node, Serial);
#if AETHERIUM_SERIAL_DEBUG
  Serial.println("Aetherium ESP32 setup: send hello");
#endif
  g_link->sendHello(g_deviceName.c_str());
}

void loop() {
  if (g_link) {
    g_link->poll();
  }
  if (g_node) {
    g_node->loop();
    const auto status = g_node->status();
    applyLedPattern(status, g_link && g_link->helloAcknowledged());
  } else {
    applyLedPattern({}, false);
  }
}
