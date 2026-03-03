defmodule AetheriumServer.DeviceSessionRef do
  @moduledoc """
  Connector-scoped handle used by the server to communicate with a device session.
  """

  @enforce_keys [:connector_id, :connector_type, :connector_module, :session_id]
  defstruct [
    :connector_id,
    :connector_type,
    :connector_module,
    :session_id,
    :endpoint,
    :monitor_pid,
    metadata: %{}
  ]

  @type t :: %__MODULE__{
          connector_id: String.t(),
          connector_type: atom(),
          connector_module: module(),
          session_id: String.t(),
          endpoint: term(),
          monitor_pid: pid() | nil,
          metadata: map()
        }
end
