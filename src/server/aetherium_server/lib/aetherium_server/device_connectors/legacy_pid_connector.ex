defmodule AetheriumServer.DeviceConnectors.LegacyPidConnector do
  @moduledoc false

  @behaviour AetheriumServer.DeviceConnector

  alias AetheriumServer.DeviceConnectorInstance
  alias AetheriumServer.DeviceSessionRef

  @impl true
  def child_spec(%DeviceConnectorInstance{}), do: raise("legacy pid connector is not startable")

  @impl true
  def connector_type, do: :unknown

  @impl true
  def normalize_metadata(raw) when is_map(raw), do: raw

  @impl true
  def send_frame(%DeviceSessionRef{endpoint: pid}, binary)
      when is_pid(pid) and is_binary(binary) do
    send(pid, {:send_binary, binary})
    :ok
  end

  def send_frame(_session_ref, _binary), do: {:error, :invalid_endpoint}

  @impl true
  def close_session(%DeviceSessionRef{endpoint: pid}, _reason) when is_pid(pid) do
    Process.exit(pid, :normal)
    :ok
  catch
    :exit, _ -> :ok
  end

  def close_session(_session_ref, _reason), do: {:error, :invalid_endpoint}
end
