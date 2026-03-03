// Arduino/ESP32 build integration:
// pull in runtime-core implementation units so sketches link against the
// same shared engine core without duplicating source trees.
#ifndef AETHERIUM_RUNTIME_CORE_ONLY
#define AETHERIUM_RUNTIME_CORE_ONLY 1
#endif

#ifndef AETHERIUM_DISABLE_LUA_SCRIPT_ENGINE
#define AETHERIUM_DISABLE_LUA_SCRIPT_ENGINE 1
#endif

#include "../../core/artifact.cpp"
#include "../../core/runtime.cpp"
#include "../../core/protocol.cpp"
#include "../../core/protocol_v2.cpp"
#include "../../core/telemetry_log_hub.cpp"
#include "../../core/command_bus.cpp"
#include "../../core/engine.cpp"
