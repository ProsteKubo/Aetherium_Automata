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

    {:ok, _deployment} = DeviceManager.deploy_automata(automata_id, device_id, sample_automata(automata_id))

    assert {:error, :unsupported_command} =
             DeviceManager.trigger_event(deployment_id, "external_event", %{"value" => 1})

    assert {:error, :unsupported_command} = DeviceManager.force_state(deployment_id, "running")

    assert {:ok, snapshot} = DeviceManager.request_state(deployment_id)
    assert snapshot["source"] == "device_manager_snapshot" or snapshot.source == "device_manager_snapshot"
    assert snapshot.current_state == nil
    assert snapshot.running == false
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
        "t1" => %{id: "t1", from: "idle", to: "running", type: :classic, condition: "enabled == true"}
      },
      variables: [
        %{id: "v1", name: "enabled", type: "bool", direction: :input, default: false}
      ]
    }
  end
end
