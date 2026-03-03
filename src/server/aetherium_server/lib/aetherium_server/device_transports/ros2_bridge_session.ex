defmodule AetheriumServer.DeviceTransports.Ros2BridgeSession do
  @moduledoc false

  use GenServer
  require Logger

  alias AetheriumServer.DeviceIngress
  alias AetheriumServer.DeviceManager
  alias AetheriumServer.DeviceSessionRef
  alias AetheriumServer.EngineProtocol

  defstruct socket: nil,
            connector_instance: nil,
            session_ref: nil,
            remote: "unknown",
            device_id: nil

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts)
  end

  @impl true
  def init(opts) do
    Process.flag(:trap_exit, true)

    connector_instance = Keyword.fetch!(opts, :connector_instance)
    remote = Keyword.get(opts, :remote, "unknown")
    socket = Keyword.fetch!(opts, :socket)

    state = %__MODULE__{
      connector_instance: connector_instance,
      socket: socket,
      remote: remote
    }

    state = put_session_ref(state)
    AetheriumServer.ConnectorRegistry.register_session(state.session_ref)

    Logger.info(
      "ROS2 bridge session connected on #{connector_instance.id} from #{remote} (#{state.session_ref.session_id})"
    )

    {:ok, state}
  end

  @impl true
  def handle_info(:activate_socket, state) do
    :ok = :inet.setopts(state.socket, active: :once)
    {:noreply, state}
  end

  def handle_info({:tcp, socket, line}, %{socket: socket} = state) when is_binary(line) do
    next_state =
      case decode_bridge_frame(line) do
        {:ok, frame} ->
          route_frame(frame, state)

        {:error, reason} ->
          Logger.debug("ROS2 bridge frame decode error (#{state.remote}): #{inspect(reason)}")
          state
      end

    :ok = :inet.setopts(socket, active: :once)
    {:noreply, next_state}
  end

  def handle_info({:tcp_closed, _socket}, state) do
    Logger.info("ROS2 bridge session disconnected: #{state.remote}")
    {:stop, :normal, state}
  end

  def handle_info({:tcp_error, _socket, reason}, state) do
    Logger.warning("ROS2 bridge TCP error (#{state.remote}): #{inspect(reason)}")
    {:stop, {:tcp_error, reason}, state}
  end

  def handle_info({:send_binary, binary}, state) when is_binary(binary) do
    outbound = Jason.encode!(%{"frame_b64" => Base.encode64(binary)}) <> "\n"

    case :gen_tcp.send(state.socket, outbound) do
      :ok ->
        {:noreply, state}

      {:error, reason} ->
        Logger.warning("ROS2 bridge send failed (#{state.remote}): #{inspect(reason)}")
        {:stop, {:send_failed, reason}, state}
    end
  end

  def handle_info({:close_session, reason}, state) do
    {:stop, {:connector_close, reason}, state}
  end

  def handle_info(_msg, state), do: {:noreply, state}

  @impl true
  def terminate(_reason, state) do
    maybe_notify_disconnect(state.device_id)

    if state.session_ref,
      do: AetheriumServer.ConnectorRegistry.unregister_session(state.session_ref)

    if state.socket, do: :gen_tcp.close(state.socket)
    :ok
  end

  defp route_frame(frame, state) do
    case EngineProtocol.decode(frame) do
      {:ok, type, payload} ->
        case DeviceIngress.route(type, payload, state.device_id, state.session_ref) do
          {:ok, device_id} ->
            %{state | device_id: device_id || state.device_id}
        end

      {:error, reason} ->
        Logger.debug("ROS2 bridge protocol decode error (#{state.remote}): #{inspect(reason)}")
        state
    end
  end

  defp decode_bridge_frame(line) when is_binary(line) do
    payload =
      line
      |> String.trim()

    cond do
      payload == "" ->
        {:error, :empty_payload}

      String.starts_with?(payload, "{") ->
        with {:ok, decoded} <- Jason.decode(payload),
             {:ok, frame} <- frame_from_json(decoded) do
          {:ok, frame}
        else
          {:error, reason} -> {:error, reason}
        end

      true ->
        Base.decode64(payload)
    end
  end

  defp frame_from_json(%{"frame_b64" => encoded}) when is_binary(encoded),
    do: Base.decode64(encoded)

  defp frame_from_json(%{"payload_b64" => encoded}) when is_binary(encoded),
    do: Base.decode64(encoded)

  defp frame_from_json(%{"data" => encoded}) when is_binary(encoded), do: Base.decode64(encoded)
  defp frame_from_json(_json), do: {:error, :missing_frame_b64}

  defp maybe_notify_disconnect(nil), do: :ok
  defp maybe_notify_disconnect(device_id), do: DeviceManager.device_disconnected(device_id)

  defp put_session_ref(state) do
    instance = state.connector_instance
    session_id = generate_id()

    session_ref = %DeviceSessionRef{
      connector_id: instance.id,
      connector_type: :ros2,
      connector_module: AetheriumServer.DeviceConnectors.Ros2Connector,
      session_id: session_id,
      endpoint: self(),
      monitor_pid: self(),
      metadata:
        AetheriumServer.DeviceConnectors.Ros2Connector.normalize_metadata(%{
          link: "ros2://#{instance.id}",
          remote: state.remote
        })
    }

    %{state | session_ref: session_ref}
  end

  defp generate_id do
    "ros2-" <> (:crypto.strong_rand_bytes(8) |> Base.encode16(case: :lower))
  end
end
