defmodule AetheriumServer.DeviceConnectors.Ros2Connector do
  @moduledoc false

  use Supervisor

  @behaviour AetheriumServer.DeviceConnector

  alias AetheriumServer.DeviceConnectorInstance
  alias AetheriumServer.DeviceSessionRef

  @impl true
  def child_spec(%DeviceConnectorInstance{} = instance) do
    %{
      id: {:ros2_connector, instance.id},
      start: {__MODULE__, :start_link, [instance]}
    }
  end

  def start_link(%DeviceConnectorInstance{} = instance) do
    Supervisor.start_link(__MODULE__, instance)
  end

  @impl true
  def init(%DeviceConnectorInstance{} = instance) do
    children = [
      %{
        id: {AetheriumServer.DeviceTransports.Ros2BridgeListener, instance.id},
        start:
          {AetheriumServer.DeviceTransports.Ros2BridgeListener, :start_link,
           [[connector_instance: instance, listener_config: normalize_options(instance.options)]]}
      }
    ]

    Supervisor.init(children, strategy: :one_for_one)
  end

  @impl true
  def connector_type, do: :ros2

  @impl true
  def normalize_metadata(raw) when is_map(raw) do
    %{
      transport: "ros2_bridge",
      link: raw[:link] || raw["link"],
      remote: raw[:remote] || raw["remote"]
    }
    |> Enum.reject(fn {_k, v} -> is_nil(v) end)
    |> Map.new()
  end

  @impl true
  def send_frame(%DeviceSessionRef{endpoint: pid}, binary)
      when is_pid(pid) and is_binary(binary) do
    send(pid, {:send_binary, binary})
    :ok
  end

  def send_frame(_session_ref, _binary), do: {:error, :invalid_endpoint}

  @impl true
  def close_session(%DeviceSessionRef{endpoint: pid}, reason) when is_pid(pid) do
    send(pid, {:close_session, reason})
    :ok
  end

  def close_session(_session_ref, _reason), do: {:error, :invalid_endpoint}

  defp normalize_options(opts) when is_map(opts), do: Map.to_list(opts)
  defp normalize_options(opts) when is_list(opts), do: opts
  defp normalize_options(_), do: []
end
