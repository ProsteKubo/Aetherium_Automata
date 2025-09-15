cmake_minimum_required(VERSION 3.18)

project(AetheriumAutomata
  VERSION 0.1.0
  DESCRIPTION "Aetherium Automata Platform"
  LANGUAGES CXX)

option(AETHERIUM_BUILD_ENGINE "Build the engine executable" ON)
option(AETHERIUM_ENABLE_TESTS "Enable tests" ON)
option(AETHERIUM_FETCH_RYML "Automatically fetch rapidyaml + c4core" ON)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(AETHERIUM_BUILD_ENGINE)
  add_executable(aetherium_engine
    src/engine/main.cpp
    src/engine/argparser.cpp
    src/engine/engine.cpp
    src/engine/automata_parser.cpp)

  target_compile_features(aetherium_engine PRIVATE cxx_std_17)
  target_include_directories(aetherium_engine PRIVATE ${CMAKE_SOURCE_DIR}/src)

  # Windows-friendly output names
  set_target_properties(aetherium_engine PROPERTIES
    OUTPUT_NAME "aetherium_engine")
endif()

# YAML backend: rapidyaml (ryml) via FetchContent
if(AETHERIUM_FETCH_RYML)
  include(FetchContent)

  FetchContent_Declare(
    ryml
    GIT_REPOSITORY https://github.com/biojppm/rapidyaml.git
    GIT_TAG        v0.9.0
    GIT_SHALLOW FALSE

  )
  FetchContent_MakeAvailable(ryml)

  if(TARGET aetherium_engine)
    target_link_libraries(aetherium_engine PRIVATE ryml::ryml)
  endif()
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

    # Additional argument parsing tests
    add_test(NAME engine_argparse_unknown_flag
      COMMAND ${Python3_EXECUTABLE} ${CMAKE_SOURCE_DIR}/tests/test_engine_argparse.py
              --binary ${ENGINE_BIN} --case unknown_flag)
    set_tests_properties(engine_argparse_unknown_flag PROPERTIES
      WORKING_DIRECTORY ${CMAKE_SOURCE_DIR})

    add_test(NAME engine_argparse_missing_arg_run
      COMMAND ${Python3_EXECUTABLE} ${CMAKE_SOURCE_DIR}/tests/test_engine_argparse.py
              --binary ${ENGINE_BIN} --case missing_arg_run)
    set_tests_properties(engine_argparse_missing_arg_run PROPERTIES
      WORKING_DIRECTORY ${CMAKE_SOURCE_DIR})

    add_test(NAME engine_argparse_mode_network_ok
      COMMAND ${Python3_EXECUTABLE} ${CMAKE_SOURCE_DIR}/tests/test_engine_argparse.py
              --binary ${ENGINE_BIN} --case mode_network_ok)
    set_tests_properties(engine_argparse_mode_network_ok PROPERTIES
      WORKING_DIRECTORY ${CMAKE_SOURCE_DIR})

    add_test(NAME engine_argparse_mode_invalid
      COMMAND ${Python3_EXECUTABLE} ${CMAKE_SOURCE_DIR}/tests/test_engine_argparse.py
              --binary ${ENGINE_BIN} --case mode_invalid)
    set_tests_properties(engine_argparse_mode_invalid PROPERTIES
      WORKING_DIRECTORY ${CMAKE_SOURCE_DIR})

    add_test(NAME engine_argparse_run_valid_file
      COMMAND ${Python3_EXECUTABLE} ${CMAKE_SOURCE_DIR}/tests/test_engine_argparse.py
              --binary ${ENGINE_BIN} --case run_valid_file
              --file ${CMAKE_SOURCE_DIR}/example/automata/automata-yaml-examples/one-state-automata-inline.yaml)
    set_tests_properties(engine_argparse_run_valid_file PROPERTIES
      WORKING_DIRECTORY ${CMAKE_SOURCE_DIR})

    add_test(NAME engine_argparse_validate_missing_file
      COMMAND ${Python3_EXECUTABLE} ${CMAKE_SOURCE_DIR}/tests/test_engine_argparse.py
              --binary ${ENGINE_BIN} --case validate_missing_file)
    set_tests_properties(engine_argparse_validate_missing_file PROPERTIES
      WORKING_DIRECTORY ${CMAKE_SOURCE_DIR})

    add_test(NAME engine_argparse_config_missing_file
      COMMAND ${Python3_EXECUTABLE} ${CMAKE_SOURCE_DIR}/tests/test_engine_argparse.py
              --binary ${ENGINE_BIN} --case config_missing_file)
    set_tests_properties(engine_argparse_config_missing_file PROPERTIES
      WORKING_DIRECTORY ${CMAKE_SOURCE_DIR})
  endif()
endif()
