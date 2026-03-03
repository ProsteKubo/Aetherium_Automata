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

  defp get_string(map, key, default \\ "")

  defp get_string(map, key, default) when is_map(map) do
    value = fetch_by_key(map, key, default)
    if is_binary(value), do: value, else: default
  end

  defp get_int(map, key, default) when is_map(map) do
    value = fetch_by_key(map, key, default)
    if is_integer(value), do: value, else: default
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
end
