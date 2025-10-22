//
// Created by kubino on 10/22/25.
//

#ifndef AETHERIUMAUTOMATA_AUTOMATA_STATE_HPP
#define AETHERIUMAUTOMATA_AUTOMATA_STATE_HPP
#include "automata.hpp"

enum ExecutionState {
    INITIATING,
    RUNNING,
    STOPPED,
    FINISHED
};

class AutomataState {
public:
    ExecutionState currentState;
    State * current;
    Automata * au;
    // TODO: here will go network configuration, clocks, random seed, etc
};


#endif //AETHERIUMAUTOMATA_AUTOMATA_STATE_HPP