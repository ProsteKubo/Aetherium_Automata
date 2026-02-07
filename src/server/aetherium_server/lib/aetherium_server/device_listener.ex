defmodule AetheriumServer.DeviceListener do
  @moduledoc false

  use Supervisor
  require Logger

  @default_port 4000
  @default_bind_ip "0.0.0.0"

  def start_link(opts \\ []) do
    Supervisor.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @impl true
  def init(_opts) do
    cfg = Application.get_env(:aetherium_server, :device_listener, [])
    port = cfg[:port] || @default_port
    bind_ip = cfg[:bind_ip] || @default_bind_ip

    Logger.info("Starting device WS listener on #{bind_ip}:#{port}")

    children = [
      Plug.Cowboy.child_spec(
        scheme: :http,
        plug: AetheriumServer.DeviceRouter,
        options: [
          port: port,
          ip: parse_ip!(bind_ip),
          dispatch: dispatch()
        ]
      )
    ]

    Supervisor.init(children, strategy: :one_for_one)
  end

  defp dispatch do
    [
      {:_, [
        {"/socket/device/websocket", AetheriumServer.DeviceWebSocket, []},
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
