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
  alias AetheriumGateway.CommandDispatcher
  alias AetheriumGateway.CommandEnvelope
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
          # Latest global topic values, versions, and source metadata.
          topics: %{variable_name() => map()},
          # Last delivered input state per concrete deployment/input target.
          delivered_inputs: %{{String.t(), variable_name()} => map()},
          # Event subscriptions
          event_routes: %{String.t() => [{automata_id(), String.t()}]}
        }

  @dispatch_warning_ms 200

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
  @spec propagate_output(map() | automata_id(), variable_name(), any()) :: :ok
  def propagate_output(%{} = source, output_name, value) do
    GenServer.cast(
      __MODULE__,
      {:propagate_output, normalize_source_context(source), output_name, value}
    )
  end

  def propagate_output(source_automata, output_name, value) when is_binary(source_automata) do
    propagate_output(%{automata_id: source_automata}, output_name, value)
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
      topics: %{},
      delivered_inputs: %{},
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
  def handle_cast({:propagate_output, source, output_name, value}, state) do
    started_at_ms = System.monotonic_time(:millisecond)
    source_automata = source.automata_id
    connection_ids = Map.get(state.by_source, source_automata, [])

    connections =
      connection_ids
      |> Enum.map(&Map.get(state.connections, &1))
      |> Enum.reject(&is_nil/1)
      |> Enum.filter(&(&1.source_output == output_name && &1.enabled))

    state = put_in(state, [:values, {source_automata, output_name}], value)
    now_ms = System.system_time(:millisecond)
    {state, topic_entry} = maybe_update_topic(state, source, output_name, value, now_ms)

    manual_targets =
      connections
      |> Enum.map(&{&1.target_automata, &1.target_input})
      |> MapSet.new()

    {state, topic_dispatch_count} =
      case topic_entry do
        nil ->
          {state, 0}

        _ ->
          fanout_topic_targets(state, topic_entry, source, manual_targets)
      end

    {state, explicit_dispatch_count} =
      fanout_explicit_connections(state, connections, source, output_name, value, topic_entry)

    elapsed_ms = System.monotonic_time(:millisecond) - started_at_ms

    if elapsed_ms > @dispatch_warning_ms do
      Logger.warning(
        "Global topic fanout for #{output_name} from #{source_automata} took #{elapsed_ms}ms " <>
          "(topic_targets=#{topic_dispatch_count}, explicit_targets=#{explicit_dispatch_count})"
      )
    end

    {:noreply, state}
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
    targets = active_deployments_for_automata(automata_id)

    state =
      Enum.reduce(Map.get(state.by_target, automata_id, []), state, fn id, acc ->
        case Map.get(acc.connections, id) do
          %{enabled: true} = conn ->
            source_key = {conn.source_automata, conn.source_output}

            case Map.fetch(acc.values, source_key) do
              {:ok, value} ->
                transformed_value = apply_transform(value, conn.transform)

                deliver_targets =
                  Enum.filter(targets, &(&1.automata_id == conn.target_automata))

                {_count, next_state} =
                  Enum.reduce(deliver_targets, {0, acc}, fn target, {count, state_acc} ->
                    metadata =
                      topic_metadata_for(state_acc, conn.source_output)
                      |> Map.put(:force_replay, true)

                    case dispatch_input_change(
                           state_acc,
                           target,
                           conn.target_input,
                           transformed_value,
                           metadata
                         ) do
                      {:dispatched, updated_state} -> {count + 1, updated_state}
                      {:deduped, updated_state} -> {count, updated_state}
                    end
                  end)

                next_state

              :error ->
                acc
            end

          _ ->
            acc
        end
      end)

    state =
      Enum.reduce(input_topics_for_automata(automata_id), state, fn input_name, acc ->
        case Map.get(acc.topics, input_name) do
          nil ->
            acc

          topic_entry ->
            Enum.reduce(targets, acc, fn target, state_acc ->
              metadata =
                topic_entry
                |> metadata_from_topic(input_name)
                |> Map.put(:force_replay, true)

              case dispatch_input_change(
                     state_acc,
                     target,
                     input_name,
                     topic_entry.value,
                     metadata
                   ) do
                {:dispatched, updated_state} -> updated_state
                {:deduped, updated_state} -> updated_state
              end
            end)
        end
      end)

    {:noreply, state}
  end

  # ============================================================================
  # Private Functions
  # ============================================================================

  defp normalize_connection_params(params) when is_map(params) do
    Enum.reduce(
      [
        :source_automata,
        :source_output,
        :target_automata,
        :target_input,
        :transform,
        :enabled,
        :binding_type
      ],
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

  defp maybe_update_topic(state, source, topic_name, value, now_ms) do
    case Map.get(state.topics, topic_name) do
      %{value: current_value} when current_value == value ->
        {state, nil}

      current_topic ->
        next_topic = %{
          value: value,
          version: ((current_topic && current_topic.version) || 0) + 1,
          updated_at: now_ms,
          source_deployment_id: source.deployment_id
        }

        {put_in(state, [:topics, topic_name], next_topic),
         Map.put(next_topic, :topic_name, topic_name)}
    end
  end

  defp fanout_topic_targets(state, topic_entry, source, manual_targets) do
    targets =
      topic_subscriber_deployments(topic_entry.topic_name, source)
      |> Enum.reject(&MapSet.member?(manual_targets, {&1.automata_id, topic_entry.topic_name}))

    Enum.reduce(targets, {state, 0}, fn target, {acc, count} ->
      metadata = metadata_from_topic(topic_entry, topic_entry.topic_name)

      case dispatch_input_change(acc, target, topic_entry.topic_name, topic_entry.value, metadata) do
        {:dispatched, updated_state} -> {updated_state, count + 1}
        {:deduped, updated_state} -> {updated_state, count}
      end
    end)
  end

  defp fanout_explicit_connections(state, connections, source, output_name, value, _topic_entry) do
    Enum.reduce(connections, {state, 0}, fn conn, {state_acc, total_count} ->
      transformed_value = apply_transform(value, conn.transform)
      now = System.system_time(:millisecond)
      targets = active_deployments_for_automata(conn.target_automata)

      {dispatch_count, dedupe_count, updated_state} =
        Enum.reduce(targets, {0, 0, state_acc}, fn target, {count, dedupes, acc} ->
          metadata =
            topic_metadata_for(acc, output_name)
            |> Map.put_new(:origin_deployment_id, source.deployment_id)

          case dispatch_input_change(acc, target, conn.target_input, transformed_value, metadata) do
            {:dispatched, next_state} -> {count + 1, dedupes, next_state}
            {:deduped, next_state} -> {count, dedupes + 1, next_state}
          end
        end)

      runtime =
        cond do
          dispatch_count > 0 ->
            conn.runtime
            |> Map.update(:message_count, dispatch_count, &(&1 + dispatch_count))
            |> Map.put(:last_value, transformed_value)
            |> Map.put(:last_value_timestamp, now)
            |> Map.put(:average_latency_ms, 0)
            |> Map.put(:max_latency_ms, 0)

          dedupe_count > 0 ->
            conn.runtime
            |> Map.update(:dedupe_count, dedupe_count, &(&1 + dedupe_count))
            |> Map.put(:last_value, transformed_value)
            |> Map.put(:last_value_timestamp, now)

          true ->
            conn.runtime
        end

      next_state = put_in(updated_state, [:connections, conn.id, :runtime], runtime)
      {next_state, total_count + dispatch_count}
    end)
  end

  defp topic_subscriber_deployments(topic_name, source) do
    active_deployments()
    |> Enum.reject(&(&1.deployment_id == source.deployment_id))
    |> Enum.filter(fn deployment ->
      case AutomataRegistry.get_automata(deployment.automata_id) do
        {:ok, automata} -> automata_has_input?(automata, topic_name)
        _ -> false
      end
    end)
  end

  defp active_deployments do
    AutomataRegistry.list_deployments()
    |> Enum.filter(&active_deployment?/1)
    |> Enum.map(&normalize_target_deployment/1)
    |> Enum.reject(&is_nil/1)
  end

  defp active_deployments_for_automata(automata_id) when is_binary(automata_id) do
    active_deployments()
    |> Enum.filter(&(&1.automata_id == automata_id))
  end

  defp active_deployment?(deployment) when is_map(deployment) do
    status = Map.get(deployment, :status) || Map.get(deployment, "status")
    status in [:loading, :running, :paused, "loading", "running", "paused"]
  end

  defp active_deployment?(_), do: false

  defp input_topics_for_automata(automata_id) do
    case AutomataRegistry.get_automata(automata_id) do
      {:ok, automata} ->
        automata
        |> extract_inputs()
        |> Enum.uniq()

      _ ->
        []
    end
  end

  defp automata_has_input?(automata, topic_name) do
    topic_name in extract_inputs(automata)
  end

  defp extract_inputs(automata) do
    variables = automata[:variables] || automata["variables"] || []
    explicit_inputs = automata[:inputs] || automata["inputs"] || []

    variable_inputs =
      variables
      |> Enum.filter(fn var ->
        direction = var[:direction] || var["direction"]
        direction in [:input, "input"]
      end)
      |> Enum.map(fn var -> var[:name] || var["name"] end)

    (explicit_inputs ++ variable_inputs)
    |> Enum.reject(&is_nil/1)
    |> Enum.map(&to_string/1)
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

  defp dispatch_input_change(state, target, input_name, value, metadata) do
    delivery_key = {target.deployment_id, input_name}
    previous_delivery = Map.get(state.delivered_inputs, delivery_key)

    if duplicate_delivery?(previous_delivery, value, metadata) do
      {:deduped, state}
    else
      AetheriumGatewayWeb.Endpoint.broadcast(
        "automata:control",
        "input_changed",
        %{
          automata_id: target.automata_id,
          deployment_id: target.deployment_id,
          device_id: target.device_id,
          server_id: target.server_id,
          input: input_name,
          value: value
        }
      )

      payload =
        %{
          "deployment_id" => target.deployment_id,
          "device_id" => target.device_id,
          "automata_id" => target.automata_id,
          "input" => input_name,
          "value" => value,
          "internal_propagation" => true,
          "topic_dispatched_at_ms" => System.system_time(:millisecond)
        }
        |> maybe_put_payload("topic", metadata[:topic])
        |> maybe_put_payload("topic_version", metadata[:topic_version])
        |> maybe_put_payload("origin_deployment_id", metadata[:origin_deployment_id])
        |> maybe_put_payload("force_replay", metadata[:force_replay])

      envelope = system_envelope("set_input", payload, target)
      CommandDispatcher.dispatch(target.server_id, "set_input", payload, envelope)

      delivered_inputs =
        Map.put(state.delivered_inputs, delivery_key, %{
          value: value,
          topic: metadata[:topic],
          topic_version: metadata[:topic_version],
          origin_deployment_id: metadata[:origin_deployment_id],
          delivered_at: System.system_time(:millisecond)
        })

      {:dispatched, %{state | delivered_inputs: delivered_inputs}}
    end
  end

  defp duplicate_delivery?(previous_delivery, value, metadata) when is_map(previous_delivery) do
    cond do
      metadata[:force_replay] ->
        false

      is_integer(metadata[:topic_version]) and previous_delivery[:topic] == metadata[:topic] ->
        previous_delivery[:topic_version] == metadata[:topic_version]

      true ->
        previous_delivery[:value] == value and previous_delivery[:topic] == metadata[:topic]
    end
  end

  defp duplicate_delivery?(_previous_delivery, _value, _metadata), do: false

  defp metadata_from_topic(topic_entry, topic_name) when is_map(topic_entry) do
    %{
      topic: topic_name,
      topic_version: topic_entry.version,
      origin_deployment_id: topic_entry.source_deployment_id,
      force_replay: false
    }
  end

  defp topic_metadata_for(state, topic_name) do
    case Map.get(state.topics, topic_name) do
      nil -> %{topic: topic_name, force_replay: false}
      topic_entry -> metadata_from_topic(topic_entry, topic_name)
    end
  end

  defp normalize_target_deployment(deployment) when is_map(deployment) do
    automata_id = deployment_field(deployment, :automata_id)
    device_id = deployment_field(deployment, :device_id)
    server_id = deployment_field(deployment, :server_id)

    deployment_id =
      deployment_field(deployment, :deployment_id, default_deployment_id(automata_id, device_id))

    cond do
      !is_binary(automata_id) or automata_id == "" ->
        nil

      !is_binary(device_id) or device_id == "" ->
        nil

      !is_binary(server_id) or server_id == "" ->
        nil

      !is_binary(deployment_id) or deployment_id == "" ->
        nil

      true ->
        %{
          automata_id: automata_id,
          device_id: device_id,
          server_id: server_id,
          deployment_id: deployment_id
        }
    end
  end

  defp normalize_target_deployment(_deployment), do: nil

  defp deployment_field(deployment, key, default \\ nil)
       when is_map(deployment) and is_atom(key) do
    Map.get(deployment, key, Map.get(deployment, Atom.to_string(key), default))
  end

  defp normalize_source_context(source) when is_map(source) do
    %{
      automata_id: fetch_source_value(source, :automata_id),
      deployment_id: fetch_source_value(source, :deployment_id),
      device_id: fetch_source_value(source, :device_id),
      server_id: fetch_source_value(source, :server_id)
    }
  end

  defp fetch_source_value(source, key) when is_atom(key) do
    Map.get(source, key) || Map.get(source, Atom.to_string(key))
  end

  defp default_deployment_id(automata_id, device_id)
       when is_binary(automata_id) and is_binary(device_id) do
    "#{automata_id}:#{device_id}"
  end

  defp default_deployment_id(_automata_id, _device_id), do: nil

  defp system_envelope(command_type, payload, target) do
    actor = %{"role" => "system", "source" => "connection_manager"}

    {:ok, envelope} =
      CommandEnvelope.from_payload(
        command_type,
        Map.put(payload, "target", %{
          "server_id" => target.server_id,
          "deployment_id" => target.deployment_id
        }),
        actor
      )

    envelope
  end

  defp maybe_put_payload(payload, _key, nil), do: payload
  defp maybe_put_payload(payload, _key, false), do: payload
  defp maybe_put_payload(payload, key, value), do: Map.put(payload, key, value)

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
    |> Map.put(:values, %{})
    |> Map.put(:topics, %{})
    |> Map.put(:delivered_inputs, %{})
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
      Map.take(state, [:connections, :event_routes])
    )
  end
end
