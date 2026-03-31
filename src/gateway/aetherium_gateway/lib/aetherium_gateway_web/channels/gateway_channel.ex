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

  # UI sends command: {"event": "restart_device", "payload": {"device_id": "dev_123"}}
  def handle_in("restart_device", %{"device_id" => device_id}, socket) do
    # Log the command
    log(:info, "UI issued restart for #{device_id}", socket)

    # Simulate async device restart
    Process.send_after(self(), {:device_restarted, device_id}, 2000)

    {:reply, {:ok, %{status: "restart_queued"}}, socket}
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

  def handle_info({:device_restarted, device_id}, socket) do
    log(:info, "Device #{device_id} successfully restarted", socket)

    push(socket, "alert", %{
      type: "device_restarted",
      severity: "info",
      device_id: device_id,
      message: "Device restarted and reconnected",
      timestamp: DateTime.utc_now()
    })

    send(self(), :send_device_list)
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

  # Helper to send logs to UI
  defp log(level, message, socket) do
    push(socket, "log", %{
      level: level,
      message: message,
      timestamp: DateTime.utc_now(),
      ui_session: socket.assigns.ui_session_id
    })
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
