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

    state_names = states |> Map.values() |> Enum.map(&to_s(Map.get(&1, :name) || Map.get(&1, "name"))) |> Enum.reject(&(&1 == ""))
    initial_state = infer_initial_state(states, state_names)

    {states_yaml, state_id_map} = render_states(states)
    {trans_yaml, transition_id_map} = render_transitions(transitions)
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

  defp render_transitions(transitions) when transitions == %{}, do: {"", %{}}

  defp render_transitions(transitions) do
    ordered =
      transitions
      |> Map.values()
      |> Enum.map(fn t ->
        %{
          name: transition_name(t),
          from: to_s(Map.get(t, :from) || Map.get(t, "from")),
          to: to_s(Map.get(t, :to) || Map.get(t, "to")),
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
    delay = Map.get(map, :delay_ms) || Map.get(map, "delay_ms")
    jitter = Map.get(map, :jitter_ms) || Map.get(map, "jitter_ms")
    mode = Map.get(map, :mode) || Map.get(map, "mode")

    [
      "      timed:\n",
      if(mode, do: ["        mode: ", q(to_s(mode)), "\n"], else: ""),
      if(delay, do: ["        delay_ms: ", q(to_s(delay)), "\n"], else: ""),
      if(jitter, do: ["        jitter_ms: ", q(to_s(jitter)), "\n"], else: "")
    ]
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
