defmodule AetheriumGatewayWeb.ServerChannel do
  use AetheriumGatewayWeb, :channel
  require Logger

  alias AetheriumGateway.Auth
  alias AetheriumGateway.AutomataRegistry
  alias AetheriumGateway.CommandDispatcher
  alias AetheriumGateway.Persistence
  alias AetheriumGateway.ServerTracker

  @impl true
  def join("server:gateway", payload, socket) do
    token = payload["token"] || socket.assigns[:token]
    server_id = payload["server_id"] || socket.assigns[:server_id]

    cond do
      is_nil(server_id) or server_id == "" ->
        {:error, %{reason: "missing_server_id"}}

      true ->
        case Auth.authorize(:server, token) do
          {:ok, claims} ->
            case ServerTracker.register(server_id, self()) do
              :ok ->
                :ok

              {:error, :already_connected} ->
                :ok = ServerTracker.unregister(server_id)
                :ok = ServerTracker.register(server_id, self())
            end

            CommandDispatcher.server_connected(server_id)

            socket =
              socket
              |> assign(:server_id, server_id)
              |> assign(:authenticated_at, DateTime.utc_now())
              |> assign(:auth_claims, claims)

            broadcast_server_lists()

            {:ok, %{gateway_version: "2.0.0", status: "connected"}, socket}

          {:error, reason} ->
            {:error, %{reason: to_string(reason)}}
        end
    end
  end

  @impl true
  def handle_in("heartbeat", _payload, socket) do
    :ok = ServerTracker.heartbeat(socket.assigns.server_id)
    {:reply, {:ok, %{status: "ok"}}, socket}
  end

  @impl true
  def handle_in("device_update", %{"devices" => devices}, socket) do
    server_id = socket.assigns.server_id
    :ok = ServerTracker.update_devices(server_id, devices)

    AetheriumGatewayWeb.Endpoint.broadcast!(
      "gateway:control",
      "devices_updated",
      %{
        server_id: server_id,
        devices: devices,
        timestamp: DateTime.utc_now()
      }
    )

    AetheriumGatewayWeb.Endpoint.broadcast!(
      "gateway:control",
      "device_list",
      %{devices: ServerTracker.list_devices_flat()}
    )

    {:noreply, socket}
  end

  @impl true
  def handle_in("device_alert", %{"device_id" => _device_id} = alert, socket) do
    AetheriumGatewayWeb.Endpoint.broadcast!(
      "gateway:control",
      "alert",
      Map.put(alert, "server_id", socket.assigns.server_id)
    )

    {:noreply, socket}
  end

  @impl true
  def handle_in("state_changed", payload, socket) do
    server_id = socket.assigns.server_id
    device_id = payload["device_id"]

    AutomataRegistry.update_device_state(device_id, payload["to_state"], payload["variables"] || %{})

    AutomataRegistry.record_transition(
      device_id,
      payload["from_state"],
      payload["to_state"],
      payload["transition_id"],
      %{"weight_used" => payload["weight_used"]}
    )

    AetheriumGatewayWeb.Endpoint.broadcast!("gateway:control", "state_changed", Map.put(payload, "server_id", server_id))
    AetheriumGatewayWeb.Endpoint.broadcast!("automata:control", "state_changed", payload)
    {:noreply, socket}
  end

  @impl true
  def handle_in("variable_updated", payload, socket) do
    if payload["direction"] == "output" do
      AetheriumGateway.ConnectionManager.propagate_output(
        payload["automata_id"],
        payload["name"],
        payload["value"]
      )
    end

    AetheriumGatewayWeb.Endpoint.broadcast!("automata:control", "variable_updated", payload)
    {:noreply, socket}
  end

  @impl true
  def handle_in("transition_fired", payload, socket) do
    AutomataRegistry.record_transition(
      payload["device_id"],
      payload["from"],
      payload["to"],
      payload["transition_id"],
      %{"weight_used" => payload["weight_used"]}
    )

    AetheriumGatewayWeb.Endpoint.broadcast!("automata:control", "transition_fired", payload)
    {:noreply, socket}
  end

  @impl true
  def handle_in("deployment_status", payload, socket) do
    status = normalize_status(payload["status"])

    if payload["automata_id"] && payload["device_id"] do
      AutomataRegistry.update_deployment_status(
        payload["automata_id"],
        payload["device_id"],
        status,
        %{current_state: payload["current_state"], error: payload["error"]}
      )
    end

    AetheriumGatewayWeb.Endpoint.broadcast!("automata:control", "deployment_status", payload)
    {:noreply, socket}
  end

  @impl true
  def handle_in("device_log", payload, socket) do
    AetheriumGatewayWeb.Endpoint.broadcast!(
      "gateway:control",
      "device_log",
      Map.put(payload, "server_id", socket.assigns.server_id)
    )

    {:noreply, socket}
  end

  @impl true
  def handle_in("deployment_error", payload, socket) do
    AetheriumGatewayWeb.Endpoint.broadcast!("automata:control", "deployment_error", payload)
    {:noreply, socket}
  end

  @impl true
  def handle_in("output_changed", payload, socket) do
    AetheriumGateway.ConnectionManager.propagate_output(
      payload["automata_id"],
      payload["output"],
      payload["value"]
    )

    {:noreply, socket}
  end

  @impl true
  def handle_in("command_outcome", payload, socket) do
    Persistence.append_event(%{
      kind: "server_command_outcome",
      source: "server_channel",
      data: Map.put(payload, "server_id", socket.assigns.server_id)
    })

    AetheriumGatewayWeb.Endpoint.broadcast!("gateway:control", "command_outcome", payload)
    AetheriumGatewayWeb.Endpoint.broadcast!("automata:control", "command_outcome", payload)
    {:noreply, socket}
  end

  @impl true
  def handle_info({:dispatch_command, event, payload, envelope}, socket)
      when is_binary(event) and is_map(payload) and is_map(envelope) do
    outbound_payload =
      payload
      |> stringify_keys()
      |> Map.put("envelope", stringify_keys(envelope))

    push(socket, event, outbound_payload)

    Persistence.append_event(%{
      kind: "dispatch_command",
      source: "server_channel",
      data: %{
        server_id: socket.assigns.server_id,
        event: event,
        payload: outbound_payload
      }
    })

    {:noreply, socket}
  end

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

  @impl true
  def terminate(_reason, socket) do
    server_id = socket.assigns[:server_id]

    if server_id do
      :ok = ServerTracker.unregister(server_id)
      broadcast_server_lists()
    end

    :ok
  end

  defp broadcast_server_lists do
    AetheriumGatewayWeb.Endpoint.broadcast!(
      "gateway:control",
      "server_list",
      %{servers: ServerTracker.list_servers()}
    )

    AetheriumGatewayWeb.Endpoint.broadcast!(
      "gateway:control",
      "device_list",
      %{devices: ServerTracker.list_devices_flat()}
    )
  end

  defp normalize_status("pending"), do: :pending
  defp normalize_status("deploying"), do: :deploying
  defp normalize_status("loading"), do: :deploying
  defp normalize_status("running"), do: :running
  defp normalize_status("paused"), do: :paused
  defp normalize_status("stopped"), do: :stopped
  defp normalize_status("error"), do: :error
  defp normalize_status(:pending), do: :pending
  defp normalize_status(:deploying), do: :deploying
  defp normalize_status(:running), do: :running
  defp normalize_status(:paused), do: :paused
  defp normalize_status(:stopped), do: :stopped
  defp normalize_status(:error), do: :error
  defp normalize_status(_), do: :error

  defp stringify_keys(%_{} = struct), do: struct

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
