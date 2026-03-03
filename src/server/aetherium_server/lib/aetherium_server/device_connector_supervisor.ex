defmodule AetheriumServer.DeviceConnectorSupervisor do
  @moduledoc false

  use Supervisor
  require Logger

  alias AetheriumServer.DeviceConnectorInstance

  @default_connector_id "ws_default"

  def start_link(opts \\ []) do
    Supervisor.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @spec connector_statuses() :: [map()]
  def connector_statuses do
    running_by_id =
      __MODULE__
      |> Supervisor.which_children()
      |> Enum.reduce(%{}, fn
        {id_tuple, pid, _type, _modules}, acc when is_pid(pid) ->
          case connector_id_from_child(id_tuple) do
            nil -> acc
            connector_id -> Map.put(acc, connector_id, pid)
          end

        _, acc ->
          acc
      end)

    configured_instances()
    |> Enum.map(fn instance ->
      pid = Map.get(running_by_id, instance.id)

      %{
        id: instance.id,
        type: instance.type |> to_string(),
        enabled: instance.enabled,
        status: connector_runtime_status(instance.enabled, pid),
        pid: if(is_pid(pid), do: inspect(pid), else: nil)
      }
    end)
  rescue
    _ -> []
  end

  @spec configured_instances() :: [DeviceConnectorInstance.t()]
  def configured_instances do
    Application.get_env(:aetherium_server, :device_connectors, nil)
    |> normalize_connector_instances()
  end

  @impl true
  def init(_opts) do
    instances =
      configured_instances()
      |> Enum.filter(& &1.enabled)

    Logger.info(
      "Starting device connectors: #{Enum.map_join(instances, ", ", fn i -> "#{i.id}(#{i.type})" end)}"
    )

    children =
      Enum.map(instances, fn %DeviceConnectorInstance{module: module} = instance ->
        module.child_spec(instance)
      end)

    Supervisor.init(children, strategy: :one_for_one)
  end

  defp normalize_connector_instances(nil) do
    [legacy_default_websocket_instance()] ++ legacy_serial_instances() ++ legacy_ros2_instances()
  end

  defp normalize_connector_instances(instances) when is_list(instances) do
    Enum.map(instances, &normalize_instance!/1)
  end

  defp normalize_instance!(%DeviceConnectorInstance{} = instance), do: instance

  defp normalize_instance!(raw) when is_map(raw) do
    raw
    |> Map.to_list()
    |> normalize_instance!()
  end

  defp normalize_instance!(raw) when is_list(raw) do
    id = Keyword.fetch!(raw, :id) |> to_string()
    type = raw |> Keyword.fetch!(:type) |> normalize_type!()
    enabled = Keyword.get(raw, :enabled, true)
    options = Keyword.get(raw, :options, [])
    module = Keyword.get(raw, :module, module_for_type!(type))

    %DeviceConnectorInstance{
      id: id,
      type: type,
      enabled: enabled,
      options: options,
      module: module
    }
  end

  defp normalize_type!(type) when is_atom(type), do: type
  defp normalize_type!(type) when is_binary(type), do: String.to_atom(type)

  defp module_for_type!(:websocket), do: AetheriumServer.DeviceConnectors.WebSocketConnector
  defp module_for_type!(:serial), do: AetheriumServer.DeviceConnectors.SerialConnector
  defp module_for_type!(:ros2), do: AetheriumServer.DeviceConnectors.Ros2Connector

  defp module_for_type!(type),
    do: raise(ArgumentError, "unsupported connector type: #{inspect(type)}")

  defp legacy_default_websocket_instance do
    listener_cfg = Application.get_env(:aetherium_server, :device_listener, [])

    %DeviceConnectorInstance{
      id: @default_connector_id,
      type: :websocket,
      module: AetheriumServer.DeviceConnectors.WebSocketConnector,
      enabled: true,
      options: [
        bind_ip: listener_cfg[:bind_ip] || "0.0.0.0",
        port: listener_cfg[:port] || 4000,
        path: listener_cfg[:path] || "/socket/device/websocket"
      ]
    }
  end

  defp legacy_serial_instances do
    serial_cfg = Application.get_env(:aetherium_server, :serial_transport, [])

    if serial_cfg[:enabled] do
      [
        %DeviceConnectorInstance{
          id: "serial_default",
          type: :serial,
          module: AetheriumServer.DeviceConnectors.SerialConnector,
          enabled: true,
          options: serial_cfg
        }
      ]
    else
      []
    end
  end

  defp legacy_ros2_instances do
    ros2_cfg = Application.get_env(:aetherium_server, :ros2_transport, [])

    if ros2_cfg[:enabled] do
      [
        %DeviceConnectorInstance{
          id: "ros2_default",
          type: :ros2,
          module: AetheriumServer.DeviceConnectors.Ros2Connector,
          enabled: true,
          options: ros2_cfg
        }
      ]
    else
      []
    end
  end

  defp connector_id_from_child({:websocket_connector, id}), do: to_string(id)
  defp connector_id_from_child({:serial_connector, id}), do: to_string(id)
  defp connector_id_from_child({:ros2_connector, id}), do: to_string(id)
  defp connector_id_from_child(_), do: nil

  defp connector_runtime_status(false, _pid), do: "disabled"
  defp connector_runtime_status(true, pid) when is_pid(pid), do: "running"
  defp connector_runtime_status(true, _pid), do: "stopped"
end
