defmodule AetheriumServer.DeviceConnectors.SerialConnector do
  @moduledoc false

  use Supervisor
  require Logger

  @behaviour AetheriumServer.DeviceConnector

  alias AetheriumServer.DeviceConnectorInstance
  alias AetheriumServer.DeviceSessionRef

  @macos_globs ["/dev/cu.usb*", "/dev/cu.wchusb*", "/dev/cu.SLAB*"]
  @linux_globs ["/dev/ttyACM*", "/dev/ttyUSB*"]

  @impl true
  def child_spec(%DeviceConnectorInstance{} = instance) do
    %{
      id: {:serial_connector, instance.id},
      start: {__MODULE__, :start_link, [instance]}
    }
  end

  def start_link(%DeviceConnectorInstance{} = instance) do
    Supervisor.start_link(__MODULE__, instance)
  end

  @impl true
  def init(%DeviceConnectorInstance{} = instance) do
    opts = normalize_options(instance.options)
    ports = resolve_ports(Keyword.get(opts, :ports, :auto))
    baud_rate = Keyword.get(opts, :baud_rate, 115_200)
    retry_interval = Keyword.get(opts, :retry_interval, 3_000)

    if ports == [] do
      Logger.warning("Serial connector #{instance.id} enabled but no ports resolved")
    else
      Logger.info(
        "Starting serial connector #{instance.id} on #{Enum.join(ports, ", ")} @ #{baud_rate} baud"
      )
    end

    children =
      Enum.map(ports, fn port_name ->
        %{
          id: {AetheriumServer.DeviceTransports.SerialPortSession, instance.id, port_name},
          start:
            {AetheriumServer.DeviceTransports.SerialPortSession, :start_link,
             [
               [
                 connector_instance: instance,
                 port_name: port_name,
                 baud_rate: baud_rate,
                 retry_interval: retry_interval
               ]
             ]}
        }
      end)

    Supervisor.init(children, strategy: :one_for_one)
  end

  @impl true
  def connector_type, do: :serial

  @impl true
  def normalize_metadata(raw) when is_map(raw) do
    %{
      transport: "serial",
      link: raw[:port] || raw["port"]
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
    send(pid, :close_serial_session)
    :ok
  end

  def close_session(_session_ref, _reason), do: {:error, :invalid_endpoint}

  defp normalize_options(opts) when is_map(opts), do: Map.to_list(opts)
  defp normalize_options(opts) when is_list(opts), do: opts
  defp normalize_options(_), do: []

  defp resolve_ports(:auto), do: resolve_ports("auto")

  defp resolve_ports("auto") do
    (@macos_globs ++ @linux_globs)
    |> Enum.flat_map(&Path.wildcard/1)
    |> Enum.uniq()
    |> Enum.sort()
  end

  defp resolve_ports(ports) when is_list(ports) do
    ports
    |> Enum.map(&String.trim(to_string(&1)))
    |> Enum.reject(&(&1 == ""))
    |> Enum.uniq()
  end

  defp resolve_ports(port) when is_binary(port), do: [port]
  defp resolve_ports(_), do: []
end
