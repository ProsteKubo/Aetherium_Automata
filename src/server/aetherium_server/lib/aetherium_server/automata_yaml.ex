defmodule AetheriumServer.AutomataYaml do
  @moduledoc false

  @doc """
  Convert a gateway automata map into an engine-compatible YAML string.

  Returns `%{yaml: yaml, state_id_map: %{id => name}, transition_id_map: %{id => name}}`.
  """
  def from_gateway_automata(automata) when is_map(automata) do
    name = to_s(Map.get(automata, :name) || Map.get(automata, "name") || "automata")
    version = to_s(Map.get(automata, :version) || Map.get(automata, "version") || "1.0")
    description = Map.get(automata, :description) || Map.get(automata, "description")

    states = Map.get(automata, :states) || Map.get(automata, "states") || %{}
    transitions = Map.get(automata, :transitions) || Map.get(automata, "transitions") || %{}
    variables = Map.get(automata, :variables) || Map.get(automata, "variables") || []
    state_lookup = build_state_lookup(states)

    state_names = states |> Map.values() |> Enum.map(&to_s(Map.get(&1, :name) || Map.get(&1, "name"))) |> Enum.reject(&(&1 == ""))
    initial_ref = Map.get(automata, :initial_state) || Map.get(automata, "initial_state") || Map.get(automata, :initialState) || Map.get(automata, "initialState")
    initial_state = resolve_state_name(initial_ref, state_lookup) || infer_initial_state(states, state_names)

    {states_yaml, state_id_map} = render_states(states)
    {trans_yaml, transition_id_map} = render_transitions(transitions, state_lookup)
    vars_yaml = render_variables(variables)

    yaml =
      [
        "version: #{q(version)}\n",
        "config:\n",
        "  name: #{q(name)}\n",
        if(description, do: "  description: #{q(to_s(description))}\n", else: ""),
        "automata:\n",
        if(initial_state, do: "  initial_state: #{q(initial_state)}\n", else: ""),
        "  states:\n",
        states_yaml,
        "  transitions:\n",
        trans_yaml,
        "variables:\n",
        vars_yaml
      ]
      |> IO.iodata_to_binary()

    %{yaml: yaml, state_id_map: state_id_map, transition_id_map: transition_id_map}
  end

  defp render_states(states) when states == %{}, do: {"", %{}}

  defp render_states(states) do
    # Deterministic order ensures stable engine IDs.
    ordered =
      states
      |> Map.values()
      |> Enum.map(fn s ->
        %{
          name: to_s(Map.get(s, :name) || Map.get(s, "name")),
          description: Map.get(s, :description) || Map.get(s, "description"),
          on_enter: Map.get(s, :on_enter) || Map.get(s, "on_enter"),
          on_exit: Map.get(s, :on_exit) || Map.get(s, "on_exit")
        }
      end)
      |> Enum.reject(&(&1.name == ""))
      |> Enum.sort_by(& &1.name)

    {iodata, id_map, _next_id} =
      Enum.reduce(ordered, {[], %{}, 1}, fn s, {acc, map, id} ->
        fields =
          [
            maybe_kv("      description", s.description),
            maybe_code("      on_enter", s.on_enter),
            maybe_code("      on_exit", s.on_exit)
          ]

        entry =
          case Enum.all?(fields, &(&1 == "")) do
            true ->
              ["    ", escape_key(s.name), ": {}\n"]

            false ->
              ["    ", escape_key(s.name), ":\n", fields]
          end

        {[acc, entry], Map.put(map, id, s.name), id + 1}
      end)

    {IO.iodata_to_binary(iodata), id_map}
  end

  defp render_transitions(transitions, _state_lookup) when transitions == %{}, do: {"", %{}}

  defp render_transitions(transitions, state_lookup) do
    ordered =
      transitions
      |> Map.values()
      |> Enum.map(fn t ->
        from = Map.get(t, :from) || Map.get(t, "from")
        to = Map.get(t, :to) || Map.get(t, "to")

        %{
          name: transition_name(t),
          from: resolve_state_name(from, state_lookup) || to_s(from),
          to: resolve_state_name(to, state_lookup) || to_s(to),
          type: to_s(Map.get(t, :type) || Map.get(t, "type") || "classic"),
          condition: Map.get(t, :condition) || Map.get(t, "condition"),
          priority: Map.get(t, :priority) || Map.get(t, "priority"),
          weight: Map.get(t, :weight) || Map.get(t, "weight"),
          timed: Map.get(t, :timed) || Map.get(t, "timed"),
          probabilistic: Map.get(t, :probabilistic) || Map.get(t, "probabilistic")
        }
      end)
      |> Enum.reject(&(&1.name == ""))
      |> Enum.sort_by(& &1.name)

    {iodata, id_map, _next_id} =
      Enum.reduce(ordered, {[], %{}, 1}, fn t, {acc, map, id} ->
        entry =
          [
            "    ", escape_key(t.name), ":\n",
            "      from: #{q(t.from)}\n",
            "      to: #{q(t.to)}\n",
            "      type: #{q(t.type)}\n",
            maybe_code("      condition", t.condition),
            maybe_kv("      priority", t.priority),
            maybe_kv("      weight", t.weight),
            maybe_timed(t.timed),
            maybe_prob(t.probabilistic)
          ]

        {[acc, entry], Map.put(map, id, t.name), id + 1}
      end)

    {IO.iodata_to_binary(iodata), id_map}
  end

  defp render_variables(vars) when vars == [], do: "  []\n"

  defp render_variables(vars) do
    vars
    |> Enum.map(fn v ->
      name = to_s(Map.get(v, :name) || Map.get(v, "name"))
      type = to_s(Map.get(v, :type) || Map.get(v, "type") || "string")
      direction = to_s(Map.get(v, :direction) || Map.get(v, "direction") || "internal")
      default = Map.get(v, :default) || Map.get(v, "default")

      [
        "  - name: ", q(name), "\n",
        "    type: ", q(type), "\n",
        "    direction: ", q(direction), "\n",
        if(is_nil(default), do: "", else: ["    default: ", q(to_s(default)), "\n"])
      ]
    end)
    |> IO.iodata_to_binary()
  end

  defp infer_initial_state(states, fallback_names) do
    initial =
      states
      |> Map.values()
      |> Enum.find_value(fn s ->
        type = Map.get(s, :type) || Map.get(s, "type")
        name = to_s(Map.get(s, :name) || Map.get(s, "name"))

        if to_s(type) in ["initial", ":initial"] and name != "", do: name, else: nil
      end)

    initial || List.first(fallback_names)
  end

  defp transition_name(t) do
    to_s(Map.get(t, :id) || Map.get(t, "id") || Map.get(t, :name) || Map.get(t, "name") || "")
  end

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

  defp resolve_state_name(nil, _lookup), do: nil

  defp resolve_state_name(value, lookup) when is_map(lookup) do
    key = to_s(value)

    cond do
      key == "" -> nil
      true -> Map.get(lookup, key, key)
    end
  end

  defp maybe_put_lookup(acc, "", _resolved), do: acc
  defp maybe_put_lookup(acc, key, resolved), do: Map.put(acc, key, resolved)

  defp maybe_kv(_k, nil), do: ""
  defp maybe_kv(k, v), do: [k, ": ", q(to_s(v)), "\n"]

  defp maybe_code(_k, nil), do: ""

  defp maybe_code(k, v) do
    s = to_s(v)
    if String.contains?(s, "\n") do
      [k, ": |-\n", indent_block(s, "        ")]
    else
      [k, ": ", q(s), "\n"]
    end
  end

  defp maybe_timed(nil), do: ""
  defp maybe_timed(map) when is_map(map) do
    delay =
      first_present(map, [
        :delay_ms,
        "delay_ms",
        :delayMs,
        "delayMs",
        :after,
        "after"
      ])

    jitter = first_present(map, [:jitter_ms, "jitter_ms", :jitterMs, "jitterMs"])
    mode = first_present(map, [:mode, "mode"])
    repeat_count = first_present(map, [:repeat_count, "repeat_count", :repeatCount, "repeatCount"])
    window_end = first_present(map, [:window_end_ms, "window_end_ms", :windowEndMs, "windowEndMs"])

    absolute_time =
      first_present(map, [
        :absolute_time_ms,
        "absolute_time_ms",
        :absoluteTimeMs,
        "absoluteTimeMs",
        :absoluteTime,
        "absoluteTime",
        :at_ms,
        "at_ms"
      ])

    additional_condition =
      first_present(map, [
        :additional_condition,
        "additional_condition",
        :additionalCondition,
        "additionalCondition",
        :condition,
        "condition"
      ])

    [
      "      timed:\n",
      if(mode, do: ["        mode: ", q(to_s(mode)), "\n"], else: ""),
      if(delay, do: ["        delay_ms: ", q(to_s(delay)), "\n"], else: ""),
      if(jitter, do: ["        jitter_ms: ", q(to_s(jitter)), "\n"], else: ""),
      if(repeat_count, do: ["        repeat_count: ", q(to_s(repeat_count)), "\n"], else: ""),
      if(window_end, do: ["        window_end_ms: ", q(to_s(window_end)), "\n"], else: ""),
      if(absolute_time, do: ["        absolute_time_ms: ", q(to_s(absolute_time)), "\n"], else: ""),
      maybe_code("        condition", additional_condition)
    ]
  end

  defp first_present(map, keys) when is_map(map) and is_list(keys) do
    Enum.find_value(keys, fn key ->
      case Map.fetch(map, key) do
        {:ok, value} -> value
        :error -> nil
      end
    end)
  end

  defp maybe_prob(nil), do: ""
  defp maybe_prob(map) when is_map(map) do
    weight = Map.get(map, :weight) || Map.get(map, "weight")

    if is_nil(weight) do
      ""
    else
      [
        "      probabilistic:\n",
        "        weight: ", q(to_s(weight)), "\n"
      ]
    end
  end

  defp indent_block(s, indent) do
    s
    |> String.split("\n", trim: false)
    |> Enum.map_join("\n", fn line -> indent <> line end)
    |> Kernel.<>("\n")
  end

  defp escape_key(key) do
    if String.match?(key, ~r/^[A-Za-z0-9_\-]+$/) do
      key
    else
      q(key)
    end
  end

  defp q(s) when is_binary(s) do
    escaped =
      s
      |> String.replace("\\", "\\\\")
      |> String.replace("\"", "\\\"")

    "\"#{escaped}\""
  end

  defp to_s(nil), do: ""
  defp to_s(v) when is_binary(v), do: v
  defp to_s(v), do: to_string(v)
end
