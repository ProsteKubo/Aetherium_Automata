#ifndef AUTOMATA_VALIDATOR_HPP
#define AUTOMATA_VALIDATOR_HPP
#include <string>

class AutomataValidator {
public:
    static bool validate(const std::string& filePath);
};

#endif // AUTOMATA_VALIDATOR_HPP