/**
 * Aetherium Automata - Runtime Implementation
 */

#include "runtime.hpp"

#ifdef abs
#undef abs
#endif

#if defined(ARDUINO) || defined(AETHERIUM_PLATFORM_MCXN947)
#include "engine/embedded/platform/EmbeddedPlatformHooks.hpp"
#endif

#include <chrono>
#include <algorithm>

#if !defined(ARDUINO) && !defined(AETHERIUM_PLATFORM_MCXN947)
#include <thread>
#endif

namespace aeth {

// ============================================================================
// StdClock Implementation
// ============================================================================

Timestamp StdClock::now() {
#if defined(ARDUINO) || defined(AETHERIUM_PLATFORM_MCXN947)
    return aeth::embedded::platform::millis();
#else
    auto now = std::chrono::steady_clock::now();
    auto duration = now.time_since_epoch();
    return std::chrono::duration_cast<std::chrono::milliseconds>(duration).count();
#endif
}

void StdClock::sleep(uint32_t ms) {
#if defined(ARDUINO) || defined(AETHERIUM_PLATFORM_MCXN947)
    aeth::embedded::platform::delayMs(ms);
#else
    std::this_thread::sleep_for(std::chrono::milliseconds(ms));
#endif
}

// ============================================================================
// StdRandomSource Implementation
// ============================================================================

StdRandomSource::StdRandomSource() 
    : gen_(std::random_device{}()), dist_(0.0, 1.0) {}

StdRandomSource::StdRandomSource(uint64_t seed) 
    : gen_(seed), dist_(0.0, 1.0) {}

double StdRandomSource::random() {
    return dist_(gen_);
}

uint32_t StdRandomSource::randomInt(uint32_t max) {
    if (max == 0) return 0;
    std::uniform_int_distribution<uint32_t> intDist(0, max - 1);
    return intDist(gen_);
}

void StdRandomSource::seed(uint64_t seed) {
    gen_.seed(seed);
}

// ============================================================================
// TransitionResolver Implementation
// ============================================================================

const Transition* TransitionResolver::resolve(const Automata& automata, 
                                               StateId currentState) {
    // Get all transitions from current state (already sorted by priority)
    auto transitions = automata.getTransitionsFrom(currentState);
    
    if (transitions.empty()) {
        return nullptr;
    }

    // Group by priority and find first group with enabled transitions
    std::vector<EvaluatedTransition> candidates;
    uint8_t currentPriority = transitions[0]->priority;

    for (const auto* t : transitions) {
        // If we moved to lower priority and have candidates, stop
        if (t->priority > currentPriority && !candidates.empty()) {
            break;
        }
        currentPriority = t->priority;

        auto eval = evaluate(*t);
        if (eval.conditionMet) {
            candidates.push_back(eval);
        }
    }

    if (candidates.empty()) {
        return nullptr;
    }

    // Timeout transitions are fallback by design: if any other transition is
    // available in the same priority group, suppress timeout candidates.
    const bool hasNonTimeout = std::any_of(
        candidates.begin(), candidates.end(),
        [](const EvaluatedTransition& c) {
            const Transition* t = c.transition;
            return !(t->type == TransitionType::Timed &&
                     t->timedConfig.mode == TimedMode::Timeout);
        });

    if (hasNonTimeout) {
        candidates.erase(
            std::remove_if(
                candidates.begin(), candidates.end(),
                [](const EvaluatedTransition& c) {
                    const Transition* t = c.transition;
                    return t->type == TransitionType::Timed &&
                           t->timedConfig.mode == TimedMode::Timeout;
                }),
            candidates.end());
    }

    if (candidates.empty()) {
        return nullptr;
    }

    // Single candidate - return it
    if (candidates.size() == 1) {
        return candidates[0].transition;
    }

    // Multiple candidates - check if any are weighted
    bool hasWeights = std::any_of(candidates.begin(), candidates.end(),
        [](const EvaluatedTransition& e) { 
            return e.transition->isWeighted(); 
        });

    if (hasWeights) {
        return selectWeighted(candidates);
    }

    // No weights - return first (deterministic)
    return candidates[0].transition;
}

EvaluatedTransition TransitionResolver::evaluate(const Transition& t) {
    EvaluatedTransition result;
    result.transition = &t;
    result.weight = t.weight;

    if (!t.enabled) {
        result.conditionMet = false;
        return result;
    }

    switch (t.type) {
        case TransitionType::Immediate:
            result.conditionMet = true;
            break;

        case TransitionType::Classic:
            if (t.classicConfig.condition.isEmpty()) {
                result.conditionMet = true;
            } else {
                auto evalResult = script_->evaluateCondition(t.classicConfig.condition);
                result.conditionMet = evalResult.isOk() && evalResult.value();
            }
            break;

        case TransitionType::Timed:
            result.conditionMet = evaluateTimed(t);
            break;

        case TransitionType::Event:
            result.conditionMet = evaluateEvent(t);
            break;

        case TransitionType::Probabilistic:
            // Probabilistic always fires, weight determines selection
            result.conditionMet = true;
            if (t.probConfig.isDynamic && !t.probConfig.weightExpression.isEmpty()) {
                auto weightResult = script_->evaluateWeight(t.probConfig.weightExpression);
                if (weightResult.isOk()) {
                    result.weight = static_cast<uint16_t>(
                        std::clamp(weightResult.value() * 100, 0.0, 10000.0));
                }
            } else {
                result.weight = t.probConfig.weight;
            }
            break;
    }

    return result;
}

bool TransitionResolver::evaluateTimed(const Transition& t) {
    const auto* timer = timers_->getTimer(t.id);
    const Timestamp now = timers_->now();
    const Timestamp stateEntry = context_ ? context_->stateEntryTime : 0;
    const Timestamp elapsed = now >= stateEntry ? (now - stateEntry) : 0;
    const bool timerFired = timer ? timer->fired : false;

    bool ready = false;
    switch (t.timedConfig.mode) {
        case TimedMode::After:
            ready = timerFired;
            break;
        case TimedMode::Every:
            ready = timerFired;
            break;
        case TimedMode::Timeout:
            ready = timerFired;
            break;
        case TimedMode::At:
            // Current representation keeps "at" in delayMs; if delayMs is unset,
            // fall back to timer semantics.
            ready = (t.timedConfig.delayMs > 0)
                ? (elapsed >= static_cast<Timestamp>(t.timedConfig.delayMs))
                : timerFired;
            break;
        case TimedMode::Window: {
            const Timestamp startMs = static_cast<Timestamp>(t.timedConfig.delayMs);
            const Timestamp endMs = static_cast<Timestamp>(t.timedConfig.windowEndMs);
            ready = elapsed >= startMs;
            if (ready && endMs > 0) {
                ready = elapsed <= endMs;
            }
            break;
        }
    }

    if (!ready) {
        return false;
    }

    // Check additional condition if present
    if (!t.timedConfig.additionalCondition.isEmpty()) {
        auto result = script_->evaluateCondition(t.timedConfig.additionalCondition);
        if (result.isError() || !result.value()) {
            return false;
        }
    }

    return true;
}

bool TransitionResolver::evaluateEvent(const Transition& t) {
    bool anyTriggered = false;
    bool allTriggered = true;

    for (const auto& trigger : t.eventConfig.triggers) {
        bool triggered = false;
        const Variable* var = variables_->getByName(trigger.signalName);
        
        if (!var) {
            allTriggered = false;
            continue;
        }

        switch (trigger.triggerType) {
            case EventTrigger::OnChange:
                triggered = var->hasChanged();
                break;

            case EventTrigger::OnRise:
                if (var->hasChanged()) {
                    auto prevBool = var->previousValue().tryGet<bool>();
                    auto currBool = var->value().tryGet<bool>();
                    triggered = prevBool && currBool && !*prevBool && *currBool;
                }
                break;

            case EventTrigger::OnFall:
                if (var->hasChanged()) {
                    auto prevBool = var->previousValue().tryGet<bool>();
                    auto currBool = var->value().tryGet<bool>();
                    triggered = prevBool && currBool && *prevBool && !*currBool;
                }
                break;

            case EventTrigger::OnThreshold:
                if (trigger.threshold && var->hasChanged()) {
                    // Compare current value with threshold
                    double curr = var->value().toDouble();
                    double threshold = trigger.threshold->value.toDouble();
                    
                    switch (trigger.threshold->op) {
                        case CompareOp::Gt: triggered = curr > threshold; break;
                        case CompareOp::Ge: triggered = curr >= threshold; break;
                        case CompareOp::Lt: triggered = curr < threshold; break;
                        case CompareOp::Le: triggered = curr <= threshold; break;
                        case CompareOp::Eq: triggered = curr == threshold; break;
                        case CompareOp::Ne: triggered = curr != threshold; break;
                    }
                }
                break;

            case EventTrigger::OnMatch:
                if (var->hasChanged()) {
                    auto strVal = var->value().tryGet<std::string>();
                    if (strVal) {
                        triggered = (*strVal == trigger.pattern);
                    }
                }
                break;
        }

        if (triggered) anyTriggered = true;
        else allTriggered = false;
    }

    bool result = t.eventConfig.requireAll ? allTriggered : anyTriggered;

    // Check additional condition
    if (result && !t.eventConfig.additionalCondition.isEmpty()) {
        auto evalResult = script_->evaluateCondition(t.eventConfig.additionalCondition);
        result = evalResult.isOk() && evalResult.value();
    }

    return result;
}

const Transition* TransitionResolver::selectWeighted(
    const std::vector<EvaluatedTransition>& candidates) {
    
    if (candidates.empty()) return nullptr;

    // Calculate total weight
    double totalWeight = 0;
    for (const auto& c : candidates) {
        totalWeight += c.weight;
    }

    if (totalWeight <= 0) {
        // No weights, return first
        return candidates[0].transition;
    }

    // Select random value
    double r = random_->random() * totalWeight;
    double cumulative = 0;

    for (const auto& c : candidates) {
        cumulative += c.weight;
        if (r < cumulative) {
            return c.transition;
        }
    }

    // Fallback to last
    return candidates.back().transition;
}

// ============================================================================
// Runtime Implementation
// ============================================================================

Runtime::Runtime(std::unique_ptr<IClock> clock,
                 std::unique_ptr<IRandomSource> random,
                 std::unique_ptr<IScriptEngine> script)
    : clock_(std::move(clock))
    , random_(std::move(random))
    , script_(std::move(script)) {
    
    timers_ = std::make_unique<TimerManager>(clock_.get());
    timers_->setRandomSource(random_.get());
}

Runtime::~Runtime() {
    if (running_) {
        stop();
    }
}

void Runtime::setCallbacks(RuntimeCallbacks callbacks) {
    callbacks_ = std::move(callbacks);

    if (!script_) {
        return;
    }

    script_->setLogHandler([this](const std::string& level, const std::string& message) {
        const std::string entry = "lua[" + level + "]: " + message;
        if (level == "error" || level == "fatal") {
            reportError(entry);
            return;
        }
        debug(entry);
    });
}

Result<RunId> Runtime::load(const Automata& automata) {
    // Validate automata
    auto errors = automata.validate();
    if (!errors.empty()) {
        return Result<RunId>::error("Validation failed: " + errors[0]);
    }

    // Store reference
    automata_ = &automata;
    ctx_.automata = &automata;
    ctx_.runId = nextRunId_++;
    ctx_.state = ExecutionState::Loaded;

    // Initialize variables
    ctx_.variables.clear();
    for (const auto& spec : automata.variables) {
        ctx_.variables.addVariable(spec);
    }

    // Setup variable change callback for outputs
    ctx_.variables.onVariableChange([this](const Variable& var) {
        if (var.direction() == VariableDirection::Output && callbacks_.onOutputChange) {
            callbacks_.onOutputChange(var);
        }
    });

    // Initialize script engine
    auto initResult = script_->initialize(&ctx_.variables);
    if (initResult.isError()) {
        ctx_.state = ExecutionState::Error;
        return Result<RunId>::error("Script init failed: " + initResult.error());
    }

    debug("Loaded automata: " + automata.config.name);
    return Result<RunId>::ok(ctx_.runId);
}

Result<void> Runtime::start(std::optional<StateId> fromState) {
    if (!isLoaded()) {
        return Result<void>::error("No automata loaded");
    }

    if (isRunning()) {
        return Result<void>::error("Already running");
    }

    // Set initial state
    StateId startState = fromState.value_or(automata_->initialState);
    
    const State* state = automata_->getState(startState);
    if (!state) {
        return Result<void>::error("Invalid start state");
    }

    ctx_.currentState = startState;
    ctx_.previousState = INVALID_STATE;
    ctx_.state = ExecutionState::Running;
    ctx_.startTime = clock_->now();
    ctx_.stateEntryTime = ctx_.startTime;
    ctx_.tickCount = 0;
    ctx_.transitionCount = 0;
    pausedAt_ = 0;

    // Setup resolver
    resolver_ = std::make_unique<TransitionResolver>(
        script_.get(), random_.get(), timers_.get(), &ctx_.variables, &ctx_);

    // Setup timers for initial state
    setupTimersForState(*state);

    // Execute on_enter for initial state
    executeOnEnter(*state);

    debug("Started in state: " + state->name);
    return Result<void>::ok();
}

Result<void> Runtime::stop() {
    if (!isRunning() && ctx_.state != ExecutionState::Paused) {
        return Result<void>::error("Not running");
    }

    running_ = false;

    // Execute on_exit for current state
    if (const State* state = automata_->getState(ctx_.currentState)) {
        executeOnExit(*state);
    }

    ctx_.state = ExecutionState::Stopped;
    timers_->cancelAll();
    pausedAt_ = 0;

    debug("Stopped");
    return Result<void>::ok();
}

Result<void> Runtime::pause() {
    if (!isRunning()) {
        return Result<void>::error("Not running");
    }

    ctx_.state = ExecutionState::Paused;
    pausedAt_ = clock_->now();
    
    debug("Paused");
    return Result<void>::ok();
}

Result<void> Runtime::resume() {
    if (ctx_.state != ExecutionState::Paused) {
        return Result<void>::error("Not paused");
    }

    const Timestamp now = clock_->now();
    if (pausedAt_ > 0 && now >= pausedAt_) {
        const auto delta = static_cast<uint32_t>(now - pausedAt_);
        timers_->shiftAll(delta);
    }
    pausedAt_ = 0;
    ctx_.state = ExecutionState::Running;
    
    debug("Resumed");
    return Result<void>::ok();
}

Result<void> Runtime::reset() {
    if (!isLoaded()) {
        return Result<void>::error("No automata loaded");
    }

    bool wasRunning = isRunning();
    
    if (wasRunning) {
        stop();
    }

    ctx_.reset();
    timers_->cancelAll();

    if (wasRunning) {
        return start();
    }

    debug("Reset");
    return Result<void>::ok();
}

void Runtime::unload() {
    if (isRunning()) {
        stop();
    }

    automata_ = nullptr;
    ctx_.automata = nullptr;
    ctx_.state = ExecutionState::Unloaded;
    ctx_.variables.clear();
    timers_->cancelAll();
    resolver_.reset();
    pausedAt_ = 0;

    debug("Unloaded");
}

bool Runtime::tick() {
    if (!isRunning()) {
        return false;
    }

    const Timestamp now = clock_->now();
    ctx_.tickCount++;
    ctx_.lastTickTime = now;
    
    // Run garbage collection every 100 ticks to prevent memory buildup
    if (ctx_.tickCount % 100 == 0 && script_) {
        script_->collectGarbage();
    }

    // Check expired timers
    auto expiredTimers = timers_->checkExpired();

    // Resolve transition
    const Transition* transition = resolver_->resolve(*automata_, ctx_.currentState);

    if (transition) {
        fireTransition(*transition);
        return true;
    }

    // No transition available - check if this is a terminal state
    auto outgoing = automata_->getTransitionsFrom(ctx_.currentState);
    if (outgoing.empty()) {
        // Terminal state - no outgoing transitions, stop execution
        if (const State* state = automata_->getState(ctx_.currentState)) {
            debug("Reached terminal state: " + state->name);
        }
        ctx_.state = ExecutionState::Stopped;
        running_ = false;
        return false;
    }

    // Execute state body while waiting for transition conditions
    if (const State* state = automata_->getState(ctx_.currentState)) {
        executeBody(*state);
    }

    // Clear change flags after processing
    ctx_.variables.clearAllChanged();

    return false;
}

void Runtime::run() {
    if (!isRunning()) {
        auto result = start();
        if (result.isError()) {
            reportError(result.error());
            return;
        }
    }

    running_ = true;

    while (running_ && isRunning()) {
        Timestamp tickStart = clock_->now();
        
        tick();

        // Rate limiting
        if (maxTickRate_ > 0) {
            Timestamp tickDuration = clock_->now() - tickStart;
            uint32_t targetMs = 1000 / maxTickRate_;
            if (tickDuration < targetMs) {
                clock_->sleep(targetMs - static_cast<uint32_t>(tickDuration));
            }
        }
    }
}

Result<void> Runtime::setInput(const std::string& name, Value value) {
    if (!ctx_.variables.setExternalValue(name, std::move(value))) {
        return Result<void>::error("Failed to set input: " + name);
    }
    return Result<void>::ok();
}

Result<void> Runtime::setInput(VariableId id, Value value) {
    if (!ctx_.variables.setExternalValue(id, std::move(value))) {
        return Result<void>::error("Failed to set input");
    }
    return Result<void>::ok();
}

Result<void> Runtime::setVariable(const std::string& name, Value value) {
    const auto* existing = ctx_.variables.getByName(name);
    if (!existing) {
        return Result<void>::error("Variable not found: " + name);
    }
    if (existing->direction() == VariableDirection::Input) {
        return Result<void>::error("Cannot set input via setVariable: " + name);
    }
    if (!ctx_.variables.setValue(name, std::move(value))) {
        return Result<void>::error("Failed to set variable: " + name);
    }
    return Result<void>::ok();
}

Result<void> Runtime::setVariable(VariableId id, Value value) {
    const auto* existing = ctx_.variables.get(id);
    if (!existing) {
        return Result<void>::error("Variable not found");
    }
    if (existing->direction() == VariableDirection::Input) {
        return Result<void>::error("Cannot set input via setVariable");
    }
    if (!ctx_.variables.setValue(id, std::move(value))) {
        return Result<void>::error("Failed to set variable");
    }
    return Result<void>::ok();
}

std::optional<Value> Runtime::getOutput(const std::string& name) const {
    return ctx_.variables.getValue(name);
}

std::optional<Value> Runtime::getOutput(VariableId id) const {
    return ctx_.variables.getValue(id);
}

std::vector<std::pair<std::string, Value>> Runtime::getChangedOutputs() {
    std::vector<std::pair<std::string, Value>> result;
    
    for (auto* var : ctx_.variables.outputs()) {
        if (var->hasChanged()) {
            result.emplace_back(var->name(), var->value());
        }
    }
    
    return result;
}

void Runtime::fireTransition(const Transition& t) {
    const State* fromState = automata_->getState(t.from);
    const State* toState = automata_->getState(t.to);

    if (!fromState || !toState) {
        reportError("Invalid transition states");
        return;
    }

    debug("Firing: " + t.name + " (" + fromState->name + " -> " + toState->name + ")");

    // Execute on_exit of current state
    executeOnExit(*fromState);

    // Cancel timers for old state
    cancelTimersForState(t.from);

    // Execute transition body
    executeTransitionBody(t);

    // Update state
    ctx_.previousState = ctx_.currentState;
    ctx_.currentState = t.to;
    ctx_.transitionCount++;
    ctx_.stateEntryTime = clock_->now();

    // Setup timers for new state
    setupTimersForState(*toState);

    // Execute on_enter of new state
    executeOnEnter(*toState);

    // Notify callback
    if (callbacks_.onStateChange) {
        callbacks_.onStateChange(t.from, t.to, t.id);
    }

    // Handle repeating timed transitions
    if (t.type == TransitionType::Timed && 
        (t.timedConfig.mode == TimedMode::Every)) {
        timers_->restartTimer(t.id, t.timedConfig.delayMs, t.timedConfig.jitterMs);
    }
}

void Runtime::executeOnEnter(const State& state) {
    if (!state.onEnter.isEmpty()) {
        auto result = script_->execute(state.onEnter);
        if (result.isError()) {
            reportError("on_enter error in " + state.name + ": " + result.error());
        }
    }
}

void Runtime::executeOnExit(const State& state) {
    if (!state.onExit.isEmpty()) {
        auto result = script_->execute(state.onExit);
        if (result.isError()) {
            reportError("on_exit error in " + state.name + ": " + result.error());
        }
    }
}

void Runtime::executeBody(const State& state) {
    if (!state.body.isEmpty()) {
        auto result = script_->execute(state.body);
        if (result.isError()) {
            reportError("body error in " + state.name + ": " + result.error());
        }
    }
}

void Runtime::executeTransitionBody(const Transition& t) {
    if (!t.body.isEmpty()) {
        auto result = script_->execute(t.body);
        if (result.isError()) {
            reportError("transition body error in " + t.name + ": " + result.error());
        }
    }

    if (!t.triggered.isEmpty()) {
        auto result = script_->execute(t.triggered);
        if (result.isError()) {
            reportError("triggered error in " + t.name + ": " + result.error());
        }
    }
}

void Runtime::setupTimersForState(const State& state) {
    // Find timed transitions from this state
    auto transitions = automata_->getTransitionsFrom(state.id);
    
    for (const auto* t : transitions) {
        if (t->type == TransitionType::Timed) {
            timers_->startTimer(t->id, t->timedConfig.delayMs, 
                               t->timedConfig.jitterMs,
                               t->timedConfig.repeatCount);
        }
    }
}

void Runtime::cancelTimersForState(StateId stateId) {
    auto transitions = automata_->getTransitionsFrom(stateId);
    
    for (const auto* t : transitions) {
        if (t->type == TransitionType::Timed) {
            timers_->cancelTimer(t->id);
        }
    }
}

void Runtime::reportError(const std::string& error) {
    ctx_.errorCount++;
    if (callbacks_.onError) {
        callbacks_.onError(error);
    }
}

void Runtime::debug(const std::string& message) {
    if (callbacks_.onDebug) {
        callbacks_.onDebug(message);
    }
}

// ============================================================================
// Value Implementation
// ============================================================================

bool Value::toBool() const {
    if (is<bool>()) return get<bool>();
    if (is<int32_t>()) return get<int32_t>() != 0;
    if (is<int64_t>()) return get<int64_t>() != 0;
    if (is<float>()) return get<float>() != 0.0f;
    if (is<double>()) return get<double>() != 0.0;
    if (is<std::string>()) return !get<std::string>().empty();
    return false;
}

int64_t Value::toInt() const {
    if (is<bool>()) return get<bool>() ? 1 : 0;
    if (is<int32_t>()) return get<int32_t>();
    if (is<int64_t>()) return get<int64_t>();
    if (is<float>()) return static_cast<int64_t>(get<float>());
    if (is<double>()) return static_cast<int64_t>(get<double>());
    if (is<std::string>()) {
        try { return std::stoll(get<std::string>()); }
        catch (...) { return 0; }
    }
    return 0;
}

double Value::toDouble() const {
    if (is<bool>()) return get<bool>() ? 1.0 : 0.0;
    if (is<int32_t>()) return static_cast<double>(get<int32_t>());
    if (is<int64_t>()) return static_cast<double>(get<int64_t>());
    if (is<float>()) return static_cast<double>(get<float>());
    if (is<double>()) return get<double>();
    if (is<std::string>()) {
        try { return std::stod(get<std::string>()); }
        catch (...) { return 0.0; }
    }
    return 0.0;
}

std::string Value::toString() const {
    if (isVoid()) return "";
    if (is<bool>()) return get<bool>() ? "true" : "false";
    if (is<int32_t>()) return std::to_string(get<int32_t>());
    if (is<int64_t>()) return std::to_string(get<int64_t>());
    if (is<float>()) return std::to_string(get<float>());
    if (is<double>()) return std::to_string(get<double>());
    if (is<std::string>()) return get<std::string>();
    return "[binary]";
}

} // namespace aeth
