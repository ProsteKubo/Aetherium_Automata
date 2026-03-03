#include <Arduino.h>

#include "AetheriumAvrNode.hpp"
#include "AetheriumAvrSerialLink.hpp"

// Scaffold example only:
// - boots the shared-engine wrapper
// - prints status to Serial
// - artifact loading will be wired from host/server serial protocol in a later step

aeth::embedded::arduino::AvrNodeOptions makeNodeOptions() {
  aeth::embedded::arduino::AvrNodeOptions opts;
  opts.engineInit.maxTickRate = 100;
  opts.engineInit.logCapacity = 64;
  opts.engineInit.deviceId = 1;
  opts.engineInit.deviceName = "avr-uno-v1";
  opts.tickPeriodMs = 10;
  opts.randomSeed = 0xA37E57ULL;
  return opts;
}

aeth::embedded::arduino::AetheriumAvrNode g_node(makeNodeOptions());
aeth::embedded::arduino::AetheriumAvrSerialLink* g_link = nullptr;

void setup() {
  Serial.begin(115200);
  while (!Serial) {
    delay(10);
  }

  auto res = g_node.begin();
  if (res.isError()) {
    Serial.print("Aetherium AVR node init failed: ");
    Serial.println(res.error().c_str());
    return;
  }

  Serial.println("Aetherium AVR node scaffold initialized");

  static aeth::embedded::arduino::AetheriumAvrSerialLink link(g_node, Serial);
  g_link = &link;
  g_link->sendHello();
}

void loop() {
  if (g_link) {
    g_link->poll();
  }
  g_node.loop();

  static unsigned long lastPrint = 0;
  if (millis() - lastPrint >= 1000) {
    lastPrint = millis();
    auto s = g_node.status();
    Serial.print("state=");
    Serial.print(static_cast<int>(s.executionState));
    Serial.print(" run=");
    Serial.print(s.runId);
    Serial.print(" transitions=");
    Serial.println(static_cast<unsigned long>(s.transitionCount));
  }
}
