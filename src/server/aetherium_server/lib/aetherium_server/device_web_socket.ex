defmodule AetheriumServer.DeviceWebSocket do
  @moduledoc false

  @behaviour :cowboy_websocket
  require Logger

  alias AetheriumServer.EngineProtocol
  alias AetheriumServer.DeviceManager

  @impl true
  def init(req, _opts) do
    {:cowboy_websocket, req, %{device_id: nil, target_id: 0, next_msg_id: 1, run_id: nil}}
  end

  @impl true
  def websocket_init(state) do
    {:ok, state}
  end

  @impl true
  def websocket_handle({:binary, data}, state) do
    case EngineProtocol.decode(data) do
      {:ok, :hello, hello} ->
        device_id = hello.name

        case DeviceManager.register_device(
               %{device_id: device_id, device_type: map_device_type(hello.device_type), capabilities: hello.capabilities, protocol_version: 1},
               self()
             ) do
          {:ok, _device} ->
            {:ok, %{state | device_id: device_id}}

          {:error, reason} ->
            Logger.error("Failed to register device #{inspect(device_id)}: #{inspect(reason)}")
            {:ok, state}
        end

      {:ok, :load_ack, payload} ->
        if state.device_id, do: DeviceManager.handle_device_message(state.device_id, :load_ack, payload)
        {:ok, state}

      {:ok, :state_change, payload} ->
        if state.device_id, do: DeviceManager.handle_device_message(state.device_id, :state_change, payload)
        {:ok, state}

      {:ok, :output, payload} ->
        if state.device_id, do: DeviceManager.handle_device_message(state.device_id, :output, payload)
        {:ok, state}

      {:ok, :telemetry, payload} ->
        if state.device_id, do: DeviceManager.handle_device_message(state.device_id, :telemetry, payload)
        {:ok, state}

      {:ok, :debug, payload} ->
        if state.device_id, do: DeviceManager.handle_device_message(state.device_id, :log, payload)
        {:ok, state}

      {:ok, :error, payload} ->
        if state.device_id, do: DeviceManager.handle_device_message(state.device_id, :error, payload)
        {:ok, state}

      {:ok, :ping, _payload} ->
        if state.device_id, do: DeviceManager.heartbeat(state.device_id)
        {:ok, state}

      {:error, reason} ->
        Logger.debug("WS decode error: #{inspect(reason)}")
        {:ok, state}
    end
  end

  def websocket_handle(_frame, state), do: {:ok, state}

  @impl true
  def websocket_info({:send_binary, data}, state) when is_binary(data) do
    {:reply, {:binary, data}, state}
  end

  def websocket_info(_msg, state), do: {:ok, state}

  @impl true
  def terminate(_reason, _req, state) do
    if state.device_id, do: DeviceManager.device_disconnected(state.device_id)
    :ok
  end

  defp map_device_type(0x01), do: :desktop
  defp map_device_type(0x02), do: :esp32
  defp map_device_type(0x03), do: :pico
  defp map_device_type(0x04), do: :raspberry_pi
  defp map_device_type(0x10), do: :server
  defp map_device_type(0x11), do: :gateway
  defp map_device_type(_), do: :unknown
end
