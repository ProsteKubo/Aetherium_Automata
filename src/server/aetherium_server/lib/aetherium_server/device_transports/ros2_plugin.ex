defmodule AetheriumServer.DeviceTransports.Ros2Plugin do
  @moduledoc false

  @behaviour AetheriumServer.DeviceTransportPlugin

  @impl true
  def child_spec(opts) do
    AetheriumServer.DeviceConnectors.Ros2Connector.child_spec(
      %AetheriumServer.DeviceConnectorInstance{
        id: "ros2_legacy_plugin",
        type: :ros2,
        module: AetheriumServer.DeviceConnectors.Ros2Connector,
        options: opts
      }
    )
  end
end
