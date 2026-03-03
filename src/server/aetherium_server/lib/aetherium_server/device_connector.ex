defmodule AetheriumServer.DeviceConnector do
  @moduledoc """
  Behaviour for connector modules that host device sessions (websocket, serial, ...).
  """

  alias AetheriumServer.DeviceConnectorInstance
  alias AetheriumServer.DeviceSessionRef

  @callback child_spec(DeviceConnectorInstance.t()) :: Supervisor.child_spec()
  @callback connector_type() :: atom()
  @callback normalize_metadata(map()) :: map()
  @callback send_frame(DeviceSessionRef.t(), binary()) :: :ok | {:error, term()}
  @callback close_session(DeviceSessionRef.t(), term()) :: :ok | {:error, term()}

  @spec send_frame(DeviceSessionRef.t(), binary()) :: :ok | {:error, term()}
  def send_frame(%DeviceSessionRef{connector_module: module} = session_ref, binary)
      when is_atom(module) and is_binary(binary) do
    module.send_frame(session_ref, binary)
  end

  @spec close_session(DeviceSessionRef.t(), term()) :: :ok | {:error, term()}
  def close_session(%DeviceSessionRef{connector_module: module} = session_ref, reason)
      when is_atom(module) do
    module.close_session(session_ref, reason)
  end
end
