#include "automata_validator.hpp"
#include <fstream>
#include <sstream>
#include <ryml.hpp>

bool AutomataValidator::validate(const std::string &filePath) {
    std::ifstream file(filePath);
    if (!file.is_open()) {
        return false;
    }
    std::stringstream buffer;
    
    buffer << file.rdbuf();
    std::string yaml_content = buffer.str();

    try {
        c4::csubstr yamlView(yaml_content.c_str(), yaml_content.size());
        ryml::Tree tree = ryml::parse_in_arena(yamlView);
        ryml::ConstNodeRef root = tree.rootref();

        if (!root.is_map() && !root.is_seq()) {
            return false;
        }

        if (root.is_map()) {
            return root.has_child("config") && root.has_child("automata") && root.has_child("version");
        }
        for (auto child : root.children()) {
            if (!child.is_map()) continue;
            if (child.has_child("config") || child.has_child("automata") || child.has_child("version")) {
                return true;
            }
        }
        return false;
    } catch (...) {
        return false;
    }
}
