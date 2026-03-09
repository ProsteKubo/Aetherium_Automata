defmodule AetheriumServer.TimeSeriesInfluxSink do
  @moduledoc """
  Optional InfluxDB sink for deployment timeline data.

  v1 role:
  - stream events/snapshots from `TimeSeriesStore` into InfluxDB
  - provide external timeline persistence for query/replay backends
  """

  use GenServer
  require Logger

  @default_flush_interval_ms 1_000
  @default_batch_size 200
  @default_timeout_ms 5_000

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @spec enabled?() :: boolean()
  def enabled? do
    config = Application.get_env(:aetherium_server, __MODULE__, [])
    Keyword.get(config, :enabled, false)
  end

  @spec append_event(map()) :: :ok
  def append_event(event) when is_map(event) do
    if enabled?() do
      GenServer.cast(__MODULE__, {:append_event, event})
    end

    :ok
  end

  @spec append_snapshot(map()) :: :ok
  def append_snapshot(snapshot) when is_map(snapshot) do
    if enabled?() do
      GenServer.cast(__MODULE__, {:append_snapshot, snapshot})
    end

    :ok
  end

  @spec append_device_metrics(map()) :: :ok
  def append_device_metrics(metrics) when is_map(metrics) do
    if enabled?() do
      GenServer.cast(__MODULE__, {:append_device_metrics, metrics})
    end

    :ok
  end

  @spec append_device_status(map()) :: :ok
  def append_device_status(status) when is_map(status) do
    if enabled?() do
      GenServer.cast(__MODULE__, {:append_device_status, status})
    end

    :ok
  end

  @impl true
  def init(_opts) do
    config = Application.get_env(:aetherium_server, __MODULE__, [])

    enabled = Keyword.get(config, :enabled, false)
    flush_interval_ms = Keyword.get(config, :flush_interval_ms, @default_flush_interval_ms)
    batch_size = Keyword.get(config, :batch_size, @default_batch_size)
    timeout_ms = Keyword.get(config, :timeout_ms, @default_timeout_ms)

    state = %{
      enabled: enabled,
      url: Keyword.get(config, :url, "http://localhost:8086"),
      org: Keyword.get(config, :org, "aetherium"),
      bucket: Keyword.get(config, :bucket, "aetherium_ts"),
      token: Keyword.get(config, :token, ""),
      precision: Keyword.get(config, :precision, "ns"),
      flush_interval_ms: max(flush_interval_ms, 50),
      batch_size: max(batch_size, 1),
      timeout_ms: max(timeout_ms, 500),
      queue: []
    }

    if enabled do
      _ = :inets.start()
      schedule_flush(state.flush_interval_ms)
      Logger.info("TimeSeriesInfluxSink enabled (bucket=#{state.bucket}, org=#{state.org})")
    end

    {:ok, state}
  end

  @impl true
  def handle_cast({:append_event, event}, %{enabled: true} = state) do
    with {:ok, line} <- event_to_line(event) do
      next = %{state | queue: [line | state.queue]}
      maybe_flush(next)
    else
      _ -> {:noreply, state}
    end
  end

  def handle_cast({:append_snapshot, snapshot}, %{enabled: true} = state) do
    with {:ok, line} <- snapshot_to_line(snapshot) do
      next = %{state | queue: [line | state.queue]}
      maybe_flush(next)
    else
      _ -> {:noreply, state}
    end
  end

  def handle_cast({:append_device_metrics, metrics}, %{enabled: true} = state) do
    with {:ok, line} <- device_metrics_to_line(metrics) do
      next = %{state | queue: [line | state.queue]}
      maybe_flush(next)
    else
      _ -> {:noreply, state}
    end
  end

  def handle_cast({:append_device_status, status}, %{enabled: true} = state) do
    with {:ok, line} <- device_status_to_line(status) do
      next = %{state | queue: [line | state.queue]}
      maybe_flush(next)
    else
      _ -> {:noreply, state}
    end
  end

  def handle_cast(_msg, state), do: {:noreply, state}

  @impl true
  def handle_info(:flush, %{enabled: true} = state) do
    next = flush_queue(state)
    schedule_flush(state.flush_interval_ms)
    {:noreply, next}
  end

  def handle_info(:flush, state), do: {:noreply, state}

  defp maybe_flush(state) do
    if length(state.queue) >= state.batch_size do
      {:noreply, flush_queue(state)}
    else
      {:noreply, state}
    end
  end

  defp flush_queue(%{queue: []} = state), do: state

  defp flush_queue(state) do
    body =
      state.queue
      |> Enum.reverse()
      |> Enum.join("\n")

    write_url =
      "#{String.trim_trailing(state.url, "/")}/api/v2/write?org=#{URI.encode(state.org)}&bucket=#{URI.encode(state.bucket)}&precision=#{state.precision}"

    headers = [
      {~c"Authorization", String.to_charlist("Token " <> state.token)},
      {~c"Content-Type", ~c"text/plain"}
    ]

    request = {String.to_charlist(write_url), headers, ~c"text/plain", body}
    http_opts = [timeout: state.timeout_ms, connect_timeout: state.timeout_ms]

    case :httpc.request(:post, request, http_opts, []) do
      {:ok, {{_http, status, _reason}, _headers, _resp_body}} when status in [200, 204] ->
        %{state | queue: []}

      {:ok, {{_http, status, _reason}, _headers, resp_body}} ->
        Logger.warning(
          "TimeSeriesInfluxSink write failed status=#{status}: #{inspect(resp_body)}"
        )

        %{state | queue: []}

      {:error, reason} ->
        Logger.warning("TimeSeriesInfluxSink write failed: #{inspect(reason)}")
        %{state | queue: []}
    end
  end

  defp event_to_line(event) when is_map(event) do
    deployment_id = get_string(event, "deployment_id")

    if deployment_id == "" do
      {:error, :missing_deployment_id}
    else
      event_name = get_string(event, "event", "unknown")
      cursor = get_int(event, "cursor", 0)
      timestamp_ns = timestamp_ns(event)
      payload_json = json_field(event["payload"] || %{})

      line =
        "aeth_timeline,kind=event,deployment_id=#{escape_tag(deployment_id)},event=#{escape_tag(event_name)} cursor=#{cursor}i,payload_json=\"#{payload_json}\" #{timestamp_ns}"

      {:ok, line}
    end
  end

  defp snapshot_to_line(snapshot) when is_map(snapshot) do
    deployment_id = get_string(snapshot, "deployment_id")

    if deployment_id == "" do
      {:error, :missing_deployment_id}
    else
      reason = get_string(snapshot, "reason", "snapshot")
      cursor = get_int(snapshot, "snapshot_cursor", 0)
      timestamp_ns = timestamp_ns(snapshot)
      state_json = json_field(snapshot["state"] || %{})

      line =
        "aeth_timeline,kind=snapshot,deployment_id=#{escape_tag(deployment_id)},reason=#{escape_tag(reason)} snapshot_cursor=#{cursor}i,state_json=\"#{state_json}\" #{timestamp_ns}"

      {:ok, line}
    end
  end

  defp device_metrics_to_line(metrics) when is_map(metrics) do
    device_id = get_string(metrics, "device_id")

    if device_id == "" do
      {:error, :missing_device_id}
    else
      tags =
        [
          {"device_id", device_id},
          {"deployment_id", get_string(metrics, "deployment_id")},
          {"automata_id", get_string(metrics, "automata_id")},
          {"server_id", get_string(metrics, "server_id")},
          {"connector_type", get_string(metrics, "connector_type")},
          {"transport", get_string(metrics, "transport")}
        ]
        |> Enum.reject(fn {_key, value} -> value in [nil, ""] end)

      fields = %{
        "cpu_usage" => get_float(metrics, "cpu_usage", 0.0),
        "heap_free" => get_int(metrics, "heap_free", 0),
        "heap_total" => get_int(metrics, "heap_total", 0),
        "tick_rate" => get_int(metrics, "tick_rate", 0),
        "run_id" => get_int(metrics, "run_id", 0),
        "source_id" => get_int(metrics, "source_id", 0),
        "message_id" => get_int(metrics, "message_id", 0),
        "telemetry_timestamp_ms" => get_int(metrics, "telemetry_timestamp_ms", 0),
        "received_at_ms" => get_int(metrics, "received_at_ms", 0),
        "variable_count" => metrics |> fetch_by_key("variable_count", 0) |> integer_or_default(0)
      }

      measurement_line("aeth_device_metrics", tags, fields, timestamp_ns(metrics))
    end
  end

  defp device_status_to_line(status) when is_map(status) do
    device_id = get_string(status, "device_id")

    if device_id == "" do
      {:error, :missing_device_id}
    else
      tags =
        [
          {"device_id", device_id},
          {"server_id", get_string(status, "server_id")},
          {"connector_type", get_string(status, "connector_type")},
          {"transport", get_string(status, "transport")},
          {"status", get_string(status, "status", "unknown")}
        ]
        |> Enum.reject(fn {_key, value} -> value in [nil, ""] end)

      fields = %{
        "last_seen_at" => get_int(status, "last_seen_at", 0),
        "connected_at" => get_int(status, "connected_at", 0),
        "has_session" => get_bool(status, "has_session", false),
        "status_text" => empty_to_nil(get_string(status, "status")),
        "deployment_id" => empty_to_nil(get_string(status, "deployment_id")),
        "automata_id" => empty_to_nil(get_string(status, "automata_id")),
        "deployment_status" => empty_to_nil(get_string(status, "deployment_status")),
        "deployment_status_text" => empty_to_nil(get_string(status, "deployment_status")),
        "current_state" => empty_to_nil(get_string(status, "current_state")),
        "error" => empty_to_nil(get_string(status, "error")),
        "link" => empty_to_nil(get_string(status, "link"))
      }

      measurement_line("aeth_device_status", tags, fields, timestamp_ns(status))
    end
  end

  defp measurement_line(measurement, tags, fields, timestamp_ns)
       when is_binary(measurement) and is_list(tags) and is_map(fields) and
              is_integer(timestamp_ns) do
    field_values =
      fields
      |> Enum.reject(fn {_key, value} -> is_nil(value) end)
      |> Enum.map_join(",", fn {key, value} -> "#{escape_tag(key)}=#{field_value(value)}" end)

    if field_values == "" do
      {:error, :missing_fields}
    else
      tag_values =
        case tags do
          [] ->
            measurement

          _ ->
            measurement <>
              "," <>
              Enum.map_join(tags, ",", fn {key, value} ->
                "#{escape_tag(key)}=#{escape_tag(value)}"
              end)
        end

      {:ok, "#{tag_values} #{field_values} #{timestamp_ns}"}
    end
  end

  defp get_string(map, key, default \\ "")

  defp get_string(map, key, default) when is_map(map) do
    value = fetch_by_key(map, key, default)
    if is_binary(value), do: value, else: default
  end

  defp get_int(map, key, default) when is_map(map) do
    value = fetch_by_key(map, key, default)
    if is_integer(value), do: value, else: default
  end

  defp get_float(map, key, default) when is_map(map) do
    value = fetch_by_key(map, key, default)

    cond do
      is_float(value) -> value
      is_integer(value) -> value * 1.0
      true -> default
    end
  end

  defp get_bool(map, key, default) when is_map(map) do
    value = fetch_by_key(map, key, default)
    if is_boolean(value), do: value, else: default
  end

  defp fetch_by_key(map, key, default) when is_map(map) and is_binary(key) do
    case Map.fetch(map, key) do
      {:ok, value} ->
        value

      :error ->
        Enum.find_value(map, default, fn
          {k, value} when is_atom(k) ->
            if Atom.to_string(k) == key, do: value, else: nil

          _ ->
            nil
        end)
    end
  end

  defp timestamp_ns(map) when is_map(map) do
    ts =
      case Map.get(map, "timestamp") || Map.get(map, :timestamp) do
        value when is_integer(value) and value >= 0 -> value
        _ -> System.system_time(:millisecond)
      end

    ts * 1_000_000
  end

  defp escape_tag(value) when is_binary(value) do
    value
    |> String.replace("\\", "\\\\")
    |> String.replace(",", "\\,")
    |> String.replace(" ", "\\ ")
    |> String.replace("=", "\\=")
  end

  defp json_field(value) do
    value
    |> Jason.encode!()
    |> String.replace("\\", "\\\\")
    |> String.replace("\"", "\\\"")
    |> String.replace("\n", "\\n")
    |> String.replace("\r", "\\r")
  end

  defp schedule_flush(interval_ms) do
    Process.send_after(self(), :flush, interval_ms)
  end

  defp field_value(value) when is_integer(value), do: Integer.to_string(value) <> "i"
  defp field_value(value) when is_float(value), do: :erlang.float_to_binary(value, decimals: 6)
  defp field_value(true), do: "true"
  defp field_value(false), do: "false"
  defp field_value(value) when is_binary(value), do: ~s("#{escape_field_string(value)}")

  defp empty_to_nil(""), do: nil
  defp empty_to_nil(value), do: value

  defp integer_or_default(value, _default) when is_integer(value), do: value
  defp integer_or_default(_value, default), do: default

  defp escape_field_string(value) when is_binary(value) do
    value
    |> String.replace("\\", "\\\\")
    |> String.replace("\"", "\\\"")
    |> String.replace("\n", "\\n")
    |> String.replace("\r", "\\r")
  end
end
