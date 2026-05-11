defmodule AetheriumGatewayWeb.GatewayChannel do
  use AetheriumGatewayWeb, :channel

  alias AetheriumGateway.Auth
  alias AetheriumGateway.CommandDispatcher
  alias AetheriumGateway.Persistence

  # UI joins "gateway:control"
  @impl true
  def join("gateway:control", payload, socket) do
    token = payload["token"] || socket.assigns[:token]

    case Auth.authorize(:operator, token) do
      {:ok, claims} ->
        socket =
          socket
          |> assign(:ui_session_id, generate_session_id())
          |> assign(:auth_claims, claims)

        send(self(), :send_device_list)
        send(self(), :send_server_list)
        {:ok, socket}

      {:error, reason} ->
        {:error, %{reason: to_string(reason)}}
    end
  end

  def handle_in("ping", _payload, socket) do
    {:reply, {:ok, %{response: "pong", timestamp: DateTime.utc_now()}}, socket}
  end

  def handle_in("list_devices", _payload, socket) do
    devices = AetheriumGateway.ServerTracker.list_devices_flat()
    {:reply, {:ok, %{devices: devices}}, socket}
  end

  def handle_in("list_servers", _payload, socket) do
    servers = AetheriumGateway.ServerTracker.list_servers()
    {:reply, {:ok, %{servers: servers}}, socket}
  end

  @impl true
  def handle_in("list_events", payload, socket) do
    cursor = parse_non_negative_int(payload["cursor"], 0)
    limit = parse_positive_int(payload["limit"], 100)

    {:reply, {:ok, %{events: Persistence.list_events(cursor, limit)}}, socket}
  end

  @impl true
  def handle_in("list_recent_events", payload, socket) do
    limit = parse_positive_int(payload["limit"], 100)
    {:reply, {:ok, %{events: Persistence.list_recent_events(limit)}}, socket}
  end

  @impl true
  def handle_in("outbox_status", _payload, socket) do
    {:reply, {:ok, %{queued_commands: CommandDispatcher.outbox_size()}}, socket}
  end

  # Handle internal alerts
  @impl true
  def handle_info({:device_crashed, device_id, reason}, socket) do
    push(socket, "alert", %{
      type: "device_crash",
      severity: "error",
      device_id: device_id,
      message: "Device crashed: #{inspect(reason)}",
      timestamp: DateTime.utc_now()
    })

    {:noreply, socket}
  end

  def handle_info({:device_disconnected, device_id}, socket) do
    push(socket, "alert", %{
      type: "device_disconnect",
      severity: "warning",
      device_id: device_id,
      message: "Device lost network connection",
      timestamp: DateTime.utc_now()
    })

    # Update device list
    send(self(), :send_device_list)
    {:noreply, socket}
  end

  def handle_info({:lua_error, device_id, error}, socket) do
    push(socket, "alert", %{
      type: "lua_error",
      severity: "error",
      device_id: device_id,
      message: "Lua runtime error: #{error}",
      timestamp: DateTime.utc_now()
    })

    {:noreply, socket}
  end

  def handle_info(:send_device_list, socket) do
    devices = AetheriumGateway.ServerTracker.list_devices_flat()
    push(socket, "device_list", %{devices: devices})
    {:noreply, socket}
  end

  def handle_info(:send_server_list, socket) do
    push(socket, "server_list", %{servers: AetheriumGateway.ServerTracker.list_servers()})
    {:noreply, socket}
  end

  defp generate_session_id do
    :crypto.strong_rand_bytes(16)
    |> Base.encode16(case: :lower)
  end

  defp parse_non_negative_int(value, default)

  defp parse_non_negative_int(value, _default) when is_integer(value) and value >= 0, do: value

  defp parse_non_negative_int(value, default) when is_binary(value) do
    case Integer.parse(value) do
      {n, ""} when n >= 0 -> n
      _ -> default
    end
  end

  defp parse_non_negative_int(_value, default), do: default

  defp parse_positive_int(value, default)

  defp parse_positive_int(value, _default) when is_integer(value) and value > 0, do: value

  defp parse_positive_int(value, default) when is_binary(value) do
    case Integer.parse(value) do
      {n, ""} when n > 0 -> n
      _ -> default
    end
  end

  defp parse_positive_int(_value, default), do: default
end
