#include "argparser.hpp"
#include <iostream>
#include <getopt.h>
#include <filesystem>

bool ArgParser::parse(int argc, char* argv[]) {
    const char* const short_opts = "hvr:m::c:";
    int verbose_flag = 0;
    int debug_flag = 0;
    option long_opts[] = {
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
                ArgParser::printHelp();
                ArgParser::helpFlag = true;
                break;

            case 'v':
                ArgParser::printVersion();
                ArgParser::versionFlag = true;
                break;

            case 'r':
                if (!std::filesystem::exists(optarg)) {
                    std::cout << "File not found: " << optarg << std::endl;
                    ArgParser::printHelp();
                    return false;
                }
                ArgParser::automataFile = optarg;
                ArgParser::runFlag = true;
                break;
            
            case 'm':
                if (strcmp(optarg, "network") == 0) {
                    ArgParser::mode = network;
                } else if (strcmp(optarg, "detached") == 0) {
                    ArgParser::mode = detached;
                } else {
                    ArgParser::printHelp();
                    return false;
                }
                break;
            
            case 'c':
                if (!std::filesystem::exists(optarg)) {
                        std::cout << "File not found: " << optarg << std::endl;
                        ArgParser::printHelp();
                        return false;
                    }
                ArgParser::configFile = optarg;
                ArgParser::configProvidedFlag = true;
                break;
            
            case 1: // validate
                if (!std::filesystem::exists(optarg)) {
                        std::cout << "File not found: " << optarg << std::endl;
                        ArgParser::printHelp();
                        return false;
                    }
                ArgParser::automataFile = optarg;
                ArgParser::validateAutomataFlag = true;
                break;
            
            default:
                ArgParser::printHelp();
                return false;
        }
    }

    ArgParser::debugFlag = debug_flag;
    ArgParser::verboseFlag = verbose_flag;

    return true;
}

void ArgParser::printHelp() {
    std::cout <<
        "Usage:\n"
        "  engine [options] \n\n"
        "Options:\n"
        "  --help                       Show this help and exit\n"
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
