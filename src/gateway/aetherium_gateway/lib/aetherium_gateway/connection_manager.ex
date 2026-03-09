defmodule AetheriumGateway.ConnectionManager do
  @moduledoc """
  Manages inter-automata connections and I/O bindings.

  Handles:
  - Input/output bindings between automata
  - Event routing between connected automata
  - Connection validation (type matching, cycle detection)
  - Real-time I/O value propagation
  """

  use GenServer
  require Logger

  alias AetheriumGateway.AutomataRegistry
  alias AetheriumGateway.Persistence

  # ============================================================================
  # Types
  # ============================================================================

  @type connection_id :: String.t()
  @type automata_id :: String.t()
  @type variable_name :: String.t()

  @type connection :: %{
          id: connection_id(),
          source_automata: automata_id(),
          source_output: variable_name(),
          target_automata: automata_id(),
          target_input: variable_name(),
          transform: String.t() | nil,
          enabled: boolean(),
          binding_type: atom() | nil,
          created_at: integer(),
          runtime: map()
        }

  @type state :: %{
          connections: %{connection_id() => connection()},
          # Index: source automata -> list of connections
          by_source: %{automata_id() => [connection_id()]},
          # Index: target automata -> list of connections
          by_target: %{automata_id() => [connection_id()]},
          # Current propagated values
          values: %{{automata_id(), variable_name()} => any()},
          # Event subscriptions
          event_routes: %{String.t() => [{automata_id(), String.t()}]}
        }

  # ============================================================================
  # Public API
  # ============================================================================

  @doc "Start the connection manager"
  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @doc "Create a new connection between automata"
  @spec create_connection(map()) :: {:ok, connection()} | {:error, term()}
  def create_connection(params) do
    GenServer.call(__MODULE__, {:create_connection, normalize_connection_params(params)})
  end

  @doc "Update an existing connection"
  @spec update_connection(connection_id(), map()) :: {:ok, connection()} | {:error, term()}
  def update_connection(id, params) do
    GenServer.call(__MODULE__, {:update_connection, id, normalize_connection_params(params)})
  end

  @doc "Delete a connection"
  @spec delete_connection(connection_id()) :: :ok | {:error, term()}
  def delete_connection(id) do
    GenServer.call(__MODULE__, {:delete_connection, id})
  end

  @doc "Get a connection by ID"
  @spec get_connection(connection_id()) :: {:ok, connection()} | {:error, :not_found}
  def get_connection(id) do
    GenServer.call(__MODULE__, {:get_connection, id})
  end

  @doc "List all connections"
  @spec list_connections() :: [connection()]
  def list_connections do
    GenServer.call(__MODULE__, :list_connections)
  end

  @doc "Get connections for an automata (as source or target)"
  @spec get_automata_connections(automata_id()) :: [connection()]
  def get_automata_connections(automata_id) do
    GenServer.call(__MODULE__, {:get_automata_connections, automata_id})
  end

  @doc "Get outgoing connections from an automata"
  @spec get_outgoing_connections(automata_id()) :: [connection()]
  def get_outgoing_connections(automata_id) do
    GenServer.call(__MODULE__, {:get_outgoing_connections, automata_id})
  end

  @doc "Get incoming connections to an automata"
  @spec get_incoming_connections(automata_id()) :: [connection()]
  def get_incoming_connections(automata_id) do
    GenServer.call(__MODULE__, {:get_incoming_connections, automata_id})
  end

  @doc "Propagate an output value from source to all connected targets"
  @spec propagate_output(automata_id(), variable_name(), any()) :: :ok
  def propagate_output(source_automata, output_name, value) do
    GenServer.cast(__MODULE__, {:propagate_output, source_automata, output_name, value})
  end

  @doc "Route an event to subscribed automata"
  @spec route_event(String.t(), any()) :: :ok
  def route_event(event_name, data) do
    GenServer.cast(__MODULE__, {:route_event, event_name, data})
  end

  @doc "Subscribe an automata to an event"
  @spec subscribe_event(automata_id(), String.t(), String.t()) :: :ok
  def subscribe_event(automata_id, event_pattern, handler) do
    GenServer.cast(__MODULE__, {:subscribe_event, automata_id, event_pattern, handler})
  end

  @doc "Enable or disable a connection"
  @spec set_connection_enabled(connection_id(), boolean()) :: :ok | {:error, term()}
  def set_connection_enabled(id, enabled) do
    GenServer.call(__MODULE__, {:set_enabled, id, enabled})
  end

  @doc "Replay cached source values for a target automata after reconnect/redeploy"
  @spec replay_for_automata(automata_id()) :: :ok
  def replay_for_automata(automata_id) do
    GenServer.cast(__MODULE__, {:replay_for_automata, automata_id})
  end

  @doc "Validate connections for an automata (check types, cycles)"
  @spec validate_connections(automata_id()) :: {:ok, []} | {:error, [String.t()]}
  def validate_connections(automata_id) do
    GenServer.call(__MODULE__, {:validate_connections, automata_id})
  end

  @doc "Remove all connections for an automata"
  @spec remove_automata_connections(automata_id()) :: :ok
  def remove_automata_connections(automata_id) do
    GenServer.cast(__MODULE__, {:remove_automata_connections, automata_id})
  end

  # ============================================================================
  # GenServer Implementation
  # ============================================================================

  @impl true
  def init(_opts) do
    default_state = %{
      connections: %{},
      by_source: %{},
      by_target: %{},
      values: %{},
      event_routes: %{}
    }

    state =
      Persistence.load_state("connection_manager_state", default_state)
      |> normalize_state()

    Logger.info("ConnectionManager started")
    {:ok, state}
  end

  @impl true
  def handle_call({:create_connection, params}, _from, state) do
    with :ok <- validate_connection_params(params),
         :ok <- check_no_cycles(params, state),
         :ok <- validate_io_types(params) do
      id = generate_id()

      connection = %{
        id: id,
        source_automata: params[:source_automata],
        source_output: params[:source_output],
        target_automata: params[:target_automata],
        target_input: params[:target_input],
        transform: params[:transform],
        enabled: Map.get(params, :enabled, true),
        binding_type: Map.get(params, :binding_type, :direct),
        created_at: System.system_time(:millisecond),
        runtime: default_runtime()
      }

      new_state =
        state
        |> put_in([:connections, id], connection)
        |> add_to_index(:by_source, connection.source_automata, id)
        |> add_to_index(:by_target, connection.target_automata, id)

      broadcast_connection_change(:created, connection)
      persist_state(new_state)
      {:reply, {:ok, connection}, new_state}
    else
      {:error, reason} -> {:reply, {:error, reason}, state}
    end
  end

  @impl true
  def handle_call({:update_connection, id, params}, _from, state) do
    case Map.get(state.connections, id) do
      nil ->
        {:reply, {:error, :not_found}, state}

      connection ->
        updated = Map.merge(connection, Map.take(params, [:transform, :enabled, :binding_type]))
        new_state = put_in(state, [:connections, id], updated)

        broadcast_connection_change(:updated, updated)
        persist_state(new_state)
        {:reply, {:ok, updated}, new_state}
    end
  end

  @impl true
  def handle_call({:delete_connection, id}, _from, state) do
    case Map.get(state.connections, id) do
      nil ->
        {:reply, {:error, :not_found}, state}

      connection ->
        new_state =
          state
          |> update_in([:connections], &Map.delete(&1, id))
          |> remove_from_index(:by_source, connection.source_automata, id)
          |> remove_from_index(:by_target, connection.target_automata, id)

        broadcast_connection_change(:deleted, connection)
        persist_state(new_state)
        {:reply, :ok, new_state}
    end
  end

  @impl true
  def handle_call({:get_connection, id}, _from, state) do
    case Map.get(state.connections, id) do
      nil -> {:reply, {:error, :not_found}, state}
      connection -> {:reply, {:ok, connection}, state}
    end
  end

  @impl true
  def handle_call(:list_connections, _from, state) do
    {:reply, Map.values(state.connections), state}
  end

  @impl true
  def handle_call({:get_automata_connections, automata_id}, _from, state) do
    outgoing_ids = Map.get(state.by_source, automata_id, [])
    incoming_ids = Map.get(state.by_target, automata_id, [])

    connections =
      (outgoing_ids ++ incoming_ids)
      |> Enum.uniq()
      |> Enum.map(&Map.get(state.connections, &1))
      |> Enum.reject(&is_nil/1)

    {:reply, connections, state}
  end

  @impl true
  def handle_call({:get_outgoing_connections, automata_id}, _from, state) do
    ids = Map.get(state.by_source, automata_id, [])

    connections =
      ids
      |> Enum.map(&Map.get(state.connections, &1))
      |> Enum.reject(&is_nil/1)

    {:reply, connections, state}
  end

  @impl true
  def handle_call({:get_incoming_connections, automata_id}, _from, state) do
    ids = Map.get(state.by_target, automata_id, [])

    connections =
      ids
      |> Enum.map(&Map.get(state.connections, &1))
      |> Enum.reject(&is_nil/1)

    {:reply, connections, state}
  end

  @impl true
  def handle_call({:set_enabled, id, enabled}, _from, state) do
    case Map.get(state.connections, id) do
      nil ->
        {:reply, {:error, :not_found}, state}

      connection ->
        updated = %{connection | enabled: enabled}
        new_state = put_in(state, [:connections, id], updated)

        broadcast_connection_change(:updated, updated)
        persist_state(new_state)
        {:reply, :ok, new_state}
    end
  end

  @impl true
  def handle_call({:validate_connections, automata_id}, _from, state) do
    connections = get_connections_for(automata_id, state)
    errors = validate_connections_list(connections, state)

    if Enum.empty?(errors) do
      {:reply, {:ok, []}, state}
    else
      {:reply, {:error, errors}, state}
    end
  end

  @impl true
  def handle_cast({:propagate_output, source_automata, output_name, value}, state) do
    connection_ids = Map.get(state.by_source, source_automata, [])

    # Find connections for this output
    connections =
      connection_ids
      |> Enum.map(&Map.get(state.connections, &1))
      |> Enum.reject(&is_nil/1)
      |> Enum.filter(&(&1.source_output == output_name && &1.enabled))

    # Propagate to each target
    {new_connections, new_values} =
      Enum.reduce(connections, {state.connections, state.values}, fn conn,
                                                                     {conn_acc, value_acc} ->
        transformed_value = apply_transform(value, conn.transform)
        target_key = {conn.target_automata, conn.target_input}
        now = System.system_time(:millisecond)

        if Map.get(value_acc, target_key) == transformed_value do
          runtime =
            conn.runtime
            |> Map.update(:dedupe_count, 1, &(&1 + 1))
            |> Map.put(:last_value, transformed_value)
            |> Map.put(:last_value_timestamp, now)

          {Map.put(conn_acc, conn.id, %{conn | runtime: runtime}), value_acc}
        else
          notify_input_change(conn.target_automata, conn.target_input, transformed_value)

          runtime =
            conn.runtime
            |> Map.update(:message_count, 1, &(&1 + 1))
            |> Map.put(:last_value, transformed_value)
            |> Map.put(:last_value_timestamp, now)
            |> Map.put(:average_latency_ms, 0)
            |> Map.put(:max_latency_ms, 0)

          {
            Map.put(conn_acc, conn.id, %{conn | runtime: runtime}),
            Map.put(value_acc, target_key, transformed_value)
          }
        end
      end)

    # Store current value
    new_state =
      state
      |> Map.put(:connections, new_connections)
      |> Map.put(:values, Map.put(new_values, {source_automata, output_name}, value))

    persist_state(new_state)
    {:noreply, new_state}
  end

  @impl true
  def handle_cast({:route_event, event_name, data}, state) do
    routes = Map.get(state.event_routes, event_name, [])

    Enum.each(routes, fn {automata_id, handler} ->
      notify_event(automata_id, handler, data)
    end)

    {:noreply, state}
  end

  @impl true
  def handle_cast({:subscribe_event, automata_id, event_pattern, handler}, state) do
    new_state =
      update_in(state, [:event_routes, event_pattern], fn
        nil -> [{automata_id, handler}]
        list -> [{automata_id, handler} | list]
      end)

    {:noreply, new_state}
  end

  @impl true
  def handle_cast({:remove_automata_connections, automata_id}, state) do
    outgoing_ids = Map.get(state.by_source, automata_id, [])
    incoming_ids = Map.get(state.by_target, automata_id, [])
    all_ids = Enum.uniq(outgoing_ids ++ incoming_ids)

    new_state =
      Enum.reduce(all_ids, state, fn id, acc ->
        case Map.get(acc.connections, id) do
          nil ->
            acc

          conn ->
            acc
            |> update_in([:connections], &Map.delete(&1, id))
            |> remove_from_index(:by_source, conn.source_automata, id)
            |> remove_from_index(:by_target, conn.target_automata, id)
        end
      end)

    persist_state(new_state)
    {:noreply, new_state}
  end

  @impl true
  def handle_cast({:replay_for_automata, automata_id}, state) do
    incoming_ids = Map.get(state.by_target, automata_id, [])

    Enum.each(incoming_ids, fn id ->
      case Map.get(state.connections, id) do
        %{enabled: true} = conn ->
          source_key = {conn.source_automata, conn.source_output}

          case Map.fetch(state.values, source_key) do
            {:ok, value} ->
              transformed_value = apply_transform(value, conn.transform)
              notify_input_change(conn.target_automata, conn.target_input, transformed_value)

            :error ->
              :ok
          end

        _ ->
          :ok
      end
    end)

    {:noreply, state}
  end

  # ============================================================================
  # Private Functions
  # ============================================================================

  defp normalize_connection_params(params) when is_map(params) do
    Enum.reduce(
      [:source_automata, :source_output, :target_automata, :target_input, :transform, :enabled, :binding_type],
      %{},
      fn key, acc ->
        case fetch_param(params, key) do
          {:ok, value} -> Map.put(acc, key, value)
          :error -> acc
        end
      end
    )
  end

  defp normalize_connection_params(params), do: params

  defp fetch_param(params, key) do
    case Map.fetch(params, key) do
      {:ok, value} ->
        {:ok, value}

      :error ->
        Map.fetch(params, Atom.to_string(key))
    end
  end

  defp validate_connection_params(params) do
    required = [:source_automata, :source_output, :target_automata, :target_input]

    missing = Enum.filter(required, fn key -> !Map.has_key?(params, key) end)

    if Enum.empty?(missing) do
      :ok
    else
      {:error, {:missing_params, missing}}
    end
  end

  defp check_no_cycles(params, state) do
    source = params[:source_automata]
    target = params[:target_automata]

    # Check for direct self-loop
    if source == target do
      {:error, :self_connection}
    else
      # Check for cycles using DFS
      if creates_cycle?(target, source, state) do
        {:error, :creates_cycle}
      else
        :ok
      end
    end
  end

  defp creates_cycle?(from, to, state, visited \\ MapSet.new()) do
    if MapSet.member?(visited, from) do
      false
    else
      visited = MapSet.put(visited, from)

      # Get all automata that 'from' connects to
      connection_ids = Map.get(state.by_source, from, [])

      targets =
        connection_ids
        |> Enum.map(&Map.get(state.connections, &1))
        |> Enum.reject(&is_nil/1)
        |> Enum.map(& &1.target_automata)

      if to in targets do
        true
      else
        Enum.any?(targets, &creates_cycle?(&1, to, state, visited))
      end
    end
  end

  defp validate_io_types(params) do
    source_automata = params[:source_automata]
    source_output = params[:source_output]
    target_automata = params[:target_automata]
    target_input = params[:target_input]

    with {:ok, source} <- AutomataRegistry.get_automata(source_automata),
         {:ok, target} <- AutomataRegistry.get_automata(target_automata) do
      source_var = find_variable(source, source_output, :output)
      target_var = find_variable(target, target_input, :input)

      cond do
        is_nil(source_var) ->
          {:error, {:output_not_found, source_output}}

        is_nil(target_var) ->
          {:error, {:input_not_found, target_input}}

        source_var.type != target_var.type ->
          {:error, {:type_mismatch, source_var.type, target_var.type}}

        true ->
          :ok
      end
    else
      {:error, :not_found} -> {:error, :automata_not_found}
      error -> error
    end
  end

  defp find_variable(automata, name, direction) do
    variables = automata[:variables] || []

    Enum.find(variables, fn var ->
      var[:name] == name && var[:direction] == direction
    end)
  end

  defp get_connections_for(automata_id, state) do
    outgoing_ids = Map.get(state.by_source, automata_id, [])
    incoming_ids = Map.get(state.by_target, automata_id, [])

    (outgoing_ids ++ incoming_ids)
    |> Enum.uniq()
    |> Enum.map(&Map.get(state.connections, &1))
    |> Enum.reject(&is_nil/1)
  end

  defp validate_connections_list(connections, _state) do
    connections
    |> Enum.flat_map(fn conn ->
      errors = []

      # Check source automata exists
      errors =
        case AutomataRegistry.get_automata(conn.source_automata) do
          {:ok, _} -> errors
          _ -> ["Source automata '#{conn.source_automata}' not found" | errors]
        end

      # Check target automata exists
      errors =
        case AutomataRegistry.get_automata(conn.target_automata) do
          {:ok, _} -> errors
          _ -> ["Target automata '#{conn.target_automata}' not found" | errors]
        end

      errors
    end)
  end

  defp add_to_index(state, index_key, automata_id, connection_id) do
    update_in(state, [index_key, automata_id], fn
      nil -> [connection_id]
      list -> [connection_id | list]
    end)
  end

  defp remove_from_index(state, index_key, automata_id, connection_id) do
    update_in(state, [index_key, automata_id], fn
      nil -> []
      list -> List.delete(list, connection_id)
    end)
  end

  defp apply_transform(value, nil), do: value

  defp apply_transform(value, transform) when is_binary(transform) do
    # Simple transform expressions
    # TODO: Implement proper expression evaluation
    case transform do
      "negate" when is_boolean(value) -> !value
      "invert" when is_number(value) -> -value
      "double" when is_number(value) -> value * 2
      "half" when is_number(value) -> value / 2
      "to_string" -> to_string(value)
      _ -> value
    end
  end

  defp notify_input_change(automata_id, input_name, value) do
    # Broadcast to the automata channel
    AetheriumGatewayWeb.Endpoint.broadcast(
      "automata:control",
      "input_changed",
      %{
        automata_id: automata_id,
        input: input_name,
        value: value
      }
    )

    # Also notify any servers running this automata
    AetheriumGatewayWeb.Endpoint.broadcast(
      "server:gateway",
      "set_input",
      %{
        automata_id: automata_id,
        input: input_name,
        value: value
      }
    )
  end

  defp notify_event(automata_id, handler, data) do
    AetheriumGatewayWeb.Endpoint.broadcast(
      "automata:control",
      "event_received",
      %{
        automata_id: automata_id,
        handler: handler,
        data: data
      }
    )
  end

  defp broadcast_connection_change(action, connection) do
    AetheriumGatewayWeb.Endpoint.broadcast(
      "gateway:control",
      "connection_#{action}",
      connection
    )
  end

  defp generate_id do
    :crypto.strong_rand_bytes(16)
    |> Base.encode16(case: :lower)
  end

  defp default_runtime do
    %{
      message_count: 0,
      error_count: 0,
      dedupe_count: 0,
      last_error: nil,
      last_value: nil,
      last_value_timestamp: nil,
      average_latency_ms: 0,
      max_latency_ms: 0
    }
  end

  defp normalize_state(%{connections: connections} = state) when is_map(connections) do
    state
    |> Map.put(:by_source, %{})
    |> Map.put(:by_target, %{})
    |> Map.put_new(:values, %{})
    |> Map.put_new(:event_routes, %{})
    |> rebuild_indexes()
    |> normalize_connection_runtime()
  end

  defp normalize_state(_), do: normalize_state(%{connections: %{}})

  defp rebuild_indexes(state) do
    Enum.reduce(state.connections, %{state | by_source: %{}, by_target: %{}}, fn {id, connection},
                                                                                 acc ->
      acc
      |> add_to_index(:by_source, connection.source_automata, id)
      |> add_to_index(:by_target, connection.target_automata, id)
    end)
  end

  defp normalize_connection_runtime(state) do
    connections =
      Enum.into(state.connections, %{}, fn {id, connection} ->
        {id, Map.put_new(connection, :runtime, default_runtime())}
      end)

    %{state | connections: connections}
  end

  defp persist_state(state) do
    Persistence.save_state(
      "connection_manager_state",
      Map.take(state, [:connections, :values, :event_routes])
    )
  end
end
