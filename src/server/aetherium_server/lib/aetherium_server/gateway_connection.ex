defmodule AetheriumServer.GatewayConnection do
  use GenServer
  require Logger

  @default_url "ws://localhost:4000/socket"
  @default_auth_token "server_secret_token"
  @default_server_id "srv_01"
  @default_heartbeat_interval 10_000
  @default_join_retry_interval 2_000

  def start_link(_opts) do
    GenServer.start_link(__MODULE__, nil, name: __MODULE__)
  end

  def init(_opts) do
    config = Application.fetch_env!(:aetherium_server, :gateway)

    url = config[:url] || @default_url
    token = config[:auth_token] || @default_auth_token
    server_id = config[:server_id] || @default_server_id

    heartbeat_interval = config[:heartbeat_interval] || @default_heartbeat_interval
    join_retry_interval = config[:join_retry_interval] || @default_join_retry_interval

    {:ok, socket} = PhoenixClient.Socket.start_link(
      url: url,
      params: %{
        "token" => token,
        "server_id" => server_id
      }
    )

    send(self(), :try_join)

    {:ok,
     %{
       socket: socket,
       channel: nil,
       config: config,
       url: url,
       token: token,
       server_id: server_id,
       heartbeat_interval: heartbeat_interval,
       join_retry_interval: join_retry_interval
     }}
  end

  def report_devices(devices) do
    GenServer.cast(__MODULE__, {:report_devices, devices})
  end

  def report_alert(alert) do
    GenServer.cast(__MODULE__, {:report_alert, alert})
  end

  @impl true
  def handle_cast({:report_devices, devices}, %{channel: channel} = state) when not is_nil(channel) do
    PhoenixClient.Channel.push_async(channel, "device_update", %{"devices" => devices})
    {:noreply, state}
  end

  def handle_cast({:report_devices, _devices}, state) do
    {:noreply, state}
  end

  @impl true
  def handle_cast({:report_alert, alert}, %{channel: channel} = state) when not is_nil(channel) do
    PhoenixClient.Channel.push_async(channel, "device_alert", alert)
    {:noreply, state}
  end

  def handle_cast({:report_alert, _alert}, state) do
    {:noreply, state}
  end

  @impl true
  def handle_info(:send_heartbeat, %{channel: nil} = state) do
    {:noreply, state}
  end

  def handle_info(:send_heartbeat, %{channel: channel, heartbeat_interval: heartbeat_interval} = state) do
    PhoenixClient.Channel.push(channel, "heartbeat", %{})
    Process.send_after(self(), :send_heartbeat, heartbeat_interval)
    {:noreply, state}
  end

  @impl true
  def handle_info(:try_join, %{socket: socket} = state) do
    join_payload = %{"token" => state.token, "server_id" => state.server_id}

    case PhoenixClient.Channel.join(socket, "server:gateway", join_payload) do
      {:ok, _response, channel} ->
        Logger.info("Connected to gateway and joined server:gateway")
        Process.send_after(self(), :send_heartbeat, state.heartbeat_interval)
        {:noreply, %{state | channel: channel}}

      {:error, :socket_not_connected} ->
        Process.send_after(self(), :try_join, state.join_retry_interval)
        {:noreply, state}

      {:error, reason} ->
        Logger.warn("Failed to join server:gateway: #{inspect(reason)}")
        Process.send_after(self(), :try_join, state.join_retry_interval)
        {:noreply, state}
    end
  end

  def handle_info(%PhoenixClient.Message{event: "device_command", payload: payload}, state) do
    Logger.info("Received command from gateway: #{inspect(payload)}")
    {:noreply, state}
  end

  def handle_info({:disconnected, reason, _transport_pid}, state) do
    Logger.warn("Disconnected from gateway: #{inspect(reason)}")
    Process.send_after(self(), :try_join, state.join_retry_interval)
    {:noreply, %{state | channel: nil}}
  end
end
