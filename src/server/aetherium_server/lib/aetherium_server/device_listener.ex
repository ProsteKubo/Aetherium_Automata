defmodule AetheriumServer.DeviceListener do
  @moduledoc false

  use Supervisor
  require Logger

  @default_port 4000
  @default_bind_ip "0.0.0.0"
  @default_path "/socket/device/websocket"

  def start_link(opts \\ []) do
    Supervisor.start_link(__MODULE__, opts)
  end

  @impl true
  def init(opts) do
    connector_instance = Keyword.get(opts, :connector_instance)
    cfg = Keyword.get(opts, :listener_config, [])

    port = cfg[:port] || opts[:port] || @default_port
    bind_ip = cfg[:bind_ip] || opts[:bind_ip] || @default_bind_ip
    path = cfg[:path] || opts[:path] || @default_path

    connector_id = (connector_instance && connector_instance.id) || "ws_default"
    Logger.info("Starting device WS listener #{connector_id} on #{bind_ip}:#{port}#{path}")

    children = [
      Plug.Cowboy.child_spec(
        scheme: :http,
        plug: AetheriumServer.DeviceRouter,
        options: [
          port: port,
          ip: parse_ip!(bind_ip),
          dispatch: dispatch(path, connector_instance)
        ]
      )
    ]

    Supervisor.init(children, strategy: :one_for_one)
  end

  defp dispatch(path, connector_instance) do
    [
      {:_,
       [
         {path, AetheriumServer.DeviceWebSocket, [connector_instance: connector_instance]},
         {:_, Plug.Cowboy.Handler, {AetheriumServer.DeviceRouter, []}}
       ]}
    ]
  end

  defp parse_ip!(ip) when is_binary(ip) do
    case ip |> String.to_charlist() |> :inet.parse_address() do
      {:ok, tuple} -> tuple
      {:error, _} -> raise ArgumentError, "invalid BIND_IP: #{inspect(ip)}"
    end
  end
end
