defmodule AetheriumGateway.Persistence do
  @moduledoc """
  Durable state/event/idempotency storage for gateway control-plane data.

  Uses append-safe term snapshots under a configurable directory.
  """

  use GenServer

  @type event :: map()

  @default_event_capacity 10_000
  @default_flush_interval_ms 200

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @spec enabled?() :: boolean()
  def enabled? do
    config = Application.get_env(:aetherium_gateway, __MODULE__, [])
    Keyword.get(config, :enabled, true)
  end

  @spec load_state(String.t(), term()) :: term()
  def load_state(key, default) do
    if enabled?() do
      GenServer.call(__MODULE__, {:load_state, key, default})
    else
      default
    end
  end

  @spec save_state(String.t(), term()) :: :ok
  def save_state(key, value) do
    if enabled?() do
      GenServer.cast(__MODULE__, {:save_state, key, value})
    end

    :ok
  end

  @spec fetch_command(String.t()) :: {:ok, map()} | :not_found
  def fetch_command(idempotency_key) do
    if enabled?() do
      GenServer.call(__MODULE__, {:fetch_command, idempotency_key})
    else
      :not_found
    end
  end

  @spec record_command(String.t(), map()) :: :ok
  def record_command(idempotency_key, result) do
    if enabled?() do
      GenServer.cast(__MODULE__, {:record_command, idempotency_key, result})
    end

    :ok
  end

  @spec append_event(event()) :: non_neg_integer()
  def append_event(event) do
    if enabled?() do
      GenServer.call(__MODULE__, {:append_event, event})
    else
      0
    end
  end

  @spec list_events(non_neg_integer(), pos_integer()) :: [event()]
  def list_events(cursor \\ 0, limit \\ 100) do
    if enabled?() do
      GenServer.call(__MODULE__, {:list_events, cursor, limit})
    else
      []
    end
  end

  @spec list_recent_events(pos_integer()) :: [event()]
  def list_recent_events(limit \\ 100) do
    if enabled?() do
      GenServer.call(__MODULE__, {:list_recent_events, limit})
    else
      []
    end
  end

  @impl true
  def init(_opts) do
    if enabled?() do
      dir = data_dir()
      File.mkdir_p!(dir)

      state = %{
        dir: dir,
        kv: read_term(Path.join(dir, "state.bin"), %{}),
        commands: read_term(Path.join(dir, "commands.bin"), %{}),
        events: read_term(Path.join(dir, "events.bin"), []),
        cursor: 0,
        event_capacity: event_capacity(),
        flush_interval_ms: flush_interval_ms(),
        dirty: MapSet.new(),
        flush_timer_ref: nil,
        flush_inflight: false,
        pending_flush: false,
        flush_generation: 0
      }

      # Rebuild cursor from persisted events.
      cursor =
        state.events
        |> List.last()
        |> case do
          %{"cursor" => c} when is_integer(c) -> c
          _ -> 0
        end

      {:ok, %{state | cursor: cursor}}
    else
      {:ok,
       %{
         dir: nil,
         kv: %{},
         commands: %{},
         events: [],
         cursor: 0,
         event_capacity: event_capacity(),
         flush_interval_ms: flush_interval_ms(),
         dirty: MapSet.new(),
         flush_timer_ref: nil,
         flush_inflight: false,
         pending_flush: false,
         flush_generation: 0
       }}
    end
  end

  @impl true
  def handle_call({:load_state, key, default}, _from, state) do
    value = Map.get(state.kv, key, default)
    {:reply, value, state}
  end

  def handle_call({:fetch_command, key}, _from, state) do
    case Map.get(state.commands, key) do
      nil -> {:reply, :not_found, state}
      result -> {:reply, {:ok, result}, state}
    end
  end

  def handle_call({:append_event, event}, _from, state) do
    cursor = state.cursor + 1

    entry =
      event
      |> stringify_keys()
      |> Map.put_new("timestamp", System.system_time(:millisecond))
      |> Map.put("cursor", cursor)

    events = [entry | state.events] |> Enum.take(state.event_capacity)

    next =
      state
      |> Map.put(:events, events)
      |> Map.put(:cursor, cursor)
      |> mark_dirty(:events)
      |> schedule_flush()

    {:reply, cursor, next}
  end

  def handle_call({:list_events, cursor, limit}, _from, state) do
    events =
      state.events
      |> Enum.reverse()
      |> Enum.filter(fn %{"cursor" => c} -> c > cursor end)
      |> Enum.take(max(limit, 1))

    {:reply, events, state}
  end

  def handle_call({:list_recent_events, limit}, _from, state) do
    events =
      state.events
      |> Enum.take(max(limit, 1))
      |> Enum.reverse()

    {:reply, events, state}
  end

  @impl true
  def handle_cast({:save_state, key, value}, state) do
    next =
      state
      |> Map.put(:kv, Map.put(state.kv, key, value))
      |> mark_dirty(:kv)
      |> schedule_flush()

    {:noreply, next}
  end

  def handle_cast({:record_command, key, result}, state) do
    commands = Map.put(state.commands, key, stringify_keys(result))

    next =
      state
      |> Map.put(:commands, commands)
      |> mark_dirty(:commands)
      |> schedule_flush()

    {:noreply, next}
  end

  @impl true
  def handle_info(:flush_persist, %{flush_inflight: true} = state) do
    {:noreply, %{state | flush_timer_ref: nil, pending_flush: true}}
  end

  def handle_info(:flush_persist, state) do
    dirty = state.dirty

    if MapSet.size(dirty) == 0 or is_nil(state.dir) do
      {:noreply, %{state | flush_timer_ref: nil, pending_flush: false}}
    else
      snapshot = %{dir: state.dir, kv: state.kv, commands: state.commands, events: state.events}
      generation = state.flush_generation + 1
      owner = self()

      Task.start(fn ->
        persist_snapshot(snapshot, dirty)
        send(owner, {:flush_complete, generation})
      end)

      {:noreply,
       %{
         state
         | flush_timer_ref: nil,
           dirty: MapSet.new(),
           flush_inflight: true,
           pending_flush: false,
           flush_generation: generation
       }}
    end
  end

  def handle_info({:flush_complete, generation}, %{flush_generation: generation} = state) do
    next = %{state | flush_inflight: false}

    if next.pending_flush or MapSet.size(next.dirty) > 0 do
      {:noreply, schedule_flush(%{next | pending_flush: false})}
    else
      {:noreply, next}
    end
  end

  def handle_info({:flush_complete, _generation}, state), do: {:noreply, state}

  defp persist_snapshot(%{dir: nil}, _dirty), do: :ok

  defp persist_snapshot(snapshot, dirty) do
    if MapSet.member?(dirty, :kv) do
      write_term(Path.join(snapshot.dir, "state.bin"), snapshot.kv)
    end

    if MapSet.member?(dirty, :commands) do
      write_term(Path.join(snapshot.dir, "commands.bin"), snapshot.commands)
    end

    if MapSet.member?(dirty, :events) do
      write_term(Path.join(snapshot.dir, "events.bin"), snapshot.events)
    end
  end

  defp data_dir do
    config = Application.get_env(:aetherium_gateway, __MODULE__, [])
    Keyword.get(config, :data_dir, "var/gateway")
  end

  defp event_capacity do
    config = Application.get_env(:aetherium_gateway, __MODULE__, [])
    Keyword.get(config, :event_capacity, @default_event_capacity)
  end

  defp flush_interval_ms do
    config = Application.get_env(:aetherium_gateway, __MODULE__, [])
    Keyword.get(config, :flush_interval_ms, @default_flush_interval_ms)
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

  defp mark_dirty(state, field) do
    %{state | dirty: MapSet.put(state.dirty, field)}
  end

  defp schedule_flush(%{dir: nil} = state), do: state

  defp schedule_flush(%{flush_inflight: true} = state) do
    %{state | pending_flush: true}
  end

  defp schedule_flush(%{flush_timer_ref: nil} = state) do
    ref = Process.send_after(self(), :flush_persist, state.flush_interval_ms)
    %{state | flush_timer_ref: ref}
  end

  defp schedule_flush(state), do: state

  defp stringify_keys(%_{} = struct) do
    struct
  end

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
