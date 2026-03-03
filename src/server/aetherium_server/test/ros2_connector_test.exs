defmodule AetheriumServer.Ros2ConnectorTest do
  use ExUnit.Case, async: false

  alias AetheriumServer.DeviceConnectorInstance
  alias AetheriumServer.DeviceConnectorSupervisor
  alias AetheriumServer.DeviceManager
  alias AetheriumServer.DeviceConnectors.Ros2Connector
  alias AetheriumServer.DeviceTransports.Ros2BridgeListener

  test "ros2 connector metadata normalization is transport-agnostic for ingress" do
    metadata =
      Ros2Connector.normalize_metadata(%{
        link: "ros2://ros2_default",
        remote: "127.0.0.1:5501"
      })

    assert metadata.transport == "ros2_bridge"
    assert metadata.link == "ros2://ros2_default"
    assert metadata.remote == "127.0.0.1:5501"
  end

  test "connector supervisor resolves ros2 connector instance modules from static config" do
    original = Application.get_env(:aetherium_server, :device_connectors)

    Application.put_env(:aetherium_server, :device_connectors, [
      [id: "ros2_lab", type: :ros2, enabled: true, options: [port: 5502]]
    ])

    on_exit(fn ->
      if is_nil(original) do
        Application.delete_env(:aetherium_server, :device_connectors)
      else
        Application.put_env(:aetherium_server, :device_connectors, original)
      end
    end)

    [instance] = DeviceConnectorSupervisor.configured_instances()

    assert instance.id == "ros2_lab"
    assert instance.type == :ros2
    assert instance.module == Ros2Connector
  end

  test "ros2 bridge listener accepts json/base64 frames and routes HELLO" do
    suffix = Integer.to_string(:erlang.unique_integer([:positive]))
    device_id = "ros2-device-#{suffix}"
    port = 56_000 + rem(String.to_integer(suffix), 1000)

    instance = %DeviceConnectorInstance{
      id: "ros2_test_#{suffix}",
      type: :ros2,
      module: Ros2Connector,
      enabled: true,
      options: [bind_ip: "127.0.0.1", port: port]
    }

    {:ok, _listener} =
      start_supervised(
        {Ros2BridgeListener,
         [connector_instance: instance, listener_config: [bind_ip: "127.0.0.1", port: port]]}
      )

    {:ok, socket} =
      :gen_tcp.connect({127, 0, 0, 1}, port, [:binary, packet: :line, active: false], 1_000)

    on_exit(fn -> :gen_tcp.close(socket) end)

    hello_payload = encode_hello_payload(device_id)
    hello_frame = frame(0x01, hello_payload)
    payload = Jason.encode!(%{"frame_b64" => Base.encode64(hello_frame)}) <> "\n"
    :ok = :gen_tcp.send(socket, payload)

    # Session returns HELLO_ACK via connector send_frame path (json-line/base64).
    assert {:ok, line} = :gen_tcp.recv(socket, 0, 1_000)
    assert {:ok, %{"frame_b64" => ack_b64}} = Jason.decode(String.trim(line))

    assert <<0xAE01::16, 0x01::8, 0x02::8, _len::16, _payload::binary>> =
             Base.decode64!(ack_b64)

    assert {:ok, device} = DeviceManager.get_device(device_id)
    assert device.connector_type == :ros2
    assert device.transport == "ros2_bridge"
    assert device.connector_id == instance.id
  end

  defp encode_hello_payload(name) do
    name_len = byte_size(name)

    <<1::32, 0::32, 0::32, 0x05::8, 1::8, 0::8, 0::8, 0::16, name_len::16, name::binary>>
  end

  defp frame(type, payload) do
    <<0xAE01::16, 0x01::8, type::8, byte_size(payload)::16, payload::binary>>
  end
end
