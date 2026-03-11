defmodule AetheriumGateway.AutomataRegistry do
  @moduledoc """
  Registry for tracking automata definitions, deployments, and their states
  across the network. Supports weighted/probabilistic transitions, variable
  tracking, and inter-automata connections.
  """
  use GenServer
  require Logger
  alias AetheriumGateway.Persistence
  alias AetheriumGateway.CommandEnvelope
  alias AetheriumGateway.CommandDispatcher

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
          status: :pending | :deploying | :running | :paused | :stopped | :error,
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
    deploy_automata(automata_id, device_id, server_id, [])
  end

  @spec deploy_automata(automata_id(), device_id(), server_id(), keyword()) ::
          {:ok, deployment()} | {:error, term()}
  def deploy_automata(automata_id, device_id, server_id, opts) when is_list(opts) do
    GenServer.call(__MODULE__, {:deploy_automata, automata_id, device_id, server_id, opts})
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
  @spec get_device_deployment(device_id(), keyword()) :: {:ok, deployment()} | {:error, :not_found}
  def get_device_deployment(device_id, opts \\ []) when is_list(opts) do
    GenServer.call(__MODULE__, {:get_device_deployment, device_id, opts})
  end

  @doc "List all active deployments"
  @spec list_deployments() :: [deployment()]
  def list_deployments do
    GenServer.call(__MODULE__, :list_deployments)
  end

  @doc "Reconcile live deployments reported by a connected server"
  @spec reconcile_server_deployments(server_id(), [map()]) :: [deployment()]
  def reconcile_server_deployments(server_id, deployments) when is_binary(server_id) do
    GenServer.call(__MODULE__, {:reconcile_server_deployments, server_id, deployments})
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
    default = %{
      # automata_id => automata
      automata: %{},
      # {automata_id, device_id} => deployment
      deployments: %{},
      # device_id => [{timestamp, from, to, transition_id, metadata}]
      transition_history: %{},
      # {automata_id, from_state, transition_id} => count
      transition_counts: %{}
    }

    state = Persistence.load_state("automata_registry_state", default)
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
      persist_state(new_state)
      append_event("automata_registered", %{automata_id: automata_id, name: automata.name})

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
        persist_state(new_state)
        append_event("automata_updated", %{automata_id: automata_id})

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

      next = %{state | automata: new_automata}
      persist_state(next)
      append_event("automata_deleted", %{automata_id: automata_id})
      {:reply, :ok, next}
    end
  end

  @impl true
  def handle_call({:deploy_automata, automata_id, device_id, server_id}, from, state) do
    handle_call({:deploy_automata, automata_id, device_id, server_id, []}, from, state)
  end

  @impl true
  def handle_call({:deploy_automata, automata_id, device_id, server_id, opts}, _from, state) do
    case Map.get(state.automata, automata_id) do
      nil ->
        {:reply, {:error, :automata_not_found}, state}

      automata ->
        deployment = %{
          automata_id: automata_id,
          device_id: device_id,
          server_id: server_id,
          status: :pending,
          created_at: DateTime.utc_now(),
          updated_at: DateTime.utc_now(),
          deployed_at: nil,
          current_state: nil,
          variables: initialize_variables(automata.variables),
          error: nil
        }

        key = {automata_id, device_id}
        new_state = put_in(state, [:deployments, key], deployment)

        Logger.info("Deploying automata #{automata_id} to device #{device_id} via server #{server_id}")
        broadcast_deployment_update(deployment)
        persist_state(new_state)
        append_event("deployment_requested", %{automata_id: automata_id, device_id: device_id, server_id: server_id})

        if Keyword.get(opts, :dispatch, true) do
          # Trigger actual deployment via server
          send_deployment_to_server(server_id, automata, device_id)
        end

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
  def handle_call({:get_device_deployment, device_id}, from, state) do
    handle_call({:get_device_deployment, device_id, []}, from, state)
  end

  @impl true
  def handle_call({:get_device_deployment, device_id, opts}, _from, state) do
    candidates =
      state.deployments
      |> Enum.filter(fn {{automata_id, did}, dep} ->
        did == device_id and deployment_matches_opts?(automata_id, dep, opts)
      end)

    case select_best_deployment(candidates) do
      nil -> {:reply, {:error, :not_found}, state}
      {_key, dep} -> {:reply, {:ok, dep}, state}
    end
  end

  @impl true
  def handle_call(:list_deployments, _from, state) do
    {:reply, Map.values(state.deployments), state}
  end

  @impl true
  def handle_call({:reconcile_server_deployments, server_id, live_deployments}, _from, state) do
    normalized =
      live_deployments
      |> Enum.map(&normalize_live_deployment(server_id, &1))
      |> Enum.reject(&is_nil/1)

    live_keys =
      normalized
      |> Enum.map(&{&1.automata_id, &1.device_id})
      |> MapSet.new()

    server_keys =
      state.deployments
      |> Enum.filter(fn {_key, dep} -> deployment_field(dep, :server_id) == server_id end)
      |> Enum.map(&elem(&1, 0))

    reconciled_state =
      Enum.reduce(normalized, state, fn deployment, acc ->
        upsert_reconciled_deployment(acc, deployment)
      end)

    reconciled_state =
      Enum.reduce(server_keys, reconciled_state, fn key, acc ->
        if MapSet.member?(live_keys, key) do
          acc
        else
          mark_reconciled_deployment_stale(acc, key)
        end
      end)

    if reconciled_state != state do
      persist_state(reconciled_state)

      append_event("deployment_inventory_reconciled", %{
        server_id: server_id,
        count: length(normalized)
      })
    end

    {:reply, Map.values(reconciled_state.deployments), reconciled_state}
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
            |> Map.put(:updated_at, DateTime.utc_now())
            |> Map.merge(extras)
            |> maybe_set_deployed_at(status)

          broadcast_deployment_update(updated)
          next = put_in(state, [:deployments, key], updated)
          persist_state(next)
          append_event("deployment_status", %{automata_id: automata_id, device_id: device_id, status: status, extras: extras})
          next
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
            |> Map.put(:updated_at, DateTime.utc_now())
            |> Map.put(:variables, variables)

          broadcast_device_state_update(device_id, current_state, variables)
          next = put_in(state, [:deployments, key], updated)
          persist_state(next)
          append_event("device_state", %{device_id: device_id, current_state: current_state})
          next
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
    persist_state(new_state)
    append_event("transition_recorded", %{device_id: device_id, from: from_state, to: to_state, transition_id: transition_id, metadata: metadata})

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

  defp deployment_matches_opts?(automata_id, deployment, opts) do
    matches_automata? =
      case Keyword.get(opts, :automata_id) do
        nil -> true
        expected -> expected == automata_id
      end

    matches_server? =
      case Keyword.get(opts, :server_id) do
        nil -> true
        expected -> expected == deployment_field(deployment, :server_id)
      end

    matches_automata? and matches_server?
  end

  defp select_best_deployment([]), do: nil

  defp select_best_deployment(candidates) do
    Enum.max_by(candidates, fn {{automata_id, _device_id}, dep} ->
      status = deployment_field(dep, :status, :pending)
      {deployment_status_rank(status), deployment_timestamp(dep), automata_id}
    end)
  end

  defp deployment_timestamp(dep) do
    dep
    |> deployment_field(:updated_at)
    |> case do
      nil ->
        dep
        |> deployment_field(:deployed_at)
        |> case do
          nil -> deployment_field(dep, :created_at)
          value -> value
        end

      value ->
        value
    end
    |> normalize_timestamp()
  end

  defp deployment_status_rank(:running), do: 6
  defp deployment_status_rank(:paused), do: 5
  defp deployment_status_rank(:deploying), do: 4
  defp deployment_status_rank(:pending), do: 3
  defp deployment_status_rank(:stopped), do: 2
  defp deployment_status_rank(:error), do: 1
  defp deployment_status_rank("running"), do: 6
  defp deployment_status_rank("paused"), do: 5
  defp deployment_status_rank("deploying"), do: 4
  defp deployment_status_rank("pending"), do: 3
  defp deployment_status_rank("stopped"), do: 2
  defp deployment_status_rank("error"), do: 1
  defp deployment_status_rank(_), do: 0

  defp deployment_field(dep, key, default \\ nil) when is_map(dep) and is_atom(key) do
    Map.get(dep, key, Map.get(dep, Atom.to_string(key), default))
  end

  defp normalize_timestamp(%DateTime{} = dt), do: DateTime.to_unix(dt, :millisecond)

  defp normalize_timestamp(%NaiveDateTime{} = dt) do
    dt
    |> DateTime.from_naive!("Etc/UTC")
    |> DateTime.to_unix(:millisecond)
  end

  defp normalize_timestamp(value) when is_integer(value), do: value

  defp normalize_timestamp(value) when is_binary(value) do
    case DateTime.from_iso8601(value) do
      {:ok, dt, _offset} -> DateTime.to_unix(dt, :millisecond)
      _ -> 0
    end
  end

  defp normalize_timestamp(_), do: 0

  defp normalize_live_deployment(server_id, deployment) when is_map(deployment) do
    automata_id = deployment_field(deployment, :automata_id)
    device_id = deployment_field(deployment, :device_id)

    cond do
      !is_binary(automata_id) or automata_id == "" ->
        nil

      !is_binary(device_id) or device_id == "" ->
        nil

      true ->
        %{
          automata_id: automata_id,
          device_id: device_id,
          server_id: server_id,
          status: normalize_live_status(deployment_field(deployment, :status, :stopped)),
          deployed_at:
            deployment_field(deployment, :deployed_at) ||
              deployment_field(deployment, :updated_at) ||
              DateTime.utc_now(),
          created_at: deployment_field(deployment, :created_at, DateTime.utc_now()),
          updated_at: DateTime.utc_now(),
          current_state: deployment_field(deployment, :current_state),
          variables: deployment_field(deployment, :variables, %{}),
          error: deployment_field(deployment, :error)
        }
    end
  end

  defp normalize_live_deployment(_server_id, _deployment), do: nil

  defp normalize_live_status(status)
       when status in [:pending, :deploying, :running, :paused, :stopped, :error],
       do: status

  defp normalize_live_status("pending"), do: :pending
  defp normalize_live_status("deploying"), do: :deploying
  defp normalize_live_status("running"), do: :running
  defp normalize_live_status("paused"), do: :paused
  defp normalize_live_status("stopped"), do: :stopped
  defp normalize_live_status("error"), do: :error
  defp normalize_live_status(_), do: :stopped

  defp upsert_reconciled_deployment(state, deployment) do
    key = {deployment.automata_id, deployment.device_id}

    updated =
      state.deployments
      |> Map.get(key, %{
        automata_id: deployment.automata_id,
        device_id: deployment.device_id,
        server_id: deployment.server_id,
        created_at: deployment.created_at,
        deployed_at: nil,
        current_state: nil,
        variables: %{},
        error: nil,
        status: :pending
      })
      |> Map.merge(deployment)
      |> maybe_set_deployed_at(deployment.status)

    if Map.get(state.deployments, key) != updated do
      broadcast_deployment_update(updated)
    end

    put_in(state, [:deployments, key], updated)
  end

  defp mark_reconciled_deployment_stale(state, key) do
    case Map.get(state.deployments, key) do
      nil ->
        state

      deployment ->
        updated =
          deployment
          |> Map.put(:status, :stopped)
          |> Map.put(:current_state, nil)
          |> Map.put(:updated_at, DateTime.utc_now())

        if deployment != updated do
          broadcast_deployment_update(updated)
        end

        put_in(state, [:deployments, key], updated)
    end
  end

  defp send_deployment_to_server(server_id, automata, device_id) do
    payload = %{"automata_id" => automata.id, "device_id" => device_id, "automata" => automata}

    case CommandEnvelope.from_payload("deploy_automata", payload, %{"role" => "system", "source" => "automata_registry"}) do
      {:ok, envelope} ->
        CommandDispatcher.dispatch(server_id, "deploy_automata", payload, envelope)

      {:error, reason} ->
        Logger.error("Cannot dispatch deployment envelope: #{inspect(reason)}")
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

  defp persist_state(state) do
    Persistence.save_state("automata_registry_state", state)
  end

  defp append_event(kind, data) do
    Persistence.append_event(%{kind: kind, source: "automata_registry", data: data})
  end
end
