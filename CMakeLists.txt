cmake_minimum_required(VERSION 3.18)

project(AetheriumAutomata
  VERSION 0.2.0
  DESCRIPTION "Aetherium Automata Platform"
  LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_C_STANDARD 11)

option(AETHERIUM_BUILD_ENGINE_SMOKE "Build in-process engine command smoke checker target" OFF)
option(AETHERIUM_ENABLE_LUA_SCRIPT_ENGINE "Enable Lua-backed default script engine in aetherium_core" ON)

include(FetchContent)

# RapidYAML for YAML parsing
FetchContent_Declare(ryml
        GIT_REPOSITORY https://github.com/biojppm/rapidyaml.git
        GIT_TAG v0.10.0
        GIT_SHALLOW FALSE
)

# Lua for scripting
FetchContent_Declare(lua
        GIT_REPOSITORY https://github.com/lua/lua.git
        GIT_TAG v5.4.7
        GIT_SHALLOW TRUE
)

# Sol2 for C++/Lua binding
FetchContent_Declare(sol2
        GIT_REPOSITORY https://github.com/ThePhD/sol2.git
        GIT_TAG develop
        GIT_SHALLOW TRUE
)

# IXWebSocket for WebSocket client
FetchContent_Declare(ixwebsocket
        GIT_REPOSITORY https://github.com/machinezone/IXWebSocket.git
        GIT_TAG v11.4.5
        GIT_SHALLOW TRUE
)

FetchContent_MakeAvailable(ryml)

# Build Lua as a library
FetchContent_GetProperties(lua)
if(NOT lua_POPULATED)
    FetchContent_Populate(lua)
    
    # Create Lua library from source - enable C language explicitly
    enable_language(C)
    file(GLOB LUA_SOURCES "${lua_SOURCE_DIR}/*.c")
    list(REMOVE_ITEM LUA_SOURCES "${lua_SOURCE_DIR}/lua.c" "${lua_SOURCE_DIR}/luac.c")
    
    add_library(lua_static STATIC ${LUA_SOURCES})
    target_include_directories(lua_static PUBLIC ${lua_SOURCE_DIR})
    set_target_properties(lua_static PROPERTIES LINKER_LANGUAGE C)
    if(UNIX AND NOT APPLE)
        target_compile_definitions(lua_static PUBLIC LUA_USE_POSIX)
        target_link_libraries(lua_static PUBLIC m dl)
    elseif(APPLE)
        target_compile_definitions(lua_static PUBLIC LUA_USE_MACOSX)
    endif()
endif()

# Sol2 is header-only, just get it
FetchContent_GetProperties(sol2)
if(NOT sol2_POPULATED)
    FetchContent_Populate(sol2)
endif()

# IXWebSocket
set(USE_TLS OFF CACHE BOOL "" FORCE)
set(USE_ZLIB OFF CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(ixwebsocket)

# Artifact/IR library (portable container for compiled deployables)
add_library(aetherium_ir STATIC
  src/engine/core/artifact.cpp
)

target_include_directories(aetherium_ir PUBLIC
  ${CMAKE_SOURCE_DIR}/src/engine
  ${CMAKE_SOURCE_DIR}/src
)

# Runtime core (portable execution/protocol/bytecode path; no YAML/frontend transport deps)
add_library(aetherium_runtime_core STATIC
  src/engine/core/runtime.cpp
  src/engine/core/protocol.cpp
  src/engine/core/protocol_v2.cpp
  src/engine/core/telemetry_log_hub.cpp
  src/engine/core/command_bus.cpp
  src/engine/core/engine.cpp
)

target_compile_definitions(aetherium_runtime_core PUBLIC AETHERIUM_RUNTIME_CORE_ONLY=1)

if(AETHERIUM_ENABLE_LUA_SCRIPT_ENGINE)
  target_sources(aetherium_runtime_core PRIVATE src/engine/core/lua_engine.cpp)
else()
  target_compile_definitions(aetherium_runtime_core PUBLIC AETHERIUM_DISABLE_LUA_SCRIPT_ENGINE=1)
endif()

target_include_directories(aetherium_runtime_core PUBLIC
  ${CMAKE_SOURCE_DIR}/src/engine
  ${CMAKE_SOURCE_DIR}/src
)

if(AETHERIUM_ENABLE_LUA_SCRIPT_ENGINE)
  target_include_directories(aetherium_runtime_core PUBLIC
    ${sol2_SOURCE_DIR}/include
    ${lua_SOURCE_DIR}
  )
endif()

target_link_libraries(aetherium_runtime_core PUBLIC
  aetherium_ir
)

if(AETHERIUM_ENABLE_LUA_SCRIPT_ENGINE)
  target_link_libraries(aetherium_runtime_core PUBLIC lua_static)
endif()

# Server/desktop compile frontend (YAML parser + loader)
add_library(aetherium_compile_frontend STATIC
  src/engine/core/automata_loader.cpp
)
target_include_directories(aetherium_compile_frontend PUBLIC
  ${CMAKE_SOURCE_DIR}/src/engine
  ${CMAKE_SOURCE_DIR}/src
)
target_link_libraries(aetherium_compile_frontend PUBLIC
  aetherium_runtime_core
  ryml::ryml
)

# WebSocket transport module (desktop/server-side engine client transport)
add_library(aetherium_transport_ws STATIC
  src/engine/core/websocket_transport.cpp
)
target_include_directories(aetherium_transport_ws PUBLIC
  ${CMAKE_SOURCE_DIR}/src/engine
  ${CMAKE_SOURCE_DIR}/src
)
target_link_libraries(aetherium_transport_ws PUBLIC
  aetherium_runtime_core
  ixwebsocket
)

# Legacy monolithic target for existing desktop code paths.
# Kept during the split so desktop builds remain unchanged while runtime_core/frontend/ws are adopted incrementally.
add_library(aetherium_core STATIC
  src/engine/core/runtime.cpp
  src/engine/core/protocol.cpp
  src/engine/core/protocol_v2.cpp
  src/engine/core/telemetry_log_hub.cpp
  src/engine/core/automata_loader.cpp
  src/engine/core/command_bus.cpp
  src/engine/core/engine.cpp
  src/engine/core/websocket_transport.cpp
)

if(AETHERIUM_ENABLE_LUA_SCRIPT_ENGINE)
  target_sources(aetherium_core PRIVATE src/engine/core/lua_engine.cpp)
else()
  target_compile_definitions(aetherium_core PUBLIC AETHERIUM_DISABLE_LUA_SCRIPT_ENGINE=1)
endif()

target_include_directories(aetherium_core PUBLIC
  ${CMAKE_SOURCE_DIR}/src/engine
  ${CMAKE_SOURCE_DIR}/src
  ${sol2_SOURCE_DIR}/include
  ${lua_SOURCE_DIR}
)

target_link_libraries(aetherium_core PUBLIC
  aetherium_ir
  ryml::ryml
  ixwebsocket
)

if(AETHERIUM_ENABLE_LUA_SCRIPT_ENGINE)
  target_link_libraries(aetherium_core PUBLIC lua_static)
endif()

add_library(aetherium_platform_desktop INTERFACE)
target_link_libraries(aetherium_platform_desktop INTERFACE
  aetherium_runtime_core
  aetherium_compile_frontend
  aetherium_transport_ws
)
target_include_directories(aetherium_platform_desktop INTERFACE
  ${CMAKE_SOURCE_DIR}/src/engine
  ${CMAKE_SOURCE_DIR}/src
)

# AVR platform scaffolding target (Arduino IDE/library integration lives under src/engine/embedded/arduino).
# This is a stable dependency name for downstream code while the runtime-core split is completed.
add_library(aetherium_platform_avr INTERFACE)
target_link_libraries(aetherium_platform_avr INTERFACE aetherium_runtime_core)
target_include_directories(aetherium_platform_avr INTERFACE
  ${CMAKE_SOURCE_DIR}/src
  ${CMAKE_SOURCE_DIR}/src/engine
  ${CMAKE_SOURCE_DIR}/src/engine/embedded/arduino
)
target_compile_definitions(aetherium_platform_avr INTERFACE
  AETHERIUM_PLATFORM_AVR=1
  AETHERIUM_DISABLE_LUA_SCRIPT_ENGINE=1
)

# ESP32 platform scaffolding target (shares runtime core and Arduino embedded adapters).
add_library(aetherium_platform_esp32 INTERFACE)
target_link_libraries(aetherium_platform_esp32 INTERFACE aetherium_runtime_core)
target_include_directories(aetherium_platform_esp32 INTERFACE
  ${CMAKE_SOURCE_DIR}/src
  ${CMAKE_SOURCE_DIR}/src/engine
  ${CMAKE_SOURCE_DIR}/src/engine/embedded/arduino
)
target_compile_definitions(aetherium_platform_esp32 INTERFACE
  AETHERIUM_PLATFORM_ESP32=1
  AETHERIUM_DISABLE_LUA_SCRIPT_ENGINE=1
)

# Desktop engine executable
add_executable(aetherium_engine
  src/engine/main.cpp
  src/engine/argparser.cpp
  src/engine/automata_validator.cpp
)

target_include_directories(aetherium_engine PRIVATE ${CMAKE_SOURCE_DIR}/src)

target_link_libraries(aetherium_engine PRIVATE 
  aetherium_core
)

# In-process command smoke checker for engine protocol command handling.
# Disabled by default so production/container builds do not require test sources.
if(AETHERIUM_BUILD_ENGINE_SMOKE)
  if(EXISTS "${CMAKE_SOURCE_DIR}/tests/engine_command_smoke.cpp")
    add_executable(aetherium_engine_command_smoke
      tests/engine_command_smoke.cpp
    )

    target_include_directories(aetherium_engine_command_smoke PRIVATE
      ${CMAKE_SOURCE_DIR}/src
      ${CMAKE_SOURCE_DIR}/src/engine
    )

    target_link_libraries(aetherium_engine_command_smoke PRIVATE
      aetherium_core
    )
  else()
    message(WARNING "AETHERIUM_BUILD_ENGINE_SMOKE=ON but tests/engine_command_smoke.cpp was not found; skipping smoke target.")
  endif()
endif()
