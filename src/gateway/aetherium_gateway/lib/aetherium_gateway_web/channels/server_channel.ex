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
