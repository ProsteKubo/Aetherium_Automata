#include "argparser.hpp"
#include <iostream>
#include <getopt.h>
#include <filesystem>
#include <cstdlib>

bool ArgParser::parse(int argc, char* argv[]) {
    helpFlag = false;
    versionFlag = false;
    verboseFlag = false;
    debugFlag = false;
    validateAutomataFlag = false;
    runFlag = false;
    configProvidedFlag = false;
    automataFile.clear();
    configFile.clear();
    serverUrl.clear();
    traceFile.clear();
    instanceId = "engine.local";
    placement = "host";
    transportName = "local";
    controlPlaneInstance = "server";
    faultProfileName = "production";
    mode = detached;
    maxTransitions = 0;
    maxTicks = 0;
    seed = 0;
    seedProvided = false;
    faultDelayMs = 0;
    faultJitterMs = 0;
    faultDisconnectPeriodMs = 0;
    faultDisconnectDurationMs = 0;
    faultDropProbability = 0.0;
    faultDuplicateProbability = 0.0;
    faultSuccessProbability = 1.0;
    faultIngressFlag = false;
    batteryPresent = false;
    batteryExternalPower = true;
    batteryPercent = 100.0;
    batteryLowThresholdPercent = 20.0;
    batteryDrainPerTickPercent = 0.0;
    batteryDrainPerMessagePercent = 0.0;
    latencyBudgetMs = 0;
    latencyWarningMs = 0;

    const auto short_opts = "hvr:m:c:n:s:t:";
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
        {"trace-file", required_argument, NULL, 2},
        {"instance-id", required_argument, NULL, 3},
        {"placement", required_argument, NULL, 4},
        {"transport", required_argument, NULL, 5},
        {"control-plane-instance", required_argument, NULL, 6},
        {"fault-profile", required_argument, NULL, 7},
        {"fault-delay-ms", required_argument, NULL, 8},
        {"fault-jitter-ms", required_argument, NULL, 9},
        {"fault-drop-probability", required_argument, NULL, 10},
        {"fault-duplicate-probability", required_argument, NULL, 11},
        {"fault-success-probability", required_argument, NULL, 12},
        {"fault-disconnect-period-ms", required_argument, NULL, 13},
        {"fault-disconnect-duration-ms", required_argument, NULL, 14},
        {"fault-ingress", no_argument, NULL, 15},
        {"seed", required_argument, NULL, 16},
        {"battery-present", no_argument, NULL, 17},
        {"battery-percent", required_argument, NULL, 18},
        {"battery-low-threshold-percent", required_argument, NULL, 19},
        {"battery-drain-per-tick-percent", required_argument, NULL, 20},
        {"battery-drain-per-message-percent", required_argument, NULL, 21},
        {"battery-external-power", no_argument, NULL, 22},
        {"latency-budget-ms", required_argument, NULL, 23},
        {"latency-warning-ms", required_argument, NULL, 24},
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

            case 2:
                traceFile = optarg;
                break;

            case 3:
                instanceId = optarg;
                break;

            case 4:
                placement = optarg;
                break;

            case 5:
                transportName = optarg;
                break;

            case 6:
                controlPlaneInstance = optarg;
                break;

            case 7:
                faultProfileName = optarg;
                break;

            case 8:
                faultDelayMs = static_cast<uint32_t>(std::strtoul(optarg, nullptr, 10));
                break;

            case 9:
                faultJitterMs = static_cast<uint32_t>(std::strtoul(optarg, nullptr, 10));
                break;

            case 10:
                faultDropProbability = std::strtod(optarg, nullptr);
                break;

            case 11:
                faultDuplicateProbability = std::strtod(optarg, nullptr);
                break;

            case 12:
                faultSuccessProbability = std::strtod(optarg, nullptr);
                break;

            case 13:
                faultDisconnectPeriodMs = static_cast<uint32_t>(std::strtoul(optarg, nullptr, 10));
                break;

            case 14:
                faultDisconnectDurationMs = static_cast<uint32_t>(std::strtoul(optarg, nullptr, 10));
                break;

            case 15:
                faultIngressFlag = true;
                break;

            case 16:
                seed = static_cast<uint64_t>(std::strtoull(optarg, nullptr, 10));
                seedProvided = true;
                break;

            case 17:
                batteryPresent = true;
                break;

            case 18:
                batteryPresent = true;
                batteryExternalPower = false;
                batteryPercent = std::strtod(optarg, nullptr);
                break;

            case 19:
                batteryPresent = true;
                batteryLowThresholdPercent = std::strtod(optarg, nullptr);
                break;

            case 20:
                batteryPresent = true;
                batteryExternalPower = false;
                batteryDrainPerTickPercent = std::strtod(optarg, nullptr);
                break;

            case 21:
                batteryPresent = true;
                batteryExternalPower = false;
                batteryDrainPerMessagePercent = std::strtod(optarg, nullptr);
                break;

            case 22:
                batteryPresent = true;
                batteryExternalPower = true;
                break;

            case 23:
                latencyBudgetMs = static_cast<uint32_t>(std::strtoul(optarg, nullptr, 10));
                break;

            case 24:
                latencyWarningMs = static_cast<uint32_t>(std::strtoul(optarg, nullptr, 10));
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
        "  --server, -s <url>           Server URL for network mode (default: ws://localhost:4000/socket/device/websocket)\n"
        "  --trace-file <path>          Write local execution trace as JSONL\n"
        "  --instance-id <id>           Deployment instance identifier for trace metadata\n"
        "  --placement <name>           Placement label for trace metadata (default: host)\n"
        "  --transport <name>           Transport label for trace metadata (default: local)\n"
        "  --control-plane-instance <id> Control-plane peer label for trace metadata\n"
        "  --fault-profile <name>       Name of the active fault profile\n"
        "  --fault-delay-ms <N>         Fixed outbound delay injection in milliseconds\n"
        "  --fault-jitter-ms <N>        Additional outbound jitter injection in milliseconds\n"
        "  --fault-drop-probability <P> Drop probability in range 0..1\n"
        "  --fault-duplicate-probability <P> Duplicate probability in range 0..1\n"
        "  --fault-success-probability <P> Delivery success probability in range 0..1\n"
        "  --fault-disconnect-period-ms <N> Simulated disconnect cycle period in milliseconds\n"
        "  --fault-disconnect-duration-ms <N> Simulated disconnect window length in milliseconds\n"
        "  --fault-ingress              Also apply fault profile to ingress boundaries\n"
        "  --seed <N>                   Seed for fault decisions and replayable local runs\n"
        "  --battery-present            Include battery state in deployment metadata and trace\n"
        "  --battery-percent <P>        Initial battery charge percent for simulated deployments\n"
        "  --battery-low-threshold-percent <P> Low-battery threshold for trace annotation\n"
        "  --battery-drain-per-tick-percent <P> Simulated battery drain per engine tick\n"
        "  --battery-drain-per-message-percent <P> Simulated battery drain per outbound message\n"
        "  --battery-external-power     Mark deployment as externally powered\n"
        "  --latency-budget-ms <N>      Deployment latency budget for boundary traces\n"
        "  --latency-warning-ms <N>     Deployment warning threshold for latency-sensitive paths\n\n";
}

void ArgParser::printVersion() {
    // TODO: make this dynamic using cmake
    std::cout << "version 0.0.1\n\n";
}
