defmodule AetheriumServer.DeviceTransportPlugin do
  @moduledoc """
  Behaviour for pluggable device communication transports (WebSocket, serial, etc.).
  """

  @callback child_spec(keyword()) :: Supervisor.child_spec()
end
