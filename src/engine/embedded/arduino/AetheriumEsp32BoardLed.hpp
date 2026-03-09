#ifndef AETHERIUM_EMBEDDED_ARDUINO_ESP32_BOARD_LED_HPP
#define AETHERIUM_EMBEDDED_ARDUINO_ESP32_BOARD_LED_HPP

namespace aeth::embedded::arduino::board_led {

inline bool overrideEnabled = false;
inline bool overrideState = false;

inline void set(bool on) {
    overrideEnabled = true;
    overrideState = on;
}

inline void clear() {
    overrideEnabled = false;
    overrideState = false;
}

inline bool active() {
    return overrideEnabled;
}

inline bool value() {
    return overrideState;
}

} // namespace aeth::embedded::arduino::board_led

#endif // AETHERIUM_EMBEDDED_ARDUINO_ESP32_BOARD_LED_HPP
