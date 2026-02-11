#ifndef AETHERIUM_AUTOMATA_LOADER_HPP
#define AETHERIUM_AUTOMATA_LOADER_HPP

#include "parser.hpp"
#include "types.hpp"

#include <memory>
#include <string>
#include <vector>

namespace aeth {

struct AutomataLoadResult {
    std::unique_ptr<Automata> automata;
    std::string source;
    std::vector<std::string> warnings;
    std::vector<std::string> errors;

    [[nodiscard]] bool success() const {
        return automata != nullptr && errors.empty();
    }
};

class AutomataLoader {
public:
    AutomataLoader() = default;

    Result<AutomataLoadResult> loadFromFile(const std::string& filePath) const;
    Result<AutomataLoadResult> loadFromString(const std::string& yaml,
                                              const std::string& basePath,
                                              const std::string& sourceLabel = "<memory>") const;

    Result<void> validateFile(const std::string& filePath,
                              std::vector<std::string>* warnings = nullptr,
                              std::vector<std::string>* errors = nullptr) const;

private:
    static Result<AutomataLoadResult> fromParseResult(ParseResult parseResult,
                                                      const std::string& sourceLabel);
};

} // namespace aeth

#endif // AETHERIUM_AUTOMATA_LOADER_HPP
