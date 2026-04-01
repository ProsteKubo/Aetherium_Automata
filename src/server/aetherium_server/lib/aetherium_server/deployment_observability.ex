defmodule AetheriumServer.DeploymentObservability do
  @moduledoc """
  Observability and black-box/introspection helpers for deployment state.

  This keeps time-series capture, deployment metadata shaping, gateway event
  emission, and black-box description logic out of `DeviceManager`.
  """

  alias AetheriumServer.DeviceSessionRef
  alias AetheriumServer.GatewayConnection
  alias AetheriumServer.TimeSeriesInfluxSink
  alias AetheriumServer.TimeSeriesStore

  @spec push_to_gateway(map(), String.t(), map()) :: :ok
  def push_to_gateway(state, event, payload)
      when is_map(state) and is_binary(event) and is_map(payload) do
    enriched_payload = enrich_observability_payload(state, payload)
    maybe_record_time_series_event(event, enriched_payload)
    GatewayConnection.push(event, enriched_payload)
    :ok
  end

  @spec push_to_gateway(String.t(), map()) :: :ok
  def push_to_gateway(event, payload) when is_binary(event) and is_map(payload) do
    enriched_payload = enrich_observability_payload(payload)
    maybe_record_time_series_event(event, enriched_payload)
    GatewayConnection.push(event, enriched_payload)
    :ok
  end

  @spec append_time_series_event(String.t(), String.t(), map()) :: :ok
  def append_time_series_event(deployment_id, event_name, payload)
      when is_binary(deployment_id) and is_binary(event_name) and is_map(payload) do
    _ =
      TimeSeriesStore.append_event(%{
        "deployment_id" => deployment_id,
        "event" => event_name,
        "payload" => stringify_keys(payload),
        "timestamp" => System.system_time(:millisecond)
      })

    :ok
  end

  @spec snapshot_deployment(map(), String.t(), String.t()) :: :ok
  def snapshot_deployment(state, deployment_id, reason)
      when is_map(state) and is_binary(deployment_id) and is_binary(reason) do
    case Map.get(state.deployments, deployment_id) do
      nil ->
        :ok

      deployment ->
        device = Map.get(state.devices, deployment.device_id)

        deployment_metadata =
          merge_deployment_metadata(
            deployment.deployment_metadata || %{},
            build_deployment_metadata(device, deployment, %{})
          )

        state_payload = %{
          "deployment_id" => deployment.id,
          "automata_id" => deployment.automata_id,
          "device_id" => deployment.device_id,
          "status" => Atom.to_string(deployment.status),
          "current_state" => deployment.current_state,
          "variables" => deployment.variables || %{},
          "error" => deployment.error,
          "deployment_metadata" => deployment_metadata
        }

        _ =
          TimeSeriesStore.append_snapshot(%{
            "deployment_id" => deployment.id,
            "reason" => reason,
            "state" => state_payload,
            "timestamp" => System.system_time(:millisecond)
          })

        :ok
    end
  end

  @spec persist_device_status(map(), String.t()) :: :ok
  def persist_device_status(state, device_id)
      when is_map(state) and is_binary(device_id) do
    case Map.get(state.devices, device_id) do
      nil ->
        :ok

      device ->
        deployment = latest_device_deployment(device_id, state)
        deployment_metadata = build_deployment_metadata(device, deployment, %{})
        battery = deployment_metadata["battery"] || %{}
        latency = deployment_metadata["latency"] || %{}

        TimeSeriesInfluxSink.append_device_status(%{
          "device_id" => device.id,
          "server_id" => configured_server_id(),
          "connector_type" => normalize_dimension(device.connector_type),
          "transport" => normalize_dimension(device.transport),
          "status" => normalize_dimension(device.status),
          "last_seen_at" => device.last_heartbeat,
          "connected_at" => device.connected_at,
          "has_session" => match?(%DeviceSessionRef{}, device.session_ref),
          "deployment_id" => deployment && deployment.id,
          "automata_id" => deployment && deployment.automata_id,
          "deployment_status" => deployment && Atom.to_string(deployment.status),
          "current_state" => deployment && deployment.current_state,
          "error" => deployment && deployment.error,
          "link" => device.link,
          "placement" => deployment_metadata["placement"],
          "battery_percent" => battery["percent"],
          "battery_low" => battery["low"],
          "latency_budget_ms" => latency["budget_ms"],
          "latency_warning_ms" => latency["warning_ms"],
          "observed_latency_ms" => latency["observed_ms"],
          "timestamp" => System.system_time(:millisecond)
        })
    end
  end

  @spec persist_device_metrics(map(), map() | nil, map()) :: :ok
  def persist_device_metrics(device, deployment, payload)
      when is_map(device) and is_map(payload) do
    telemetry_timestamp =
      payload[:timestamp] || payload["timestamp"] || System.system_time(:millisecond)

    deployment_metadata = build_deployment_metadata(device, deployment, payload)
    battery = deployment_metadata["battery"] || %{}
    latency = deployment_metadata["latency"] || %{}

    TimeSeriesInfluxSink.append_device_metrics(%{
      "device_id" => device.id,
      "deployment_id" => deployment && deployment.id,
      "automata_id" => deployment && deployment.automata_id,
      "server_id" => configured_server_id(),
      "connector_type" => normalize_dimension(device.connector_type),
      "transport" => normalize_dimension(device.transport),
      "placement" => deployment_metadata["placement"],
      "link" => device.link,
      "cpu_usage" => payload[:cpu_usage] || payload["cpu_usage"] || 0.0,
      "heap_free" => payload[:heap_free] || payload["heap_free"] || 0,
      "heap_total" => payload[:heap_total] || payload["heap_total"] || 0,
      "tick_rate" => payload[:tick_rate] || payload["tick_rate"] || 0,
      "run_id" => payload[:run_id] || payload["run_id"] || 0,
      "source_id" => payload[:source_id] || payload["source_id"] || 0,
      "message_id" => payload[:message_id] || payload["message_id"] || 0,
      "telemetry_timestamp_ms" => telemetry_timestamp,
      "received_at_ms" => System.system_time(:millisecond),
      "variable_count" => telemetry_variable_count(payload),
      "battery_percent" => battery["percent"],
      "battery_low" => battery["low"],
      "battery_present" => battery["present"],
      "battery_external_power" => battery["external_power"],
      "latency_budget_ms" => latency["budget_ms"],
      "latency_warning_ms" => latency["warning_ms"],
      "observed_latency_ms" => latency["observed_ms"],
      "ingress_latency_ms" => latency["ingress_ms"],
      "egress_latency_ms" => latency["egress_ms"],
      "send_timestamp_ms" => latency["send_timestamp"],
      "receive_timestamp_ms" => latency["receive_timestamp"],
      "handle_timestamp_ms" => latency["handle_timestamp"],
      "timestamp" => telemetry_timestamp
    })

    :ok
  end

  @spec build_deployment_metadata(map() | nil, map() | nil, map()) :: map()
  def build_deployment_metadata(device, deployment, payload)
      when (is_map(device) or is_nil(device)) and (is_map(deployment) or is_nil(deployment)) and
             is_map(payload) do
    existing = if is_map(deployment), do: deployment.deployment_metadata || %{}, else: %{}
    device_metadata = if is_map(device), do: device[:deployment_metadata] || %{}, else: %{}
    payload_metadata = payload_value(payload, "deployment_metadata") || %{}

    metadata =
      compact_metadata(%{
        "server" => compact_metadata(%{"server_id" => configured_server_id()}),
        "placement" =>
          payload_value(payload, "placement") ||
            payload_metadata["placement"] ||
            device_metadata["placement"] ||
            existing["placement"] ||
            infer_placement(device),
        "transport" =>
          compact_metadata(%{
            "type" => device && normalize_dimension(device.transport),
            "link" => device && device.link,
            "connector_id" => device && device.connector_id,
            "connector_type" => device && normalize_dimension(device.connector_type)
          }),
        "runtime" =>
          compact_metadata(%{
            "run_id" => deployment && deployment.run_id,
            "target_profile" =>
              (deployment && deployment.target_profile) ||
                payload_value(payload, "target_profile"),
            "patch_mode" => deployment && deployment.patch_mode,
            "artifact_version_id" => deployment && deployment.artifact_version_id,
            "snapshot_id" => deployment && deployment.snapshot_id,
            "migration_plan_ref" => deployment && deployment.migration_plan_ref
          }),
        "battery" =>
          compact_metadata(%{
            "present" => payload_value(payload, "battery_present"),
            "percent" => payload_value(payload, "battery_percent"),
            "low" => payload_value(payload, "battery_low"),
            "external_power" => payload_value(payload, "battery_external_power")
          }),
        "latency" =>
          compact_metadata(%{
            "budget_ms" => payload_value(payload, "latency_budget_ms"),
            "warning_ms" => payload_value(payload, "latency_warning_ms"),
            "observed_ms" => payload_value(payload, "observed_latency_ms"),
            "ingress_ms" => payload_value(payload, "ingress_latency_ms"),
            "egress_ms" => payload_value(payload, "egress_latency_ms"),
            "send_timestamp" => payload_value(payload, "send_timestamp"),
            "receive_timestamp" => payload_value(payload, "receive_timestamp"),
            "handle_timestamp" => payload_value(payload, "handle_timestamp")
          }),
        "black_box" =>
          payload_value(payload, "black_box") || payload_value(payload, "black_box_contract") ||
            payload_value(payload, "contract"),
        "trace" =>
          compact_metadata(%{
            "fault_profile" => payload_value(payload, "fault_profile"),
            "trace_file" => payload_value(payload, "trace_file"),
            "trace_event_count" => payload_value(payload, "trace_event_count")
          })
      })

    existing
    |> merge_deployment_metadata(device_metadata)
    |> merge_deployment_metadata(payload_metadata)
    |> merge_deployment_metadata(metadata)
    |> attach_local_trace_evidence(deployment, payload)
  end

  def build_deployment_metadata(_device, _deployment, _payload), do: %{}

  @spec enrich_black_box_snapshot(map(), map(), map()) :: map()
  def enrich_black_box_snapshot(snapshot, deployment, state)
      when is_map(snapshot) and is_map(deployment) and is_map(state) do
    description = black_box_description(deployment, state)

    snapshot
    |> Map.put(:deployment_metadata, description["deployment_metadata"])
    |> Map.put(:black_box, description["black_box"])
    |> Map.put(:observable_state, description["observable_state"])
  end

  @spec black_box_description(map(), map()) :: map()
  def black_box_description(deployment, state) when is_map(deployment) and is_map(state) do
    device = Map.get(state.devices, deployment.device_id)
    automata = Map.get(state.automata_cache, deployment.automata_id, %{})
    deployment_metadata = build_deployment_metadata(device, deployment, %{})
    black_box = black_box_contract(automata, deployment_metadata)

    %{
      "deployment_id" => deployment.id,
      "automata_id" => deployment.automata_id,
      "device_id" => deployment.device_id,
      "status" => Atom.to_string(deployment.status),
      "observable_state" => deployment.current_state,
      "deployment_metadata" => deployment_metadata,
      "black_box" => black_box
    }
  end

  @spec validate_black_box_event(map(), map(), String.t()) ::
          :ok | {:error, :invalid_black_box_event}
  def validate_black_box_event(deployment, state, event_name)
      when is_map(deployment) and is_map(state) and is_binary(event_name) and event_name != "" do
    emitted_events =
      black_box_description(deployment, state)
      |> get_in(["black_box", "emitted_events"])
      |> List.wrap()

    if event_name in emitted_events do
      :ok
    else
      {:error, :invalid_black_box_event}
    end
  end

  def validate_black_box_event(_deployment, _state, _event_name),
    do: {:error, :invalid_black_box_event}

  @spec validate_black_box_state(map(), map(), String.t()) ::
          :ok | {:error, :invalid_black_box_state}
  def validate_black_box_state(deployment, state, state_name)
      when is_map(deployment) and is_map(state) and is_binary(state_name) and state_name != "" do
    observable_states =
      black_box_description(deployment, state)
      |> get_in(["black_box", "observable_states"])
      |> List.wrap()

    if state_name in observable_states do
      :ok
    else
      {:error, :invalid_black_box_state}
    end
  end

  def validate_black_box_state(_deployment, _state, _state_name),
    do: {:error, :invalid_black_box_state}

  @spec maybe_record_set_input_event(map(), String.t(), any(), map()) :: :ok
  def maybe_record_set_input_event(deployment, input_name, value, opts)
      when is_map(deployment) and is_binary(input_name) do
    internal_propagation =
      opts["internal_propagation"] || opts[:internal_propagation] || false

    unless internal_propagation do
      append_time_series_event(deployment.id, "set_input", %{
        "automata_id" => deployment.automata_id,
        "device_id" => deployment.device_id,
        "name" => input_name,
        "value" => value
      })
    end

    :ok
  end

  def maybe_record_set_input_event(_deployment, _input_name, _value, _opts), do: :ok

  defp enrich_observability_payload(state, payload) when is_map(state) and is_map(payload) do
    payload = stringify_keys(payload)
    {device, deployment} = resolve_runtime_context(state, payload)
    deployment_metadata = build_deployment_metadata(device, deployment, payload)

    payload
    |> maybe_put_identity(deployment, device)
    |> maybe_put_map("deployment_metadata", deployment_metadata)
    |> put_runtime_trace_fields(deployment_metadata)
  end

  defp enrich_observability_payload(payload) when is_map(payload) do
    payload
    |> stringify_keys()
    |> put_runtime_trace_fields(payload_value(payload, "deployment_metadata") || %{})
  end

  defp maybe_record_time_series_event(event, payload) when is_binary(event) and is_map(payload) do
    case payload["deployment_id"] || payload[:deployment_id] do
      deployment_id when is_binary(deployment_id) and deployment_id != "" ->
        append_time_series_event(deployment_id, event, payload)

      _ ->
        :ok
    end
  end

  defp stringify_keys(%_{} = struct), do: struct

  defp stringify_keys(map) when is_map(map) do
    map
    |> Enum.map(fn
      {k, v} when is_atom(k) -> {Atom.to_string(k), stringify_keys(v)}
      {k, v} when is_binary(k) -> {k, stringify_keys(v)}
      {k, v} -> {to_string(k), stringify_keys(v)}
    end)
    |> Enum.into(%{})
  end

  defp stringify_keys(list) when is_list(list), do: Enum.map(list, &stringify_keys/1)
  defp stringify_keys(other), do: other

  defp black_box_contract(automata, deployment_metadata) when is_map(deployment_metadata) do
    declared =
      case automata[:black_box] || automata["black_box"] || deployment_metadata["black_box"] do
        %{} = declared -> declared
        _ -> %{}
      end

    if map_size(declared) > 0 do
      declared
    else
      derive_black_box_contract(automata)
    end
  end

  defp derive_black_box_contract(automata) when is_map(automata) do
    variables = automata[:variables] || automata["variables"] || []
    states = automata[:states] || automata["states"] || %{}
    transitions = automata[:transitions] || automata["transitions"] || %{}

    ports =
      Enum.map(variables, fn variable ->
        %{
          "name" => variable[:name] || variable["name"],
          "direction" => normalize_port_direction(variable[:direction] || variable["direction"]),
          "type" => variable[:type] || variable["type"] || "unknown"
        }
      end)
      |> Enum.reject(&is_nil(&1["name"]))

    emitted_events =
      transitions
      |> Enum.map(fn {_id, transition} ->
        event = transition[:event] || transition["event"] || %{}

        cond do
          is_binary(event[:name]) -> event[:name]
          is_binary(event["name"]) -> event["name"]
          is_binary(transition[:event]) -> transition[:event]
          is_binary(transition["event"]) -> transition["event"]
          true -> nil
        end
      end)
      |> Enum.reject(&is_nil/1)
      |> Enum.uniq()

    %{
      "ports" => ports,
      "observable_states" => Map.keys(states),
      "emitted_events" => emitted_events,
      "resources" => []
    }
  end

  defp derive_black_box_contract(_automata),
    do: %{"ports" => [], "observable_states" => [], "emitted_events" => [], "resources" => []}

  defp normalize_port_direction(direction) when direction in [:input, :output, :internal],
    do: Atom.to_string(direction)

  defp normalize_port_direction(direction)
       when direction in ["input", "output", "internal"],
       do: direction

  defp normalize_port_direction(_direction), do: "internal"

  defp merge_deployment_metadata(existing, incoming) when is_map(existing) and is_map(incoming) do
    Map.merge(existing, incoming, fn _key, left, right ->
      if is_map(left) and is_map(right) do
        Map.merge(left, right)
      else
        right
      end
    end)
  end

  defp merge_deployment_metadata(_existing, incoming) when is_map(incoming), do: incoming
  defp merge_deployment_metadata(existing, _incoming) when is_map(existing), do: existing
  defp merge_deployment_metadata(_existing, _incoming), do: %{}

  defp compact_metadata(map) when is_map(map) do
    map
    |> Enum.reject(fn
      {_key, nil} -> true
      {_key, ""} -> true
      {_key, value} when is_map(value) -> map_size(value) == 0
      _ -> false
    end)
    |> Enum.into(%{})
  end

  defp infer_placement(%{device_type: :desktop}), do: "host"
  defp infer_placement(%{connector_type: nil, transport: nil}), do: "host"
  defp infer_placement(%{transport: "local_runtime"}), do: "host"

  defp infer_placement(%{connector_type: connector_type}) when not is_nil(connector_type),
    do: "device"

  defp infer_placement(%{}), do: "device"
  defp infer_placement(_device), do: nil

  defp payload_value(payload, key) when is_map(payload) and is_binary(key) do
    Map.get(payload, String.to_existing_atom(key), Map.get(payload, key))
  rescue
    ArgumentError -> Map.get(payload, key)
  end

  defp resolve_runtime_context(state, payload) when is_map(state) and is_map(payload) do
    deployment = resolve_deployment(state, payload)

    device =
      cond do
        is_map(deployment) -> Map.get(state.devices, deployment.device_id)
        is_binary(payload["device_id"]) -> Map.get(state.devices, payload["device_id"])
        true -> nil
      end

    {device, deployment}
  end

  defp resolve_deployment(state, payload) when is_map(state) and is_map(payload) do
    deployment_id = payload["deployment_id"]
    automata_id = payload["automata_id"]
    device_id = payload["device_id"]

    cond do
      is_binary(deployment_id) and deployment_id != "" ->
        Map.get(state.deployments, deployment_id)

      is_binary(device_id) and device_id != "" ->
        state.deployments
        |> Map.values()
        |> Enum.find(fn deployment ->
          deployment.device_id == device_id and
            (is_nil(automata_id) or automata_id == "" or deployment.automata_id == automata_id)
        end)

      true ->
        nil
    end
  end

  defp maybe_put_identity(payload, deployment, device) when is_map(payload) do
    payload
    |> maybe_put_value("deployment_id", deployment && deployment.id)
    |> maybe_put_value("automata_id", deployment && deployment.automata_id)
    |> maybe_put_value("device_id", (device && device.id) || (deployment && deployment.device_id))
  end

  defp maybe_put_map(payload, _key, value) when value in [nil, %{}], do: payload

  defp maybe_put_map(payload, key, value)
       when is_map(payload) and is_binary(key) and is_map(value) do
    Map.update(payload, key, value, fn existing ->
      existing =
        case stringify_keys(existing) do
          %{} = map -> map
          _ -> %{}
        end

      merge_deployment_metadata(value, existing)
    end)
  end

  defp put_runtime_trace_fields(payload, deployment_metadata)
       when is_map(payload) and is_map(deployment_metadata) do
    latency = deployment_metadata["latency"] || %{}
    trace = deployment_metadata["trace"] || %{}

    payload
    |> maybe_put_value("placement", deployment_metadata["placement"])
    |> maybe_put_value("latency_budget_ms", latency["budget_ms"])
    |> maybe_put_value("latency_warning_ms", latency["warning_ms"])
    |> maybe_put_value("observed_latency_ms", latency["observed_ms"])
    |> maybe_put_value("ingress_latency_ms", latency["ingress_ms"])
    |> maybe_put_value("egress_latency_ms", latency["egress_ms"])
    |> maybe_put_value("fault_profile", trace["fault_profile"])
    |> maybe_put_value("trace_file", trace["trace_file"])
    |> maybe_put_value("trace_event_count", trace["trace_event_count"])
    |> maybe_put_value("fault_actions", trace["recent_fault_actions"])
    |> maybe_put_value(
      "latency_budget_exceeded",
      trace["recent_latency_budget_exceeded"] ||
        latency_threshold_exceeded?(latency["observed_ms"], latency["budget_ms"])
    )
    |> maybe_put_value(
      "latency_warning_exceeded",
      latency_threshold_exceeded?(latency["observed_ms"], latency["warning_ms"])
    )
  end

  defp maybe_put_value(payload, _key, nil), do: payload

  defp maybe_put_value(payload, key, value) when is_map(payload) and is_binary(key) do
    Map.put_new(payload, key, value)
  end

  defp attach_local_trace_evidence(metadata, deployment, payload)
       when is_map(metadata) and is_map(payload) do
    trace_file = get_in(metadata, ["trace", "trace_file"])
    run_id = payload_value(payload, "run_id") || (deployment && deployment.run_id)

    case load_recent_trace_evidence(trace_file, run_id) do
      %{trace: trace_evidence, latency: latency_evidence} ->
        metadata
        |> update_in(["trace"], fn existing ->
          merge_deployment_metadata(existing || %{}, trace_evidence)
        end)
        |> update_in(["latency"], fn existing ->
          merge_deployment_metadata(existing || %{}, latency_evidence)
        end)

      _ ->
        metadata
    end
  end

  defp attach_local_trace_evidence(metadata, _deployment, _payload), do: metadata

  defp latency_threshold_exceeded?(observed_ms, threshold_ms)
       when is_integer(observed_ms) and is_integer(threshold_ms) and threshold_ms > 0 do
    observed_ms > threshold_ms
  end

  defp latency_threshold_exceeded?(_observed_ms, _threshold_ms), do: nil

  defp load_recent_trace_evidence(trace_file, run_id)
       when is_binary(trace_file) and trace_file != "" do
    with {:ok, chunk} <- read_trace_tail(trace_file, 65_536),
         lines <- decode_trace_lines(chunk),
         records when records != [] <- filter_trace_records(lines, run_id) do
      trace_evidence =
        %{}
        |> maybe_put_trace_value("recent_fault_actions", recent_fault_actions(records))
        |> maybe_put_trace_value(
          "recent_latency_budget_exceeded",
          latest_trace_value(records, "latency_budget_exceeded")
        )

      latency_evidence =
        %{}
        |> maybe_put_trace_value("budget_ms", latest_trace_value(records, "latency_budget_ms"))
        |> maybe_put_trace_value("warning_ms", latest_trace_value(records, "latency_warning_ms"))
        |> maybe_put_trace_value(
          "observed_ms",
          latest_trace_value(records, "observed_latency_ms")
        )

      %{trace: trace_evidence, latency: latency_evidence}
    else
      _ -> nil
    end
  end

  defp load_recent_trace_evidence(_trace_file, _run_id), do: nil

  defp read_trace_tail(path, max_bytes) when is_binary(path) and is_integer(max_bytes) do
    with {:ok, stat} <- File.stat(path),
         {:ok, io} <- :file.open(String.to_charlist(path), [:read, :binary]) do
      offset = max(stat.size - max_bytes, 0)

      try do
        :file.pread(io, offset, stat.size - offset)
      after
        :file.close(io)
      end
    end
  end

  defp decode_trace_lines(chunk) when is_binary(chunk) do
    chunk
    |> String.split("\n", trim: true)
    |> Enum.reverse()
    |> Enum.take(25)
    |> Enum.reverse()
    |> Enum.map(&Jason.decode/1)
    |> Enum.flat_map(fn
      {:ok, %{} = record} -> [record]
      _ -> []
    end)
  end

  defp filter_trace_records(records, run_id) when is_list(records) and is_integer(run_id) do
    matching = Enum.filter(records, &(&1["run_id"] == run_id))
    if matching == [], do: records, else: matching
  end

  defp filter_trace_records(records, _run_id), do: records

  defp recent_fault_actions(records) when is_list(records) do
    records
    |> Enum.flat_map(&List.wrap(&1["fault_actions"]))
    |> Enum.reject(&(&1 in [nil, ""]))
    |> Enum.uniq()
  end

  defp latest_trace_value(records, key) when is_list(records) and is_binary(key) do
    records
    |> Enum.reverse()
    |> Enum.find_value(&Map.get(&1, key))
  end

  defp maybe_put_trace_value(map, _key, nil), do: map
  defp maybe_put_trace_value(map, _key, []), do: map
  defp maybe_put_trace_value(map, key, value), do: Map.put(map, key, value)

  defp latest_device_deployment(device_id, state) do
    state.deployments
    |> Map.values()
    |> Enum.filter(&(&1.device_id == device_id))
    |> Enum.sort_by(
      fn deployment -> {deployment_priority(deployment.status), deployment.deployed_at} end,
      :desc
    )
    |> List.first()
  end

  defp deployment_priority(status) when status in [:running, :paused, :loading], do: 2
  defp deployment_priority(status) when status in [:stopped, :pending], do: 1
  defp deployment_priority(:error), do: 0
  defp deployment_priority(_status), do: 0

  defp telemetry_variable_count(payload) when is_map(payload) do
    case payload[:variables] || payload["variables"] do
      variables when is_list(variables) -> length(variables)
      _ -> 0
    end
  end

  defp configured_server_id do
    :aetherium_server
    |> Application.get_env(:gateway, [])
    |> Keyword.get(:server_id, "srv_01")
  end

  defp normalize_dimension(value) when is_atom(value), do: Atom.to_string(value)
  defp normalize_dimension(value) when is_binary(value) and value != "", do: value
  defp normalize_dimension(_value), do: "unknown"
end
