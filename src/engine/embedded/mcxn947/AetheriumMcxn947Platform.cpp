#include "AetheriumMcxn947Platform.hpp"

#include "engine/embedded/platform/EmbeddedPlatformHooks.hpp"

#if defined(AETHERIUM_PLATFORM_MCXN947)
#include "clock_config.h"
#include "fsl_device_registers.h"
#include "fsl_lpuart.h"
#include "pin_mux.h"
#endif

namespace aeth::embedded::mcxn947 {

namespace {

constexpr uint32_t kFlexcomm4Index = 4;
constexpr uint32_t kDebugUartClockHz = 12'000'000U;
constexpr int kStatusLedPort = 1;
constexpr int kStatusLedPin = 2;

volatile Timestamp g_ticksMs = 0;
bool g_initialized = false;
bool g_clockConfigured = false;

#if defined(AETHERIUM_PLATFORM_MCXN947)
GPIO_Type* const kGpioPorts[] = GPIO_BASE_PTRS;
PORT_Type* const kPortRegs[] = PORT_BASE_PTRS;

void enablePeripheralClocks() {
    SYSCON->AHBCLKCTRLSET[0] =
        SYSCON_AHBCLKCTRL0_PORT0_MASK |
        SYSCON_AHBCLKCTRL0_PORT1_MASK |
        SYSCON_AHBCLKCTRL0_PORT2_MASK |
        SYSCON_AHBCLKCTRL0_PORT3_MASK |
        SYSCON_AHBCLKCTRL0_PORT4_MASK |
        SYSCON_AHBCLKCTRL0_GPIO0_MASK |
        SYSCON_AHBCLKCTRL0_GPIO1_MASK |
        SYSCON_AHBCLKCTRL0_GPIO2_MASK |
        SYSCON_AHBCLKCTRL0_GPIO3_MASK |
        SYSCON_AHBCLKCTRL0_GPIO4_MASK;
}

void configureSystemClock() {
    if (g_clockConfigured) {
        return;
    }

    BOARD_BootClockPLL150M();
    g_clockConfigured = true;
}

void releasePeripheralResets() {
    SYSCON->PRESETCTRLCLR[0] =
        SYSCON_PRESETCTRL0_PORT0_RST_MASK |
        SYSCON_PRESETCTRL0_PORT1_RST_MASK |
        SYSCON_PRESETCTRL0_PORT2_RST_MASK |
        SYSCON_PRESETCTRL0_PORT3_RST_MASK |
        SYSCON_PRESETCTRL0_PORT4_RST_MASK |
        SYSCON_PRESETCTRL0_GPIO0_RST_MASK |
        SYSCON_PRESETCTRL0_GPIO1_RST_MASK |
        SYSCON_PRESETCTRL0_GPIO2_RST_MASK |
        SYSCON_PRESETCTRL0_GPIO3_RST_MASK |
        SYSCON_PRESETCTRL0_GPIO4_RST_MASK;
}

void configurePinMux(PORT_Type* port, int pin, uint32_t mux, bool inputBuffer, bool pullEnable, bool pullUp) {
    uint32_t pcr = PORT_PCR_MUX(mux) | PORT_PCR_PV(pullUp ? 1U : 0U);
    if (inputBuffer) {
        pcr |= PORT_PCR_IBE(1U);
    }
    if (pullEnable) {
        pcr |= PORT_PCR_PE(1U) | PORT_PCR_PS(pullUp ? 1U : 0U);
    }
    port->PCR[pin] = pcr;
}

void configureDebugUart(uint32_t baudRate) {
    CLOCK_AttachClk(kFRO12M_to_FLEXCOMM4);
    SYSCON->FLEXCOMMCLKDIV[kFlexcomm4Index] = 0;

    lpuart_config_t config{};
    LPUART_GetDefaultConfig(&config);
    config.baudRate_Bps = baudRate;
    config.enableTx = true;
    config.enableRx = true;
    (void)LPUART_Init(LPUART4, &config, kDebugUartClockHz);
}

void configureStatusLed() {
    configurePinMux(PORT1, kStatusLedPin, 0U, false, false, false);
    GPIO1->PCOR = (1UL << kStatusLedPin);
    GPIO1->PDDR |= (1UL << kStatusLedPin);
    GPIO1->PSOR = (1UL << kStatusLedPin);
}

#endif

} // namespace

#if defined(AETHERIUM_PLATFORM_MCXN947)
extern "C" void SysTick_Handler(void) {
    ++g_ticksMs;
}
#endif

Result<void> initializePlatform(const UartConfig& uart) {
    if (g_initialized) {
        return Result<void>::ok();
    }

#if defined(AETHERIUM_PLATFORM_MCXN947)
    configureSystemClock();
    enablePeripheralClocks();
    releasePeripheralResets();
    BOARD_InitDEBUG_UARTPins();
    configureDebugUart(uart.baudRate);
    configureStatusLed();

    if (SysTick_Config(SystemCoreClock / 1000U) != 0U) {
        return Result<void>::error("systick init failed");
    }

    g_initialized = true;
    return Result<void>::ok();
#else
    (void) uart;
    return Result<void>::error("mcxn947 platform unavailable");
#endif
}

Timestamp millis() { return g_ticksMs; }

void delayMs(uint32_t ms) {
    const Timestamp start = millis();
    while ((millis() - start) < ms) {
        yieldIfNeeded();
    }
}

void yieldIfNeeded() {
#if defined(AETHERIUM_PLATFORM_MCXN947)
    __NOP();
#endif
}

bool decodePin(int encodedPin, int& port, int& pin) {
    if (encodedPin < 0) {
        return false;
    }
    port = encodedPin / 32;
    pin = encodedPin % 32;
    return port >= 0 && port < 6 && pin >= 0 && pin < 32;
}

bool uartReadByte(uint8_t& byte) {
#if defined(AETHERIUM_PLATFORM_MCXN947)
    if ((LPUART4->STAT & LPUART_STAT_RDRF_MASK) == 0U) {
        return false;
    }
    byte = static_cast<uint8_t>(LPUART4->DATA & 0xFFU);
    return true;
#else
    (void) byte;
    return false;
#endif
}

void uartWrite(const uint8_t* data, size_t len) {
#if defined(AETHERIUM_PLATFORM_MCXN947)
    if (!data) {
        return;
    }
    for (size_t i = 0; i < len; ++i) {
        while ((LPUART4->STAT & LPUART_STAT_TDRE_MASK) == 0U) {
        }
        LPUART4->DATA = static_cast<uint32_t>(data[i]);
    }
#else
    (void) data;
    (void) len;
#endif
}

void setStatusLed(bool on) {
#if defined(AETHERIUM_PLATFORM_MCXN947)
    if (on) {
        GPIO1->PCOR = (1UL << kStatusLedPin);
    } else {
        GPIO1->PSOR = (1UL << kStatusLedPin);
    }
#else
    (void) on;
#endif
}

} // namespace aeth::embedded::mcxn947

namespace aeth::embedded::platform {

Timestamp millis() { return mcxn947::millis(); }
void delayMs(uint32_t ms) { mcxn947::delayMs(ms); }
void yieldIfNeeded() { mcxn947::yieldIfNeeded(); }

} // namespace aeth::embedded::platform
