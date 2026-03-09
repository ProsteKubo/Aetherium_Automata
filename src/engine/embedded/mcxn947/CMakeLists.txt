cmake_minimum_required(VERSION 3.24)

project(AetheriumMcxn947Node LANGUAGES C CXX ASM)

set(CMAKE_C_STANDARD 11)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include(FetchContent)

FetchContent_Declare(lua
  GIT_REPOSITORY https://github.com/lua/lua.git
  GIT_TAG v5.4.7
  GIT_SHALLOW TRUE
)

FetchContent_Declare(mcux_sdk
  GIT_REPOSITORY https://github.com/nxp-mcuxpresso/mcux-sdk.git
  GIT_TAG 8a289764d763ad06e0c3a05c885644ed98b970af
  GIT_SHALLOW TRUE
)

FetchContent_MakeAvailable(mcux_sdk)

FetchContent_GetProperties(lua)
if(NOT lua_POPULATED)
  FetchContent_Populate(lua)
  file(GLOB LUA_SOURCES "${lua_SOURCE_DIR}/*.c")
  list(REMOVE_ITEM LUA_SOURCES "${lua_SOURCE_DIR}/lua.c" "${lua_SOURCE_DIR}/luac.c" "${lua_SOURCE_DIR}/onelua.c")
  add_library(lua_static STATIC ${LUA_SOURCES})
  target_include_directories(lua_static PUBLIC ${lua_SOURCE_DIR})
  target_compile_definitions(lua_static PUBLIC
    LLONG_MAX=LONG_LONG_MAX
    LLONG_MIN=LONG_LONG_MIN
    ULLONG_MAX=ULONG_LONG_MAX
  )
  set_target_properties(lua_static PROPERTIES LINKER_LANGUAGE C)
endif()

set(AETHERIUM_ROOT ${CMAKE_CURRENT_LIST_DIR}/../..)
set(MCUX_DEVICE_DIR ${mcux_sdk_SOURCE_DIR}/devices/MCXN947)
set(MCUX_DEVICE_DRIVERS_DIR ${MCUX_DEVICE_DIR}/drivers)
set(MCUX_CMSIS_DIR ${mcux_sdk_SOURCE_DIR}/CMSIS/Core/Include)
set(MCUX_BOARD_DIR ${mcux_sdk_SOURCE_DIR}/boards/frdmmcxn947/project_template)
set(AETHERIUM_CMSIS_CORE_INCLUDE_DIRS ${MCUX_CMSIS_DIR})

file(GLOB AETHERIUM_ARDUINO_CMSIS_CORE_DIRS
  "$ENV{HOME}/Library/Arduino15/packages/arduino/hardware/renesas_uno/*/variants/*/includes/ra/arm/CMSIS_5/CMSIS/Core/Include"
)

if(AETHERIUM_ARDUINO_CMSIS_CORE_DIRS)
  list(APPEND AETHERIUM_CMSIS_CORE_INCLUDE_DIRS ${AETHERIUM_ARDUINO_CMSIS_CORE_DIRS})
endif()

add_library(aetherium_mcxn947_runtime STATIC
  ${AETHERIUM_ROOT}/core/artifact.cpp
  ${AETHERIUM_ROOT}/core/runtime.cpp
  ${AETHERIUM_ROOT}/core/protocol.cpp
  ${AETHERIUM_ROOT}/core/protocol_v2.cpp
  ${AETHERIUM_ROOT}/core/telemetry_log_hub.cpp
  ${AETHERIUM_ROOT}/core/command_bus.cpp
  ${AETHERIUM_ROOT}/core/engine.cpp
  ${AETHERIUM_ROOT}/embedded/arduino/AetheriumAvrNode.cpp
  ${AETHERIUM_ROOT}/embedded/arduino/AetheriumEmbeddedLuaEngine.cpp
  ${MCUX_DEVICE_DRIVERS_DIR}/fsl_clock.c
  ${MCUX_DEVICE_DRIVERS_DIR}/fsl_reset.c
  ${mcux_sdk_SOURCE_DIR}/drivers/lpflexcomm/fsl_lpflexcomm.c
  ${mcux_sdk_SOURCE_DIR}/drivers/lpflexcomm/lpuart/fsl_lpuart.c
  ${MCUX_BOARD_DIR}/clock_config.c
  ${MCUX_BOARD_DIR}/pin_mux.c
  ${CMAKE_CURRENT_LIST_DIR}/AetheriumMcxn947Platform.cpp
  ${CMAKE_CURRENT_LIST_DIR}/AetheriumMcxn947SerialLink.cpp
)

target_include_directories(aetherium_mcxn947_runtime PUBLIC
  ${AETHERIUM_ROOT}/..
  ${AETHERIUM_ROOT}
  ${AETHERIUM_ROOT}/embedded/mcxn947
  ${AETHERIUM_ROOT}/embedded/arduino
  ${MCUX_DEVICE_DIR}
  ${MCUX_DEVICE_DRIVERS_DIR}
  ${mcux_sdk_SOURCE_DIR}/drivers/common
  ${mcux_sdk_SOURCE_DIR}/drivers/gpio
  ${mcux_sdk_SOURCE_DIR}/drivers/port
  ${mcux_sdk_SOURCE_DIR}/drivers/lpflexcomm
  ${mcux_sdk_SOURCE_DIR}/drivers/lpflexcomm/lpuart
  ${MCUX_BOARD_DIR}
  ${AETHERIUM_CMSIS_CORE_INCLUDE_DIRS}
  ${lua_SOURCE_DIR}
)

target_compile_definitions(aetherium_mcxn947_runtime PUBLIC
  AETHERIUM_RUNTIME_CORE_ONLY=1
  AETHERIUM_DISABLE_LUA_SCRIPT_ENGINE=1
  AETHERIUM_USE_EMBEDDED_LUA_SCRIPT_ENGINE=1
  AETHERIUM_PLATFORM_MCXN947=1
  CPU_MCXN947VDF_cm33_core0=1
  LLONG_MAX=LONG_LONG_MAX
  LLONG_MIN=LONG_LONG_MIN
  ULLONG_MAX=ULONG_LONG_MAX
)

target_compile_options(aetherium_mcxn947_runtime PUBLIC
  -Os
  -ffunction-sections
  -fdata-sections
  -fno-rtti
)

target_link_libraries(aetherium_mcxn947_runtime PUBLIC lua_static)

add_executable(aetherium_mcxn947_node
  ${CMAKE_CURRENT_LIST_DIR}/examples/AetheriumMcxn947Node/main.cpp
  ${MCUX_DEVICE_DIR}/system_MCXN947_cm33_core0.c
  ${MCUX_DEVICE_DIR}/gcc/startup_MCXN947_cm33_core0.S
)

target_include_directories(aetherium_mcxn947_node PRIVATE
  ${AETHERIUM_ROOT}/..
  ${AETHERIUM_ROOT}
  ${AETHERIUM_ROOT}/embedded/mcxn947
  ${MCUX_DEVICE_DIR}
  ${AETHERIUM_CMSIS_CORE_INCLUDE_DIRS}
)

target_compile_definitions(aetherium_mcxn947_node PRIVATE
  AETHERIUM_PLATFORM_MCXN947=1
  CPU_MCXN947VDF_cm33_core0=1
)

target_compile_options(aetherium_mcxn947_node PRIVATE
  -Os
  -ffunction-sections
  -fdata-sections
)

target_link_libraries(aetherium_mcxn947_node PRIVATE aetherium_mcxn947_runtime)

target_link_options(aetherium_mcxn947_node PRIVATE
  --specs=nano.specs
  --specs=nosys.specs
  -T${MCUX_DEVICE_DIR}/gcc/MCXN947_cm33_core0_flash.ld
  -Wl,--defsym=__heap_size__=0x00030000
  -Wl,--defsym=__stack_size__=0x00008000
  -Wl,--gc-sections
  -Wl,-Map=${CMAKE_CURRENT_BINARY_DIR}/aetherium_mcxn947_node.map
)

add_custom_command(TARGET aetherium_mcxn947_node POST_BUILD
  COMMAND ${CMAKE_OBJCOPY} -O binary $<TARGET_FILE:aetherium_mcxn947_node> ${CMAKE_CURRENT_BINARY_DIR}/aetherium_mcxn947_node.bin
  COMMAND ${CMAKE_OBJCOPY} -O ihex $<TARGET_FILE:aetherium_mcxn947_node> ${CMAKE_CURRENT_BINARY_DIR}/aetherium_mcxn947_node.hex
  COMMAND ${CMAKE_SIZE} $<TARGET_FILE:aetherium_mcxn947_node>
)
