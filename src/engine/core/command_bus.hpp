#ifndef AETHERIUM_COMMAND_BUS_HPP
#define AETHERIUM_COMMAND_BUS_HPP

#include "protocol.hpp"

#include <functional>
#include <memory>
#include <unordered_map>
#include <vector>

namespace aeth {

class Engine;

class CommandBus {
public:
    using Replies = std::vector<std::unique_ptr<protocol::Message>>;
    using Handler = std::function<Replies(Engine&, const protocol::Message&)>;

    void registerHandler(protocol::MessageType type, Handler handler);
    void setDefaultHandler(Handler handler);
    Replies route(Engine& engine, const protocol::Message& message) const;

private:
    std::unordered_map<protocol::MessageType, Handler> handlers_;
    Handler defaultHandler_;
};

} // namespace aeth

#endif // AETHERIUM_COMMAND_BUS_HPP
