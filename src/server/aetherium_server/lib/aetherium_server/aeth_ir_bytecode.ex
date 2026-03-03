defmodule AetheriumServer.AethIrBytecode do
  @moduledoc false

  @magic "AETHBC01"

  @value_void 0x00
  @value_bool 0x01
  @value_int32 0x02
  @value_float32 0x04
  @value_string 0x06

  @dir_input 0x01
  @dir_output 0x02
  @dir_internal 0x03

  @transition_immediate 0x01
  @transition_timed_after 0x02
  @transition_classic 0x03
  @transition_event_signal 0x04

  @event_on_change 0x01
  @event_on_rise 0x02
  @event_on_fall 0x03
  @event_on_threshold 0x04
  @event_on_match 0x05

  @compare_eq 0x01
  @compare_ne 0x02
  @compare_lt 0x03
  @compare_le 0x04
  @compare_gt 0x05
  @compare_ge 0x06

  @spec compile_gateway_automata(map()) ::
          {:ok,
           %{
             payload: binary(),
             state_id_map: %{pos_integer() => String.t()},
             transition_id_map: %{pos_integer() => String.t()},
             warnings: [String.t()]
           }}
          | {:unsupported, [String.t()]}
          | {:error, term()}
  def compile_gateway_automata(automata) when is_map(automata) do
    with {:ok, normalized} <- normalize_automata(automata),
         {:ok, payload} <- encode_program(normalized) do
      {:ok,
       %{
         payload: payload,
         state_id_map: normalized.state_id_map,
         transition_id_map: normalized.transition_id_map,
         warnings: normalized.warnings
       }}
    end
  end

  defp normalize_automata(automata) do
    name = to_s(Map.get(automata, :name) || Map.get(automata, "name") || "automata")
    states_map = Map.get(automata, :states) || Map.get(automata, "states") || %{}
    transitions_map = Map.get(automata, :transitions) || Map.get(automata, "transitions") || %{}
    variables_list = Map.get(automata, :variables) || Map.get(automata, "variables") || []

    with {:ok, normalized_states} <- normalize_states(states_map),
         {:ok, initial_state_id} <-
           resolve_initial_state_id(automata, states_map, normalized_states),
         {:ok, normalized_vars} <- normalize_variables(variables_list),
         {:ok, normalized_transitions} <-
           normalize_transitions(
             transitions_map,
             normalized_states.state_lookup,
             normalized_states.state_num_by_name
           ) do
      {:ok,
       %{
         version_major: 0,
         version_minor: 1,
         name: name,
         initial_state_id: initial_state_id,
         states: normalized_states.states,
         state_id_map: normalized_states.state_id_map,
         variables: normalized_vars.variables,
         transitions: normalized_transitions.transitions,
         transition_id_map: normalized_transitions.transition_id_map,
         warnings: normalized_transitions.warnings
       }}
    end
  end

  defp normalize_states(states_map) when is_map(states_map) do
    ordered =
      states_map
      |> Map.values()
      |> Enum.map(fn s ->
        %{
          raw: s,
          name: to_s(Map.get(s, :name) || Map.get(s, "name")),
          key_id: to_s(Map.get(s, :id) || Map.get(s, "id")),
          type: Map.get(s, :type) || Map.get(s, "type"),
          on_enter: Map.get(s, :on_enter) || Map.get(s, "on_enter"),
          on_exit: Map.get(s, :on_exit) || Map.get(s, "on_exit"),
          body: Map.get(s, :body) || Map.get(s, "body")
        }
      end)
      |> Enum.reject(&(&1.name == ""))
      |> Enum.sort_by(& &1.name)

    cond do
      ordered == [] ->
        {:unsupported, ["Bytecode subset compiler requires at least one named state."]}

      Enum.any?(ordered, &state_has_code?/1) ->
        {:unsupported,
         [
           "State code hooks (on_enter/on_exit/body) are not supported by bytecode subset compiler yet."
         ]}

      true ->
        {states, state_id_map, state_num_by_name} =
          ordered
          |> Enum.with_index(1)
          |> Enum.reduce({[], %{}, %{}}, fn {state, idx}, {acc, id_map, num_by_name} ->
            encoded = %{id: idx, name: state.name}

            {
              [encoded | acc],
              Map.put(id_map, idx, state.name),
              Map.put(num_by_name, state.name, idx)
            }
          end)

        {:ok,
         %{
           states: Enum.reverse(states),
           state_id_map: state_id_map,
           state_num_by_name: state_num_by_name,
           state_lookup: build_state_lookup(states_map)
         }}
    end
  end

  defp normalize_states(_),
    do: {:unsupported, ["Invalid states collection for bytecode subset compiler."]}

  defp resolve_initial_state_id(automata, states_map, normalized_states) do
    initial_ref =
      Map.get(automata, :initial_state) || Map.get(automata, "initial_state") ||
        Map.get(automata, :initialState) || Map.get(automata, "initialState")

    inferred =
      resolve_state_name(initial_ref, normalized_states.state_lookup) ||
        infer_initial_state_name(states_map, Map.values(normalized_states.state_id_map))

    case inferred do
      nil ->
        {:unsupported, ["Unable to resolve initial state for bytecode subset compiler."]}

      name ->
        case Map.get(normalized_states.state_num_by_name, name) do
          nil ->
            {:unsupported, ["Initial state #{inspect(name)} not found in bytecode state set."]}

          id ->
            {:ok, id}
        end
    end
  end

  defp normalize_variables(vars) when is_list(vars) do
    ordered =
      vars
      |> Enum.map(fn v ->
        %{
          name: to_s(Map.get(v, :name) || Map.get(v, "name")),
          type: Map.get(v, :type) || Map.get(v, "type"),
          direction: Map.get(v, :direction) || Map.get(v, "direction") || :internal,
          default: Map.get(v, :default) || Map.get(v, "default")
        }
      end)
      |> Enum.reject(&(&1.name == ""))
      |> Enum.sort_by(& &1.name)

    with :ok <- ensure_unique_names(ordered, "variable"),
         {:ok, encoded} <- encode_variables(ordered) do
      {:ok, %{variables: encoded}}
    end
  end

  defp normalize_variables(_),
    do: {:unsupported, ["Invalid variables collection for bytecode subset compiler."]}

  defp normalize_transitions(transitions_map, state_lookup, state_num_by_name)
       when is_map(transitions_map) do
    ordered =
      transitions_map
      |> Map.values()
      |> Enum.map(fn t ->
        %{
          name: transition_name(t),
          from: resolve_state_name(Map.get(t, :from) || Map.get(t, "from"), state_lookup),
          to: resolve_state_name(Map.get(t, :to) || Map.get(t, "to"), state_lookup),
          type: downcase_atomish(Map.get(t, :type) || Map.get(t, "type") || "classic"),
          raw: t
        }
      end)
      |> Enum.reject(&(&1.name == ""))
      |> Enum.sort_by(& &1.name)

    with :ok <- ensure_unique_names(ordered, "transition"),
         {:ok, encoded, warnings} <- encode_transitions(ordered, state_num_by_name) do
      transition_id_map =
        encoded
        |> Enum.map(&{&1.id, &1.name})
        |> Enum.into(%{})

      {:ok, %{transitions: encoded, transition_id_map: transition_id_map, warnings: warnings}}
    end
  end

  defp normalize_transitions(_, _state_lookup, _state_num_by_name),
    do: {:unsupported, ["Invalid transitions collection for bytecode subset compiler."]}

  defp encode_program(%{
         version_major: maj,
         version_minor: min,
         name: name,
         initial_state_id: initial_state_id,
         variables: variables,
         states: states,
         transitions: transitions
       }) do
    with :ok <- ensure_u16(maj, :version_major_out_of_range),
         :ok <- ensure_u16(min, :version_minor_out_of_range),
         {:ok, name_bin} <- encode_string_u16(name),
         :ok <- ensure_u16(initial_state_id, :initial_state_out_of_range),
         :ok <- ensure_u16(length(variables), :too_many_variables),
         :ok <- ensure_u16(length(states), :too_many_states),
         :ok <- ensure_u16(length(transitions), :too_many_transitions),
         {:ok, vars_bin} <- encode_variable_entries(variables),
         {:ok, states_bin} <- encode_state_entries(states),
         {:ok, transitions_bin} <- encode_transition_entries(transitions) do
      {:ok,
       IO.iodata_to_binary([
         @magic,
         <<maj::16-big, min::16-big>>,
         name_bin,
         <<initial_state_id::16-big, length(variables)::16-big, length(states)::16-big,
           length(transitions)::16-big>>,
         vars_bin,
         states_bin,
         transitions_bin
       ])}
    end
  end

  defp encode_variable_entries(vars) do
    vars
    |> Enum.reduce_while({:ok, []}, fn v, {:ok, acc} ->
      with :ok <- ensure_u16(v.id, :variable_id_out_of_range),
           {:ok, name_bin} <- encode_string_u16(v.name),
           {:ok, value_bin} <- encode_value(v.type_code, v.initial) do
        bin = [<<v.id::16-big, v.type_code::8, v.direction_code::8>>, name_bin, value_bin]
        {:cont, {:ok, [acc, bin]}}
      else
        {:error, _} = err -> {:halt, err}
      end
    end)
  end

  defp encode_state_entries(states) do
    states
    |> Enum.reduce_while({:ok, []}, fn s, {:ok, acc} ->
      with :ok <- ensure_u16(s.id, :state_id_out_of_range),
           {:ok, name_bin} <- encode_string_u16(s.name) do
        {:cont, {:ok, [acc, <<s.id::16-big>>, name_bin]}}
      else
        {:error, _} = err -> {:halt, err}
      end
    end)
  end

  defp encode_transition_entries(transitions) do
    transitions
    |> Enum.reduce_while({:ok, []}, fn t, {:ok, acc} ->
      with :ok <- ensure_u16(t.id, :transition_id_out_of_range),
           :ok <- ensure_u16(t.from_id, :transition_from_out_of_range),
           :ok <- ensure_u16(t.to_id, :transition_to_out_of_range),
           :ok <- ensure_u32(t.delay_ms, :transition_delay_out_of_range),
           {:ok, condition_bin} <- encode_string_u16(t.condition_expr || ""),
           {:ok, threshold_value_bin} <-
             encode_value(t.event_threshold_type_code || @value_void, t.event_threshold_value),
           {:ok, event_signal_bin} <- encode_string_u16(t.event_signal_name || ""),
           {:ok, event_pattern_bin} <- encode_string_u16(t.event_pattern || ""),
           {:ok, name_bin} <- encode_string_u16(t.name) do
        bin =
          [
            <<t.id::16-big, t.from_id::16-big, t.to_id::16-big, t.kind_code::8, t.priority::8,
              if(t.enabled, do: 1, else: 0)::8, 0::8, t.delay_ms::32-big>>,
            condition_bin,
            <<t.event_signal_direction_code::8, t.event_trigger_code::8,
              if(t.event_has_threshold, do: 1, else: 0)::8, t.event_threshold_op_code::8,
              if(t.event_threshold_one_shot, do: 1, else: 0)::8, 0::8>>,
            threshold_value_bin,
            event_signal_bin,
            event_pattern_bin,
            name_bin
          ]

        {:cont, {:ok, [acc, bin]}}
      else
        {:error, _} = err -> {:halt, err}
      end
    end)
  end

  defp encode_variables(ordered) do
    ordered
    |> Enum.with_index(1)
    |> Enum.reduce_while({:ok, []}, fn {v, idx}, {:ok, acc} ->
      with {:ok, type_code, initial} <- normalize_variable_type_and_initial(v.type, v.default),
           {:ok, direction_code} <- normalize_direction(v.direction) do
        encoded = %{
          id: idx,
          name: v.name,
          type_code: type_code,
          direction_code: direction_code,
          initial: initial
        }

        {:cont, {:ok, [encoded | acc]}}
      else
        {:unsupported, reasons} -> {:halt, {:unsupported, reasons}}
        {:error, _} = err -> {:halt, err}
      end
    end)
    |> case do
      {:ok, encoded} -> {:ok, Enum.reverse(encoded)}
      other -> other
    end
  end

  defp encode_transitions(ordered, state_num_by_name) do
    ordered
    |> Enum.with_index(1)
    |> Enum.reduce_while({:ok, [], []}, fn {t, idx}, {:ok, acc, warnings} ->
      with {:ok, from_id} <- lookup_state_num(t.from, state_num_by_name, :from),
           {:ok, to_id} <- lookup_state_num(t.to, state_num_by_name, :to),
           :ok <- ensure_transition_has_no_scripts(t.type, t.raw),
           {:ok, kind_code, delay_ms, condition_expr, event_meta, transition_warnings} <-
             normalize_transition_kind(t) do
        encoded = %{
          id: idx,
          name: t.name,
          from_id: from_id,
          to_id: to_id,
          kind_code: kind_code,
          priority: normalize_priority(Map.get(t.raw, :priority) || Map.get(t.raw, "priority")),
          enabled: normalize_enabled(Map.get(t.raw, :enabled) || Map.get(t.raw, "enabled")),
          delay_ms: delay_ms,
          condition_expr: condition_expr,
          event_signal_name: event_meta[:signal_name] || "",
          event_signal_direction_code: event_meta[:signal_direction_code] || @dir_input,
          event_trigger_code: event_meta[:trigger_code] || @event_on_change,
          event_has_threshold: event_meta[:has_threshold] || false,
          event_threshold_op_code: event_meta[:threshold_op_code] || @compare_gt,
          event_threshold_type_code: event_meta[:threshold_type_code] || @value_void,
          event_threshold_value: event_meta[:threshold_value],
          event_threshold_one_shot: event_meta[:threshold_one_shot] || false,
          event_pattern: event_meta[:pattern] || ""
        }

        {:cont, {:ok, [encoded | acc], warnings ++ transition_warnings}}
      else
        {:unsupported, reasons} -> {:halt, {:unsupported, reasons}}
        {:error, _} = err -> {:halt, err}
      end
    end)
    |> case do
      {:ok, encoded, warnings} -> {:ok, Enum.reverse(encoded), Enum.uniq(warnings)}
      other -> other
    end
  end

  defp normalize_transition_kind(%{type: "immediate"}) do
    {:ok, @transition_immediate, 0, "", %{}, []}
  end

  defp normalize_transition_kind(%{type: "classic", raw: raw}) do
    with {:ok, condition_expr} <-
           normalize_classic_condition(Map.get(raw, :condition) || Map.get(raw, "condition")) do
      {:ok, @transition_classic, 0, condition_expr, %{}, []}
    end
  end

  defp normalize_transition_kind(%{type: "timed", raw: raw}) do
    timed = Map.get(raw, :timed) || Map.get(raw, "timed") || %{}

    delay =
      first_present([
        Map.get(raw, :after),
        Map.get(raw, "after"),
        Map.get(raw, :delay_ms),
        Map.get(raw, "delay_ms"),
        Map.get(raw, :delayMs),
        Map.get(raw, "delayMs"),
        Map.get(timed, :after),
        Map.get(timed, "after"),
        Map.get(timed, :delay_ms),
        Map.get(timed, "delay_ms"),
        Map.get(timed, :delayMs),
        Map.get(timed, "delayMs")
      ])

    mode = downcase_atomish(Map.get(timed, :mode) || Map.get(timed, "mode") || "after")

    with {:ok, delay_ms} <- normalize_delay_ms(delay),
         true <-
           mode in ["after", ""] or
             {:unsupported, ["Timed bytecode subset currently supports only `after` mode."]} do
      {:ok, @transition_timed_after, delay_ms, "", %{}, []}
    end
  end

  defp normalize_transition_kind(%{type: "event", raw: raw}) do
    with {:ok, event_meta} <- normalize_event_transition(raw) do
      {:ok, @transition_event_signal, 0, "", event_meta, []}
    end
  end

  defp normalize_transition_kind(%{type: type}) do
    {:unsupported,
     ["Transition type #{inspect(type)} is not supported by bytecode subset compiler yet."]}
  end

  defp ensure_transition_has_no_scripts(type, raw) do
    unsupported_keys =
      [
        :probabilistic,
        "probabilistic",
        :body,
        "body",
        :triggered,
        "triggered"
      ]

    unsupported_keys =
      cond do
        type == "classic" -> unsupported_keys ++ [:event, "event"]
        type == "event" -> [:condition, "condition" | unsupported_keys]
        true -> [:condition, "condition", :event, "event" | unsupported_keys]
      end

    if Enum.any?(unsupported_keys, fn key -> present_value?(Map.get(raw, key)) end) do
      {:unsupported,
       ["Transition scripts/conditions/events are not supported by bytecode subset compiler yet."]}
    else
      :ok
    end
  end

  defp normalize_event_transition(raw) do
    event = Map.get(raw, :event) || Map.get(raw, "event") || %{}

    triggers = Map.get(event, :triggers) || Map.get(event, "triggers") || []

    require_all =
      Map.get(event, :require_all) || Map.get(event, "require_all") ||
        Map.get(event, :requireAll) || Map.get(event, "requireAll")

    debounce =
      Map.get(event, :debounce_ms) || Map.get(event, "debounce_ms") ||
        Map.get(event, :debounceMs) || Map.get(event, "debounceMs")

    addl =
      Map.get(event, :additional_condition) || Map.get(event, "additional_condition") ||
        Map.get(event, :additionalCondition) || Map.get(event, "additionalCondition")

    with true <- is_map(event) or {:unsupported, ["Event transition config must be a map."]},
         true <-
           is_list(triggers) or
             {:unsupported, ["Event bytecode subset requires `event.triggers` list."]},
         true <-
           length(triggers) == 1 or
             {:unsupported,
              ["Event bytecode subset supports exactly one trigger per transition."]},
         true <-
           not truthy?(require_all) or
             {:unsupported, ["Event bytecode subset does not support `requireAll`."]},
         true <-
           nil_or_zero?(debounce) or
             {:unsupported, ["Event bytecode subset does not support debounce."]},
         true <-
           not present_value?(addl) or
             {:unsupported, ["Event bytecode subset does not support additional conditions."]},
         {:ok, trigger_meta} <- normalize_event_trigger(hd(triggers)) do
      {:ok, trigger_meta}
    end
  end

  defp normalize_event_trigger(trigger) when is_map(trigger) do
    signal =
      Map.get(trigger, :signal) || Map.get(trigger, "signal") ||
        Map.get(trigger, :signal_name) || Map.get(trigger, "signal_name") ||
        Map.get(trigger, :signalName) || Map.get(trigger, "signalName")

    trigger_type =
      Map.get(trigger, :trigger) || Map.get(trigger, "trigger") ||
        Map.get(trigger, :triggerType) || Map.get(trigger, "triggerType")

    signal_type =
      Map.get(trigger, :signal_type) || Map.get(trigger, "signal_type") ||
        Map.get(trigger, :signalType) || Map.get(trigger, "signalType") || :input

    threshold = Map.get(trigger, :threshold) || Map.get(trigger, "threshold")
    pattern = Map.get(trigger, :pattern) || Map.get(trigger, "pattern")

    with true <-
           (is_binary(to_s(signal)) and String.trim(to_s(signal)) != "") or
             {:unsupported, ["Event bytecode subset trigger requires `signal`."]},
         {:ok, direction_code} <- normalize_direction(signal_type),
         {:ok, trigger_code} <- normalize_event_trigger_type(trigger_type),
         {:ok, trigger_meta} <- normalize_event_trigger_payload(trigger_code, threshold, pattern) do
      {:ok,
       %{
         signal_name: String.trim(to_s(signal)),
         signal_direction_code: direction_code,
         trigger_code: trigger_code
       }
       |> Map.merge(trigger_meta)}
    end
  end

  defp normalize_event_trigger(_),
    do: {:unsupported, ["Event bytecode subset trigger entries must be maps."]}

  defp normalize_event_trigger_type(type) do
    case downcase_atomish(type) do
      "on_change" ->
        {:ok, @event_on_change}

      "onchange" ->
        {:ok, @event_on_change}

      "change" ->
        {:ok, @event_on_change}

      "on_rise" ->
        {:ok, @event_on_rise}

      "onrise" ->
        {:ok, @event_on_rise}

      "rise" ->
        {:ok, @event_on_rise}

      "on_fall" ->
        {:ok, @event_on_fall}

      "onfall" ->
        {:ok, @event_on_fall}

      "fall" ->
        {:ok, @event_on_fall}

      "on_threshold" ->
        {:ok, @event_on_threshold}

      "onthreshold" ->
        {:ok, @event_on_threshold}

      "threshold" ->
        {:ok, @event_on_threshold}

      "on_match" ->
        {:ok, @event_on_match}

      "onmatch" ->
        {:ok, @event_on_match}

      "match" ->
        {:ok, @event_on_match}

      "" ->
        {:ok, @event_on_change}

      other ->
        {:unsupported,
         ["Event trigger #{inspect(other)} is not supported by bytecode subset compiler yet."]}
    end
  end

  defp normalize_event_trigger_payload(trigger_code, threshold, pattern)
       when trigger_code in [@event_on_change, @event_on_rise, @event_on_fall] do
    with true <-
           not present_value?(threshold) or
             {:unsupported, ["This event trigger type does not support `threshold`."]},
         true <-
           not present_value?(pattern) or
             {:unsupported, ["This event trigger type does not support `pattern`."]} do
      {:ok, %{}}
    end
  end

  defp normalize_event_trigger_payload(@event_on_threshold, threshold, pattern) do
    with true <-
           not present_value?(pattern) or
             {:unsupported, ["on_threshold trigger does not support `pattern`."]},
         {:ok, threshold_meta} <- normalize_threshold_config(threshold) do
      {:ok, threshold_meta}
    end
  end

  defp normalize_event_trigger_payload(@event_on_match, threshold, pattern) do
    with true <-
           not present_value?(threshold) or
             {:unsupported, ["on_match trigger does not support `threshold`."]},
         true <-
           is_binary(pattern) or {:unsupported, ["on_match trigger requires string `pattern`."]},
         true <-
           pattern != "" or {:unsupported, ["on_match trigger requires non-empty `pattern`."]} do
      {:ok, %{pattern: pattern}}
    end
  end

  defp normalize_threshold_config(threshold) when is_map(threshold) do
    op = Map.get(threshold, :op) || Map.get(threshold, "op")
    value = Map.get(threshold, :value) || Map.get(threshold, "value")

    one_shot =
      Map.get(threshold, :one_shot) || Map.get(threshold, "one_shot") ||
        Map.get(threshold, :oneShot) || Map.get(threshold, "oneShot")

    with {:ok, op_code} <- normalize_compare_op(op),
         {:ok, type_code, normalized_value} <- normalize_threshold_value(value) do
      {:ok,
       %{
         has_threshold: true,
         threshold_op_code: op_code,
         threshold_type_code: type_code,
         threshold_value: normalized_value,
         threshold_one_shot: truthy?(one_shot)
       }}
    end
  end

  defp normalize_threshold_config(_),
    do: {:unsupported, ["on_threshold trigger requires `threshold` map with `op` and `value`."]}

  defp normalize_compare_op(op) do
    case downcase_atomish(op) do
      "eq" ->
        {:ok, @compare_eq}

      "==" ->
        {:ok, @compare_eq}

      "ne" ->
        {:ok, @compare_ne}

      "!=" ->
        {:ok, @compare_ne}

      "lt" ->
        {:ok, @compare_lt}

      "<" ->
        {:ok, @compare_lt}

      "le" ->
        {:ok, @compare_le}

      "<=" ->
        {:ok, @compare_le}

      "gt" ->
        {:ok, @compare_gt}

      ">" ->
        {:ok, @compare_gt}

      "ge" ->
        {:ok, @compare_ge}

      ">=" ->
        {:ok, @compare_ge}

      _ ->
        {:unsupported, ["Threshold `op` must be one of == != < <= > >= (or eq/ne/lt/le/gt/ge)."]}
    end
  end

  defp normalize_threshold_value(nil), do: {:unsupported, ["Threshold `value` is required."]}

  defp normalize_threshold_value(value) when is_boolean(value), do: {:ok, @value_bool, value}

  defp normalize_threshold_value(value) when is_integer(value) do
    if value < -2_147_483_648 or value > 2_147_483_647 do
      {:unsupported, ["Threshold integer value is out of Int32 range."]}
    else
      {:ok, @value_int32, value}
    end
  end

  defp normalize_threshold_value(value) when is_float(value), do: {:ok, @value_float32, value}

  defp normalize_threshold_value(value) when is_binary(value) do
    trimmed = String.trim(value)

    cond do
      trimmed == "" ->
        {:unsupported, ["Threshold string value cannot be empty."]}

      String.downcase(trimmed) in ["true", "false"] ->
        {:ok, @value_bool, String.downcase(trimmed) == "true"}

      true ->
        case Integer.parse(trimmed) do
          {int, ""} ->
            normalize_threshold_value(int)

          _ ->
            case Float.parse(trimmed) do
              {float, ""} -> {:ok, @value_float32, float}
              _ -> {:ok, @value_string, trimmed}
            end
        end
    end
  end

  defp normalize_threshold_value(_),
    do: {:unsupported, ["Threshold value has unsupported type."]}

  defp normalize_variable_type_and_initial(type, default) do
    case downcase_atomish(type) do
      "bool" ->
        with {:ok, v} <- coerce_bool(default) do
          {:ok, @value_bool, v}
        end

      "int" ->
        normalize_int32_default(default)

      "int32" ->
        normalize_int32_default(default)

      "float" ->
        normalize_float32_default(default)

      "float32" ->
        normalize_float32_default(default)

      "string" ->
        {:ok, @value_string, if(is_nil(default), do: "", else: to_s(default))}

      "" ->
        {:unsupported, ["Variable type is required for bytecode subset compiler."]}

      other ->
        {:unsupported,
         ["Variable type #{inspect(other)} is not supported by bytecode subset compiler yet."]}
    end
  end

  defp normalize_int32_default(default) do
    with {:ok, v} <- coerce_int(default) do
      if v < -2_147_483_648 or v > 2_147_483_647 do
        {:unsupported, ["Int32 variable default is out of range for bytecode subset compiler."]}
      else
        {:ok, @value_int32, v}
      end
    end
  end

  defp normalize_float32_default(default) do
    with {:ok, v} <- coerce_float(default) do
      {:ok, @value_float32, v}
    end
  end

  defp normalize_direction(direction) do
    case downcase_atomish(direction) do
      "input" -> {:ok, @dir_input}
      "output" -> {:ok, @dir_output}
      "" -> {:ok, @dir_internal}
      "internal" -> {:ok, @dir_internal}
      other -> {:unsupported, ["Variable direction #{inspect(other)} is not supported."]}
    end
  end

  defp encode_value(@value_bool, v) when is_boolean(v),
    do: {:ok, <<@value_bool::8, if(v, do: 1, else: 0)::8>>}

  defp encode_value(@value_int32, v) when is_integer(v),
    do: {:ok, <<@value_int32::8, v::signed-32-big>>}

  defp encode_value(@value_float32, v) when is_float(v),
    do: {:ok, <<@value_float32::8, v::float-32-big>>}

  defp encode_value(@value_string, v) when is_binary(v) do
    with {:ok, s} <- encode_string_u16(v) do
      {:ok, [<<@value_string::8>>, s]}
    end
  end

  defp encode_value(@value_void, _), do: {:ok, <<@value_void::8>>}
  defp encode_value(_type, _v), do: {:error, :invalid_bytecode_value}

  defp ensure_unique_names(entries, label) do
    names = Enum.map(entries, & &1.name)

    if length(names) == length(Enum.uniq(names)) do
      :ok
    else
      {:unsupported, ["Duplicate #{label} names are not supported by bytecode subset compiler."]}
    end
  end

  defp lookup_state_num(nil, _map, which),
    do:
      {:unsupported,
       ["Transition #{which} state could not be resolved for bytecode subset compiler."]}

  defp lookup_state_num(name, map, which) do
    case Map.get(map, name) do
      nil ->
        {:unsupported,
         ["Transition #{which} state #{inspect(name)} is not present in compiled state set."]}

      id ->
        {:ok, id}
    end
  end

  defp normalize_delay_ms(nil),
    do: {:unsupported, ["Timed bytecode subset transitions require an `after`/`delay_ms` value."]}

  defp normalize_delay_ms(v) when is_integer(v) and v >= 0, do: {:ok, v}
  defp normalize_delay_ms(v) when is_float(v) and v >= 0.0, do: {:ok, trunc(v)}

  defp normalize_delay_ms(v) when is_binary(v) do
    value = String.trim(v)

    with {:ok, numeric, factor} <- parse_duration_number_and_factor(value),
         true <- numeric >= 0.0 or {:unsupported, ["Timed transition delay must be non-negative."]} do
      {:ok, trunc(numeric * factor)}
    else
      {:error, :invalid_duration} ->
        {:unsupported,
         ["Timed transition delay must be numeric and may use ms/s/m/h suffixes."]}

      {:unsupported, _} = unsupported ->
        unsupported
    end
  end

  defp normalize_delay_ms(_), do: {:unsupported, ["Timed transition delay must be numeric."]}

  defp parse_duration_number_and_factor(raw) when is_binary(raw) do
    lower = String.downcase(String.trim(raw))

    cond do
      lower == "" ->
        {:error, :invalid_duration}

      String.ends_with?(lower, "ms") ->
        parse_duration_number(lower, "ms", 1.0)

      String.ends_with?(lower, "s") ->
        parse_duration_number(lower, "s", 1000.0)

      String.ends_with?(lower, "m") ->
        parse_duration_number(lower, "m", 60_000.0)

      String.ends_with?(lower, "h") ->
        parse_duration_number(lower, "h", 3_600_000.0)

      true ->
        parse_duration_number(lower, "", 1.0)
    end
  end

  defp parse_duration_number(raw, suffix, factor) do
    number =
      if suffix == "" do
        raw
      else
        String.slice(raw, 0, byte_size(raw) - byte_size(suffix))
      end
      |> String.trim()

    case Float.parse(number) do
      {value, ""} -> {:ok, value, factor}
      _ -> {:error, :invalid_duration}
    end
  end

  defp normalize_classic_condition(nil),
    do: {:unsupported, ["Classic bytecode subset transitions require a `condition` expression."]}

  defp normalize_classic_condition(condition) do
    expr = to_s(condition) |> String.trim()

    cond do
      expr == "" ->
        {:unsupported, ["Classic bytecode subset transitions require a non-empty condition."]}

      String.contains?(expr, "\n") ->
        {:unsupported, ["Classic bytecode subset supports single-line conditions only."]}

      true ->
        with {:ok, tokens} <- tokenize_classic_condition(expr),
             {:ok, ast, []} <- parse_bool_expr(tokens),
             {:ok, canonical} <- render_classic_condition(ast) do
          {:ok, canonical}
        else
          {:ok, _ast, rest} ->
            {:unsupported,
             [
               "Classic bytecode subset condition has unsupported trailing tokens: #{inspect(rest)}"
             ]}

          {:error, reason} ->
            {:unsupported, [reason]}
        end
    end
  end

  defp tokenize_classic_condition(expr), do: tokenize_classic_condition(expr, [])

  defp tokenize_classic_condition(<<>>, acc), do: {:ok, Enum.reverse(acc)}

  defp tokenize_classic_condition(<<c, rest::binary>>, acc) when c in [?\s, ?\t, ?\r, ?\n],
    do: tokenize_classic_condition(rest, acc)

  defp tokenize_classic_condition(<<"&&", rest::binary>>, acc),
    do: tokenize_classic_condition(rest, [{:kw, "and"} | acc])

  defp tokenize_classic_condition(<<"||", rest::binary>>, acc),
    do: tokenize_classic_condition(rest, [{:kw, "or"} | acc])

  defp tokenize_classic_condition(<<"==", rest::binary>>, acc),
    do: tokenize_classic_condition(rest, [{:op, "=="} | acc])

  defp tokenize_classic_condition(<<"!=", rest::binary>>, acc),
    do: tokenize_classic_condition(rest, [{:op, "!="} | acc])

  defp tokenize_classic_condition(<<">=", rest::binary>>, acc),
    do: tokenize_classic_condition(rest, [{:op, ">="} | acc])

  defp tokenize_classic_condition(<<"<=", rest::binary>>, acc),
    do: tokenize_classic_condition(rest, [{:op, "<="} | acc])

  defp tokenize_classic_condition(<<"(", rest::binary>>, acc),
    do: tokenize_classic_condition(rest, [:lparen | acc])

  defp tokenize_classic_condition(<<")", rest::binary>>, acc),
    do: tokenize_classic_condition(rest, [:rparen | acc])

  defp tokenize_classic_condition(<<"!", rest::binary>>, acc),
    do: tokenize_classic_condition(rest, [{:kw, "not"} | acc])

  defp tokenize_classic_condition(<<">", rest::binary>>, acc),
    do: tokenize_classic_condition(rest, [{:op, ">"} | acc])

  defp tokenize_classic_condition(<<"<", rest::binary>>, acc),
    do: tokenize_classic_condition(rest, [{:op, "<"} | acc])

  defp tokenize_classic_condition(<<"\"", _::binary>> = bin, acc) do
    with {:ok, value, rest} <- read_quoted_string(bin, ?") do
      tokenize_classic_condition(rest, [{:string, value} | acc])
    end
  end

  defp tokenize_classic_condition(<<"'", _::binary>> = bin, acc) do
    with {:ok, value, rest} <- read_quoted_string(bin, ?') do
      tokenize_classic_condition(rest, [{:string, value} | acc])
    end
  end

  defp tokenize_classic_condition(<<c, _::binary>> = bin, acc) when c in ?0..?9 or c == ?- do
    case read_number_token(bin) do
      {:ok, value, rest} -> tokenize_classic_condition(rest, [{:number, value} | acc])
      {:error, _} = err -> err
    end
  end

  defp tokenize_classic_condition(<<c, _::binary>> = bin, acc)
       when c in ?A..?Z or c in ?a..?z or c == ?_ do
    {ident, rest} = take_identifier(bin)

    token =
      case String.downcase(ident) do
        kw when kw in ["and", "or", "not"] -> {:kw, kw}
        "true" -> {:bool, true}
        "false" -> {:bool, false}
        _ -> {:ident, ident}
      end

    tokenize_classic_condition(rest, [token | acc])
  end

  defp tokenize_classic_condition(<<c, _::binary>>, _acc) do
    {:error,
     "Classic bytecode subset condition contains unsupported character: #{inspect(<<c>>)}"}
  end

  defp parse_bool_expr(tokens), do: parse_or_expr(tokens)

  defp parse_or_expr(tokens) do
    with {:ok, left, rest} <- parse_and_expr(tokens) do
      parse_or_tail(left, rest)
    end
  end

  defp parse_or_tail(left, [{:kw, "or"} | rest]) do
    with {:ok, right, rest2} <- parse_and_expr(rest) do
      parse_or_tail({:bin, "or", left, right}, rest2)
    end
  end

  defp parse_or_tail(left, rest), do: {:ok, left, rest}

  defp parse_and_expr(tokens) do
    with {:ok, left, rest} <- parse_unary_expr(tokens) do
      parse_and_tail(left, rest)
    end
  end

  defp parse_and_tail(left, [{:kw, "and"} | rest]) do
    with {:ok, right, rest2} <- parse_unary_expr(rest) do
      parse_and_tail({:bin, "and", left, right}, rest2)
    end
  end

  defp parse_and_tail(left, rest), do: {:ok, left, rest}

  defp parse_unary_expr([{:kw, "not"} | rest]) do
    with {:ok, expr, rest2} <- parse_unary_expr(rest) do
      {:ok, {:not, expr}, rest2}
    end
  end

  defp parse_unary_expr(tokens), do: parse_primary_expr(tokens)

  defp parse_primary_expr([:lparen | rest]) do
    with {:ok, expr, rest2} <- parse_bool_expr(rest) do
      case rest2 do
        [:rparen | rest3] -> {:ok, expr, rest3}
        _ -> {:error, "Classic bytecode subset condition has unmatched `(`."}
      end
    end
  end

  defp parse_primary_expr(tokens) do
    with {:ok, left, rest} <- parse_operand(tokens) do
      case rest do
        [{:op, op} | rest2] when op in ["==", "!=", ">", ">=", "<", "<="] ->
          with {:ok, right, rest3} <- parse_operand(rest2) do
            {:ok, {:cmp, op, left, right}, rest3}
          end

        _ ->
          {:ok, left, rest}
      end
    end
  end

  # Support common gateway condition style: value("var_name") / value(var_name)
  # by lowering it to a direct variable reference for bytecode subset expressions.
  defp parse_operand([{:ident, fun}, :lparen, {:string, name}, :rparen | rest])
       when fun in ["value", "getVal", "getval"] do
    {:ok, {:ident, name}, rest}
  end

  defp parse_operand([{:ident, fun}, :lparen, {:ident, name}, :rparen | rest])
       when fun in ["value", "getVal", "getval"] do
    {:ok, {:ident, name}, rest}
  end

  defp parse_operand([{:ident, name} | rest]), do: {:ok, {:ident, name}, rest}
  defp parse_operand([{:bool, value} | rest]), do: {:ok, {:lit, {:bool, value}}, rest}
  defp parse_operand([{:number, value} | rest]), do: {:ok, {:lit, {:number, value}}, rest}
  defp parse_operand([{:string, value} | rest]), do: {:ok, {:lit, {:string, value}}, rest}
  defp parse_operand([]), do: {:error, "Classic bytecode subset condition ended unexpectedly."}

  defp parse_operand([token | _rest]) do
    {:error,
     "Classic bytecode subset condition expected a variable or literal, got #{inspect(token)}."}
  end

  defp render_classic_condition(ast) do
    {:ok, render_expr(ast)}
  end

  defp render_expr({:ident, name}), do: name
  defp render_expr({:lit, {:bool, true}}), do: "true"
  defp render_expr({:lit, {:bool, false}}), do: "false"
  defp render_expr({:lit, {:number, n}}), do: n
  defp render_expr({:lit, {:string, s}}), do: lua_string_literal(s)
  defp render_expr({:not, expr}), do: "(not #{render_expr(expr)})"

  defp render_expr({:cmp, op, left, right}),
    do: "(#{render_expr(left)} #{op} #{render_expr(right)})"

  defp render_expr({:bin, op, left, right}),
    do: "(#{render_expr(left)} #{op} #{render_expr(right)})"

  defp read_quoted_string(<<quote, rest::binary>>, quote), do: read_quoted_chars(rest, quote, "")

  defp read_quoted_chars(<<>>, _quote, _acc),
    do: {:error, "Classic bytecode subset condition has unterminated string literal."}

  defp read_quoted_chars(<<quote, rest::binary>>, quote, acc), do: {:ok, acc, rest}

  defp read_quoted_chars(<<"\\", c, rest::binary>>, quote, acc) do
    escaped =
      case c do
        ?n -> "\n"
        ?r -> "\r"
        ?t -> "\t"
        ?\\ -> "\\"
        ?" -> "\""
        ?' -> "'"
        other -> <<other>>
      end

    read_quoted_chars(rest, quote, acc <> escaped)
  end

  defp read_quoted_chars(<<c::utf8, rest::binary>>, quote, acc) do
    read_quoted_chars(rest, quote, acc <> <<c::utf8>>)
  end

  defp read_number_token(<<"-", rest::binary>>) do
    with {:ok, number, rest2} <- read_unsigned_number(rest) do
      {:ok, "-" <> number, rest2}
    end
  end

  defp read_number_token(bin), do: read_unsigned_number(bin)

  defp read_unsigned_number(bin) do
    {int_part, rest} = take_digits(bin)

    cond do
      int_part == "" ->
        {:error, "Classic bytecode subset condition has invalid numeric literal."}

      String.starts_with?(rest, ".") ->
        <<".", after_dot::binary>> = rest
        {frac_part, rest2} = take_digits(after_dot)

        if frac_part == "" do
          {:error, "Classic bytecode subset condition has invalid float literal."}
        else
          {:ok, int_part <> "." <> frac_part, rest2}
        end

      true ->
        {:ok, int_part, rest}
    end
  end

  defp take_identifier(bin), do: take_while(bin, fn c -> ident_char?(c) end)
  defp take_digits(bin), do: take_while(bin, fn c -> c in ?0..?9 end)

  defp take_while(bin, pred), do: take_while(bin, pred, "")

  defp take_while(<<c, rest::binary>>, pred, acc) do
    if pred.(c) do
      take_while(rest, pred, acc <> <<c>>)
    else
      {acc, <<c, rest::binary>>}
    end
  end

  defp take_while(<<>>, _pred, acc), do: {acc, ""}

  defp ident_char?(c), do: c in ?A..?Z or c in ?a..?z or c in ?0..?9 or c == ?_

  defp lua_string_literal(value) do
    escaped =
      value
      |> String.replace("\\", "\\\\")
      |> String.replace("\"", "\\\"")

    ~s("#{escaped}")
  end

  defp normalize_priority(nil), do: 0

  defp normalize_priority(v) when is_integer(v) and v >= 0 and v <= 255, do: v
  defp normalize_priority(v) when is_integer(v) and v < 0, do: 0
  defp normalize_priority(v) when is_integer(v) and v > 255, do: 255

  defp normalize_priority(v) when is_binary(v) do
    case Integer.parse(v) do
      {int, ""} -> normalize_priority(int)
      _ -> 0
    end
  end

  defp normalize_priority(_), do: 0

  defp normalize_enabled(nil), do: true
  defp normalize_enabled(v) when is_boolean(v), do: v
  defp normalize_enabled(v) when is_integer(v), do: v != 0
  defp normalize_enabled(v) when is_binary(v), do: String.downcase(v) not in ["false", "0", "no"]
  defp normalize_enabled(_), do: true

  defp state_has_code?(state) do
    present_value?(state.on_enter) or present_value?(state.on_exit) or present_value?(state.body)
  end

  defp present_value?(nil), do: false
  defp present_value?(""), do: false
  defp present_value?(value) when is_binary(value), do: String.trim(value) != ""
  defp present_value?(_), do: true

  defp truthy?(nil), do: false
  defp truthy?(false), do: false
  defp truthy?(0), do: false
  defp truthy?("0"), do: false

  defp truthy?(value) when is_binary(value),
    do: String.downcase(String.trim(value)) not in ["", "false", "no", "off", "0"]

  defp truthy?(_), do: true

  defp nil_or_zero?(nil), do: true
  defp nil_or_zero?(0), do: true
  defp nil_or_zero?(value) when is_float(value), do: value == 0.0
  defp nil_or_zero?("0"), do: true
  defp nil_or_zero?(value) when is_binary(value), do: String.trim(value) in ["", "0", "0.0"]
  defp nil_or_zero?(_), do: false

  defp build_state_lookup(states) when is_map(states) do
    Enum.reduce(states, %{}, fn {key, state}, acc ->
      key_s = to_s(key)
      name = to_s(Map.get(state, :name) || Map.get(state, "name"))
      state_id = to_s(Map.get(state, :id) || Map.get(state, "id"))
      resolved = if name == "", do: key_s, else: name

      acc
      |> maybe_put_lookup(key_s, resolved)
      |> maybe_put_lookup(state_id, resolved)
      |> maybe_put_lookup(name, resolved)
    end)
  end

  defp build_state_lookup(_), do: %{}

  defp resolve_state_name(nil, _lookup), do: nil

  defp resolve_state_name(value, lookup) do
    key = to_s(value)
    if(key == "", do: nil, else: Map.get(lookup, key, key))
  end

  defp infer_initial_state_name(states, fallback_names) do
    initial =
      states
      |> Map.values()
      |> Enum.find_value(fn s ->
        type = downcase_atomish(Map.get(s, :type) || Map.get(s, "type"))
        name = to_s(Map.get(s, :name) || Map.get(s, "name"))
        if type == "initial" and name != "", do: name, else: nil
      end)

    initial || List.first(fallback_names)
  end

  defp transition_name(t) do
    to_s(Map.get(t, :id) || Map.get(t, "id") || Map.get(t, :name) || Map.get(t, "name") || "")
  end

  defp maybe_put_lookup(acc, "", _resolved), do: acc
  defp maybe_put_lookup(acc, key, resolved), do: Map.put(acc, key, resolved)

  defp coerce_bool(nil), do: {:ok, false}
  defp coerce_bool(v) when is_boolean(v), do: {:ok, v}
  defp coerce_bool(v) when is_integer(v), do: {:ok, v != 0}

  defp coerce_bool(v) when is_binary(v) do
    case String.downcase(String.trim(v)) do
      "true" -> {:ok, true}
      "false" -> {:ok, false}
      "1" -> {:ok, true}
      "0" -> {:ok, false}
      _ -> {:unsupported, ["Boolean variable default must be true/false/0/1."]}
    end
  end

  defp coerce_bool(_), do: {:unsupported, ["Boolean variable default has unsupported type."]}

  defp coerce_int(nil), do: {:ok, 0}
  defp coerce_int(v) when is_integer(v), do: {:ok, v}
  defp coerce_int(v) when is_float(v), do: {:ok, trunc(v)}

  defp coerce_int(v) when is_binary(v) do
    case Integer.parse(String.trim(v)) do
      {int, ""} -> {:ok, int}
      _ -> {:unsupported, ["Int variable default must be an integer."]}
    end
  end

  defp coerce_int(_), do: {:unsupported, ["Int variable default has unsupported type."]}

  defp coerce_float(nil), do: {:ok, 0.0}
  defp coerce_float(v) when is_float(v), do: {:ok, v}
  defp coerce_float(v) when is_integer(v), do: {:ok, v / 1}

  defp coerce_float(v) when is_binary(v) do
    case Float.parse(String.trim(v)) do
      {f, ""} -> {:ok, f}
      _ -> {:unsupported, ["Float variable default must be numeric."]}
    end
  end

  defp coerce_float(_), do: {:unsupported, ["Float variable default has unsupported type."]}

  defp encode_string_u16(value) when is_binary(value) do
    if byte_size(value) <= 0xFFFF do
      {:ok, <<byte_size(value)::16-big, value::binary>>}
    else
      {:error, :string_too_large}
    end
  end

  defp ensure_u16(v, _reason) when is_integer(v) and v >= 0 and v <= 0xFFFF, do: :ok
  defp ensure_u16(_v, reason), do: {:error, reason}

  defp ensure_u32(v, _reason) when is_integer(v) and v >= 0 and v <= 0xFFFF_FFFF, do: :ok
  defp ensure_u32(_v, reason), do: {:error, reason}

  defp first_present(values), do: Enum.find(values, &(!is_nil(&1)))

  defp downcase_atomish(nil), do: ""

  defp downcase_atomish(v) when is_atom(v),
    do: v |> Atom.to_string() |> String.trim_leading(":") |> String.downcase()

  defp downcase_atomish(v) when is_binary(v), do: v |> String.trim() |> String.downcase()
  defp downcase_atomish(v), do: to_s(v) |> String.downcase()

  defp to_s(nil), do: ""
  defp to_s(v) when is_binary(v), do: v
  defp to_s(v) when is_atom(v), do: Atom.to_string(v)
  defp to_s(v), do: to_string(v)
end
