cmake_minimum_required(VERSION 3.18)

project(AetheriumAutomata
  VERSION 0.1.0
  DESCRIPTION "Aetherium Automata Platform"
  LANGUAGES CXX)

option(AETHERIUM_BUILD_ENGINE "Build the engine executable" ON)
option(AETHERIUM_ENABLE_TESTS "Enable tests" ON)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(AETHERIUM_BUILD_ENGINE)
  add_executable(aetherium_engine
    src/engine/main.cpp)

  target_compile_features(aetherium_engine PRIVATE cxx_std_17)
  target_include_directories(aetherium_engine PRIVATE ${CMAKE_SOURCE_DIR}/src)

  # Windows-friendly output names
  set_target_properties(aetherium_engine PROPERTIES
    OUTPUT_NAME "aetherium_engine")
endif()

include(CTest)
if(AETHERIUM_ENABLE_TESTS)
  enable_testing()

  find_package(Python3 COMPONENTS Interpreter QUIET)
  if(NOT Python3_Interpreter_FOUND)
    message(WARNING "Python3 not found; CLI tests will be skipped.")
  elseif(TARGET aetherium_engine)
    set(ENGINE_BIN $<TARGET_FILE:aetherium_engine>)

    # Test: --help prints usage and exits 0
    add_test(NAME engine_cli_help
      COMMAND ${Python3_EXECUTABLE} ${CMAKE_SOURCE_DIR}/tests/test_engine_cli.py
              --binary ${ENGINE_BIN} --case help)
    set_tests_properties(engine_cli_help PROPERTIES
      WORKING_DIRECTORY ${CMAKE_SOURCE_DIR}
      FAIL_REGULAR_EXPRESSION "^$" # placeholder; adjust when implemented
    )

    # Test: --version prints a version and exits 0
    add_test(NAME engine_cli_version
      COMMAND ${Python3_EXECUTABLE} ${CMAKE_SOURCE_DIR}/tests/test_engine_cli.py
              --binary ${ENGINE_BIN} --case version)
    set_tests_properties(engine_cli_version PROPERTIES
      WORKING_DIRECTORY ${CMAKE_SOURCE_DIR})

    # Test: validate a known-good YAML returns 0
    add_test(NAME engine_cli_validate_valid
      COMMAND ${Python3_EXECUTABLE} ${CMAKE_SOURCE_DIR}/tests/test_engine_cli.py
              --binary ${ENGINE_BIN} --case validate_valid
              --file ${CMAKE_SOURCE_DIR}/example/automata/automata-yaml-examples/one-state-automata-inline.yaml)
    set_tests_properties(engine_cli_validate_valid PROPERTIES
      WORKING_DIRECTORY ${CMAKE_SOURCE_DIR})

    # Test: validate a known-bad YAML returns non-zero
    add_test(NAME engine_cli_validate_invalid
      COMMAND ${Python3_EXECUTABLE} ${CMAKE_SOURCE_DIR}/tests/test_engine_cli.py
              --binary ${ENGINE_BIN} --case validate_invalid
              --file ${CMAKE_SOURCE_DIR}/tests/data/invalid_automata.yaml)
    set_tests_properties(engine_cli_validate_invalid PROPERTIES
      WORKING_DIRECTORY ${CMAKE_SOURCE_DIR})
  endif()
endif()
