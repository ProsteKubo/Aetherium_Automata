#include "argparser.hpp"
#include <iostream>
#include <getopt.h>
#include <filesystem>
#include <cstdlib>

bool ArgParser::parse(int argc, char* argv[]) {
    const auto short_opts = "hvr:m::c:n:s:t:";
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
        {"max-transitions", required_argument, NULL, 'n'},
        {"max-ticks", required_argument, NULL, 't'},
        {"server", required_argument, NULL, 's'},
        {0, 0, 0, 0}
    };

    int opt;
    while ((opt = getopt_long(argc, argv, short_opts, long_opts, NULL)) != -1) {
        switch (opt) {
            case 0:
                // Flag was set automatically by getopt_long
                break;
                
            case 'h':
                printHelp();
                helpFlag = true;
                break;

            case 'v':
                printVersion();
                versionFlag = true;
                break;

            case 'r':
                if (std::string(optarg) != "-" && !std::filesystem::exists(optarg)) {
                    std::cout << "File not found: " << optarg << std::endl;
                    printHelp();
                    return false;
                }
                automataFile = (std::string(optarg) == "-" ? std::string() : std::string(optarg));
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
            
            case 'n': // max-transitions
                maxTransitions = static_cast<uint64_t>(std::strtoull(optarg, nullptr, 10));
                break;
            
            case 't': // max-ticks
                maxTicks = static_cast<uint64_t>(std::strtoull(optarg, nullptr, 10));
                break;
            
            case 's': // server
                serverUrl = optarg;
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
        "  --run <file|- >              Runs automata (use '-' to wait for server deploy)\n"
        "  --mode [detached|network]    Selects mode engine will run in, defaults to detached\n"
        "  --config <file>              Provides configuration file if running in network mode.\n"
        "  --max-transitions, -n <N>    Maximum transitions before auto-stop (0 = unlimited)\n"
        "  --max-ticks, -t <N>          Maximum ticks before auto-stop (default: 10,000,000)\n"
        "  --server, -s <url>           Server URL for network mode (default: ws://localhost:4000/socket/device/websocket)\n\n";
}

void ArgParser::printVersion() {
    // TODO: make this dynamic using cmake
    std::cout << "version 0.0.1\n\n";
}
