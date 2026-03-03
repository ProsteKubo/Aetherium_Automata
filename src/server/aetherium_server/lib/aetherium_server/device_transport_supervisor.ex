defmodule AetheriumServer.DeviceTransportSupervisor do
  @moduledoc false

  # Backward-compatible alias during connector-host transition.
  defdelegate start_link(opts \\ []), to: AetheriumServer.DeviceConnectorSupervisor
end
