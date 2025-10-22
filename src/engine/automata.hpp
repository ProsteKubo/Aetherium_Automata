#ifndef AETHERIUM_AUTOMATA_HPP
#define AETHERIUM_AUTOMATA_HPP

#include <variant>
#include <string>
#include <vector>
#include <ryml.hpp>

template <class T>
class Node {
public:
    virtual ~Node() = default;

private:
    virtual T parse(ryml::ConstNodeRef node) = 0;
    virtual std::string toString() = 0;
};

enum VariableType {
    BOOL,
    INT,
    STRING,
    VOID,
    NOT_SET
};

enum AutomataType {
    FOLDER,
    INLINE
};

// empty class for NULL not sure if other variant is possible, right now this is useless 
class Void {

};

class Variable final : Node<Variable> {
public:
    using Value = std::variant<bool, int, std::string, Void>;

    Variable() : data_(Void()), type_(NOT_SET) {};
    explicit Variable(Void v) : data_(v), type_(VOID) {}
    explicit Variable(bool v) : data_(v), type_(BOOL) {}
    explicit Variable(int v) : data_(v), type_(INT) {}
    explicit Variable(std::string v) : data_(v), type_(STRING) {}
    explicit Variable(const char* s) : data_(std::string(s)), type_(STRING) {}

    std::string name;

    [[nodiscard]] VariableType type() const {
        return static_cast<VariableType>(data_.index());
    }

    template <class T>
    [[nodiscard]] bool is() const { return std::holds_alternative<T>(data_); }

    template <class T>
    T& get() { return std::get<T>(data_); }

    template <class T>
    const T& get() const { return std::get<T>(data_); }

    template <class T>
    void set(T&& v) {
        VariableType expected_type;
        // TODO: add support for implicit conversion(int -> float etc)
        if constexpr (std::is_same_v<T, bool>) {
            expected_type = BOOL;
        } else if constexpr (std::is_same_v<T, int>) {
            expected_type = INT;
        } else if constexpr (std::is_same_v<T, std::string>) {
            expected_type = STRING;
        } else if constexpr (std::is_same_v<T, Void>) {
            expected_type = VOID;
        } else {
            expected_type = NOT_SET;
        }

        if (expected_type != type_ && type_ != NOT_SET) {
            throw std::runtime_error("type mismatch");
        }
        data_ = std::forward<T>(v);
        type_ = expected_type;
    };

    Variable parse(ryml::ConstNodeRef node) override;
    std::string toString() override;

private:
    Value data_;
    VariableType type_;
};

class Code final : Node<Code> {
public:
    std::string code;
    VariableType returnType;

    Code parse(ryml::ConstNodeRef node) override;
    std::string toString() override;
};

class State final : Node<State> {
public:
    std::vector<Variable> inputs;
    std::vector<Variable> outputs;
    std::vector<Variable> variables;
    std::string name;
    Code on_enter;
    Code on_exit;
    Code body;

    State parse(ryml::ConstNodeRef node) override;
    std::string toString() override;
};

class Transition final : Node<Transition> {
public:
    State* from;
    State* to;
    Code condition;
    Code triggered;
    Code body; // TODO: body will be implemented later, or fully dropped
    std::string name;
    Transition parse(ryml::ConstNodeRef node) override;
    std::string toString() override;

};

class Automata final : Node<Automata> {
public:
    std::vector<State> states;
    std::vector<Transition> transitions;
    std::vector<Variable> variables;
    std::string version;
    std::string name;
    AutomataType type;
    std::string rootPath;

    explicit Automata(const std::string& path);
private:
    Automata parse(ryml::ConstNodeRef node) override;
    std::string toString() override;
};

#endif // AETHERIUM_AUTOMATA_HPP
