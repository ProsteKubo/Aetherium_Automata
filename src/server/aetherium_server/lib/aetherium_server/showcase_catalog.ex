defmodule AetheriumServer.ShowcaseCatalog do
  @moduledoc """
  Helpers for curated showcase automata catalog listing and loading.
  """

  @catalog_rel_path Path.join(["example", "automata", "showcase", "CATALOG.txt"])

  @type entry :: %{
          id: String.t(),
          name: String.t(),
          category: String.t(),
          relative_path: String.t(),
          absolute_path: String.t()
        }

  @spec list_entries() :: {:ok, [entry()]} | {:error, term()}
  def list_entries do
    with {:ok, repo_root} <- resolve_repo_root(),
         {:ok, raw} <- File.read(Path.join(repo_root, @catalog_rel_path)) do
      lines =
        raw
        |> String.split(~r/\r?\n/, trim: true)
        |> Enum.map(&String.trim/1)
        |> Enum.reject(&(&1 == "" or String.starts_with?(&1, "#")))

      entries =
        lines
        |> Enum.with_index(1)
        |> Enum.map(fn {relative_path, index} ->
          normalized_rel = String.replace(relative_path, "\\", "/")
          segments = String.split(normalized_rel, "/")
          category_raw = Enum.at(segments, 3, "showcase")
          basename = Path.basename(normalized_rel, Path.extname(normalized_rel))

          %{
            id: "showcase_" <> String.pad_leading(Integer.to_string(index), 2, "0"),
            name: humanize_label(basename),
            category: humanize_label(String.replace(category_raw, ~r/^\d+_/, "")),
            relative_path: normalized_rel,
            absolute_path: Path.join(repo_root, normalized_rel)
          }
        end)

      {:ok, entries}
    end
  end

  @spec load_automata(String.t()) :: {:ok, %{entry: entry(), automata: map()}} | {:error, term()}
  def load_automata(target) when is_binary(target) do
    with {:ok, entries} <- list_entries(),
         {:ok, entry} <- fetch_entry(entries, target),
         {:ok, parsed} <- YamlElixir.read_from_file(entry.absolute_path) do
      {:ok, %{entry: entry, automata: normalize_showcase(parsed)}}
    else
      {:error, %File.Error{} = err} -> {:error, Exception.message(err)}
      {:error, reason} -> {:error, reason}
    end
  end

  defp fetch_entry(entries, target) do
    case Enum.find(entries, fn entry ->
           entry.id == target or entry.relative_path == target
         end) do
      nil -> {:error, {:showcase_not_found, target}}
      entry -> {:ok, entry}
    end
  end

  defp normalize_showcase(parsed) do
    root = collapse_map_list(parsed)
    config = as_map(root["config"])
    source = extract_automata_source(root)
    target = as_non_empty_map(config["target"])

    raw_states = as_map(source["states"])

    state_ref_to_name =
      Enum.reduce(raw_states, %{}, fn {state_key, raw_state}, acc ->
        state = as_map(raw_state)
        key = to_s(state_key)
        id = to_s(state["id"], key)
        name = to_s(state["name"], key)

        acc
        |> maybe_put_lookup(key, name)
        |> maybe_put_lookup(id, name)
        |> maybe_put_lookup(name, name)
      end)

    states =
      Enum.reduce(raw_states, %{}, fn {state_key, raw_state}, acc ->
        state = as_map(raw_state)
        key = to_s(state_key)
        id = to_s(state["id"], key)
        name = to_s(state["name"], key)
        hooks = as_map(state["hooks"])
        on_enter = first_present([state["on_enter"], state["onEnter"], hooks["onEnter"]])
        on_exit = first_present([state["on_exit"], state["onExit"], hooks["onExit"]])
        on_tick = first_present([state["on_tick"], state["onTick"], hooks["onTick"]])
        on_error = first_present([state["on_error"], state["onError"], hooks["onError"]])

        normalized =
          %{
            "id" => id,
            "name" => name,
            "description" => state["description"],
            "inputs" => state["inputs"],
            "outputs" => state["outputs"],
            "variables" => state["variables"],
            "position" => as_non_empty_map(state["position"]),
            "isComposite" => first_present([state["isComposite"], state["is_composite"]]),
            "code" => first_present([state["code"], state["body"]]),
            "on_enter" => on_enter,
            "on_exit" => on_exit,
            "hooks" =>
              %{
                "onEnter" => on_enter,
                "onExit" => on_exit,
                "onTick" => on_tick,
                "onError" => on_error
              }
              |> reject_nil_values()
              |> empty_map_to_nil(),
            "type" => state["type"] || infer_state_type(id, key, name)
          }
          |> reject_nil_values()

        Map.put(acc, key, normalized)
      end)

    resolve_state_name = fn ref ->
      key = to_s(ref)
      if key == "", do: "", else: Map.get(state_ref_to_name, key, key)
    end

    raw_transitions = as_map(source["transitions"])

    transitions =
      Enum.reduce(raw_transitions, %{}, fn {transition_key, raw_transition}, acc ->
        transition = as_map(raw_transition)
        key = to_s(transition_key)
        id = to_s(transition["id"], key)

        timed =
          case as_map(transition["timed"]) do
            timed_map when map_size(timed_map) > 0 ->
              timed_map

            _ ->
              delay =
                first_present([
                  transition["delay_ms"],
                  transition["delayMs"],
                  transition["after"]
                ])

              if is_nil(delay) do
                nil
              else
                %{
                  "mode" => transition["mode"] || "after",
                  "delay_ms" => delay,
                  "jitter_ms" => first_present([transition["jitter_ms"], transition["jitterMs"]]),
                  "repeat_count" =>
                    first_present([transition["repeat_count"], transition["repeatCount"]])
                }
                |> reject_nil_values()
              end
          end

        type =
          cond do
            is_binary(transition["type"]) and String.trim(transition["type"]) != "" ->
              transition["type"]

            is_map(timed) and map_size(timed) > 0 ->
              "timed"

            true ->
              "classic"
          end

        normalized =
          %{
            "id" => id,
            "name" => to_s(transition["name"], id),
            "from" => resolve_state_name.(transition["from"]),
            "to" => resolve_state_name.(transition["to"]),
            "type" => type,
            "condition" => transition["condition"],
            "body" => transition["body"],
            "triggered" => transition["triggered"],
            "priority" => transition["priority"],
            "weight" => transition["weight"],
            "timed" => timed,
            "event" => as_non_empty_map(transition["event"]),
            "probabilistic" => as_non_empty_map(transition["probabilistic"]),
            "description" => transition["description"]
          }
          |> reject_nil_values()

        Map.put(acc, key, normalized)
      end)

    variables =
      root["variables"]
      |> normalize_variable_list(source["variables"])

    initial_ref =
      first_present([
        source["initial_state"],
        source["initialState"],
        root["initial_state"],
        root["initialState"]
      ])

    initial_state = resolve_state_name.(initial_ref)

    %{
      "name" => to_s(config["name"], to_s(root["name"], "Showcase Automata")),
      "version" => to_s(root["version"], to_s(config["version"], "0.0.1")),
      "config" =>
        %{
          "name" => to_s(config["name"], to_s(root["name"], "Showcase Automata")),
          "type" => to_s(config["type"], "inline"),
          "language" => to_s(config["language"], "lua"),
          "description" => first_present([config["description"], root["description"]]),
          "author" => config["author"],
          "tags" => config["tags"],
          "version" => to_s(config["version"], "1.0.0"),
          "target" => target
        }
        |> reject_nil_values(),
      "description" => first_present([config["description"], root["description"]]),
      "initial_state" => if(initial_state == "", do: nil, else: initial_state),
      "states" => states,
      "transitions" => transitions,
      "variables" => variables
    }
    |> reject_nil_values()
  end

  defp normalize_variable_list(nil, fallback), do: normalize_variable_list(fallback, [])

  defp normalize_variable_list(list, _fallback) when is_list(list) do
    list
    |> Enum.map(&as_map/1)
    |> Enum.map(fn variable ->
      %{
        "name" => to_s(variable["name"]),
        "type" => to_s(variable["type"], "any"),
        "direction" => to_s(variable["direction"], "internal"),
        "default" => variable["default"]
      }
      |> reject_nil_values()
    end)
    |> Enum.reject(fn variable -> to_s(variable["name"]) == "" end)
  end

  defp normalize_variable_list(_other, _fallback), do: []

  defp extract_automata_source(root) do
    case root["automata"] do
      map when is_map(map) and map_size(map) > 0 ->
        map

      list when is_list(list) ->
        merged =
          list
          |> Enum.map(&collapse_map_list/1)
          |> Enum.reduce(%{}, &merge_automata_item/2)

        if map_size(merged) > 0, do: merged, else: root

      _ ->
        root
    end
  end

  defp merge_automata_item(item, acc) do
    map = as_map(item)

    cond do
      map_size(map) == 0 ->
        acc

      Map.has_key?(map, "states") ->
        states =
          map
          |> Map.get("states")
          |> as_map()
          |> Map.merge(Map.drop(map, ["states"]))

        Map.put(acc, "states", Map.merge(as_map(acc["states"]), states))

      Map.has_key?(map, "transitions") ->
        transitions =
          map
          |> Map.get("transitions")
          |> as_map()
          |> Map.merge(Map.drop(map, ["transitions"]))

        Map.put(acc, "transitions", Map.merge(as_map(acc["transitions"]), transitions))

      true ->
        Map.merge(acc, map)
    end
  end

  defp collapse_map_list(value) when is_map(value) do
    value
    |> Enum.reduce(%{}, fn {key, val}, acc ->
      Map.put(acc, to_s(key), collapse_map_list(val))
    end)
  end

  defp collapse_map_list(list) when is_list(list) do
    collapsed = Enum.map(list, &collapse_map_list/1)

    if Enum.all?(collapsed, &keyword_item?/1) do
      Enum.reduce(collapsed, %{}, &Map.merge(&2, &1))
    else
      collapsed
    end
  end

  defp collapse_map_list(other), do: other

  defp keyword_item?(value), do: is_map(value) and map_size(value) == 1

  defp as_non_empty_map(value) do
    map = as_map(value)
    if map_size(map) > 0, do: map, else: nil
  end

  defp empty_map_to_nil(map) when is_map(map) and map_size(map) == 0, do: nil
  defp empty_map_to_nil(map), do: map

  defp as_map(value) when is_map(value) do
    Enum.reduce(value, %{}, fn {k, v}, acc -> Map.put(acc, to_s(k), v) end)
  end

  defp as_map(_), do: %{}

  defp maybe_put_lookup(acc, "", _name), do: acc
  defp maybe_put_lookup(acc, _key, ""), do: acc
  defp maybe_put_lookup(acc, key, name), do: Map.put(acc, key, name)

  defp first_present(values) when is_list(values) do
    Enum.find(values, fn value ->
      case value do
        nil -> false
        "" -> false
        _ -> true
      end
    end)
  end

  defp reject_nil_values(map) when is_map(map) do
    Enum.reduce(map, %{}, fn
      {_k, nil}, acc ->
        acc

      {k, v}, acc ->
        Map.put(acc, k, v)
    end)
  end

  defp to_s(nil), do: ""
  defp to_s(value) when is_binary(value), do: value
  defp to_s(value) when is_atom(value), do: Atom.to_string(value)
  defp to_s(value), do: to_string(value)

  defp to_s(value, fallback) do
    rendered = to_s(value)
    if rendered == "", do: fallback, else: rendered
  end

  defp infer_state_type(id, key, name) do
    if Enum.any?([id, key, name], &(to_s(&1) in ["initial", "Initial"])) do
      "initial"
    else
      nil
    end
  end

  defp humanize_label(input) do
    input
    |> to_s()
    |> String.split(~r/[_-]+/, trim: true)
    |> Enum.map(&String.capitalize/1)
    |> Enum.join(" ")
  end

  defp resolve_repo_root do
    candidates =
      [
        System.get_env("AETHERIUM_REPO_ROOT"),
        File.cwd!(),
        __DIR__
      ]
      |> Enum.reject(&is_nil_or_empty?/1)
      |> Enum.map(&Path.expand/1)

    case Enum.find_value(candidates, &find_catalog_in_ancestors/1) do
      nil -> {:error, {:catalog_not_found, @catalog_rel_path}}
      root -> {:ok, root}
    end
  end

  defp find_catalog_in_ancestors(start_dir) do
    do_find_catalog(Path.expand(start_dir), 10)
  end

  defp do_find_catalog(_dir, 0), do: nil

  defp do_find_catalog(dir, depth) do
    catalog = Path.join(dir, @catalog_rel_path)

    cond do
      File.exists?(catalog) ->
        dir

      true ->
        parent = Path.dirname(dir)
        if parent == dir, do: nil, else: do_find_catalog(parent, depth - 1)
    end
  end

  defp is_nil_or_empty?(nil), do: true
  defp is_nil_or_empty?(""), do: true
  defp is_nil_or_empty?(_), do: false
end
