#include "argparser.hpp"
#include <iostream>
#include <getopt.h>
#include <filesystem>

bool ArgParser::parse(int argc, char* argv[]) {
    const auto short_opts = "hvr:m::c:";
    int verbose_flag = 0;
    int debug_flag = 0;
    const option long_opts[] = {
        {"help", no_argument, NULL, 'h'},
        {"version", no_argument, NULL, 'v'},
        {"debug", no_argument, &debug_flag, 1},
        {"run", required_argument, NULL, 'r'},
        {"mode", required_argument, NULL, 'm'},
        {"config", required_argument, NULL, 'c'},
        {"verbose", no_argument, &verbose_flag, 1},
        {"validate", required_argument, NULL, 1},
        {0, 0, 0, 0}
    };

    int opt;
    while ((opt = getopt_long(argc, argv, short_opts, long_opts, NULL)) != -1) {
        switch (opt) {
            case 'h':
                printHelp();
                helpFlag = true;
                break;

            case 'v':
                printVersion();
                versionFlag = true;
                break;

            case 'r':
                if (!std::filesystem::exists(optarg)) {
                    std::cout << "File not found: " << optarg << std::endl;
                    printHelp();
                    return false;
                }
                automataFile = optarg;
                runFlag = true;
                break;
            
            case 'm':
                if (std::string(optarg) == "network") {
                    mode = network;
                } else if (std::string(optarg) == "detached") {
                    mode = detached;
                } else {
                    printHelp();
                    return false;
                }
                break;
            
            case 'c':
                if (!std::filesystem::exists(optarg)) {
                        std::cout << "File not found: " << optarg << std::endl;
                        printHelp();
                        return false;
                    }
                configFile = optarg;
                configProvidedFlag = true;
                break;
            
            case 1: // validate
                if (!std::filesystem::exists(optarg)) {
                        std::cout << "File not found: " << optarg << std::endl;
                        printHelp();
                        return false;
                    }
                automataFile = optarg;
                validateAutomataFlag = true;
                break;
            
            default:
                printHelp();
                return false;
        }
    }

    debugFlag = debug_flag;
    verboseFlag = verbose_flag;

    return true;
}

void ArgParser::printHelp() {
    std::cout <<
        "Usage:\n"
        "  engine [options] \n\n"
        "Options:\n"
        "  --help                       Show help and exit\n"
        "  --version                    Show version and exit\n"
        "  --validate <file>            Validate an automata YAML and exit\n"
        "  --verbose                    Enable verbose logging\n"
        "  --debug                      Enable debug logging\n"
        "  --run <file>                 Runs automata\n"
        "  --mode [detached|network]    Selects mode engine will run in, defaults to detached\n"
        "  --config <file>              Provides configuration file if running in network mode.\n\n";
}

void ArgParser::printVersion() {
    // TODO: make this dynamic using cmake
    std::cout << "version 0.0.1\n\n";
}
