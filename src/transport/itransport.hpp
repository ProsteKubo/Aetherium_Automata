//
// Created by kubino on 10/22/25.
//

#ifndef AETHERIUMAUTOMATA_ITRANSPORT_HPP
#define AETHERIUMAUTOMATA_ITRANSPORT_HPP
#include <string>
#include <utility>

#include "engine/automata.hpp"

enum MessageType {
    INPUT,
    OUTPUT,
    INITIATE,
};

class Message {
public:
    virtual ~Message() = default;
    Message(std::string  raw_message, MessageType type) : type(type), raw_message(std::move(raw_message)) {}

    MessageType type;
    virtual std::string toString();
protected:
    std::string raw_message;
};

class InputMessage final : public Message {
public:
    InputMessage(const std::string& raw_message, Variable input) :
        Message(raw_message, INPUT),  input(std::move(input)) {}

    Variable input;
    std::string toString() override;
};

class OutputMessage final : public Message {
public:
    OutputMessage(const std::string& raw_message, Variable output) :
        Message(raw_message, OUTPUT), output(std::move(output)) {}

    Variable output;
    std::string toString() override;
};

class ITransport {
public:
    virtual ~ITransport() = default;
    virtual bool send(Message message) = 0;
    virtual Message receive() = 0;
    virtual bool is_available() = 0;
    virtual std::string info() = 0;
    virtual void connect() = 0;
    virtual void close() = 0;
protected:
    // This will be used when clusters of automata are implemented exist so that the structure of mqtt won't fall apart
    std::string prefix_name;
};

#endif //AETHERIUMAUTOMATA_ITRANSPORT_HPP