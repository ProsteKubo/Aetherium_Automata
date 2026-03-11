defmodule AetheriumServer.DeviceManagerCommandsTest do
  use ExUnit.Case, async: false

  alias AetheriumServer.DeviceManager

  test "unsupported commands return deterministic errors and state snapshot is available" do
    suffix = :erlang.unique_integer([:positive]) |> Integer.to_string()
    device_id = "test-device-#{suffix}"
    automata_id = "test-automata-#{suffix}"
    deployment_id = "#{automata_id}:#{device_id}"

    {:ok, _device} =
      DeviceManager.register_device(
        %{
          device_id: device_id,
          device_type: :desktop,
          capabilities: 0xFFFF,
          protocol_version: 1
        },
        self()
      )

    {:ok, _deployment} =
      DeviceManager.deploy_automata(automata_id, device_id, sample_automata(automata_id))

    assert {:error, :unsupported_command} =
             DeviceManager.trigger_event(deployment_id, "external_event", %{"value" => 1})

    assert {:error, :unsupported_command} = DeviceManager.force_state(deployment_id, "running")

    assert {:ok, snapshot} = DeviceManager.request_state(deployment_id)

    assert snapshot["source"] == "device_manager_snapshot" or
             snapshot.source == "device_manager_snapshot"

    assert snapshot.current_state == nil
    assert snapshot.running == false
  end

  test "deployment can be rewound from recorded time-series snapshots" do
    suffix = :erlang.unique_integer([:positive]) |> Integer.to_string()
    device_id = "rewind-device-#{suffix}"
    automata_id = "rewind-automata-#{suffix}"
    deployment_id = "#{automata_id}:#{device_id}"

    {:ok, _device} =
      DeviceManager.register_device(
        %{
          device_id: device_id,
          device_type: :desktop,
          capabilities: 0xFFFF,
          protocol_version: 1
        },
        self()
      )

    {:ok, _deployment} =
      DeviceManager.deploy_automata(automata_id, device_id, sample_automata(automata_id))

    DeviceManager.update_deployment_state(deployment_id, "running", %{"enabled" => true})
    Process.sleep(10)

    timeline = DeviceManager.list_time_series(deployment_id, limit: 100)
    assert timeline.events != []
    assert timeline.snapshots != []

    first_snapshot_ts =
      timeline.snapshots
      |> List.first()
      |> Map.fetch!("timestamp")

    assert {:ok, _rewind} = DeviceManager.rewind_deployment(deployment_id, first_snapshot_ts)

    deployments = DeviceManager.get_device_deployments(device_id)
    current = Enum.find(deployments, &(&1.id == deployment_id))
    assert current.status == :loading
    assert current.current_state == nil
  end

  test "host runtime device runs automata locally through the standard deployment API" do
    suffix = :erlang.unique_integer([:positive]) |> Integer.to_string()
    device_id = "host-runtime-device-#{suffix}"
    automata_id = "host-runtime-automata-#{suffix}"
    deployment_id = "#{automata_id}:#{device_id}"

    {:ok, _device} =
      DeviceManager.register_device(
        %{
          device_id: device_id,
          device_type: :desktop,
          connector_type: :host_runtime,
          transport: "host_runtime",
          capabilities: 0xFFFF,
          protocol_version: 1
        },
        self()
      )

    {:ok, deployment} =
      DeviceManager.deploy_automata(automata_id, device_id, sample_automata(automata_id))

    assert deployment.id == deployment_id
    assert deployment.status == :stopped

    assert :ok = DeviceManager.start_automata(deployment_id)
    assert :ok = DeviceManager.set_input(deployment_id, "enabled", true)

    Process.sleep(200)

    assert {:ok, snapshot} = DeviceManager.request_state(deployment_id)
    assert snapshot.running == true
    assert snapshot.current_state == "running"
    assert snapshot.variables["enabled"] == true
  end

  defp sample_automata(id) do
    %{
      id: id,
      name: "DM Test",
      version: "1.0.0",
      states: %{
        "idle" => %{id: "idle", name: "Idle", type: :initial},
        "running" => %{id: "running", name: "Running", type: :normal}
      },
      transitions: %{
        "t1" => %{
          id: "t1",
          from: "idle",
          to: "running",
          type: :classic,
          condition: "enabled == true"
        }
      },
      variables: [
        %{id: "v1", name: "enabled", type: "bool", direction: :input, default: false}
      ]
    }
  end
end
