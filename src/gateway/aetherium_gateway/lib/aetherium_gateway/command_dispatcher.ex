defmodule AetheriumGateway.CommandDispatcher do
  @moduledoc """
  Routes commands from gateway control-plane to connected server channels.

  Includes a durable outbox to replay commands when servers reconnect.
  """

  use GenServer
  require Logger

  alias AetheriumGateway.Persistence

  @outbox_key "gateway_outbox"

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @spec dispatch(String.t(), String.t(), map(), map()) :: :ok
  def dispatch(server_id, event, payload, envelope)
      when is_binary(server_id) and is_binary(event) and is_map(payload) and is_map(envelope) do
    GenServer.cast(__MODULE__, {:dispatch, server_id, event, payload, envelope})
  end

  @spec server_connected(String.t()) :: :ok
  def server_connected(server_id) when is_binary(server_id) do
    GenServer.cast(__MODULE__, {:server_connected, server_id})
  end

  @spec outbox_size() :: non_neg_integer()
  def outbox_size do
    GenServer.call(__MODULE__, :outbox_size)
  end

  @impl true
  def init(_opts) do
    outbox = Persistence.load_state(@outbox_key, %{})
    {:ok, %{outbox: outbox}}
  end

  @impl true
  def handle_cast({:dispatch, server_id, event, payload, envelope}, state) do
    case AetheriumGateway.ServerTracker.get_server_pid(server_id) do
      {:ok, pid} when is_pid(pid) ->
        send(pid, {:dispatch_command, event, payload, envelope})
        {:noreply, state}

      _ ->
        Logger.warning("Queueing command for offline server #{server_id}: #{event}")
        queued = %{"event" => event, "payload" => payload, "envelope" => envelope}

        next =
          update_in(state.outbox, [server_id], fn
            nil -> [queued]
            list -> list ++ [queued]
          end)

        Persistence.save_state(@outbox_key, next)
        state = %{state | outbox: next}
        {:noreply, state}
    end
  end

  def handle_cast({:server_connected, server_id}, state) do
    queue = Map.get(state.outbox, server_id, [])

    if queue != [] do
      case AetheriumGateway.ServerTracker.get_server_pid(server_id) do
        {:ok, pid} when is_pid(pid) ->
          Enum.each(queue, fn cmd ->
            send(pid, {:dispatch_command, cmd["event"], cmd["payload"], cmd["envelope"]})
          end)

          Logger.info("Flushed #{length(queue)} queued commands to server #{server_id}")

          next = Map.delete(state.outbox, server_id)
          Persistence.save_state(@outbox_key, next)
          {:noreply, %{state | outbox: next}}

        _ ->
          {:noreply, state}
      end
    else
      {:noreply, state}
    end
  end

  @impl true
  def handle_call(:outbox_size, _from, state) do
    size =
      state.outbox
      |> Map.values()
      |> Enum.map(&length/1)
      |> Enum.sum()

    {:reply, size, state}
  end
end
