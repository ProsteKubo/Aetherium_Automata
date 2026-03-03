defmodule AetheriumServer.ConnectorRegistry do
  @moduledoc """
  Tracks connector sessions and device attachments for observability/debugging.
  """

  use GenServer

  alias AetheriumServer.DeviceSessionRef

  @type state :: %{
          sessions: %{String.t() => map()},
          devices_by_session: %{String.t() => String.t()},
          sessions_by_device: %{String.t() => String.t()}
        }

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @spec register_session(DeviceSessionRef.t()) :: :ok
  def register_session(%DeviceSessionRef{} = session_ref) do
    GenServer.cast(__MODULE__, {:register_session, session_ref})
  end

  @spec attach_device(DeviceSessionRef.t(), String.t()) :: :ok
  def attach_device(%DeviceSessionRef{} = session_ref, device_id) when is_binary(device_id) do
    GenServer.cast(__MODULE__, {:attach_device, session_ref, device_id})
  end

  @spec detach_device(String.t()) :: :ok
  def detach_device(device_id) when is_binary(device_id) do
    GenServer.cast(__MODULE__, {:detach_device, device_id})
  end

  @spec unregister_session(DeviceSessionRef.t()) :: :ok
  def unregister_session(%DeviceSessionRef{} = session_ref) do
    GenServer.cast(__MODULE__, {:unregister_session, session_ref})
  end

  @spec lookup_session(DeviceSessionRef.t()) :: {:ok, map()} | {:error, :not_found}
  def lookup_session(%DeviceSessionRef{} = session_ref) do
    GenServer.call(__MODULE__, {:lookup_session, session_ref})
  end

  @impl true
  def init(_opts) do
    {:ok, %{sessions: %{}, devices_by_session: %{}, sessions_by_device: %{}}}
  end

  @impl true
  def handle_call({:lookup_session, session_ref}, _from, state) do
    case Map.get(state.sessions, session_key(session_ref)) do
      nil -> {:reply, {:error, :not_found}, state}
      session -> {:reply, {:ok, session}, state}
    end
  end

  @impl true
  def handle_cast({:register_session, session_ref}, state) do
    key = session_key(session_ref)

    session = %{
      connector_id: session_ref.connector_id,
      connector_type: session_ref.connector_type,
      session_id: session_ref.session_id,
      endpoint: session_ref.endpoint,
      metadata: session_ref.metadata,
      registered_at: System.system_time(:millisecond)
    }

    {:noreply, put_in(state, [:sessions, key], session)}
  end

  def handle_cast({:attach_device, session_ref, device_id}, state) do
    key = session_key(session_ref)

    state =
      state
      |> put_in([:devices_by_session, key], device_id)
      |> put_in([:sessions_by_device, device_id], key)

    {:noreply, state}
  end

  def handle_cast({:detach_device, device_id}, state) do
    case Map.pop(state.sessions_by_device, device_id) do
      {nil, _sessions_by_device} ->
        {:noreply, state}

      {session_key, sessions_by_device} ->
        state =
          state
          |> Map.put(:sessions_by_device, sessions_by_device)
          |> update_in([:devices_by_session], &Map.delete(&1, session_key))

        {:noreply, state}
    end
  end

  def handle_cast({:unregister_session, session_ref}, state) do
    key = session_key(session_ref)

    state =
      state
      |> update_in([:sessions], &Map.delete(&1, key))
      |> update_in([:devices_by_session], &Map.delete(&1, key))

    {:noreply, state}
  end

  defp session_key(%DeviceSessionRef{connector_id: connector_id, session_id: session_id}) do
    "#{connector_id}:#{session_id}"
  end
end
