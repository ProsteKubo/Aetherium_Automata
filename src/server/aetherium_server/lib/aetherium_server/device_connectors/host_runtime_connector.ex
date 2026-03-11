defmodule AetheriumServer.DeviceConnectors.HostRuntimeConnector do
  @moduledoc """
  No-op connector used for the server-local host runtime device.
  """

  @behaviour AetheriumServer.DeviceConnector

  alias AetheriumServer.DeviceConnectorInstance
  alias AetheriumServer.DeviceSessionRef

  @impl true
  def child_spec(%DeviceConnectorInstance{} = instance) do
    %{
      id: {:host_runtime_connector, instance.id},
      start: {Task, :start_link, [fn -> Process.sleep(:infinity) end]}
    }
  end

  @impl true
  def connector_type, do: :host_runtime

  @impl true
  def normalize_metadata(metadata) when is_map(metadata), do: metadata

  @impl true
  def send_frame(%DeviceSessionRef{}, _binary), do: :ok

  @impl true
  def close_session(%DeviceSessionRef{}, _reason), do: :ok
end
