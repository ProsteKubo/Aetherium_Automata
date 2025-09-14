#ifndef AETHERIUM_ARGPARSER_HPP
#define AETHERIUM_ARGPARSER_HPP
#include <string>
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

    inline static EngineMode mode = detached;
};

#endif //AETHERIUM_ARGPARSER_HPP