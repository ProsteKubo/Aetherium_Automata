#include "command_bus.hpp"

#include "engine.hpp"

namespace aeth {

void CommandBus::registerHandler(protocol::MessageType type, Handler handler) {
    handlers_[type] = std::move(handler);
}

void CommandBus::setDefaultHandler(Handler handler) {
    defaultHandler_ = std::move(handler);
}

CommandBus::Replies CommandBus::route(Engine& engine, const protocol::Message& message) const {
    auto it = handlers_.find(message.type());
    if (it != handlers_.end()) {
        return it->second(engine, message);
    }
    if (defaultHandler_) {
        return defaultHandler_(engine, message);
    }
    return {};
}

} // namespace aeth
