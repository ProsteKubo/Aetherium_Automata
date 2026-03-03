defmodule AetheriumServer.DeviceTransports.SerialPlugin do
  @moduledoc false

  @behaviour AetheriumServer.DeviceTransportPlugin

  @impl true
  def child_spec(opts) do
    AetheriumServer.DeviceConnectors.SerialConnector.child_spec(
      %AetheriumServer.DeviceConnectorInstance{
        id: "serial_legacy_plugin",
        type: :serial,
        module: AetheriumServer.DeviceConnectors.SerialConnector,
        options: opts
      }
    )
  end
end
