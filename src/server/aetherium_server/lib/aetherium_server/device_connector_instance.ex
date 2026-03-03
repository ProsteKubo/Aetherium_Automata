defmodule AetheriumServer.DeviceConnectorInstance do
  @moduledoc """
  Static connector instance configuration loaded at server boot.
  """

  @enforce_keys [:id, :type, :module]
  defstruct [:id, :type, :module, enabled: true, options: []]

  @type t :: %__MODULE__{
          id: String.t(),
          type: atom(),
          module: module(),
          enabled: boolean(),
          options: keyword() | map()
        }
end
