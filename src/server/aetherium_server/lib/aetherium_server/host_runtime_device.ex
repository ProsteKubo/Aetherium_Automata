defmodule AetheriumServer.HostRuntimeDevice do
  @moduledoc """
  Registers an optional local host-runtime device so the server itself can run
  automata and appear in the IDE/gateway device list.
  """

  use GenServer

  alias AetheriumServer.ConnectorRegistry
  alias AetheriumServer.DeviceManager
  alias AetheriumServer.DeviceSessionRef
  alias AetheriumServer.DeviceConnectors.HostRuntimeConnector

  @default_device_id "host-runtime"

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @impl true
  def init(_opts) do
    config = Application.get_env(:aetherium_server, :host_runtime_device, [])

    if Keyword.get(config, :enabled, false) do
      send(self(), :register_device)
    end

    {:ok, %{config: config}}
  end

  @impl true
  def handle_info(:register_device, %{config: config} = state) do
    server_id =
      Application.get_env(:aetherium_server, :gateway, [])
      |> Keyword.get(:server_id, "srv_01")

    device_id = Keyword.get(config, :device_id) || "#{@default_device_id}-#{server_id}"
    connector_id = Keyword.get(config, :connector_id) || "host_runtime"

    session_ref = %DeviceSessionRef{
      connector_id: connector_id,
      connector_type: :host_runtime,
      connector_module: HostRuntimeConnector,
      session_id: "host_runtime:#{server_id}",
      endpoint: self(),
      monitor_pid: self(),
      metadata: %{transport: "host_runtime", link: "server://#{server_id}/host_runtime"}
    }

    ConnectorRegistry.register_session(session_ref)

    _ =
      DeviceManager.register_device(
        %{
          device_id: device_id,
          device_type: :desktop,
          connector_id: connector_id,
          connector_type: :host_runtime,
          capabilities: Keyword.get(config, :capabilities, 0),
          protocol_version: 1,
          transport: "host_runtime",
          link: "server://#{server_id}/host_runtime"
        },
        session_ref
      )

    {:noreply, Map.put(state, :device_id, device_id)}
  end
end
