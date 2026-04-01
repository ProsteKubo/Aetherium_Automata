defmodule AetheriumServer.AnalyzerBundle do
  @moduledoc """
  Normalizes analyzer input into a canonical bundle that combines project topology
  with server-local replay/timeline evidence.
  """

  alias AetheriumServer.TimeSeriesQuery

  @default_limit 5_000

  @spec build(map(), map()) :: {:ok, map()} | {:error, term()}
  def build(query, state) when is_map(query) and is_map(state) do
    normalized_query = normalize_query(query)
    topology = normalize_topology(Map.get(normalized_query, "topology", %{}))

    automata = Map.get(topology, "automata", [])
    connections = Map.get(topology, "connections", [])
    provided_deployments = Map.get(topology, "deployments", [])

    local_deployments =
      state
      |> Map.get(:deployments, %{})
      |> Map.values()
      |> Enum.map(&serialize_local_deployment(&1, state))

    deployments =
      merge_deployments(provided_deployments, local_deployments)
      |> maybe_filter_deployments(normalized_query)

    resources = collect_resources(automata, deployments)
    timelines = collect_timelines(normalized_query, deployments)
    warnings = build_warnings(normalized_query, deployments, timelines)

    evidence_mode =
      cond do
        map_size(timelines) == 0 and normalized_query["include_structural"] -> "structural_only"
        map_size(timelines) > 0 and normalized_query["include_structural"] -> "hybrid"
        true -> "observed"
      end

    {:ok,
     %{
       "query" => Map.drop(normalized_query, ["topology"]),
       "generated_at" => System.system_time(:millisecond),
       "automata" => automata,
       "deployments" => deployments,
       "connections" => connections,
       "resources" => resources,
       "timelines" => timelines,
       "evidence_mode" => evidence_mode,
       "warnings" => warnings
     }}
  end

  def build(_, _), do: {:error, :invalid_arguments}

  defp normalize_query(query) do
    scope =
      query
      |> Map.get("scope", query[:scope] || "project")
      |> to_string()

    %{
      "scope" => scope,
      "deployment_ids" =>
        normalize_string_list(query["deployment_ids"] || query[:deployment_ids]),
      "automata_ids" => normalize_string_list(query["automata_ids"] || query[:automata_ids]),
      "after_ts" => normalize_non_negative_int(query["after_ts"] || query[:after_ts]),
      "before_ts" => normalize_non_negative_int(query["before_ts"] || query[:before_ts]),
      "include_structural" =>
        truthy?(Map.get(query, "include_structural", query[:include_structural]), true),
      "include_timeline" =>
        truthy?(Map.get(query, "include_timeline", query[:include_timeline]), true),
      "limit" => normalize_limit(query["limit"] || query[:limit]),
      "topology" => query["topology"] || query[:topology] || %{}
    }
  end

  defp normalize_topology(topology) when is_map(topology) do
    %{
      "automata" => normalize_automata_list(topology["automata"] || topology[:automata]),
      "deployments" =>
        normalize_deployment_list(topology["deployments"] || topology[:deployments]),
      "connections" =>
        normalize_connection_list(topology["connections"] || topology[:connections])
    }
  end

  defp normalize_topology(_), do: %{"automata" => [], "deployments" => [], "connections" => []}

  defp normalize_automata_list(list) when is_list(list) do
    Enum.map(list, fn automata ->
      %{
        "id" => field(automata, :id),
        "name" => field(automata, :name) || field(automata, :id),
        "description" => field(automata, :description),
        "states" => field(automata, :states, %{}),
        "transitions" => field(automata, :transitions, %{}),
        "variables" => field(automata, :variables, []),
        "inputs" => List.wrap(field(automata, :inputs, [])),
        "outputs" => List.wrap(field(automata, :outputs, [])),
        "black_box" => normalize_black_box(field(automata, :black_box, %{}))
      }
    end)
  end

  defp normalize_automata_list(_), do: []

  defp normalize_deployment_list(list) when is_list(list) do
    Enum.map(list, fn deployment ->
      %{
        "deployment_id" => field(deployment, :deployment_id) || field(deployment, :id),
        "automata_id" => field(deployment, :automata_id),
        "device_id" => field(deployment, :device_id),
        "server_id" => field(deployment, :server_id),
        "status" => normalize_status(field(deployment, :status)),
        "current_state" => field(deployment, :current_state),
        "variables" => field(deployment, :variables, %{}),
        "deployment_metadata" => field(deployment, :deployment_metadata, %{})
      }
    end)
    |> Enum.reject(&(blank?(&1["deployment_id"]) or blank?(&1["automata_id"])))
  end

  defp normalize_deployment_list(_), do: []

  defp normalize_connection_list(list) when is_list(list) do
    Enum.map(list, fn connection ->
      %{
        "id" => field(connection, :id),
        "source_automata" => field(connection, :source_automata),
        "source_output" => field(connection, :source_output),
        "target_automata" => field(connection, :target_automata),
        "target_input" => field(connection, :target_input),
        "enabled" => Map.get(connection, :enabled, Map.get(connection, "enabled", true)),
        "binding_type" => to_string(field(connection, :binding_type, "direct"))
      }
    end)
    |> Enum.reject(
      &(blank?(&1["source_automata"]) or blank?(&1["source_output"]) or
          blank?(&1["target_automata"]) or
          blank?(&1["target_input"]))
    )
  end

  defp normalize_connection_list(_), do: []

  defp serialize_local_deployment(deployment, state) when is_map(deployment) and is_map(state) do
    device = get_in(state, [:devices, deployment.device_id]) || %{}

    %{
      "deployment_id" => deployment.id,
      "automata_id" => deployment.automata_id,
      "device_id" => deployment.device_id,
      "server_id" => configured_server_id(),
      "status" => normalize_status(deployment.status),
      "current_state" => deployment.current_state,
      "variables" => deployment.variables || %{},
      "deployment_metadata" =>
        compact_map(%{
          "placement" =>
            get_in(deployment, [:deployment_metadata, "placement"]) ||
              get_in(device, [:deployment_metadata, "placement"]),
          "transport" =>
            compact_map(%{
              "type" => device[:transport],
              "link" => device[:link],
              "connector_id" => device[:connector_id],
              "connector_type" => normalize_dimension(device[:connector_type])
            }),
          "latency" => get_in(deployment, [:deployment_metadata, "latency"]) || %{},
          "battery" => get_in(deployment, [:deployment_metadata, "battery"]) || %{},
          "black_box" => get_in(deployment, [:deployment_metadata, "black_box"]) || %{}
        })
    }
  end

  defp merge_deployments(provided, local) do
    (provided ++ local)
    |> Enum.reduce(%{}, fn deployment, acc ->
      deployment_id = deployment["deployment_id"]

      case Map.get(acc, deployment_id) do
        nil ->
          Map.put(acc, deployment_id, deployment)

        existing ->
          Map.put(acc, deployment_id, merge_deployment(existing, deployment))
      end
    end)
    |> Map.values()
  end

  defp merge_deployment(existing, incoming) do
    %{
      "deployment_id" => incoming["deployment_id"] || existing["deployment_id"],
      "automata_id" => incoming["automata_id"] || existing["automata_id"],
      "device_id" => incoming["device_id"] || existing["device_id"],
      "server_id" => incoming["server_id"] || existing["server_id"],
      "status" => incoming["status"] || existing["status"],
      "current_state" => incoming["current_state"] || existing["current_state"],
      "variables" =>
        Map.merge(
          if(is_map(existing["variables"]), do: existing["variables"], else: %{}),
          if(is_map(incoming["variables"]), do: incoming["variables"], else: %{})
        ),
      "deployment_metadata" =>
        deep_merge(
          if(is_map(existing["deployment_metadata"]),
            do: existing["deployment_metadata"],
            else: %{}
          ),
          if(is_map(incoming["deployment_metadata"]),
            do: incoming["deployment_metadata"],
            else: %{}
          )
        )
    }
  end

  defp maybe_filter_deployments(deployments, query) do
    deployment_ids = Map.get(query, "deployment_ids", [])
    automata_ids = Map.get(query, "automata_ids", [])

    cond do
      deployment_ids != [] ->
        Enum.filter(deployments, &(&1["deployment_id"] in deployment_ids))

      automata_ids != [] ->
        Enum.filter(deployments, &(&1["automata_id"] in automata_ids))

      true ->
        deployments
    end
  end

  defp collect_resources(automata, deployments) do
    deployments_by_automata =
      Enum.group_by(deployments, & &1["automata_id"])

    automata
    |> Enum.reduce(%{}, fn automata_entry, acc ->
      automata_id = automata_entry["id"]
      contract = black_box_contract(automata_entry)
      participants = Map.get(deployments_by_automata, automata_id, [])

      contract["resources"]
      |> List.wrap()
      |> Enum.reduce(acc, fn resource, resource_acc ->
        name = field(resource, :name)

        if blank?(name) do
          resource_acc
        else
          key = {name, field(resource, :kind), field(resource, :shared, false)}
          entry = Map.get(resource_acc, key, initial_resource_entry(resource))

          participant_deployment_ids =
            Enum.map(participants, fn participant -> participant["deployment_id"] end)

          updated =
            entry
            |> update_in(
              ["participants", "automata_ids"],
              &Enum.uniq([automata_id | List.wrap(&1)])
            )
            |> update_in(
              ["participants", "deployment_ids"],
              fn existing ->
                Enum.uniq(participant_deployment_ids ++ List.wrap(existing))
              end
            )

          Map.put(resource_acc, key, updated)
        end
      end)
    end)
    |> Map.values()
  end

  defp collect_timelines(query, deployments) do
    if query["include_timeline"] do
      deployments
      |> Enum.filter(&local_server_deployment?/1)
      |> Enum.reduce(%{}, fn deployment, acc ->
        opts =
          []
          |> maybe_put_opt(:after_ts, query["after_ts"])
          |> maybe_put_opt(:before_ts, query["before_ts"])
          |> maybe_put_opt(:limit, query["limit"])

        timeline = TimeSeriesQuery.list_timeline(deployment["deployment_id"], opts)
        source = timeline[:source] || timeline["source"] || "unknown"
        backend_error = timeline[:backend_error] || timeline["backend_error"]

        events =
          normalize_timeline_events(timeline[:events] || timeline["events"] || [], deployment)

        snapshots = List.wrap(timeline[:snapshots] || timeline["snapshots"] || [])

        Map.put(acc, deployment["deployment_id"], %{
          "deployment_id" => deployment["deployment_id"],
          "automata_id" => deployment["automata_id"],
          "device_id" => deployment["device_id"],
          "source" => source,
          "backend_error" => backend_error,
          "events" => events,
          "snapshots" => snapshots
        })
      end)
    else
      %{}
    end
  end

  defp normalize_timeline_events(events, deployment) when is_list(events) do
    Enum.map(events, fn event ->
      payload = event["payload"] || event[:payload] || event["data"] || event[:data] || %{}
      timestamp = event["timestamp"] || event[:timestamp] || System.system_time(:millisecond)
      kind = event["event"] || event[:event] || event["kind"] || event[:kind] || "unknown"
      deployment_metadata = normalize_event_deployment_metadata(payload)
      observed_latency_ms = latency_value(payload, deployment_metadata, "observed_ms")
      latency_budget_ms = latency_value(payload, deployment_metadata, "budget_ms")
      latency_warning_ms = latency_value(payload, deployment_metadata, "warning_ms")
      fault_actions = normalize_string_list(field(payload, :fault_actions, []))

      %{
        "id" => "#{deployment["deployment_id"]}:#{timestamp}:#{kind}",
        "deployment_id" => deployment["deployment_id"],
        "automata_id" => payload["automata_id"] || deployment["automata_id"],
        "device_id" => payload["device_id"] || deployment["device_id"],
        "timestamp" => timestamp,
        "kind" => to_string(kind),
        "name" => payload["name"] || payload["output"] || payload["event"],
        "direction" => payload["direction"],
        "value" => payload["value"],
        "from_state" => payload["from_state"],
        "to_state" => payload["to_state"],
        "transition_id" => payload["transition_id"],
        "deployment_metadata" => deployment_metadata,
        "latency_budget_ms" => latency_budget_ms,
        "latency_warning_ms" => latency_warning_ms,
        "observed_latency_ms" => observed_latency_ms,
        "latency_budget_exceeded" =>
          latency_budget_exceeded?(payload, latency_budget_ms, observed_latency_ms),
        "fault_profile" => trace_value(payload, deployment_metadata, "fault_profile"),
        "trace_event_count" => trace_value(payload, deployment_metadata, "trace_event_count"),
        "fault_actions" => fault_actions,
        "metadata" => payload
      }
    end)
  end

  defp normalize_event_deployment_metadata(payload) when is_map(payload) do
    embedded =
      case field(payload, :deployment_metadata, %{}) do
        %{} = metadata -> metadata
        _ -> %{}
      end

    flattened =
      compact_map(%{
        "placement" => field(payload, :placement),
        "transport" =>
          compact_map(%{
            "type" => field(payload, :transport),
            "link" => field(payload, :link),
            "connector_id" => field(payload, :connector_id),
            "connector_type" => field(payload, :connector_type)
          }),
        "runtime" =>
          compact_map(%{
            "target_profile" => field(payload, :target_profile),
            "run_id" => field(payload, :run_id)
          }),
        "latency" =>
          compact_map(%{
            "budget_ms" => field(payload, :latency_budget_ms),
            "warning_ms" => field(payload, :latency_warning_ms),
            "observed_ms" => field(payload, :observed_latency_ms),
            "ingress_ms" => field(payload, :ingress_latency_ms),
            "egress_ms" => field(payload, :egress_latency_ms),
            "send_timestamp" => field(payload, :send_timestamp),
            "receive_timestamp" => field(payload, :receive_timestamp),
            "handle_timestamp" => field(payload, :handle_timestamp)
          }),
        "trace" =>
          compact_map(%{
            "fault_profile" => field(payload, :fault_profile),
            "trace_file" => field(payload, :trace_file),
            "trace_event_count" => field(payload, :trace_event_count)
          })
      })

    deep_merge(embedded, flattened)
  end

  defp normalize_event_deployment_metadata(_payload), do: %{}

  defp latency_value(payload, deployment_metadata, key)
       when is_map(payload) and is_map(deployment_metadata) do
    Map.get(payload, "latency_#{key}") ||
      get_in(deployment_metadata, ["latency", key])
  end

  defp latency_value(_payload, _deployment_metadata, _key), do: nil

  defp trace_value(payload, deployment_metadata, key)
       when is_map(payload) and is_map(deployment_metadata) do
    Map.get(payload, key) ||
      get_in(deployment_metadata, ["trace", key])
  end

  defp trace_value(_payload, _deployment_metadata, _key), do: nil

  defp latency_budget_exceeded?(payload, latency_budget_ms, observed_latency_ms)
       when is_map(payload) and is_integer(latency_budget_ms) and is_integer(observed_latency_ms) do
    case field(payload, :latency_budget_exceeded) do
      value when value in [true, "true", 1, "1"] -> true
      value when value in [false, "false", 0, "0"] -> false
      _ -> observed_latency_ms > latency_budget_ms
    end
  end

  defp latency_budget_exceeded?(payload, _latency_budget_ms, _observed_latency_ms)
       when is_map(payload) do
    field(payload, :latency_budget_exceeded) in [true, "true", 1, "1"]
  end

  defp build_warnings(query, deployments, timelines) do
    warnings = []

    warnings =
      if query["include_timeline"] and map_size(timelines) == 0 do
        ["timeline_unavailable_for_selected_scope" | warnings]
      else
        warnings
      end

    remote_count =
      deployments
      |> Enum.reject(&local_server_deployment?/1)
      |> length()

    warnings =
      if query["include_timeline"] and remote_count > 0 do
        ["remote_deployments_not_replayed" | warnings]
      else
        warnings
      end

    Enum.reverse(warnings)
  end

  defp initial_resource_entry(resource) do
    %{
      "name" => field(resource, :name),
      "kind" => field(resource, :kind, "unknown"),
      "capacity" => field(resource, :capacity),
      "shared" => field(resource, :shared, false),
      "latency_sensitive" =>
        field(resource, :latency_sensitive, field(resource, :latencySensitive, false)),
      "description" => field(resource, :description),
      "participants" => %{
        "automata_ids" => [],
        "deployment_ids" => []
      }
    }
  end

  defp black_box_contract(automata) do
    declared = normalize_black_box(automata["black_box"] || automata[:black_box] || %{})

    if map_size(declared) > 0 and
         (Enum.any?(List.wrap(declared["ports"])) or
            Enum.any?(List.wrap(declared["resources"])) or
            Enum.any?(List.wrap(declared["observable_states"])) or
            Enum.any?(List.wrap(declared["emitted_events"]))) do
      declared
    else
      derive_black_box_contract(automata)
    end
  end

  defp normalize_black_box(black_box) when is_map(black_box) do
    %{
      "ports" => List.wrap(black_box["ports"] || black_box[:ports]),
      "observable_states" =>
        List.wrap(
          black_box["observable_states"] || black_box[:observable_states] ||
            black_box["observableStates"] || black_box[:observableStates]
        ),
      "emitted_events" =>
        List.wrap(
          black_box["emitted_events"] || black_box[:emitted_events] || black_box["emittedEvents"] ||
            black_box[:emittedEvents]
        ),
      "resources" => List.wrap(black_box["resources"] || black_box[:resources])
    }
    |> compact_map()
  end

  defp normalize_black_box(_), do: %{}

  defp derive_black_box_contract(automata) do
    variables = List.wrap(automata["variables"] || automata[:variables])
    states = automata["states"] || automata[:states] || %{}
    transitions = automata["transitions"] || automata[:transitions] || %{}

    ports =
      Enum.map(variables, fn variable ->
        %{
          "name" => field(variable, :name),
          "direction" => normalize_port_direction(field(variable, :direction)),
          "type" => field(variable, :type, "unknown")
        }
      end)
      |> Enum.reject(&blank?(&1["name"]))

    emitted_events =
      transitions
      |> Enum.map(fn {_id, transition} ->
        event = field(transition, :event)

        cond do
          is_binary(event) -> event
          is_map(event) -> field(event, :name)
          true -> nil
        end
      end)
      |> Enum.reject(&blank?/1)
      |> Enum.uniq()

    %{
      "ports" => ports,
      "observable_states" => Map.keys(states),
      "emitted_events" => emitted_events,
      "resources" => []
    }
  end

  defp local_server_deployment?(deployment) do
    deployment["server_id"] in [nil, "", configured_server_id()]
  end

  defp configured_server_id do
    :aetherium_server
    |> Application.get_env(:gateway, [])
    |> Keyword.get(:server_id, "srv_01")
  end

  defp normalize_port_direction(direction) when direction in [:input, :output, :internal],
    do: Atom.to_string(direction)

  defp normalize_port_direction(direction)
       when direction in ["input", "output", "internal"],
       do: direction

  defp normalize_port_direction(_), do: "internal"

  defp normalize_status(status) when is_atom(status), do: Atom.to_string(status)
  defp normalize_status(status) when is_binary(status), do: status
  defp normalize_status(_), do: "unknown"

  defp normalize_string_list(value) when is_list(value) do
    value
    |> Enum.map(&to_string/1)
    |> Enum.reject(&blank?/1)
    |> Enum.uniq()
  end

  defp normalize_string_list(value) when is_binary(value), do: [value]
  defp normalize_string_list(_), do: []

  defp normalize_non_negative_int(value) when is_integer(value) and value >= 0, do: value

  defp normalize_non_negative_int(value) when is_binary(value) do
    case Integer.parse(value) do
      {parsed, ""} when parsed >= 0 -> parsed
      _ -> nil
    end
  end

  defp normalize_non_negative_int(_), do: nil

  defp normalize_limit(value) do
    case normalize_non_negative_int(value) do
      parsed when is_integer(parsed) and parsed > 0 -> parsed
      _ -> @default_limit
    end
  end

  defp maybe_put_opt(opts, _key, nil), do: opts
  defp maybe_put_opt(opts, key, value), do: Keyword.put(opts, key, value)

  defp truthy?(nil, default), do: default
  defp truthy?(value, _default) when value in [true, "true", 1, "1"], do: true
  defp truthy?(_value, _default), do: false

  defp normalize_dimension(value) when is_atom(value), do: Atom.to_string(value)
  defp normalize_dimension(value) when is_binary(value), do: value
  defp normalize_dimension(_), do: nil

  defp compact_map(map) when is_map(map) do
    Enum.reduce(map, %{}, fn
      {_key, value}, acc when value in [nil, "", %{}] ->
        acc

      {key, value}, acc ->
        Map.put(acc, key, value)
    end)
  end

  defp deep_merge(left, right) when is_map(left) and is_map(right) do
    Map.merge(left, right, fn _key, left_value, right_value ->
      if is_map(left_value) and is_map(right_value) do
        deep_merge(left_value, right_value)
      else
        right_value
      end
    end)
  end

  defp field(data, key, default \\ nil) when is_map(data) and is_atom(key) do
    Map.get(data, key, Map.get(data, Atom.to_string(key), default))
  end

  defp blank?(value), do: value in [nil, ""]
end
