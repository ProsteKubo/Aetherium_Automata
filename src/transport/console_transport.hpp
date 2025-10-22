//
// Created by kubino on 10/22/25.
//

#ifndef AETHERIUMAUTOMATA_CONSOLE_TRANSPORT_HPP
#define AETHERIUMAUTOMATA_CONSOLE_TRANSPORT_HPP
#include <queue>

#include "itransport.hpp"

class console_transport final : ITransport {
public:
    bool send(Message message) override;

    Message receive() override;

    bool is_available() override;

    std::string info() override;

    void connect() override;

    void close() override;

private:
    std::queue<Message> inputs;
};


#endif //AETHERIUMAUTOMATA_CONSOLE_TRANSPORT_HPP