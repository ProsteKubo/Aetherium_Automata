defmodule AetheriumGatewayWeb.GatewayChannel do
  use AetheriumGatewayWeb, :channel

  # UI joins "gateway:control"
  def join("gateway:control", payload, socket) do
    # Try payload first, then socket assigns
    token = payload["token"] || socket.assigns[:token]

    if token == "dev_secret_token" do
      socket = assign(socket, :ui_session_id, generate_session_id())
      send(self(), :send_device_list)
      {:ok, socket}
    else
      {:error, %{reason: "invalid_token"}}
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
    send(self(), :send_device_list)
    {:noreply, socket}
  end

  # Handle internal alerts
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
    # Get fake device list (replace with real registry later)
    devices = get_fake_device_list()

    push(socket, "device_list", %{devices: devices})
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

  # Fake device data for now
  defp get_fake_device_list do
    [
      %{id: "dev_001", status: "online", last_seen: DateTime.utc_now(), temp: 23.5},
      %{id: "dev_002", status: "offline", last_seen: DateTime.add(DateTime.utc_now(), -300), temp: nil},
      %{id: "dev_003", status: "error", last_seen: DateTime.utc_now(), error: "lua_timeout"}
    ]
  end

  defp generate_session_id do
    :crypto.strong_rand_bytes(16)
    |> Base.encode16(case: :lower)
  end
end
