#include "automata.hpp"
#include "argparser.hpp"
#include "automata_validator.hpp"
#include "engine.hpp"

int main(const int argc, char *argv[]) {
  if (!ArgParser::parse(argc, argv)) {
    return -1;
  }

  if (!ArgParser::automataFile.empty()) {
    if (ArgParser::validateAutomataFlag) {
      if (AutomataValidator::validate(ArgParser::automataFile)) {
        printf("Automata is valid.\n");
      } else {
        printf("Automata is invalid.\n");
      }
      return 0;
    }

    if (ArgParser::runFlag) {
      Engine engine;
      const Automata automata(ArgParser::automataFile);
      engine.run(automata);
    }
  }

  return 0;
}
