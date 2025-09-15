#include "automata.hpp"
#include "argparser.hpp"

int main(int argc, char *argv[]) {
  bool success = ArgParser::parse(argc, argv);
  
  if (!success) {
    return -1;
  }

  if (ArgParser::automataFile != "") {
    if (ArgParser::validateAutomataFlag) {

    }

    if (ArgParser::runFlag) {
      
    }
  }

  return 0;
}
