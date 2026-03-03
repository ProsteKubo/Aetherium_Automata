defmodule AetheriumServer.TimeSeriesStore do
  @moduledoc """
  Server-local time-series storage for deployment runtime events and snapshots.

  This is the v1 groundwork for time-travel debugging:
  - append deployment-scoped events
  - append point-in-time deployment snapshots
  - query timeline ranges
  - reconstruct deployment state at a target timestamp
  """

  use GenServer

  alias AetheriumServer.TimeSeriesInfluxSink
  alias AetheriumServer.TimeSeriesReplay

  @default_event_capacity 20_000
  @default_snapshot_capacity 2_000

  @type timeline_event :: map()
  @type timeline_snapshot :: map()

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @spec enabled?() :: boolean()
  def enabled? do
    config = Application.get_env(:aetherium_server, __MODULE__, [])
    Keyword.get(config, :enabled, true)
  end

  @spec append_event(timeline_event()) :: {:ok, non_neg_integer()} | {:error, term()}
  def append_event(event) when is_map(event) do
    if enabled?() do
      GenServer.call(__MODULE__, {:append_event, event})
    else
      {:ok, 0}
    end
  end

  @spec append_snapshot(timeline_snapshot()) :: {:ok, non_neg_integer()} | {:error, term()}
  def append_snapshot(snapshot) when is_map(snapshot) do
    if enabled?() do
      GenServer.call(__MODULE__, {:append_snapshot, snapshot})
    else
      {:ok, 0}
    end
  end

  @spec list_events(String.t(), keyword()) :: [map()]
  def list_events(deployment_id, opts \\ []) when is_binary(deployment_id) do
    if enabled?() do
      GenServer.call(__MODULE__, {:list_events, deployment_id, opts})
    else
      []
    end
  end

  @spec list_snapshots(String.t(), keyword()) :: [map()]
  def list_snapshots(deployment_id, opts \\ []) when is_binary(deployment_id) do
    if enabled?() do
      GenServer.call(__MODULE__, {:list_snapshots, deployment_id, opts})
    else
      []
    end
  end

  @spec replay_state_at(String.t(), non_neg_integer()) :: {:ok, map()} | {:error, term()}
  def replay_state_at(deployment_id, timestamp_ms)
      when is_binary(deployment_id) and is_integer(timestamp_ms) and timestamp_ms >= 0 do
    if enabled?() do
      GenServer.call(__MODULE__, {:replay_state_at, deployment_id, timestamp_ms})
    else
      {:error, :disabled}
    end
  end

  @impl true
  def init(_opts) do
    if enabled?() do
      dir = data_dir()
      File.mkdir_p!(dir)

      state = %{
        dir: dir,
        event_capacity: event_capacity(),
        snapshot_capacity: snapshot_capacity(),
        events: read_term(Path.join(dir, "events.bin"), %{}),
        snapshots: read_term(Path.join(dir, "snapshots.bin"), %{}),
        cursor: 0,
        snapshot_cursor: 0
      }

      cursor = max_cursor(state.events, "cursor")
      snapshot_cursor = max_cursor(state.snapshots, "snapshot_cursor")
      {:ok, %{state | cursor: cursor, snapshot_cursor: snapshot_cursor}}
    else
      {:ok,
       %{
         dir: nil,
         event_capacity: event_capacity(),
         snapshot_capacity: snapshot_capacity(),
         events: %{},
         snapshots: %{},
         cursor: 0,
         snapshot_cursor: 0
       }}
    end
  end

  @impl true
  def handle_call({:append_event, event}, _from, state) do
    event = stringify_keys(event)
    deployment_id = event["deployment_id"]

    if is_binary(deployment_id) and deployment_id != "" do
      cursor = state.cursor + 1

      entry =
        event
        |> Map.put_new("timestamp", System.system_time(:millisecond))
        |> Map.put("cursor", cursor)

      events =
        state.events
        |> Map.update(deployment_id, [entry], fn entries ->
          [entry | entries] |> Enum.take(state.event_capacity)
        end)

      next = %{state | events: events, cursor: cursor}
      persist(next)
      TimeSeriesInfluxSink.append_event(entry)
      {:reply, {:ok, cursor}, next}
    else
      {:reply, {:error, :missing_deployment_id}, state}
    end
  end

  @impl true
  def handle_call({:append_snapshot, snapshot}, _from, state) do
    snapshot = stringify_keys(snapshot)
    deployment_id = snapshot["deployment_id"]

    if is_binary(deployment_id) and deployment_id != "" do
      snapshot_cursor = state.snapshot_cursor + 1

      entry =
        snapshot
        |> Map.put_new("timestamp", System.system_time(:millisecond))
        |> Map.put("snapshot_cursor", snapshot_cursor)

      snapshots =
        state.snapshots
        |> Map.update(deployment_id, [entry], fn entries ->
          [entry | entries] |> Enum.take(state.snapshot_capacity)
        end)

      next = %{state | snapshots: snapshots, snapshot_cursor: snapshot_cursor}
      persist(next)
      TimeSeriesInfluxSink.append_snapshot(entry)
      {:reply, {:ok, snapshot_cursor}, next}
    else
      {:reply, {:error, :missing_deployment_id}, state}
    end
  end

  @impl true
  def handle_call({:list_events, deployment_id, opts}, _from, state) do
    events = query_entries(Map.get(state.events, deployment_id, []), opts)
    {:reply, events, state}
  end

  @impl true
  def handle_call({:list_snapshots, deployment_id, opts}, _from, state) do
    snapshots = query_entries(Map.get(state.snapshots, deployment_id, []), opts)
    {:reply, snapshots, state}
  end

  @impl true
  def handle_call({:replay_state_at, deployment_id, timestamp_ms}, _from, state) do
    snapshots = Map.get(state.snapshots, deployment_id, [])
    events = Map.get(state.events, deployment_id, [])

    with {:ok, replay} <-
           TimeSeriesReplay.replay_state_at(deployment_id, timestamp_ms, snapshots, events) do
      {:reply, {:ok, replay}, state}
    end
  end

  defp query_entries(entries_desc, opts) do
    order = Keyword.get(opts, :order, :desc)
    after_ts = Keyword.get(opts, :after_ts)
    before_ts = Keyword.get(opts, :before_ts)

    limit =
      case Keyword.get(opts, :limit, 200) do
        value when is_integer(value) and value > 0 -> value
        _ -> 200
      end

    base =
      case order do
        :asc -> Enum.reverse(entries_desc)
        _ -> entries_desc
      end

    base
    |> Enum.filter(fn entry ->
      ts = timestamp(entry)
      after_ok = is_nil(after_ts) or ts >= after_ts
      before_ok = is_nil(before_ts) or ts <= before_ts
      after_ok and before_ok
    end)
    |> Enum.take(max(limit, 1))
  end

  defp max_cursor(grouped_entries, key) when is_map(grouped_entries) do
    grouped_entries
    |> Map.values()
    |> List.flatten()
    |> Enum.reduce(0, fn entry, acc ->
      value = entry[key]
      if is_integer(value) and value > acc, do: value, else: acc
    end)
  end

  defp timestamp(entry) when is_map(entry) do
    value = entry["timestamp"] || entry[:timestamp]
    if is_integer(value), do: value, else: 0
  end

  defp persist(%{dir: nil}), do: :ok

  defp persist(state) do
    write_term(Path.join(state.dir, "events.bin"), state.events)
    write_term(Path.join(state.dir, "snapshots.bin"), state.snapshots)
  end

  defp data_dir do
    config = Application.get_env(:aetherium_server, __MODULE__, [])
    Keyword.get(config, :data_dir, "var/server_time_series")
  end

  defp event_capacity do
    config = Application.get_env(:aetherium_server, __MODULE__, [])
    Keyword.get(config, :event_capacity_per_deployment, @default_event_capacity)
  end

  defp snapshot_capacity do
    config = Application.get_env(:aetherium_server, __MODULE__, [])
    Keyword.get(config, :snapshot_capacity_per_deployment, @default_snapshot_capacity)
  end

  defp read_term(path, default) do
    case File.read(path) do
      {:ok, binary} ->
        try do
          :erlang.binary_to_term(binary)
        rescue
          _ -> default
        end

      _ ->
        default
    end
  end

  defp write_term(path, value) do
    tmp = path <> ".tmp"
    :ok = File.write(tmp, :erlang.term_to_binary(value, compressed: 6))
    :ok = File.rename(tmp, path)
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
end
