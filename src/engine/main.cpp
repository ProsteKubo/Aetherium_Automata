#define RYML_SINGLE_HDR_DEFINE_NOW
#include "argparser.hpp"

int main(int argc, char *argv[]) {
  bool success = ArgParser::parse(argc, argv);
  
  if (!success) {
    return -1;
  }

  return 0;
}
