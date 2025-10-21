#include "automata_validator.hpp"
#include <fstream>
#include <sstream>
#include <ryml.hpp>

bool AutomataValidator::validate(const std::string &filePath) {
    std::ifstream file(filePath);
    std::stringstream buffer;
    
    buffer << file.rdbuf();
    std::string yaml_content = buffer.str();

    ryml::csubstr const_string = yaml_content.data();
    ryml::Tree tree = ryml::parse_in_arena(const_string);

    ryml::ConstNodeRef root = tree.rootref();

    RYML_CHECK(root.is_map());
    RYML_CHECK(root.has_child("config"));
    RYML_CHECK(root.has_child("automata"));
    RYML_CHECK(root.has_child("version"));

    return true;
}