#include <fstream>
#include <sstream>
#include <ryml_std.hpp>

#include "automata.hpp"

Variable Variable::parse(ryml::ConstNodeRef node) {
    return *this;
}

std::string Variable::toString() {
    return "";
}

Code Code::parse(ryml::ConstNodeRef node) {
    return *this;
}

std::string Code::toString() {
    return "";
}

State State::parse(ryml::ConstNodeRef node) {
    return *this;
}

std::string State::toString() {
    return "";
}

Transition Transition::parse(ryml::ConstNodeRef node) {
    return *this;
}

std::string Transition::toString() {
    return "";
}

Automata::Automata(const std::string& filePath) {
    std::ifstream file(filePath);
    std::stringstream buffer;

    buffer << file.rdbuf();
    std::string yaml_content = buffer.str();

    ryml::csubstr const_string(yaml_content.c_str(), yaml_content.size());
    ryml::Tree tree = ryml::parse_in_arena(const_string);

    ryml::ConstNodeRef root = tree.rootref();
    this->type = FOLDER;
    this->Automata::parse(root);
}

Automata Automata::parse(ryml::ConstNodeRef node) {
    this->states.clear();
    this->transitions.clear();
    this->variables.clear();

    if (node["version"].is_keyval()) {
        node["version"] >> this->version;
    }

    if (node["config"].is_map()) {
        node["config"]["name"] >> this->name;
        std::string type_s;
        node["config"]["type"] >> type_s;
        if (type_s == "inline") {
            this->type = INLINE;
        } else if (type_s == "folder") {
            this->type = FOLDER;
            node["config"]["location"] >> this->rootPath;
        } else {
            throw std::runtime_error("Unknown automata type");
        }
    }

    if (node["automata"].is_map()) {
        auto states_node = node["automata"]["states"];
        auto transitions_node = node["automata"]["transitions"];

        for (auto state : states_node.children()) {
            State s;
            this->states.push_back(s.parse(state));
        }

        for (auto transition : transitions_node.children()) {
            Transition t;
            this->transitions.push_back(t.parse(transition));
        }
    }

    return *this;
}

std::string Automata::toString() {
    return "";
}
