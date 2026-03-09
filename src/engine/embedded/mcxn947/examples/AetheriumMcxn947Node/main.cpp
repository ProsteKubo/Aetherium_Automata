#include "engine/embedded/mcxn947/AetheriumMcxn947Node.hpp"
#include "engine/embedded/mcxn947/AetheriumMcxn947Platform.hpp"
#include "engine/embedded/mcxn947/AetheriumMcxn947SerialLink.hpp"

namespace {

using aeth::embedded::mcxn947::AetheriumMcxn947Node;
using aeth::embedded::mcxn947::AetheriumMcxn947SerialLink;
using aeth::embedded::mcxn947::Mcxn947NodeOptions;

Mcxn947NodeOptions makeNodeOptions() {
    Mcxn947NodeOptions opts;
    opts.engineInit.maxTickRate = 200;
    opts.engineInit.logCapacity = 256;
    opts.engineInit.deviceId = 1;
    opts.engineInit.deviceName = "mcxn947-core0";
    opts.tickPeriodMs = 5;
    opts.randomSeed = 0x947A37ULL;
    return opts;
}

void applyLedPattern(const aeth::EngineStatus& status, bool helloAcknowledged) {
    const auto now = aeth::embedded::mcxn947::millis();
    bool on = false;

    if (!helloAcknowledged) {
        on = (now % 1200ULL) < 80ULL;
    } else {
        switch (status.executionState) {
            case aeth::ExecutionState::Running:
                on = ((now / 250ULL) % 2ULL) == 0ULL;
                break;
            case aeth::ExecutionState::Paused:
                on = true;
                break;
            case aeth::ExecutionState::Loaded:
                on = ((now / 1000ULL) % 2ULL) == 0ULL;
                break;
            case aeth::ExecutionState::Error:
                on = ((now / 90ULL) % 2ULL) == 0ULL;
                break;
            default:
                on = false;
                break;
        }
    }

    aeth::embedded::mcxn947::setStatusLed(on);
}

} // namespace

int main() {
    auto init = aeth::embedded::mcxn947::initializePlatform();
    if (init.isError()) {
        while (true) {
            aeth::embedded::mcxn947::setStatusLed(true);
            aeth::embedded::mcxn947::delayMs(100);
            aeth::embedded::mcxn947::setStatusLed(false);
            aeth::embedded::mcxn947::delayMs(100);
        }
    }

    AetheriumMcxn947Node node(makeNodeOptions());
    if (node.begin().isError()) {
        while (true) {
            aeth::embedded::mcxn947::setStatusLed(true);
            aeth::embedded::mcxn947::delayMs(500);
            aeth::embedded::mcxn947::setStatusLed(false);
            aeth::embedded::mcxn947::delayMs(500);
        }
    }

    AetheriumMcxn947SerialLink link(node);
    link.sendHello();

    while (true) {
        link.poll();
        node.loop();
        applyLedPattern(node.status(), link.helloAcknowledged());
        aeth::embedded::mcxn947::yieldIfNeeded();
    }
}
