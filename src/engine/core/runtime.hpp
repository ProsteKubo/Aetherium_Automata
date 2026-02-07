/**
 * Aetherium Automata - Runtime Execution
 * 
 * The runtime manages the execution of an automata instance.
 * It handles:
 * - State transitions (weighted, timed, event-based)
 * - Variable management
 * - Timer management
 * - Communication with transport layer
 */

#ifndef AETHERIUM_RUNTIME_HPP
#define AETHERIUM_RUNTIME_HPP

#include "types.hpp"
#include "model.hpp"
#include "variable.hpp"
#include <memory>
#include <random>
#include <functional>

namespace aeth {

// ============================================================================
// Platform Abstraction
// ============================================================================

/**
 * Abstract clock interface for platform independence
 */
class IClock {
public:
    virtual ~IClock() = default;
    virtual Timestamp now() = 0;  // Monotonic milliseconds
    virtual void sleep(uint32_t ms) = 0;
};

/**
 * Abstract random source for deterministic testing
 */
class IRandomSource {
public:
    virtual ~IRandomSource() = default;
    virtual double random() = 0;  // Returns [0.0, 1.0)
    virtual uint32_t randomInt(uint32_t max) = 0;  // Returns [0, max)
    virtual void seed(uint64_t seed) = 0;
};

/**
 * Default implementations using std
 */
class StdClock : public IClock {
public:
    Timestamp now() override;
    void sleep(uint32_t ms) override;
};

class StdRandomSource : public IRandomSource {
public:
    StdRandomSource();
    explicit StdRandomSource(uint64_t seed);
    
    double random() override;
    uint32_t randomInt(uint32_t max) override;
    void seed(uint64_t seed) override;

private:
    std::mt19937_64 gen_;
    std::uniform_real_distribution<double> dist_;
};

// ============================================================================
// Script Engine Interface
// ============================================================================

/**
 * Abstract interface for script execution (Lua)
 */
class IScriptEngine {
public:
    virtual ~IScriptEngine() = default;

    // Initialize with variable store access
    virtual Result<void> initialize(VariableStore* variables) = 0;

    // Execute code block, return result
    virtual Result<Value> execute(const CodeBlock& code) = 0;

    // Evaluate condition (returns bool)
    virtual Result<bool> evaluateCondition(const CodeBlock& code) = 0;

    // Compute dynamic weight (returns number 0-100)
    virtual Result<double> evaluateWeight(const CodeBlock& code) = 0;

    // Error handling
    virtual std::string lastError() const = 0;
    virtual void clearError() = 0;
    
    // Memory management - run garbage collection
    virtual void collectGarbage() = 0;
};

// ============================================================================
// Timer Management
// ============================================================================

/**
 * Timer entry for timed transitions
 */
struct Timer {
    TransitionId transitionId = INVALID_TRANSITION;
    Timestamp startTime = 0;
    Timestamp targetTime = 0;
    uint32_t repeatCount = 0;  // 0 = infinite
    uint32_t currentRepeat = 0;
    bool fired = false;

    [[nodiscard]] bool isExpired(Timestamp now) const {
        return now >= targetTime && !fired;
    }
};

/**
 * Manages timers for timed transitions
 */
class TimerManager {
public:
    explicit TimerManager(IClock* clock) : clock_(clock) {}

    // Start timer for transition
    void startTimer(TransitionId id, uint32_t delayMs, uint32_t jitterMs = 0,
                    uint32_t repeatCount = 1);

    // Cancel timer
    void cancelTimer(TransitionId id);

    // Cancel all timers
    void cancelAll();

    // Check for expired timers
    std::vector<TransitionId> checkExpired();

    // Restart timer (for repeating)
    void restartTimer(TransitionId id, uint32_t delayMs, uint32_t jitterMs = 0);

    // Get timer info
    const Timer* getTimer(TransitionId id) const;

private:
    IClock* clock_;
    std::unordered_map<TransitionId, Timer> timers_;
    IRandomSource* randomSource_ = nullptr;  // For jitter
};

// ============================================================================
// Transition Resolver
// ============================================================================

/**
 * Result of transition evaluation
 */
struct EvaluatedTransition {
    const Transition* transition = nullptr;
    double weight = 0;          // Normalized weight for selection
    bool conditionMet = false;  // Whether guard is satisfied
};

/**
 * Resolves which transition to fire from current state
 */
class TransitionResolver {
public:
    TransitionResolver(IScriptEngine* script, IRandomSource* random, 
                       TimerManager* timers, VariableStore* variables)
        : script_(script), random_(random), timers_(timers), variables_(variables) {}

    /**
     * Resolve which transition (if any) should fire.
     * 
     * Algorithm:
     * 1. Get all enabled transitions from current state
     * 2. Group by priority (lower = higher priority)
     * 3. Evaluate conditions for highest priority group
     * 4. If multiple enabled:
     *    - If any has weight: probabilistic selection
     *    - Else: select first (deterministic)
     * 5. Return selected transition or nullptr
     */
    const Transition* resolve(const Automata& automata, StateId currentState);

private:
    // Evaluate a single transition
    EvaluatedTransition evaluate(const Transition& t);

    // Evaluate timed transition
    bool evaluateTimed(const Transition& t);

    // Evaluate event transition  
    bool evaluateEvent(const Transition& t);

    // Select from weighted transitions
    const Transition* selectWeighted(const std::vector<EvaluatedTransition>& candidates);

    IScriptEngine* script_;
    IRandomSource* random_;
    TimerManager* timers_;
    VariableStore* variables_;
};

// ============================================================================
// Execution Context
// ============================================================================

/**
 * Runtime context for an automata execution
 */
class ExecutionContext {
public:
    ExecutionContext() = default;

    // Automata being executed
    const Automata* automata = nullptr;
    RunId runId = 0;

    // Current state
    StateId currentState = INVALID_STATE;
    StateId previousState = INVALID_STATE;

    // Execution state
    ExecutionState state = ExecutionState::Unloaded;

    // Statistics
    uint64_t tickCount = 0;
    uint64_t transitionCount = 0;
    uint32_t errorCount = 0;
    Timestamp startTime = 0;
    Timestamp stateEntryTime = 0;
    Timestamp lastTickTime = 0;

    // Variable store
    VariableStore variables;

    // Reset to initial state
    void reset();

    // Get uptime
    [[nodiscard]] Timestamp uptime(Timestamp now) const {
        return startTime > 0 ? now - startTime : 0;
    }
};

// ============================================================================
// Event Callbacks
// ============================================================================

using StateChangeCallback = std::function<void(StateId from, StateId to, 
                                                TransitionId via)>;
using OutputChangeCallback = std::function<void(const Variable& var)>;
using ErrorCallback = std::function<void(const std::string& error)>;
using DebugCallback = std::function<void(const std::string& message)>;

struct RuntimeCallbacks {
    StateChangeCallback onStateChange;
    OutputChangeCallback onOutputChange;
    ErrorCallback onError;
    DebugCallback onDebug;
};

// ============================================================================
// Runtime Engine
// ============================================================================

/**
 * Main runtime engine for executing automata
 */
class Runtime {
public:
    Runtime(std::unique_ptr<IClock> clock,
            std::unique_ptr<IRandomSource> random,
            std::unique_ptr<IScriptEngine> script);

    ~Runtime();

    // ========================================================================
    // Lifecycle
    // ========================================================================

    /**
     * Load an automata for execution
     */
    Result<RunId> load(const Automata& automata);

    /**
     * Start execution from initial state (or specified state)
     */
    Result<void> start(std::optional<StateId> fromState = std::nullopt);

    /**
     * Stop execution
     */
    Result<void> stop();

    /**
     * Pause execution (timers pause too)
     */
    Result<void> pause();

    /**
     * Resume from pause
     */
    Result<void> resume();

    /**
     * Reset to initial state
     */
    Result<void> reset();

    /**
     * Unload automata
     */
    void unload();

    // ========================================================================
    // Execution
    // ========================================================================

    /**
     * Execute one tick of the automata.
     * Returns true if a transition was fired.
     */
    bool tick();

    /**
     * Run continuously until stopped.
     * Blocking call.
     */
    void run();

    // ========================================================================
    // Input/Output
    // ========================================================================

    /**
     * Set an input variable value (from external source)
     */
    Result<void> setInput(const std::string& name, Value value);
    Result<void> setInput(VariableId id, Value value);

    /**
     * Get an output variable value
     */
    std::optional<Value> getOutput(const std::string& name) const;
    std::optional<Value> getOutput(VariableId id) const;

    /**
     * Get all changed outputs since last call
     */
    std::vector<std::pair<std::string, Value>> getChangedOutputs();

    // ========================================================================
    // State Queries
    // ========================================================================

    [[nodiscard]] ExecutionState state() const { return ctx_.state; }
    [[nodiscard]] StateId currentState() const { return ctx_.currentState; }
    [[nodiscard]] const ExecutionContext& context() const { return ctx_; }
    [[nodiscard]] bool isRunning() const { 
        return ctx_.state == ExecutionState::Running; 
    }
    [[nodiscard]] bool isLoaded() const { 
        return ctx_.automata != nullptr; 
    }

    // ========================================================================
    // Callbacks
    // ========================================================================

    void setCallbacks(RuntimeCallbacks callbacks) { 
        callbacks_ = std::move(callbacks); 
    }

    // ========================================================================
    // Configuration
    // ========================================================================

    /**
     * Set tick rate limit (0 = unlimited)
     */
    void setMaxTickRate(uint32_t ticksPerSecond) { 
        maxTickRate_ = ticksPerSecond; 
    }

    /**
     * Set random seed for reproducibility
     */
    void setSeed(uint64_t seed) { random_->seed(seed); }

private:
    // Execute state hooks
    void executeOnEnter(const State& state);
    void executeOnExit(const State& state);
    void executeBody(const State& state);
    void executeTransitionBody(const Transition& t);

    // Transition handling
    void fireTransition(const Transition& t);
    void setupTimersForState(const State& state);
    void cancelTimersForState(StateId stateId);

    // Error handling
    void reportError(const std::string& error);
    void debug(const std::string& message);

    // Components
    std::unique_ptr<IClock> clock_;
    std::unique_ptr<IRandomSource> random_;
    std::unique_ptr<IScriptEngine> script_;
    std::unique_ptr<TimerManager> timers_;
    std::unique_ptr<TransitionResolver> resolver_;

    // Context
    ExecutionContext ctx_;
    const Automata* automata_ = nullptr;
    RunId nextRunId_ = 1;

    // Callbacks
    RuntimeCallbacks callbacks_;

    // Configuration
    uint32_t maxTickRate_ = 0;
    bool running_ = false;
};

// ============================================================================
// Implementation: TimerManager
// ============================================================================

inline void TimerManager::startTimer(TransitionId id, uint32_t delayMs, 
                                     uint32_t jitterMs, uint32_t repeatCount) {
    Timer t;
    t.transitionId = id;
    t.startTime = clock_->now();
    
    // Apply jitter
    int32_t jitter = 0;
    if (jitterMs > 0 && randomSource_) {
        jitter = static_cast<int32_t>(randomSource_->randomInt(jitterMs * 2)) - 
                 static_cast<int32_t>(jitterMs);
    }
    
    t.targetTime = t.startTime + delayMs + jitter;
    t.repeatCount = repeatCount;
    t.currentRepeat = 0;
    t.fired = false;
    
    timers_[id] = t;
}

inline void TimerManager::cancelTimer(TransitionId id) {
    timers_.erase(id);
}

inline void TimerManager::cancelAll() {
    timers_.clear();
}

inline std::vector<TransitionId> TimerManager::checkExpired() {
    std::vector<TransitionId> expired;
    Timestamp now = clock_->now();
    
    for (auto& [id, timer] : timers_) {
        if (timer.isExpired(now)) {
            expired.push_back(id);
            timer.fired = true;
        }
    }
    
    return expired;
}

inline void TimerManager::restartTimer(TransitionId id, uint32_t delayMs, 
                                       uint32_t jitterMs) {
    auto it = timers_.find(id);
    if (it != timers_.end()) {
        Timer& t = it->second;
        if (t.repeatCount == 0 || t.currentRepeat < t.repeatCount - 1) {
            t.currentRepeat++;
            t.startTime = clock_->now();
            t.targetTime = t.startTime + delayMs;
            t.fired = false;
        } else {
            timers_.erase(it);
        }
    }
}

inline const Timer* TimerManager::getTimer(TransitionId id) const {
    auto it = timers_.find(id);
    return it != timers_.end() ? &it->second : nullptr;
}

// ============================================================================
// Implementation: ExecutionContext
// ============================================================================

inline void ExecutionContext::reset() {
    if (automata) {
        currentState = automata->initialState;
        previousState = INVALID_STATE;
    }
    tickCount = 0;
    transitionCount = 0;
    errorCount = 0;
    stateEntryTime = 0;
    variables.resetAll();
}

} // namespace aeth

#endif // AETHERIUM_RUNTIME_HPP
