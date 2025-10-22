#include "engine.hpp"
#include "automata_state.hpp"

int Engine::run(Automata& automata) {
    AutomataState state{INITIATING, &automata.states[0], &automata};

    // TODO: add cancelation token
    while (1) {
        // get inputs

        // check transitions from current state

        // perform transitions if any available
            // execute body of new state

        // update current state

    }

    return 0;
}