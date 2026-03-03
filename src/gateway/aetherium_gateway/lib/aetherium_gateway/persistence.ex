defmodule AetheriumGateway.Persistence do
  @moduledoc """
  Durable state/event/idempotency storage for gateway control-plane data.

  Uses append-safe term snapshots under a configurable directory.
  """

  use GenServer

  @type event :: map()

  @default_event_capacity 10_000

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
        event_capacity: event_capacity()
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
      {:ok, %{dir: nil, kv: %{}, commands: %{}, events: [], cursor: 0, event_capacity: event_capacity()}}
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
    next = %{state | events: events, cursor: cursor}
    persist(next)
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
    next = %{state | kv: Map.put(state.kv, key, value)}
    persist(next)
    {:noreply, next}
  end

  def handle_cast({:record_command, key, result}, state) do
    commands = Map.put(state.commands, key, stringify_keys(result))
    next = %{state | commands: commands}
    persist(next)
    {:noreply, next}
  end

  defp persist(%{dir: nil}), do: :ok

  defp persist(state) do
    write_term(Path.join(state.dir, "state.bin"), state.kv)
    write_term(Path.join(state.dir, "commands.bin"), state.commands)
    write_term(Path.join(state.dir, "events.bin"), state.events)
  end

  defp data_dir do
    config = Application.get_env(:aetherium_gateway, __MODULE__, [])
    Keyword.get(config, :data_dir, "var/gateway")
  end

  defp event_capacity do
    config = Application.get_env(:aetherium_gateway, __MODULE__, [])
    Keyword.get(config, :event_capacity, @default_event_capacity)
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
