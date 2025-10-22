cmake_minimum_required(VERSION 3.18)

project(AetheriumAutomata
  VERSION 0.1.0
  DESCRIPTION "Aetherium Automata Platform"
  LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include(FetchContent)
FetchContent_Declare(ryml
        GIT_REPOSITORY https://github.com/biojppm/rapidyaml.git
        GIT_TAG v0.10.0
        GIT_SHALLOW FALSE
)
FetchContent_MakeAvailable(ryml)

add_executable(aetherium_engine
  src/engine/main.cpp
  src/engine/argparser.cpp
  src/engine/engine.cpp
  src/engine/automata_parser.cpp
  src/engine/automata_validator.cpp
        src/engine/automata_state.cpp
        src/engine/automata_state.hpp
        src/transport/itransport.hpp
        src/transport/console_transport.cpp
        src/transport/console_transport.hpp
        src/transport/mqtt_transport.cpp
        src/transport/mqtt_transport.hpp)

target_include_directories(aetherium_engine PRIVATE ${CMAKE_SOURCE_DIR}/src)

target_link_libraries(aetherium_engine PRIVATE ryml::ryml)
