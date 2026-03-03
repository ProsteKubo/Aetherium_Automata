defmodule AetheriumServer.DeviceConnectorSessionsTest do
  use ExUnit.Case, async: false

  alias AetheriumServer.DeviceManager
  alias AetheriumServer.DeviceSessionRef

  test "device registration stores connector metadata from session ref" do
    suffix = Integer.to_string(:erlang.unique_integer([:positive]))
    device_id = "conn-meta-#{suffix}"

    session_ref = %DeviceSessionRef{
      connector_id: "serial_lab_a",
      connector_type: :serial,
      connector_module: AetheriumServer.DeviceConnectors.LegacyPidConnector,
      session_id: "sess-#{suffix}",
      endpoint: self(),
      monitor_pid: self(),
      metadata: %{transport: "serial", link: "/dev/ttyUSB-test"}
    }

    assert {:ok, _} =
             DeviceManager.register_device(
               %{
                 device_id: device_id,
                 device_type: :arduino,
                 capabilities: 0,
                 protocol_version: 1
               },
               session_ref
             )

    assert {:ok, device} = DeviceManager.get_device(device_id)
    assert device.connector_id == "serial_lab_a"
    assert device.connector_type == :serial
    assert device.transport == "serial"
    assert device.link == "/dev/ttyUSB-test"
    assert %DeviceSessionRef{} = device.session_ref
  end

  test "duplicate device registration replaces active session metadata (last writer wins)" do
    suffix = Integer.to_string(:erlang.unique_integer([:positive]))
    device_id = "dup-device-#{suffix}"

    first = %DeviceSessionRef{
      connector_id: "ws_public",
      connector_type: :websocket,
      connector_module: AetheriumServer.DeviceConnectors.LegacyPidConnector,
      session_id: "a-#{suffix}",
      endpoint: self(),
      monitor_pid: self(),
      metadata: %{transport: "websocket", link: "/socket/device/websocket"}
    }

    second = %DeviceSessionRef{
      connector_id: "serial_lab_a",
      connector_type: :serial,
      connector_module: AetheriumServer.DeviceConnectors.LegacyPidConnector,
      session_id: "b-#{suffix}",
      endpoint: self(),
      monitor_pid: self(),
      metadata: %{transport: "serial", link: "/dev/cu.usbserial-test"}
    }

    assert {:ok, _} =
             DeviceManager.register_device(
               %{
                 device_id: device_id,
                 device_type: :desktop,
                 capabilities: 0,
                 protocol_version: 1
               },
               first
             )

    assert {:ok, _} =
             DeviceManager.register_device(
               %{
                 device_id: device_id,
                 device_type: :arduino,
                 capabilities: 0,
                 protocol_version: 1
               },
               second
             )

    assert {:ok, device} = DeviceManager.get_device(device_id)
    assert device.connector_id == "serial_lab_a"
    assert device.connector_type == :serial
    assert device.transport == "serial"
    assert device.link == "/dev/cu.usbserial-test"
  end
end
