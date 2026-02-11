#include "automata_loader.hpp"

#include <sstream>

namespace aeth {

Result<AutomataLoadResult> AutomataLoader::loadFromFile(const std::string& filePath) const {
    AutomataParser parser;
    auto parseResult = parser.parseFile(filePath);
    return fromParseResult(std::move(parseResult), filePath);
}

Result<AutomataLoadResult> AutomataLoader::loadFromString(const std::string& yaml,
                                                          const std::string& basePath,
                                                          const std::string& sourceLabel) const {
    AutomataParser parser;
    auto parseResult = parser.parseString(yaml, basePath);
    return fromParseResult(std::move(parseResult), sourceLabel);
}

Result<void> AutomataLoader::validateFile(const std::string& filePath,
                                          std::vector<std::string>* warnings,
                                          std::vector<std::string>* errors) const {
    auto loaded = loadFromFile(filePath);
    if (loaded.isError()) {
        if (errors) {
            errors->push_back(loaded.error());
        }
        return Result<void>::error(loaded.error());
    }

    if (warnings) {
        *warnings = loaded.value().warnings;
    }
    if (errors) {
        *errors = loaded.value().errors;
    }

    return Result<void>::ok();
}

Result<AutomataLoadResult> AutomataLoader::fromParseResult(ParseResult parseResult,
                                                           const std::string& sourceLabel) {
    AutomataLoadResult loaded;
    loaded.source = sourceLabel;
    loaded.warnings = std::move(parseResult.warnings);
    loaded.errors = std::move(parseResult.errors);
    loaded.automata = std::move(parseResult.automata);

    if (!loaded.success()) {
        std::ostringstream oss;
        oss << "automata load failed";
        if (!loaded.errors.empty()) {
            oss << ": " << loaded.errors.front();
        }
        return Result<AutomataLoadResult>::error(oss.str());
    }

    auto modelErrors = loaded.automata->validate();
    if (!modelErrors.empty()) {
        std::ostringstream oss;
        oss << "automata model invalid: " << modelErrors.front();
        return Result<AutomataLoadResult>::error(oss.str());
    }

    return Result<AutomataLoadResult>::ok(std::move(loaded));
}

} // namespace aeth
