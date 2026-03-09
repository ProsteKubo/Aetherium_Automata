set(CMAKE_SYSTEM_NAME Generic)
set(CMAKE_SYSTEM_PROCESSOR arm)
set(CMAKE_TRY_COMPILE_TARGET_TYPE STATIC_LIBRARY)

set(AETHERIUM_ARDUINO_ARM_GNU_ROOT
  "$ENV{HOME}/Library/Arduino15/packages/arduino/tools/arm-none-eabi-gcc/7-2017q4"
)

if(EXISTS "${AETHERIUM_ARDUINO_ARM_GNU_ROOT}/bin/arm-none-eabi-gcc")
  set(CMAKE_C_COMPILER "${AETHERIUM_ARDUINO_ARM_GNU_ROOT}/bin/arm-none-eabi-gcc")
  set(CMAKE_CXX_COMPILER "${AETHERIUM_ARDUINO_ARM_GNU_ROOT}/bin/arm-none-eabi-g++")
  set(CMAKE_ASM_COMPILER "${AETHERIUM_ARDUINO_ARM_GNU_ROOT}/bin/arm-none-eabi-gcc")
  set(CMAKE_OBJCOPY "${AETHERIUM_ARDUINO_ARM_GNU_ROOT}/bin/arm-none-eabi-objcopy")
  set(CMAKE_SIZE "${AETHERIUM_ARDUINO_ARM_GNU_ROOT}/bin/arm-none-eabi-size")
else()
  find_program(CMAKE_C_COMPILER arm-none-eabi-gcc REQUIRED)
  find_program(CMAKE_CXX_COMPILER arm-none-eabi-g++ REQUIRED)
  find_program(CMAKE_ASM_COMPILER arm-none-eabi-gcc REQUIRED)
  find_program(CMAKE_OBJCOPY arm-none-eabi-objcopy REQUIRED)
  find_program(CMAKE_SIZE arm-none-eabi-size REQUIRED)
endif()

set(CMAKE_EXECUTABLE_SUFFIX ".elf")

set(AETHERIUM_MCXN947_CPU_FLAGS "-mcpu=cortex-m33 -mthumb -mfpu=fpv5-sp-d16 -mfloat-abi=hard")
set(CMAKE_C_FLAGS_INIT "${AETHERIUM_MCXN947_CPU_FLAGS}")
set(CMAKE_CXX_FLAGS_INIT "${AETHERIUM_MCXN947_CPU_FLAGS}")
set(CMAKE_ASM_FLAGS_INIT "${AETHERIUM_MCXN947_CPU_FLAGS}")
