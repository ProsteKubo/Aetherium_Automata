defmodule AetheriumServer.AutomataRuntime do
  @moduledoc """
  Runtime execution of automata FSM with weighted/probabilistic transition support.

  Handles:
  - FSM state execution and transitions
  - Weighted/probabilistic transition selection
  - Timed transitions (after, at, every)
  - Variable management and condition evaluation
  - Event handling
  - On-enter/on-exit/on-tick actions
  """

  use GenServer
  require Logger

  alias AetheriumServer.DeviceManager

  # ============================================================================
  # Types
  # ============================================================================

  @type state :: %{
          deployment_id: String.t(),
          automata: map(),
          current_state: String.t(),
          variables: map(),
          inputs: map(),
          outputs: map(),
          timers: %{String.t() => reference()},
          running: boolean(),
          tick_interval: integer(),
          tick_ref: reference() | nil,
          transition_stats: %{String.t() => integer()},
          rng: :rand.state()
        }

  @default_tick_interval 100

  # ============================================================================
  # Public API
  # ============================================================================

  @doc "Start runtime for a deployment"
  def start_link(opts) do
    deployment_id = Keyword.fetch!(opts, :deployment_id)
    GenServer.start_link(__MODULE__, opts, name: via_tuple(deployment_id))
  end

  @doc "Set input value"
  @spec set_input(String.t(), String.t(), any()) :: :ok
  def set_input(deployment_id, input_name, value) do
    GenServer.cast(via_tuple(deployment_id), {:set_input, input_name, value})
  end

  @doc "Get current state"
  @spec get_state(String.t()) :: {:ok, map()} | {:error, term()}
  def get_state(deployment_id) do
    GenServer.call(via_tuple(deployment_id), :get_state)
  end

  @doc "Trigger an event"
  @spec trigger_event(String.t(), String.t(), any()) :: :ok
  def trigger_event(deployment_id, event_name, data \\ nil) do
    GenServer.cast(via_tuple(deployment_id), {:trigger_event, event_name, data})
  end

  @doc "Force transition to state"
  @spec force_state(String.t(), String.t()) :: :ok | {:error, term()}
  def force_state(deployment_id, state_id) do
    GenServer.call(via_tuple(deployment_id), {:force_state, state_id})
  end

  @doc "Start the automata execution"
  @spec start_execution(String.t()) :: :ok
  def start_execution(deployment_id) do
    GenServer.cast(via_tuple(deployment_id), :start)
  end

  @doc "Stop the automata execution"
  @spec stop_execution(String.t()) :: :ok
  def stop_execution(deployment_id) do
    GenServer.cast(via_tuple(deployment_id), :stop)
  end

  @doc "Reset the automata to initial state"
  @spec reset(String.t()) :: :ok
  def reset(deployment_id) do
    GenServer.cast(via_tuple(deployment_id), :reset)
  end

  # ============================================================================
  # GenServer Implementation
  # ============================================================================

  @impl true
  def init(opts) do
    deployment_id = Keyword.fetch!(opts, :deployment_id)
    automata = Keyword.fetch!(opts, :automata)
    tick_interval = Keyword.get(opts, :tick_interval, @default_tick_interval)

    # Find initial state
    initial_state = find_initial_state(automata)

    # Initialize variables
    variables = initialize_variables(automata[:variables] || [])

    # Separate inputs and outputs
    {inputs, outputs} = separate_io(automata[:variables] || [])

    state = %{
      deployment_id: deployment_id,
      automata: automata,
      current_state: initial_state,
      variables: variables,
      inputs: inputs,
      outputs: outputs,
      timers: %{},
      running: false,
      tick_interval: tick_interval,
      tick_ref: nil,
      transition_stats: %{},
      rng: :rand.seed(:exsp)
    }

    # Register in registry
    Registry.register(AetheriumServer.RuntimeRegistry, deployment_id, self())

    Logger.info("AutomataRuntime started for deployment #{deployment_id}")
    {:ok, state}
  end

  @impl true
  def handle_cast(:start, state) do
    if state.running do
      {:noreply, state}
    else
      # Execute on_enter for initial state
      new_state = execute_on_enter(state.current_state, state)

      # Start tick loop
      tick_ref = Process.send_after(self(), :tick, state.tick_interval)

      # Schedule timed transitions from initial state
      new_state = schedule_timed_transitions(state.current_state, new_state)

      Logger.info("Automata #{state.deployment_id} started in state #{state.current_state}")

      {:noreply, %{new_state | running: true, tick_ref: tick_ref}}
    end
  end

  @impl true
  def handle_cast(:stop, state) do
    # Cancel tick timer
    if state.tick_ref, do: Process.cancel_timer(state.tick_ref)

    # Cancel all timed transition timers
    Enum.each(state.timers, fn {_id, ref} -> Process.cancel_timer(ref) end)

    Logger.info("Automata #{state.deployment_id} stopped")

    {:noreply, %{state | running: false, tick_ref: nil, timers: %{}}}
  end

  @impl true
  def handle_cast(:reset, state) do
    # Stop first
    if state.tick_ref, do: Process.cancel_timer(state.tick_ref)
    Enum.each(state.timers, fn {_id, ref} -> Process.cancel_timer(ref) end)

    # Reset to initial state
    initial_state = find_initial_state(state.automata)
    variables = initialize_variables(state.automata[:variables] || [])
    {inputs, outputs} = separate_io(state.automata[:variables] || [])

    new_state = %{
      state
      | current_state: initial_state,
        variables: variables,
        inputs: inputs,
        outputs: outputs,
        timers: %{},
        running: false,
        tick_ref: nil,
        transition_stats: %{}
    }

    Logger.info("Automata #{state.deployment_id} reset to #{initial_state}")

    {:noreply, new_state}
  end

  @impl true
  def handle_cast({:set_input, input_name, value}, state) do
    if Map.has_key?(state.inputs, input_name) do
      new_state =
        state
        |> put_in([:inputs, input_name], value)
        |> put_in([:variables, input_name], value)

      # Check for transitions triggered by this input
      new_state =
        if state.running do
          check_and_fire_transitions(new_state)
        else
          new_state
        end

      {:noreply, new_state}
    else
      {:noreply, state}
    end
  end

  @impl true
  def handle_cast({:trigger_event, event_name, data}, state) do
    if state.running do
      # Find event-triggered transitions from current state
      transitions = get_event_transitions(state.current_state, event_name, state)

      new_state =
        if Enum.empty?(transitions) do
          state
        else
          # Select and fire transition
          select_and_fire_transition(transitions, state, %{event: event_name, data: data})
        end

      {:noreply, new_state}
    else
      {:noreply, state}
    end
  end

  @impl true
  def handle_call(:get_state, _from, state) do
    result = %{
      current_state: state.current_state,
      variables: state.variables,
      inputs: state.inputs,
      outputs: state.outputs,
      running: state.running
    }

    {:reply, {:ok, result}, state}
  end

  @impl true
  def handle_call({:force_state, state_id}, _from, state) do
    states = state.automata[:states] || %{}

    if Map.has_key?(states, state_id) do
      new_state = do_transition(state.current_state, state_id, nil, state)
      {:reply, :ok, new_state}
    else
      {:reply, {:error, :state_not_found}, state}
    end
  end

  @impl true
  def handle_info(:tick, %{running: false} = state) do
    {:noreply, state}
  end

  @impl true
  def handle_info(:tick, state) do
    # Execute on_tick for current state
    new_state = execute_on_tick(state.current_state, state)

    # Check condition-based transitions
    new_state = check_and_fire_transitions(new_state)

    # Schedule next tick
    tick_ref = Process.send_after(self(), :tick, state.tick_interval)

    {:noreply, %{new_state | tick_ref: tick_ref}}
  end

  @impl true
  def handle_info({:timed_transition, transition_id}, state) do
    if state.running do
      # Remove from timers
      new_state = update_in(state, [:timers], &Map.delete(&1, transition_id))

      # Get the transition
      transitions = state.automata[:transitions] || %{}

      case Map.get(transitions, transition_id) do
        nil ->
          {:noreply, new_state}

        transition ->
          # Verify we're still in the source state
          if transition[:from] == state.current_state do
            # Check condition if any
            if evaluate_condition(transition[:condition], new_state) do
              final_state =
                do_transition(state.current_state, transition[:to], transition_id, new_state)

              {:noreply, final_state}
            else
              {:noreply, new_state}
            end
          else
            {:noreply, new_state}
          end
      end
    else
      {:noreply, state}
    end
  end

  # ============================================================================
  # Transition Logic
  # ============================================================================

  defp check_and_fire_transitions(state) do
    # Get all outgoing transitions from current state
    transitions = get_outgoing_transitions(state.current_state, state)

    # Filter to condition-based transitions (classic, immediate)
    condition_transitions =
      transitions
      |> Enum.filter(&(&1[:type] in [:classic, :immediate, nil]))
      |> Enum.filter(&evaluate_condition(&1[:condition], state))
      # Higher priority first
      |> Enum.sort_by(&(-(&1[:priority] || 0)))

    if Enum.empty?(condition_transitions) do
      state
    else
      select_and_fire_transition(condition_transitions, state, nil)
    end
  end

  defp get_outgoing_transitions(state_id, state) do
    transitions = state.automata[:transitions] || %{}

    transitions
    |> Map.values()
    |> Enum.filter(&(&1[:from] == state_id))
  end

  defp get_event_transitions(state_id, event_name, state) do
    transitions = state.automata[:transitions] || %{}

    transitions
    |> Map.values()
    |> Enum.filter(fn t ->
      t[:from] == state_id &&
        t[:type] == :event &&
        t[:event] == event_name
    end)
  end

  defp select_and_fire_transition(transitions, state, context) do
    # Check if any transitions have weights (probabilistic)
    weighted = Enum.any?(transitions, &((&1[:weight] || 0) > 0))

    selected =
      if weighted do
        select_weighted_transition(transitions, state)
      else
        # Take highest priority (already sorted)
        List.first(transitions)
      end

    if selected do
      do_transition(state.current_state, selected[:to], selected[:id], state, context)
    else
      state
    end
  end

  defp select_weighted_transition(transitions, state) do
    # Calculate total weight
    weights =
      transitions
      |> Enum.map(fn t -> {t, t[:weight] || 1} end)

    total_weight = weights |> Enum.map(&elem(&1, 1)) |> Enum.sum()

    if total_weight == 0 do
      List.first(transitions)
    else
      # Generate random number
      {random, new_rng} = :rand.uniform_s(state.rng)
      threshold = random * total_weight

      # Select based on cumulative weight
      {selected, _} =
        Enum.reduce_while(weights, {nil, 0}, fn {trans, weight}, {_, cumulative} ->
          new_cumulative = cumulative + weight

          if new_cumulative >= threshold do
            {:halt, {trans, new_cumulative}}
          else
            {:cont, {trans, new_cumulative}}
          end
        end)

      # Update RNG state (side effect - not ideal but pragmatic)
      Process.put(:rng_state, new_rng)

      selected
    end
  end

  defp do_transition(from_state, to_state, transition_id, state, context \\ nil) do
    Logger.debug("Transition: #{from_state} -> #{to_state} (#{transition_id || "forced"})")

    # Execute on_exit for current state
    new_state = execute_on_exit(from_state, state)

    # Cancel timed transitions from old state
    new_state = cancel_state_timers(from_state, new_state)

    # Update current state
    new_state = %{new_state | current_state: to_state}

    # Update transition stats
    new_state =
      if transition_id do
        update_in(new_state, [:transition_stats, transition_id], &((&1 || 0) + 1))
      else
        new_state
      end

    # Execute on_enter for new state
    new_state = execute_on_enter(to_state, new_state)

    # Schedule timed transitions from new state
    new_state = schedule_timed_transitions(to_state, new_state)

    # Notify device manager
    DeviceManager.update_deployment_state(
      state.deployment_id,
      to_state,
      new_state.variables
    )

    # Broadcast transition event
    broadcast_transition(from_state, to_state, transition_id, context, state)

    new_state
  end

  # ============================================================================
  # Timed Transitions
  # ============================================================================

  defp schedule_timed_transitions(state_id, state) do
    transitions = get_outgoing_transitions(state_id, state)

    timed_transitions =
      transitions
      |> Enum.filter(&(&1[:type] == :timed))

    Enum.reduce(timed_transitions, state, fn trans, acc ->
      schedule_timed_transition(trans, acc)
    end)
  end

  defp schedule_timed_transition(transition, state) do
    timed_config = transition[:timed] || %{}
    mode = timed_config[:mode] || :after
    delay_ms = timed_config[:delay_ms] || 0
    jitter_ms = timed_config[:jitter_ms] || 0

    # Apply jitter
    actual_delay =
      if jitter_ms > 0 do
        jitter = :rand.uniform(jitter_ms * 2) - jitter_ms
        max(0, delay_ms + jitter)
      else
        delay_ms
      end

    case mode do
      :after ->
        ref = Process.send_after(self(), {:timed_transition, transition[:id]}, actual_delay)
        put_in(state, [:timers, transition[:id]], ref)

      :every ->
        # Repeating timer - schedule first occurrence
        ref = Process.send_after(self(), {:timed_transition, transition[:id]}, actual_delay)
        put_in(state, [:timers, transition[:id]], ref)

      _ ->
        state
    end
  end

  defp cancel_state_timers(state_id, state) do
    transitions = get_outgoing_transitions(state_id, state)

    transition_ids =
      transitions
      |> Enum.filter(&(&1[:type] == :timed))
      |> Enum.map(& &1[:id])

    Enum.reduce(transition_ids, state, fn tid, acc ->
      case Map.get(acc.timers, tid) do
        nil ->
          acc

        ref ->
          Process.cancel_timer(ref)
          update_in(acc, [:timers], &Map.delete(&1, tid))
      end
    end)
  end

  # ============================================================================
  # State Actions
  # ============================================================================

  defp execute_on_enter(state_id, state) do
    case get_state_def(state_id, state) do
      nil ->
        state

      state_def ->
        case state_def[:on_enter] do
          nil -> state
          action -> execute_action(action, state)
        end
    end
  end

  defp execute_on_exit(state_id, state) do
    case get_state_def(state_id, state) do
      nil ->
        state

      state_def ->
        case state_def[:on_exit] do
          nil -> state
          action -> execute_action(action, state)
        end
    end
  end

  defp execute_on_tick(state_id, state) do
    case get_state_def(state_id, state) do
      nil ->
        state

      state_def ->
        case state_def[:on_tick] do
          nil -> state
          action -> execute_action(action, state)
        end
    end
  end

  defp execute_action(action, state) when is_binary(action) do
    # Simple action execution - parse and execute
    # Format: "set var = value" or "output name = value" etc.
    cond do
      String.starts_with?(action, "set ") ->
        execute_set_action(action, state)

      String.starts_with?(action, "output ") ->
        execute_output_action(action, state)

      String.starts_with?(action, "log ") ->
        execute_log_action(action, state)

      true ->
        Logger.debug("Unknown action: #{action}")
        state
    end
  end

  defp execute_action(_action, state), do: state

  defp execute_set_action(action, state) do
    case Regex.run(~r/set\s+(\w+)\s*=\s*(.+)/, action) do
      [_, var_name, value_str] ->
        value = parse_value(value_str, state)
        put_in(state, [:variables, var_name], value)

      _ ->
        state
    end
  end

  defp execute_output_action(action, state) do
    case Regex.run(~r/output\s+(\w+)\s*=\s*(.+)/, action) do
      [_, output_name, value_str] ->
        value = parse_value(value_str, state)
        new_state = put_in(state, [:outputs, output_name], value)

        # Propagate to connection manager
        broadcast_output(output_name, value, state)

        new_state

      _ ->
        state
    end
  end

  defp execute_log_action(action, state) do
    case Regex.run(~r/log\s+"([^"]+)"/, action) do
      [_, message] ->
        Logger.info("[#{state.deployment_id}] #{message}")

      _ ->
        :ok
    end

    state
  end

  # ============================================================================
  # Condition Evaluation
  # ============================================================================

  defp evaluate_condition(nil, _state), do: true
  defp evaluate_condition("", _state), do: true

  defp evaluate_condition(condition, state) when is_binary(condition) do
    # Simple condition parsing
    # Supports: var == value, var != value, var > value, var < value, var >= value, var <= value
    cond do
      String.contains?(condition, "==") ->
        evaluate_comparison(condition, "==", state)

      String.contains?(condition, "!=") ->
        evaluate_comparison(condition, "!=", state)

      String.contains?(condition, ">=") ->
        evaluate_comparison(condition, ">=", state)

      String.contains?(condition, "<=") ->
        evaluate_comparison(condition, "<=", state)

      String.contains?(condition, ">") ->
        evaluate_comparison(condition, ">", state)

      String.contains?(condition, "<") ->
        evaluate_comparison(condition, "<", state)

      condition == "true" ->
        true

      condition == "false" ->
        false

      # Variable name - check if truthy
      true ->
        var_name = String.trim(condition)
        truthy?(Map.get(state.variables, var_name))
    end
  end

  defp evaluate_comparison(condition, operator, state) do
    [left, right] =
      condition
      |> String.split(operator)
      |> Enum.map(&String.trim/1)

    left_val = resolve_value(left, state)
    right_val = resolve_value(right, state)

    case operator do
      "==" -> left_val == right_val
      "!=" -> left_val != right_val
      ">" -> left_val > right_val
      "<" -> left_val < right_val
      ">=" -> left_val >= right_val
      "<=" -> left_val <= right_val
    end
  end

  defp resolve_value(str, state) do
    cond do
      # Number
      Regex.match?(~r/^-?\d+$/, str) ->
        String.to_integer(str)

      Regex.match?(~r/^-?\d+\.\d+$/, str) ->
        String.to_float(str)

      # Boolean
      str == "true" ->
        true

      str == "false" ->
        false

      # String literal
      String.starts_with?(str, "\"") && String.ends_with?(str, "\"") ->
        String.slice(str, 1..-2//1)

      # Variable reference
      true ->
        Map.get(state.variables, str)
    end
  end

  defp parse_value(str, state) do
    str = String.trim(str)
    resolve_value(str, state)
  end

  defp truthy?(nil), do: false
  defp truthy?(false), do: false
  defp truthy?(0), do: false
  defp truthy?(""), do: false
  defp truthy?(_), do: true

  # ============================================================================
  # Helpers
  # ============================================================================

  defp via_tuple(deployment_id) do
    {:via, Registry, {AetheriumServer.RuntimeRegistry, deployment_id}}
  end

  defp find_initial_state(automata) do
    states = automata[:states] || %{}

    initial =
      states
      |> Map.values()
      |> Enum.find(&(&1[:type] == :initial))

    if initial, do: initial[:id], else: nil
  end

  defp get_state_def(state_id, state) do
    states = state.automata[:states] || %{}
    Map.get(states, state_id)
  end

  defp initialize_variables(variables) do
    variables
    |> Enum.map(fn var -> {var[:name], var[:default]} end)
    |> Enum.into(%{})
  end

  defp separate_io(variables) do
    inputs =
      variables
      |> Enum.filter(&(&1[:direction] == :input))
      |> Enum.map(fn var -> {var[:name], var[:default]} end)
      |> Enum.into(%{})

    outputs =
      variables
      |> Enum.filter(&(&1[:direction] == :output))
      |> Enum.map(fn var -> {var[:name], var[:default]} end)
      |> Enum.into(%{})

    {inputs, outputs}
  end

  defp broadcast_transition(from, to, transition_id, context, state) do
    AetheriumServer.GatewayConnection.report_alert(%{
      type: :transition_fired,
      data: %{
        deployment_id: state.deployment_id,
        from: from,
        to: to,
        transition_id: transition_id,
        context: context,
        timestamp: System.system_time(:millisecond)
      }
    })
  end

  defp broadcast_output(output_name, value, state) do
    AetheriumServer.GatewayConnection.report_alert(%{
      type: :output_changed,
      data: %{
        deployment_id: state.deployment_id,
        automata_id: state.automata[:id],
        output: output_name,
        value: value,
        timestamp: System.system_time(:millisecond)
      }
    })
  end
end
