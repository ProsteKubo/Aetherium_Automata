defmodule AetheriumServer.DeviceWebSocket do
  @moduledoc false

  @behaviour :cowboy_websocket
  require Logger

  alias AetheriumServer.DeviceIngress
  alias AetheriumServer.DeviceSessionRef
  alias AetheriumServer.EngineProtocol

  @impl true
  def init(req, opts) do
    connector_instance = Keyword.get(opts, :connector_instance)

    {:cowboy_websocket, req,
     %{
       device_id: nil,
       connector_instance: connector_instance,
       session_ref: nil,
       target_id: 0,
       next_msg_id: 1,
       run_id: nil
     }}
  end

  @impl true
  def websocket_init(state) do
    connector_instance = state.connector_instance

    session_ref = %DeviceSessionRef{
      connector_id: (connector_instance && connector_instance.id) || "ws_default",
      connector_type: :websocket,
      connector_module: AetheriumServer.DeviceConnectors.WebSocketConnector,
      session_id: generate_id(),
      endpoint: self(),
      monitor_pid: self(),
      metadata:
        AetheriumServer.DeviceConnectors.WebSocketConnector.normalize_metadata(%{
          path: connector_instance && option(connector_instance.options, :path, nil)
        })
    }

    AetheriumServer.ConnectorRegistry.register_session(session_ref)
    {:ok, %{state | session_ref: session_ref}}
  end

  @impl true
  def websocket_handle({:binary, data}, state) do
    case EngineProtocol.decode(data) do
      {:ok, type, payload} ->
        case DeviceIngress.route(type, payload, state.device_id, state.session_ref) do
          {:ok, device_id} -> {:ok, %{state | device_id: device_id || state.device_id}}
        end

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

  def websocket_info({:close_socket, _reason}, state) do
    {:stop, state}
  end

  def websocket_info(_msg, state), do: {:ok, state}

  @impl true
  def terminate(_reason, _req, state) do
    if state.device_id, do: AetheriumServer.DeviceManager.device_disconnected(state.device_id)

    if state.session_ref,
      do: AetheriumServer.ConnectorRegistry.unregister_session(state.session_ref)

    :ok
  end

  defp generate_id do
    :crypto.strong_rand_bytes(8) |> Base.encode16(case: :lower)
  end

  defp option(opts, key, default) when is_list(opts), do: Keyword.get(opts, key, default)
  defp option(opts, key, default) when is_map(opts), do: Map.get(opts, key, default)
  defp option(_opts, _key, default), do: default
end
