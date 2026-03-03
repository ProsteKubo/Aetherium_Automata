defmodule AetheriumServer.DeviceConnectors.WebSocketConnector do
  @moduledoc false

  @behaviour AetheriumServer.DeviceConnector

  alias AetheriumServer.DeviceConnectorInstance
  alias AetheriumServer.DeviceSessionRef

  @impl true
  def child_spec(%DeviceConnectorInstance{} = instance) do
    %{
      id: {:websocket_connector, instance.id},
      start:
        {AetheriumServer.DeviceListener, :start_link,
         [[connector_instance: instance, listener_config: normalize_options(instance.options)]]}
    }
  end

  @impl true
  def connector_type, do: :websocket

  @impl true
  def normalize_metadata(raw) when is_map(raw) do
    %{
      transport: "websocket",
      link: raw[:path] || raw["path"],
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
  def close_session(%DeviceSessionRef{endpoint: pid}, _reason) when is_pid(pid) do
    send(pid, {:close_socket, :connector_requested})
    :ok
  end

  def close_session(_session_ref, _reason), do: {:error, :invalid_endpoint}

  defp normalize_options(opts) when is_map(opts), do: Map.to_list(opts)
  defp normalize_options(opts) when is_list(opts), do: opts
  defp normalize_options(_), do: []
end
