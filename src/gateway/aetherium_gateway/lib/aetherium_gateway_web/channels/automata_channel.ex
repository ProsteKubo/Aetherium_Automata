defmodule AetheriumGatewayWeb.AutomataChannel do
  @moduledoc """
  WebSocket channel for automata management operations.
  Handles CRUD, deployments, connections, and real-time state updates.
  """
  use AetheriumGatewayWeb, :channel
  require Logger

  alias AetheriumGateway.AutomataRegistry
  alias AetheriumGateway.ConnectionManager

  # ============================================================================
  # Join
  # ============================================================================

  @doc """
  UI joins "automata:control" for automata management.
  Payload: %{"token" => "dev_secret_token"}
  """
  def join("automata:control", payload, socket) do
    token = payload["token"] || socket.assigns[:token]

    if valid_token?(token) do
      socket = assign(socket, :session_id, generate_session_id())
      send(self(), :send_initial_state)
      {:ok, %{status: "connected"}, socket}
    else
      {:error, %{reason: "invalid_token"}}
    end
  end

  # ============================================================================
  # Automata CRUD
  # ============================================================================

  @doc "Create new automata"
  def handle_in("create_automata", payload, socket) do
    automata = normalize_automata(payload)

    case AutomataRegistry.register_automata(automata) do
      :ok ->
        {:reply, {:ok, %{automata_id: automata.id, status: "created"}}, socket}

      {:error, reason} ->
        {:reply, {:error, %{reason: to_string(reason)}}, socket}
    end
  end

  @doc "Update existing automata"
  def handle_in("update_automata", %{"id" => automata_id} = payload, socket) do
    updates = Map.drop(payload, ["id"])

    case AutomataRegistry.update_automata(automata_id, normalize_updates(updates)) do
      :ok ->
        {:reply, {:ok, %{status: "updated"}}, socket}

      {:error, reason} ->
        {:reply, {:error, %{reason: to_string(reason)}}, socket}
    end
  end

  @doc "Get automata by ID"
  def handle_in("get_automata", %{"id" => automata_id}, socket) do
    case AutomataRegistry.get_automata(automata_id) do
      {:ok, automata} ->
        {:reply, {:ok, %{automata: serialize_automata(automata)}}, socket}

      {:error, :not_found} ->
        {:reply, {:error, %{reason: "not_found"}}, socket}
    end
  end

  @doc "List all automata"
  def handle_in("list_automata", _payload, socket) do
    automata = AutomataRegistry.list_automata()
    {:reply, {:ok, %{automata: Enum.map(automata, &serialize_automata/1)}}, socket}
  end

  @doc "Delete automata"
  def handle_in("delete_automata", %{"id" => automata_id}, socket) do
    case AutomataRegistry.delete_automata(automata_id) do
      :ok ->
        {:reply, {:ok, %{status: "deleted"}}, socket}

      {:error, reason} ->
        {:reply, {:error, %{reason: to_string(reason)}}, socket}
    end
  end

  # ============================================================================
  # Deployment
  # ============================================================================

  @doc "Deploy automata to device"
  def handle_in("deploy", %{"automata_id" => automata_id, "device_id" => device_id, "server_id" => server_id}, socket) do
    case AutomataRegistry.deploy_automata(automata_id, device_id, server_id) do
      {:ok, deployment} ->
        {:reply, {:ok, %{deployment: serialize_deployment(deployment)}}, socket}

      {:error, reason} ->
        {:reply, {:error, %{reason: to_string(reason)}}, socket}
    end
  end

  @doc "Stop automata on device"
  def handle_in("stop", %{"device_id" => device_id}, socket) do
    case AutomataRegistry.get_device_deployment(device_id) do
      {:ok, deployment} ->
        # Update status and notify server
        AutomataRegistry.update_deployment_status(
          deployment.automata_id,
          device_id,
          :stopped,
          %{}
        )

        # Server-side control expects deployment_id.
        notify_server_stop(deployment.server_id, "#{deployment.automata_id}:#{device_id}")
        {:reply, {:ok, %{status: "stopped"}}, socket}

      {:error, :not_found} ->
        {:reply, {:error, %{reason: "no_deployment_found"}}, socket}
    end
  end

  @doc "List all deployments"
  def handle_in("list_deployments", _payload, socket) do
    deployments = AutomataRegistry.list_deployments()
    {:reply, {:ok, %{deployments: Enum.map(deployments, &serialize_deployment/1)}}, socket}
  end

  @doc "Get deployment for device"
  def handle_in("get_deployment", %{"device_id" => device_id}, socket) do
    case AutomataRegistry.get_device_deployment(device_id) do
      {:ok, deployment} ->
        {:reply, {:ok, %{deployment: serialize_deployment(deployment)}}, socket}

      {:error, :not_found} ->
        {:reply, {:error, %{reason: "not_found"}}, socket}
    end
  end

  # ============================================================================
  # Connections (Inter-Automata Bindings)
  # ============================================================================

  @doc "Create connection between automata I/O"
  def handle_in("create_connection", payload, socket) do
    connection = %{
      id: payload["id"] || generate_id("conn"),
      source_automata_id: payload["source_automata_id"],
      source_output: payload["source_output"],
      target_automata_id: payload["target_automata_id"],
      target_input: payload["target_input"],
      binding_type: String.to_atom(payload["binding_type"] || "direct"),
      transform: payload["transform"]
    }

    case ConnectionManager.create_connection(connection) do
      :ok ->
        {:reply, {:ok, %{connection_id: connection.id, status: "created"}}, socket}

      {:error, reason} ->
        {:reply, {:error, %{reason: to_string(reason)}}, socket}
    end
  end

  @doc "Delete connection"
  def handle_in("delete_connection", %{"id" => connection_id}, socket) do
    case ConnectionManager.delete_connection(connection_id) do
      :ok ->
        {:reply, {:ok, %{status: "deleted"}}, socket}

      {:error, reason} ->
        {:reply, {:error, %{reason: to_string(reason)}}, socket}
    end
  end

  @doc "List all connections"
  def handle_in("list_connections", _payload, socket) do
    connections = ConnectionManager.list_connections()
    {:reply, {:ok, %{connections: connections}}, socket}
  end

  @doc "Get connections for automata"
  def handle_in("get_automata_connections", %{"automata_id" => automata_id}, socket) do
    incoming = ConnectionManager.get_incoming_connections(automata_id)
    outgoing = ConnectionManager.get_outgoing_connections(automata_id)
    {:reply, {:ok, %{incoming: incoming, outgoing: outgoing}}, socket}
  end

  # ============================================================================
  # Variables
  # ============================================================================

  @doc "Set variable value on device"
  def handle_in("set_variable", %{"device_id" => device_id, "name" => name, "value" => value}, socket) do
    case AutomataRegistry.get_device_deployment(device_id) do
      {:ok, deployment} ->
        # Forwarded as a set_input command by the gateway->server bridge.
        notify_server_set_variable(deployment.server_id, device_id, name, value)
        {:reply, {:ok, %{status: "sent"}}, socket}

      {:error, :not_found} ->
        {:reply, {:error, %{reason: "no_deployment_found"}}, socket}
    end
  end

  @doc "Get current variable values"
  def handle_in("get_variables", %{"device_id" => device_id}, socket) do
    case AutomataRegistry.get_device_deployment(device_id) do
      {:ok, deployment} ->
        {:reply, {:ok, %{variables: deployment.variables}}, socket}

      {:error, :not_found} ->
        {:reply, {:error, %{reason: "not_found"}}, socket}
    end
  end

  # ============================================================================
  # Transition Statistics
  # ============================================================================

  @doc "Get transition history for device"
  def handle_in("get_transition_history", %{"device_id" => device_id} = payload, socket) do
    limit = payload["limit"] || 100
    history = AutomataRegistry.get_transition_history(device_id, limit)
    {:reply, {:ok, %{history: history}}, socket}
  end

  @doc "Get probabilistic transition statistics"
  def handle_in("get_transition_stats", %{"automata_id" => automata_id, "from_state" => from_state}, socket) do
    stats = AutomataRegistry.get_transition_stats(automata_id, from_state)
    {:reply, {:ok, %{stats: stats}}, socket}
  end

  # ============================================================================
  # Trigger Events
  # ============================================================================

  @doc "Send event trigger to device"
  def handle_in("trigger_event", %{"device_id" => device_id, "event" => event} = payload, socket) do
    case AutomataRegistry.get_device_deployment(device_id) do
      {:ok, deployment} ->
        notify_server_trigger_event(deployment.server_id, device_id, event, payload["data"])
        {:reply, {:ok, %{status: "sent"}}, socket}

      {:error, :not_found} ->
        {:reply, {:error, %{reason: "no_deployment_found"}}, socket}
    end
  end

  @doc "Force state transition (for debugging)"
  def handle_in("force_transition", %{"device_id" => device_id, "to_state" => to_state}, socket) do
    case AutomataRegistry.get_device_deployment(device_id) do
      {:ok, deployment} ->
        notify_server_force_transition(deployment.server_id, device_id, to_state)
        {:reply, {:ok, %{status: "sent"}}, socket}

      {:error, :not_found} ->
        {:reply, {:error, %{reason: "no_deployment_found"}}, socket}
    end
  end

  # ============================================================================
  # Handle Info
  # ============================================================================

  @impl true
  def handle_info(:send_initial_state, socket) do
    # Send current automata list
    automata = AutomataRegistry.list_automata()
    push(socket, "automata_list", %{automata: Enum.map(automata, &serialize_automata/1)})

    # Send current deployments
    deployments = AutomataRegistry.list_deployments()
    push(socket, "deployment_list", %{deployments: Enum.map(deployments, &serialize_deployment/1)})

    # Send connections
    connections = ConnectionManager.list_connections()
    push(socket, "connection_list", %{connections: connections})

    {:noreply, socket}
  end

  # ============================================================================
  # Private Functions
  # ============================================================================

  defp valid_token?(token) do
    token == "dev_secret_token"
  end

  defp generate_session_id do
    :crypto.strong_rand_bytes(16) |> Base.encode16(case: :lower)
  end

  defp generate_id(prefix) do
    "#{prefix}_#{:crypto.strong_rand_bytes(8) |> Base.encode16(case: :lower)}"
  end

  defp normalize_automata(payload) do
    %{
      id: payload["id"] || generate_id("aut"),
      name: payload["name"],
      description: payload["description"],
      version: payload["version"] || "1.0.0",
      states: normalize_states(payload["states"] || %{}),
      transitions: normalize_transitions(payload["transitions"] || %{}),
      variables: normalize_variables(payload["variables"] || []),
      inputs: payload["inputs"] || [],
      outputs: payload["outputs"] || []
    }
  end

  defp normalize_states(states) when is_map(states) do
    states
    |> Enum.map(fn {id, state} ->
      {id, %{
        id: id,
        name: state["name"] || id,
        type: String.to_atom(state["type"] || "normal"),
        on_enter: state["on_enter"],
        on_exit: state["on_exit"],
        on_tick: state["on_tick"]
      }}
    end)
    |> Enum.into(%{})
  end

  defp normalize_transitions(transitions) when is_map(transitions) do
    transitions
    |> Enum.map(fn {id, trans} ->
      {id, %{
        id: id,
        from: trans["from"],
        to: trans["to"],
        type: String.to_atom(trans["type"] || "classic"),
        condition: trans["condition"],
        priority: trans["priority"] || 0,
        weight: trans["weight"],
        timed: normalize_timed_config(trans["timed"]),
        event: normalize_event_config(trans["event"])
      }}
    end)
    |> Enum.into(%{})
  end

  defp normalize_variables(variables) when is_list(variables) do
    Enum.map(variables, fn var ->
      %{
        id: var["id"] || generate_id("var"),
        name: var["name"],
        type: var["type"] || "int",
        direction: String.to_atom(var["direction"] || "internal"),
        default: var["default"]
      }
    end)
  end

  defp normalize_timed_config(nil), do: nil
  defp normalize_timed_config(config) do
    %{
      mode: String.to_atom(config["mode"] || "after"),
      delay_ms: config["delay_ms"] || config["delayMs"] || 0,
      jitter_ms: config["jitter_ms"] || config["jitterMs"]
    }
  end

  defp normalize_event_config(nil), do: nil
  defp normalize_event_config(config) do
    %{
      triggers: config["triggers"] || [],
      require_all: config["require_all"] || config["requireAll"] || false,
      debounce_ms: config["debounce_ms"] || config["debounceMs"]
    }
  end

  defp normalize_updates(updates) do
    updates
    |> Enum.map(fn
      {"states", states} -> {:states, normalize_states(states)}
      {"transitions", trans} -> {:transitions, normalize_transitions(trans)}
      {"variables", vars} -> {:variables, normalize_variables(vars)}
      {key, value} -> {String.to_existing_atom(key), value}
    end)
    |> Enum.into(%{})
  end

  defp serialize_automata(automata) do
    %{
      id: automata.id,
      name: automata.name,
      description: automata.description,
      version: automata.version,
      states: automata.states,
      transitions: automata.transitions,
      variables: automata.variables,
      inputs: automata.inputs,
      outputs: automata.outputs,
      created_at: automata[:created_at],
      updated_at: automata[:updated_at]
    }
  end

  defp serialize_deployment(deployment) do
    %{
      automata_id: deployment.automata_id,
      device_id: deployment.device_id,
      server_id: deployment.server_id,
      status: deployment.status,
      deployed_at: deployment.deployed_at,
      current_state: deployment.current_state,
      variables: deployment.variables,
      error: deployment.error
    }
  end

  # Server notification helpers
  defp notify_server_stop(server_id, device_id) do
    case AetheriumGateway.ServerTracker.get_server_pid(server_id) do
      {:ok, pid} -> send(pid, {:stop_automata, device_id})
      _ -> :ok
    end
  end

  defp notify_server_set_variable(server_id, device_id, name, value) do
    case AetheriumGateway.ServerTracker.get_server_pid(server_id) do
      {:ok, pid} -> send(pid, {:set_variable, device_id, name, value})
      _ -> :ok
    end
  end

  defp notify_server_trigger_event(server_id, device_id, event, data) do
    case AetheriumGateway.ServerTracker.get_server_pid(server_id) do
      {:ok, pid} -> send(pid, {:trigger_event, device_id, event, data})
      _ -> :ok
    end
  end

  defp notify_server_force_transition(server_id, device_id, to_state) do
    case AetheriumGateway.ServerTracker.get_server_pid(server_id) do
      {:ok, pid} -> send(pid, {:force_transition, device_id, to_state})
      _ -> :ok
    end
  end
end
