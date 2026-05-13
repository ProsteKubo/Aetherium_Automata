defmodule AetheriumServer.DeviceIngress do
  @moduledoc false

  require Logger

  alias AetheriumServer.DeviceManager
  alias AetheriumServer.DeviceSessionRef

  @spec route(atom(), map(), String.t() | nil, DeviceSessionRef.t()) :: {:ok, String.t() | nil}
  def route(:hello, hello, _current_device_id, %DeviceSessionRef{} = session_ref) do
    device_id = sanitize_device_id(hello.name, session_ref)
    connector_meta = session_ref.metadata || %{}

    case DeviceManager.register_device(
           %{
             device_id: device_id,
             device_type: map_device_type(hello.device_type),
             capabilities: hello.capabilities,
             protocol_version: 1,
             connector_id: session_ref.connector_id,
             connector_type: session_ref.connector_type,
             transport: connector_meta[:transport] || connector_meta["transport"],
             link: connector_meta[:link] || connector_meta["link"],
             deployment_metadata:
               hello[:deployment_metadata] || hello["deployment_metadata"] || %{}
           },
           session_ref
         ) do
      {:ok, _device} ->
        {:ok, device_id}

      {:error, reason} ->
        Logger.error("Failed to register device #{inspect(device_id)}: #{inspect(reason)}")
        {:ok, nil}
    end
  end

  def route(:load_ack, payload, device_id, _session_ref) do
    if device_id, do: DeviceManager.handle_device_message(device_id, :load_ack, payload)
    {:ok, device_id}
  end

  def route(:state_change, payload, device_id, _session_ref) do
    if device_id, do: DeviceManager.handle_device_message(device_id, :state_change, payload)
    {:ok, device_id}
  end

  def route(:output, payload, device_id, _session_ref) do
    if device_id, do: DeviceManager.handle_device_message(device_id, :output, payload)
    {:ok, device_id}
  end

  def route(:telemetry, payload, device_id, _session_ref) do
    if device_id, do: DeviceManager.handle_device_message(device_id, :telemetry, payload)
    {:ok, device_id}
  end

  def route(:status, payload, device_id, _session_ref) do
    if device_id, do: DeviceManager.handle_device_message(device_id, :status, payload)
    {:ok, device_id}
  end

  def route(:variable, payload, device_id, _session_ref) do
    if device_id, do: DeviceManager.handle_device_message(device_id, :output, payload)
    {:ok, device_id}
  end

  def route(:transition_fired, payload, device_id, _session_ref) do
    if device_id, do: DeviceManager.handle_device_message(device_id, :transition_fired, payload)
    {:ok, device_id}
  end

  def route(:debug, payload, device_id, _session_ref) do
    if device_id, do: DeviceManager.handle_device_message(device_id, :log, payload)
    {:ok, device_id}
  end

  def route(:error, payload, device_id, _session_ref) do
    if device_id, do: DeviceManager.handle_device_message(device_id, :error, payload)
    {:ok, device_id}
  end

  def route(:ping, _payload, device_id, _session_ref) do
    if device_id, do: DeviceManager.heartbeat(device_id)
    {:ok, device_id}
  end

  def route(:pong, _payload, device_id, _session_ref) do
    if device_id, do: DeviceManager.heartbeat(device_id)
    {:ok, device_id}
  end

  def route(:ack, payload, device_id, _session_ref) do
    if device_id do
      DeviceManager.heartbeat(device_id)
      DeviceManager.handle_device_message(device_id, :ack, payload)
    end

    {:ok, device_id}
  end

  def route(:nak, payload, device_id, _session_ref) do
    if device_id do
      DeviceManager.handle_device_message(device_id, :nak, payload)

      DeviceManager.handle_device_message(device_id, :error, %{
        code: payload[:reason_code] || payload["reason_code"] || 0,
        message: payload[:reason] || payload["reason"] || "command_rejected"
      })
    end

    {:ok, device_id}
  end

  def route(:discover, _payload, device_id, _session_ref) do
    if device_id, do: DeviceManager.heartbeat(device_id)
    {:ok, device_id}
  end

  def route(:provision, _payload, device_id, _session_ref) do
    if device_id, do: DeviceManager.heartbeat(device_id)
    {:ok, device_id}
  end

  def route(:goodbye, _payload, device_id, _session_ref) do
    if device_id, do: DeviceManager.device_disconnected(device_id)
    {:ok, device_id}
  end

  def route(_type, _payload, device_id, _session_ref), do: {:ok, device_id}

  def map_device_type(0x01), do: :desktop
  def map_device_type(0x02), do: :esp32
  def map_device_type(0x03), do: :pico
  def map_device_type(0x04), do: :raspberry_pi
  def map_device_type(0x05), do: :arduino
  def map_device_type(0x06), do: :mcxn947
  def map_device_type(0x10), do: :server
  def map_device_type(0x11), do: :gateway
  def map_device_type(_), do: :unknown

  defp sanitize_device_id(raw, session_ref) when is_binary(raw) do
    cleaned =
      raw
      |> printable_ascii_identifier()
      |> String.replace(~r/-+/, "-")
      |> String.trim("-_.:")

    device_id =
      if cleaned == "" do
        "serial-device-" <> short_hash(raw <> session_ref.session_id)
      else
        cleaned
      end

    if device_id != raw do
      Logger.warning("Sanitized device id #{inspect(raw)} to #{device_id}")
    end

    device_id
  end

  defp sanitize_device_id(raw, session_ref) do
    raw
    |> inspect()
    |> sanitize_device_id(session_ref)
  end

  defp printable_ascii_identifier(raw) do
    for <<byte <- raw>>, into: <<>> do
      cond do
        byte in ?a..?z -> <<byte>>
        byte in ?A..?Z -> <<byte>>
        byte in ?0..?9 -> <<byte>>
        byte in [?_, ?-, ?., ?:] -> <<byte>>
        byte in [?\s, ?\t, ?\r, ?\n] -> "-"
        true -> ""
      end
    end
  end

  defp short_hash(value) do
    value
    |> then(&:crypto.hash(:sha256, &1))
    |> Base.url_encode64(padding: false)
    |> binary_part(0, 10)
  end
end
