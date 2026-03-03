defmodule AetheriumServer.DeviceTransports.SerialPortSession do
  @moduledoc false

  use GenServer
  require Logger

  alias AetheriumServer.DeviceIngress
  alias AetheriumServer.DeviceManager
  alias AetheriumServer.DeviceSessionRef
  alias AetheriumServer.EngineProtocol
  alias AetheriumServer.EngineProtocolStream

  defstruct uart: nil,
            connector_instance: nil,
            session_ref: nil,
            port_name: nil,
            baud_rate: 115_200,
            retry_interval: 3_000,
            port_open?: false,
            buffer: <<>>,
            device_id: nil

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts)
  end

  @impl true
  def init(opts) do
    Process.flag(:trap_exit, true)

    {:ok, uart} = Circuits.UART.start_link()

    state = %__MODULE__{
      uart: uart,
      connector_instance: Keyword.fetch!(opts, :connector_instance),
      port_name: Keyword.fetch!(opts, :port_name),
      baud_rate: Keyword.get(opts, :baud_rate, 115_200),
      retry_interval: Keyword.get(opts, :retry_interval, 3_000)
    }

    state = put_session_ref(state)
    AetheriumServer.ConnectorRegistry.register_session(state.session_ref)

    send(self(), :open_port)
    {:ok, state}
  end

  @impl true
  def handle_info(:open_port, state) do
    case Circuits.UART.open(state.uart, state.port_name, speed: state.baud_rate, active: true) do
      :ok ->
        Logger.info("Serial port opened: #{state.port_name}")
        {:noreply, %{state | port_open?: true, buffer: <<>>}}

      {:error, reason} ->
        Logger.warning("Failed to open serial port #{state.port_name}: #{inspect(reason)}")
        Process.send_after(self(), :open_port, state.retry_interval)
        {:noreply, %{state | port_open?: false}}
    end
  end

  def handle_info({:circuits_uart, _port_name, data}, state) when is_binary(data) do
    {frames, rest} = EngineProtocolStream.extract_frames(state.buffer <> data)
    state = %{state | buffer: rest}

    new_state =
      Enum.reduce(frames, state, fn frame, acc ->
        case EngineProtocol.decode(frame) do
          {:ok, type, payload} ->
            case DeviceIngress.route(type, payload, acc.device_id, acc.session_ref) do
              {:ok, device_id} ->
                %{acc | device_id: device_id || acc.device_id}
            end

          {:error, reason} ->
            Logger.debug("Serial decode error on #{acc.port_name}: #{inspect(reason)}")
            acc
        end
      end)

    {:noreply, new_state}
  end

  def handle_info({:circuits_uart, _port_name, {:error, reason}}, state) do
    Logger.warning("Serial UART error on #{state.port_name}: #{inspect(reason)}")
    {:noreply, handle_disconnect(state)}
  end

  def handle_info({:circuits_uart, _port_name, :closed}, state) do
    Logger.info("Serial port closed: #{state.port_name}")
    {:noreply, handle_disconnect(state)}
  end

  def handle_info({:send_binary, data}, state) when is_binary(data) do
    if state.port_open? do
      case Circuits.UART.write(state.uart, data) do
        :ok ->
          :ok

        {:error, reason} ->
          Logger.warning("Failed writing to #{state.port_name}: #{inspect(reason)}")
      end
    end

    {:noreply, state}
  end

  def handle_info(:close_serial_session, state) do
    {:stop, :normal, state}
  end

  def handle_info(_msg, state), do: {:noreply, state}

  @impl true
  def terminate(_reason, state) do
    maybe_notify_disconnect(state.device_id)

    if state.session_ref,
      do: AetheriumServer.ConnectorRegistry.unregister_session(state.session_ref)

    :ok
  end

  defp handle_disconnect(state) do
    maybe_notify_disconnect(state.device_id)
    _ = safe_close(state)
    Process.send_after(self(), :open_port, state.retry_interval)
    %{state | port_open?: false, device_id: nil, buffer: <<>>}
  end

  defp safe_close(%{port_open?: true, uart: uart}) do
    _ = Circuits.UART.close(uart)
    :ok
  rescue
    _ -> :ok
  end

  defp safe_close(_), do: :ok

  defp maybe_notify_disconnect(nil), do: :ok
  defp maybe_notify_disconnect(device_id), do: DeviceManager.device_disconnected(device_id)

  defp put_session_ref(state) do
    instance = state.connector_instance

    session_ref = %DeviceSessionRef{
      connector_id: instance.id,
      connector_type: :serial,
      connector_module: AetheriumServer.DeviceConnectors.SerialConnector,
      session_id: "port:" <> state.port_name,
      endpoint: self(),
      monitor_pid: self(),
      metadata:
        AetheriumServer.DeviceConnectors.SerialConnector.normalize_metadata(%{
          port: state.port_name
        })
    }

    %{state | session_ref: session_ref}
  end
end
