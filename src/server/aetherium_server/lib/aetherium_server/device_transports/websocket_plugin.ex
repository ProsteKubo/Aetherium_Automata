defmodule AetheriumServer.DeviceTransports.WebSocketPlugin do
  @moduledoc false

  @behaviour AetheriumServer.DeviceTransportPlugin

  @impl true
  def child_spec(opts),
    do:
      AetheriumServer.DeviceConnectors.WebSocketConnector.child_spec(
        %AetheriumServer.DeviceConnectorInstance{
          id: "ws_legacy_plugin",
          type: :websocket,
          module: AetheriumServer.DeviceConnectors.WebSocketConnector,
          options: opts
        }
      )
end
