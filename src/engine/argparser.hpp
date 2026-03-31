#ifndef AETHERIUM_ARGPARSER_HPP
#define AETHERIUM_ARGPARSER_HPP
#include <string>
#include <cstdint>

enum EngineMode{
    detached,
    network
};

struct ArgParser {
    static bool parse(int argc, char* argv[]);
    static void printHelp();
    static void printVersion();

    // flags
    inline static bool helpFlag = false;
    inline static bool versionFlag = false;
    inline static bool verboseFlag = false;
    inline static bool debugFlag = false;
    inline static bool validateAutomataFlag = false;
    inline static bool runFlag = false;
    inline static bool configProvidedFlag = false;

    inline static std::string automataFile;
    inline static std::string configFile;
    inline static std::string serverUrl;
    inline static std::string traceFile;
    inline static std::string instanceId = "engine.local";
    inline static std::string placement = "host";
    inline static std::string transportName = "local";
    inline static std::string controlPlaneInstance = "server";
    inline static std::string faultProfileName = "production";

    inline static EngineMode mode = detached;
    inline static uint64_t maxTransitions = 0;  // 0 = unlimited
    inline static uint64_t maxTicks = 0;        // 0 = use default (10 million)
    inline static uint64_t seed = 0;
    inline static bool seedProvided = false;
    inline static uint32_t faultDelayMs = 0;
    inline static uint32_t faultJitterMs = 0;
    inline static uint32_t faultDisconnectPeriodMs = 0;
    inline static uint32_t faultDisconnectDurationMs = 0;
    inline static double faultDropProbability = 0.0;
    inline static double faultDuplicateProbability = 0.0;
    inline static double faultSuccessProbability = 1.0;
    inline static bool faultIngressFlag = false;
    inline static bool batteryPresent = false;
    inline static bool batteryExternalPower = true;
    inline static double batteryPercent = 100.0;
    inline static double batteryLowThresholdPercent = 20.0;
    inline static double batteryDrainPerTickPercent = 0.0;
    inline static double batteryDrainPerMessagePercent = 0.0;
    inline static uint32_t latencyBudgetMs = 0;
    inline static uint32_t latencyWarningMs = 0;
};

#endif //AETHERIUM_ARGPARSER_HPP
