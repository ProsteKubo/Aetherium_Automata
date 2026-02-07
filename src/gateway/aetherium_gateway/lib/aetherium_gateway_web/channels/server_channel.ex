defmodule AetheriumGatewayWeb.ServerChannel do
  use AetheriumGatewayWeb, :channel

  # Server joins with: {"topic": "server:gateway", "payload": {"token": "server_secret_token", "server_id": "srv_01"}}
  def join("server:gateway", payload, socket) do
    token = payload["token"] || socket.assigns[:token]
    server_id = payload["server_id"] || socket.assigns[:server_id]

    cond do
      is_nil(server_id) or server_id == "" ->
        {:error, %{reason: "missing_server_id"}}

      not valid_server_token?(token) ->
        {:error, %{reason: "invalid_server_token"}}

      true ->
        # Register this server's connection
        case AetheriumGateway.ServerTracker.register(server_id, self()) do
          :ok ->
            :ok

          {:error, :already_connected} ->
            :ok = AetheriumGateway.ServerTracker.unregister(server_id)
            :ok = AetheriumGateway.ServerTracker.register(server_id, self())
        end

      socket =
        socket
        |> assign(:server_id, server_id)
        |> assign(:authenticated_at, DateTime.utc_now())

        # Notify UI about updated server list
        AetheriumGatewayWeb.Endpoint.broadcast!(
          "gateway:control",
          "server_list",
          %{servers: AetheriumGateway.ServerTracker.list_servers()}
        )

        {:ok, %{gateway_version: "1.0.0", status: "connected"}, socket}
    end
  end

  # Heartbeat from server
  def handle_in("heartbeat", _payload, socket) do
    :ok = AetheriumGateway.ServerTracker.heartbeat(socket.assigns.server_id)
    {:reply, {:ok, %{status: "ok"}}, socket}
  end

  # Server reporting its device list
  def handle_in("device_update", %{"devices" => devices}, socket) do
    server_id = socket.assigns.server_id

    :ok = AetheriumGateway.ServerTracker.update_devices(server_id, devices)

    # Broadcast to UI channel
    AetheriumGatewayWeb.Endpoint.broadcast!(
      "gateway:control",
      "devices_updated",
      %{
        server_id: server_id,
        devices: devices,
        timestamp: DateTime.utc_now()
      }
    )

    # Also broadcast current aggregate list for UIs that only listen to device_list
    AetheriumGatewayWeb.Endpoint.broadcast!(
      "gateway:control",
      "device_list",
      %{devices: AetheriumGateway.ServerTracker.list_devices_flat()}
    )

    {:noreply, socket}
  end

  # Server forwarding device alert
  def handle_in("device_alert", %{"device_id" => _device_id} = alert, socket) do
    # Forward to UI
    AetheriumGatewayWeb.Endpoint.broadcast!(
      "gateway:control",
      "alert",
      Map.put(alert, "server_id", socket.assigns.server_id)
    )
    {:noreply, socket}
  end

  # ============================================================================
  # Automata Protocol Handlers
  # ============================================================================

  # State change notification from device
  def handle_in("state_changed", payload, socket) do
    server_id = socket.assigns.server_id

    device_id = payload["device_id"]

    # Update registry (current state + variables snapshot optional)
    AetheriumGateway.AutomataRegistry.update_device_state(device_id, payload["to_state"], payload["variables"] || %{})

    # Record transition
    AetheriumGateway.AutomataRegistry.record_transition(
      device_id,
      payload["from_state"],
      payload["to_state"],
      payload["transition_id"],
      %{"weight_used" => payload["weight_used"]}
    )

    # Broadcast to UI
    AetheriumGatewayWeb.Endpoint.broadcast!(
      "gateway:control",
      "state_changed",
      Map.put(payload, "server_id", server_id)
    )

    AetheriumGatewayWeb.Endpoint.broadcast!(
      "automata:control",
      "state_changed",
      payload
    )

    {:noreply, socket}
  end

  # Variable update from device
  def handle_in("variable_updated", payload, socket) do
    # Handle output propagation
    if payload["direction"] == "output" do
      AetheriumGateway.ConnectionManager.propagate_output(
        payload["automata_id"],
        payload["name"],
        payload["value"]
      )
    end

    # Broadcast to UI
    AetheriumGatewayWeb.Endpoint.broadcast!(
      "automata:control",
      "variable_updated",
      payload
    )

    {:noreply, socket}
  end

  # Transition fired event (with weight info for probabilistic)
  def handle_in("transition_fired", payload, socket) do
    # Record for statistics
    AetheriumGateway.AutomataRegistry.record_transition(
      payload["device_id"],
      payload["from"],
      payload["to"],
      payload["transition_id"],
      %{"weight_used" => payload["weight_used"]}
    )

    # Broadcast to UI
    AetheriumGatewayWeb.Endpoint.broadcast!(
      "automata:control",
      "transition_fired",
      payload
    )

    {:noreply, socket}
  end

  # Deployment status update
  def handle_in("deployment_status", payload, socket) do
    status = String.to_atom(payload["status"])

    if payload["automata_id"] && payload["device_id"] do
      AetheriumGateway.AutomataRegistry.update_deployment_status(
        payload["automata_id"],
        payload["device_id"],
        status,
        %{current_state: payload["current_state"], error: payload["error"]}
      )
    end

    AetheriumGatewayWeb.Endpoint.broadcast!(
      "automata:control",
      "deployment_status",
      payload
    )

    {:noreply, socket}
  end

  # ==========================================================================
  # Gateway -> Server control-plane forwarding
  #
  # The UI talks to the gateway via "automata:control". The gateway then sends
  # internal messages to the server channel pid stored in ServerTracker.
  # These handlers forward those messages over the active server:gateway socket.
  # ==========================================================================

  @impl true
  def handle_info({:deploy_automata, automata, device_id}, socket) do
    automata_id = Map.get(automata, :id) || Map.get(automata, "id")

    push(socket, "deploy_automata", %{
      "automata_id" => automata_id,
      "device_id" => device_id,
      "automata" => automata
    })

    {:noreply, socket}
  end

  @impl true
  def handle_info({:stop_automata, deployment_id}, socket) do
    push(socket, "stop_automata", %{"deployment_id" => deployment_id})
    {:noreply, socket}
  end

  @impl true
  def handle_info({:set_variable, device_id, name, value}, socket) do
    # Server currently handles this as a set_input command.
    push(socket, "set_input", %{"device_id" => device_id, "input" => name, "value" => value})
    {:noreply, socket}
  end

  @impl true
  def handle_info({:trigger_event, device_id, event, data}, socket) do
    push(socket, "trigger_event", %{"device_id" => device_id, "event" => event, "data" => data})
    {:noreply, socket}
  end

  @impl true
  def handle_info({:force_transition, device_id, to_state}, socket) do
    push(socket, "force_state", %{"device_id" => device_id, "state_id" => to_state})
    {:noreply, socket}
  end

  # Device log
  def handle_in("device_log", payload, socket) do
    AetheriumGatewayWeb.Endpoint.broadcast!(
      "gateway:control",
      "device_log",
      Map.put(payload, "server_id", socket.assigns.server_id)
    )

    {:noreply, socket}
  end

  # Deployment error
  def handle_in("deployment_error", payload, socket) do
    AetheriumGatewayWeb.Endpoint.broadcast!(
      "automata:control",
      "deployment_error",
      payload
    )

    {:noreply, socket}
  end

  # Output changed (for connection propagation)
  def handle_in("output_changed", payload, socket) do
    AetheriumGateway.ConnectionManager.propagate_output(
      payload["automata_id"],
      payload["output"],
      payload["value"]
    )

    {:noreply, socket}
  end

  # Handle server disconnect
  def terminate(_reason, socket) do
    server_id = socket.assigns[:server_id]

    if server_id do
      :ok = AetheriumGateway.ServerTracker.unregister(server_id)

      AetheriumGatewayWeb.Endpoint.broadcast!(
        "gateway:control",
        "server_list",
        %{servers: AetheriumGateway.ServerTracker.list_servers()}
      )

      AetheriumGatewayWeb.Endpoint.broadcast!(
        "gateway:control",
        "device_list",
        %{devices: AetheriumGateway.ServerTracker.list_devices_flat()}
      )
    end

    :ok
  end

  defp valid_server_token?(token) do
    # TODO: Load from config or database
    token == "server_secret_token"
  end
end
