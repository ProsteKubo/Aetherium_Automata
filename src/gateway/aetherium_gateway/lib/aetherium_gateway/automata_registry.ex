defmodule AetheriumGateway.AutomataRegistry do
  @moduledoc """
  Registry for tracking automata definitions, deployments, and their states
  across the network. Supports weighted/probabilistic transitions, variable
  tracking, and inter-automata connections.
  """
  use GenServer
  require Logger

  # ============================================================================
  # Types
  # ============================================================================

  @type automata_id :: String.t()
  @type device_id :: String.t()
  @type server_id :: String.t()
  @type variable_name :: String.t()

  @type transition_type :: :classic | :timed | :event | :probabilistic | :immediate

  @type variable_spec :: %{
          id: String.t(),
          name: String.t(),
          type: String.t(),
          direction: :input | :output | :internal,
          default: any()
        }

  @type transition :: %{
          id: String.t(),
          from: String.t(),
          to: String.t(),
          type: transition_type(),
          condition: String.t() | nil,
          priority: integer(),
          weight: integer() | nil,
          timed: map() | nil,
          event: map() | nil
        }

  @type state_def :: %{
          id: String.t(),
          name: String.t(),
          type: :normal | :initial | :final,
          on_enter: String.t() | nil,
          on_exit: String.t() | nil,
          on_tick: String.t() | nil
        }

  @type automata :: %{
          id: automata_id(),
          name: String.t(),
          description: String.t() | nil,
          version: String.t(),
          states: %{String.t() => state_def()},
          transitions: %{String.t() => transition()},
          variables: [variable_spec()],
          inputs: [String.t()],
          outputs: [String.t()],
          created_at: DateTime.t(),
          updated_at: DateTime.t()
        }

  @type deployment :: %{
          automata_id: automata_id(),
          device_id: device_id(),
          server_id: server_id(),
          status: :pending | :deploying | :running | :stopped | :error,
          deployed_at: DateTime.t() | nil,
          current_state: String.t() | nil,
          variables: map(),
          error: String.t() | nil
        }

  # ============================================================================
  # API
  # ============================================================================

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @doc "Register a new automata definition"
  @spec register_automata(automata()) :: :ok | {:error, term()}
  def register_automata(automata) do
    GenServer.call(__MODULE__, {:register_automata, automata})
  end

  @doc "Update an existing automata definition"
  @spec update_automata(automata_id(), map()) :: :ok | {:error, term()}
  def update_automata(automata_id, updates) do
    GenServer.call(__MODULE__, {:update_automata, automata_id, updates})
  end

  @doc "Get automata by ID"
  @spec get_automata(automata_id()) :: {:ok, automata()} | {:error, :not_found}
  def get_automata(automata_id) do
    GenServer.call(__MODULE__, {:get_automata, automata_id})
  end

  @doc "List all registered automata"
  @spec list_automata() :: [automata()]
  def list_automata do
    GenServer.call(__MODULE__, :list_automata)
  end

  @doc "Delete automata"
  @spec delete_automata(automata_id()) :: :ok | {:error, term()}
  def delete_automata(automata_id) do
    GenServer.call(__MODULE__, {:delete_automata, automata_id})
  end

  @doc "Deploy automata to a device"
  @spec deploy_automata(automata_id(), device_id(), server_id()) :: {:ok, deployment()} | {:error, term()}
  def deploy_automata(automata_id, device_id, server_id) do
    GenServer.call(__MODULE__, {:deploy_automata, automata_id, device_id, server_id})
  end

  @doc "Update deployment status"
  @spec update_deployment_status(automata_id(), device_id(), atom(), map()) :: :ok
  def update_deployment_status(automata_id, device_id, status, extras \\ %{}) do
    GenServer.cast(__MODULE__, {:update_deployment_status, automata_id, device_id, status, extras})
  end

  @doc "Get all deployments for an automata"
  @spec get_deployments(automata_id()) :: [deployment()]
  def get_deployments(automata_id) do
    GenServer.call(__MODULE__, {:get_deployments, automata_id})
  end

  @doc "Get deployment for a specific device"
  @spec get_device_deployment(device_id()) :: {:ok, deployment()} | {:error, :not_found}
  def get_device_deployment(device_id) do
    GenServer.call(__MODULE__, {:get_device_deployment, device_id})
  end

  @doc "List all active deployments"
  @spec list_deployments() :: [deployment()]
  def list_deployments do
    GenServer.call(__MODULE__, :list_deployments)
  end

  @doc "Update device state (current automata state, variables)"
  @spec update_device_state(device_id(), String.t(), map()) :: :ok
  def update_device_state(device_id, current_state, variables) do
    GenServer.cast(__MODULE__, {:update_device_state, device_id, current_state, variables})
  end

  @doc "Record a state transition event"
  @spec record_transition(device_id(), String.t(), String.t(), String.t(), map()) :: :ok
  def record_transition(device_id, from_state, to_state, transition_id, metadata \\ %{}) do
    GenServer.cast(__MODULE__, {:record_transition, device_id, from_state, to_state, transition_id, metadata})
  end

  @doc "Get transition history for a device"
  @spec get_transition_history(device_id(), integer()) :: [map()]
  def get_transition_history(device_id, limit \\ 100) do
    GenServer.call(__MODULE__, {:get_transition_history, device_id, limit})
  end

  @doc "Get probabilistic transition statistics"
  @spec get_transition_stats(automata_id(), String.t()) :: map()
  def get_transition_stats(automata_id, from_state) do
    GenServer.call(__MODULE__, {:get_transition_stats, automata_id, from_state})
  end

  # ============================================================================
  # GenServer Callbacks
  # ============================================================================

  @impl true
  def init(_opts) do
    state = %{
      # automata_id => automata
      automata: %{},
      # {automata_id, device_id} => deployment
      deployments: %{},
      # device_id => [{timestamp, from, to, transition_id, metadata}]
      transition_history: %{},
      # {automata_id, from_state, transition_id} => count
      transition_counts: %{}
    }

    {:ok, state}
  end

  @impl true
  def handle_call({:register_automata, automata}, _from, state) do
    automata_id = automata.id

    if Map.has_key?(state.automata, automata_id) do
      {:reply, {:error, :already_exists}, state}
    else
      automata =
        automata
        |> Map.put(:created_at, DateTime.utc_now())
        |> Map.put(:updated_at, DateTime.utc_now())

      new_state = put_in(state, [:automata, automata_id], automata)

      Logger.info("Registered automata: #{automata.name} (#{automata_id})")
      broadcast_automata_update(:registered, automata)

      {:reply, :ok, new_state}
    end
  end

  @impl true
  def handle_call({:update_automata, automata_id, updates}, _from, state) do
    case Map.get(state.automata, automata_id) do
      nil ->
        {:reply, {:error, :not_found}, state}

      existing ->
        updated =
          existing
          |> Map.merge(updates)
          |> Map.put(:updated_at, DateTime.utc_now())

        new_state = put_in(state, [:automata, automata_id], updated)

        Logger.info("Updated automata: #{automata_id}")
        broadcast_automata_update(:updated, updated)

        {:reply, :ok, new_state}
    end
  end

  @impl true
  def handle_call({:get_automata, automata_id}, _from, state) do
    case Map.get(state.automata, automata_id) do
      nil -> {:reply, {:error, :not_found}, state}
      automata -> {:reply, {:ok, automata}, state}
    end
  end

  @impl true
  def handle_call(:list_automata, _from, state) do
    {:reply, Map.values(state.automata), state}
  end

  @impl true
  def handle_call({:delete_automata, automata_id}, _from, state) do
    # Check for active deployments
    active_deployments =
      state.deployments
      |> Enum.filter(fn {{aid, _did}, dep} ->
        aid == automata_id and dep.status in [:running, :deploying]
      end)

    if length(active_deployments) > 0 do
      {:reply, {:error, :has_active_deployments}, state}
    else
      {deleted, new_automata} = Map.pop(state.automata, automata_id)

      if deleted do
        Logger.info("Deleted automata: #{automata_id}")
        broadcast_automata_update(:deleted, %{id: automata_id})
      end

      {:reply, :ok, %{state | automata: new_automata}}
    end
  end

  @impl true
  def handle_call({:deploy_automata, automata_id, device_id, server_id}, _from, state) do
    case Map.get(state.automata, automata_id) do
      nil ->
        {:reply, {:error, :automata_not_found}, state}

      automata ->
        deployment = %{
          automata_id: automata_id,
          device_id: device_id,
          server_id: server_id,
          status: :pending,
          deployed_at: nil,
          current_state: nil,
          variables: initialize_variables(automata.variables),
          error: nil
        }

        key = {automata_id, device_id}
        new_state = put_in(state, [:deployments, key], deployment)

        Logger.info("Deploying automata #{automata_id} to device #{device_id} via server #{server_id}")
        broadcast_deployment_update(deployment)

        # Trigger actual deployment via server
        send_deployment_to_server(server_id, automata, device_id)

        {:reply, {:ok, deployment}, new_state}
    end
  end

  @impl true
  def handle_call({:get_deployments, automata_id}, _from, state) do
    deployments =
      state.deployments
      |> Enum.filter(fn {{aid, _did}, _dep} -> aid == automata_id end)
      |> Enum.map(fn {_key, dep} -> dep end)

    {:reply, deployments, state}
  end

  @impl true
  def handle_call({:get_device_deployment, device_id}, _from, state) do
    deployment =
      state.deployments
      |> Enum.find(fn {{_aid, did}, _dep} -> did == device_id end)

    case deployment do
      nil -> {:reply, {:error, :not_found}, state}
      {_key, dep} -> {:reply, {:ok, dep}, state}
    end
  end

  @impl true
  def handle_call(:list_deployments, _from, state) do
    {:reply, Map.values(state.deployments), state}
  end

  @impl true
  def handle_call({:get_transition_history, device_id, limit}, _from, state) do
    history =
      state.transition_history
      |> Map.get(device_id, [])
      |> Enum.take(limit)

    {:reply, history, state}
  end

  @impl true
  def handle_call({:get_transition_stats, automata_id, from_state}, _from, state) do
    stats =
      state.transition_counts
      |> Enum.filter(fn {{aid, fs, _tid}, _count} ->
        aid == automata_id and fs == from_state
      end)
      |> Enum.map(fn {{_aid, _fs, tid}, count} -> {tid, count} end)
      |> Enum.into(%{})

    {:reply, stats, state}
  end

  @impl true
  def handle_cast({:update_deployment_status, automata_id, device_id, status, extras}, state) do
    key = {automata_id, device_id}

    new_state =
      case Map.get(state.deployments, key) do
        nil ->
          state

        deployment ->
          updated =
            deployment
            |> Map.put(:status, status)
            |> Map.merge(extras)
            |> maybe_set_deployed_at(status)

          broadcast_deployment_update(updated)
          put_in(state, [:deployments, key], updated)
      end

    {:noreply, new_state}
  end

  @impl true
  def handle_cast({:update_device_state, device_id, current_state, variables}, state) do
    # Find deployment for this device
    deployment_entry =
      Enum.find(state.deployments, fn {{_aid, did}, _dep} -> did == device_id end)

    new_state =
      case deployment_entry do
        nil ->
          state

        {key, deployment} ->
          updated =
            deployment
            |> Map.put(:current_state, current_state)
            |> Map.put(:variables, variables)

          broadcast_device_state_update(device_id, current_state, variables)
          put_in(state, [:deployments, key], updated)
      end

    {:noreply, new_state}
  end

  @impl true
  def handle_cast({:record_transition, device_id, from_state, to_state, transition_id, metadata}, state) do
    # Record in history
    entry = %{
      timestamp: DateTime.utc_now(),
      from: from_state,
      to: to_state,
      transition_id: transition_id,
      metadata: metadata
    }

    history = Map.get(state.transition_history, device_id, [])
    # Keep last 1000 entries
    new_history = [entry | Enum.take(history, 999)]

    new_state = put_in(state, [:transition_history, device_id], new_history)

    # Update counts for probabilistic statistics
    deployment_entry =
      Enum.find(state.deployments, fn {{_aid, did}, _dep} -> did == device_id end)

    new_state =
      case deployment_entry do
        nil ->
          new_state

        {{automata_id, _}, _} ->
          count_key = {automata_id, from_state, transition_id}
          current_count = Map.get(new_state.transition_counts, count_key, 0)
          put_in(new_state, [:transition_counts, count_key], current_count + 1)
      end

    # Broadcast
    broadcast_transition_event(device_id, from_state, to_state, transition_id, metadata)

    {:noreply, new_state}
  end

  # ============================================================================
  # Private Functions
  # ============================================================================

  defp initialize_variables(variable_specs) do
    variable_specs
    |> Enum.map(fn spec -> {spec.name, spec[:default]} end)
    |> Enum.into(%{})
  end

  defp maybe_set_deployed_at(deployment, :running) do
    if is_nil(deployment.deployed_at) do
      Map.put(deployment, :deployed_at, DateTime.utc_now())
    else
      deployment
    end
  end

  defp maybe_set_deployed_at(deployment, _status), do: deployment

  defp send_deployment_to_server(server_id, automata, device_id) do
    case AetheriumGateway.ServerTracker.get_server_pid(server_id) do
      {:ok, pid} ->
        send(pid, {:deploy_automata, automata, device_id})

      {:error, :not_found} ->
        Logger.error("Cannot deploy: server #{server_id} not connected")
    end
  end

  defp broadcast_automata_update(event, automata) do
    AetheriumGatewayWeb.Endpoint.broadcast!(
      "gateway:control",
      "automata_#{event}",
      %{automata: automata}
    )
  end

  defp broadcast_deployment_update(deployment) do
    AetheriumGatewayWeb.Endpoint.broadcast!(
      "gateway:control",
      "deployment_update",
      %{deployment: deployment}
    )
  end

  defp broadcast_device_state_update(device_id, current_state, variables) do
    AetheriumGatewayWeb.Endpoint.broadcast!(
      "gateway:control",
      "device_state",
      %{
        device_id: device_id,
        current_state: current_state,
        variables: variables,
        timestamp: DateTime.utc_now()
      }
    )
  end

  defp broadcast_transition_event(device_id, from_state, to_state, transition_id, metadata) do
    AetheriumGatewayWeb.Endpoint.broadcast!(
      "gateway:control",
      "transition",
      %{
        device_id: device_id,
        from: from_state,
        to: to_state,
        transition_id: transition_id,
        metadata: metadata,
        timestamp: DateTime.utc_now()
      }
    )
  end
end
