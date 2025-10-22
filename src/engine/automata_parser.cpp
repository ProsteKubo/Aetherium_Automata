#include <fstream>
#include <sstream>
#include <ryml_std.hpp>

#include "automata.hpp"

Variable Variable::parse(ryml::ConstNodeRef node) {
    const c4::csubstr keyName = node.val();
    std::string s;
    s.assign(keyName.str, keyName.size());
    const unsigned long pos = s.find(':');
    if (pos != std::string::npos) {
        const std::string var_name = s.substr(0, pos);
        const std::string var_type = s.substr(pos + 1);
        this->name = var_name;

        // TODO: if this will be useful later extract to helper function
        if (var_type == "int") {
            this->set<int>(0);
        } else if (var_type == "bool") {
            this->set<bool>(false);
        } else if (var_type == "string") {
            this->set<std::string>("");
        }
    } else {
        this->name = s;
        this->set<std::string>("");
    }
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

State State::parse(const ryml::ConstNodeRef node) {
    const c4::csubstr keySubstring = node.key();
    this->name.assign(keySubstring.str, keySubstring.size());

    const auto inputs_node = node["inputs"];
    const auto outputs_node = node["outputs"];
    const auto code_node = node["code"];
    const auto variables_node = node["variables"];

    for (int i = 0; i < inputs_node.num_children(); i++) {
        Variable v;
        this->inputs.push_back(v.parse(inputs_node[i]));
    }

    for (int i = 0; i < outputs_node.num_children(); i++) {
        Variable v;
        this->outputs.push_back(v.parse(outputs_node[i]));
    }

    for (int i = 0; i < variables_node.num_children(); i++) {
        Variable v;
        this->variables.push_back(v.parse(variables_node[i]));
    }

    Code code;
    this->body = code.parse(code_node);

    // TODO: add examples for on_enter and on_exit for inline yaml example

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
        const auto states_node = node["automata"]["states"];
        const auto transitions_node = node["automata"]["transitions"];

        for (const auto state : states_node.children()) {
            State s;
            this->states.push_back(s.parse(state));
        }

        for (const auto transition : transitions_node.children()) {
            Transition t;
            this->transitions.push_back(t.parse(transition));
        }
    }

    return *this;
}

std::string Automata::toString() {
    return "";
}
