defmodule AetheriumServer.Application do
  # See https://hexdocs.pm/elixir/Application.html
  # for more information on OTP Applications
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    children = [
      # Registry for runtime processes
      {Registry, keys: :unique, name: AetheriumServer.RuntimeRegistry},
      AetheriumServer.ConnectorRegistry,
      # Dynamic supervisor for automata runtimes
      {DynamicSupervisor, name: AetheriumServer.RuntimeSupervisor, strategy: :one_for_one},
      # Core services
      AetheriumServer.TimeSeriesInfluxSink,
      AetheriumServer.TimeSeriesStore,
      AetheriumServer.DeviceManager,
      AetheriumServer.GatewayConnection,
      AetheriumServer.DeviceConnectorSupervisor
    ]

    # See https://hexdocs.pm/elixir/Supervisor.html
    # for other strategies and supported options
    opts = [strategy: :one_for_one, name: AetheriumServer.Supervisor]
    Supervisor.start_link(children, opts)
  end
end
