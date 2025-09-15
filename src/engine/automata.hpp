#ifndef AETHERIUM_AUTOMATA_HPP
#define AETHERIUM_AUTOMATA_HPP

#include <variant>
#include <string>
#include <vector>
#include <ryml.hpp>

// TODO: add toString as inherent for every class so printing whole automata is easy, add printing for automata as well

template <class T>
class Node {
    virtual T parse(ryml::ConstNodeRef node);
    virtual std::string toString();
};

enum VariableType {
    BOOL,
    INT,
    STRING,
    VOID
};

// empty class for NULL not sure if other variant is possible, right now this is useless 
class Void {

};

class Variable : Node<Variable> {
public:
    using Value = std::variant<bool, int, std::string, Void>;

    Variable() = default;
    explicit Variable(Void v) : data_(v) {}
    explicit Variable(bool v) : data_(v) {}
    explicit Variable(int v) : data_(v) {}
    explicit Variable(std::string v) : data_(v) {}
    Variable(const char* s) : data_(std::string(s)) {}

    VariableType type() const {
        return static_cast<VariableType>(data_.index());
    }

    template <class T>
    bool is() const { return std::holds_alternative<T>(data_); }

    template <class T>
    T& get() { return std::get<T>(data_); }

    template <class T>
    const T& get() const { return std::get<T>(data_); }

    template <class T>
    void set(T&& v) { data_ = std::forward<T>(v); };

private:
    Value data_;
};

class Code : Node<Code> {
public:
    std::string code;
    VariableType reutrnType;
};

class State : Node<State> {
public:
    std::vector<Variable> inputs;
    std::vector<Variable> outputs;
    std::vector<Variable> variables;
    Code on_enter;
    Code on_exit;
    Code body; // TODO: body will be implemented later, or fully dropped
};

class Transition : Node<Transition> {
public:
    State from;
    State to;
    Code condition;
    Code triggered;
    Code body; // TODO: body will be implemented later, or fully dropped
};

class Automata : Node<Automata> {
public:
    std::vector<State> states;
    std::vector<Transition> transitions;
    std::vector<Variable> variables;
};

#endif // AETHERIUM_AUTOMATA_HPP
