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
    assert snapshot.black_box["observable_states"] == ["idle", "running"]
    assert snapshot.deployment_metadata["runtime"]["target_profile"] == "desktop_v1"

    assert {:ok, black_box} = DeviceManager.describe_black_box(deployment_id)
    assert black_box["observable_state"] == "running"

    assert black_box["black_box"]["resources"] == [
             %{"name" => "battery_pack", "kind" => "battery"}
           ]
  end

  test "host runtime black-box event and force-state commands succeed when declared" do
    suffix = :erlang.unique_integer([:positive]) |> Integer.to_string()
    device_id = "host-runtime-event-device-#{suffix}"
    automata_id = "host-runtime-event-automata-#{suffix}"
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

    {:ok, _deployment} =
      DeviceManager.deploy_automata(automata_id, device_id, sample_event_automata(automata_id))

    assert :ok = DeviceManager.start_automata(deployment_id)
    Process.sleep(150)

    assert :ok = DeviceManager.trigger_event(deployment_id, "external_event", %{"value" => 1})
    Process.sleep(150)

    assert {:ok, snapshot} = DeviceManager.request_state(deployment_id)
    assert snapshot.current_state == "running"

    assert :ok = DeviceManager.force_state(deployment_id, "idle")
    Process.sleep(150)

    assert {:ok, reset_snapshot} = DeviceManager.request_state(deployment_id)
    assert reset_snapshot.current_state == "idle"
  end

  test "black-box event and state validation returns deterministic errors" do
    suffix = :erlang.unique_integer([:positive]) |> Integer.to_string()
    device_id = "host-runtime-validate-device-#{suffix}"
    automata_id = "host-runtime-validate-automata-#{suffix}"
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

    {:ok, _deployment} =
      DeviceManager.deploy_automata(automata_id, device_id, sample_event_automata(automata_id))

    assert {:error, :invalid_black_box_event} =
             DeviceManager.trigger_event(deployment_id, "missing_event", nil)

    assert {:error, :invalid_black_box_state} =
             DeviceManager.force_state(deployment_id, "faulted")
  end

  test "topic-versioned propagated inputs are deduped per deployment" do
    suffix = :erlang.unique_integer([:positive]) |> Integer.to_string()
    device_id = "topic-device-#{suffix}"
    automata_id = "topic-automata-#{suffix}"
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

    {:ok, _deployment} =
      DeviceManager.deploy_automata(automata_id, device_id, sample_automata(automata_id))

    assert :ok = DeviceManager.start_automata(deployment_id)

    assert :ok =
             DeviceManager.set_input(
               deployment_id,
               "enabled",
               true,
               %{
                 "internal_propagation" => true,
                 "topic" => "enabled",
                 "topic_version" => 1
               }
             )

    assert :ok =
             DeviceManager.set_input(
               deployment_id,
               "enabled",
               false,
               %{
                 "internal_propagation" => true,
                 "topic" => "enabled",
                 "topic_version" => 1
               }
             )

    Process.sleep(200)

    assert {:ok, snapshot} = DeviceManager.request_state(deployment_id)
    assert snapshot.variables["enabled"] == true

    assert :ok =
             DeviceManager.set_input(
               deployment_id,
               "enabled",
               false,
               %{
                 "internal_propagation" => true,
                 "topic" => "enabled",
                 "topic_version" => 2
               }
             )

    Process.sleep(200)

    assert {:ok, snapshot} = DeviceManager.request_state(deployment_id)
    assert snapshot.variables["enabled"] == false
  end

  test "remote request_state waits for live status and returns named variables with deployment metadata" do
    suffix = :erlang.unique_integer([:positive]) |> Integer.to_string()
    device_id = "remote-device-#{suffix}"
    automata_id = "remote-automata-#{suffix}"
    deployment_id = "#{automata_id}:#{device_id}"

    {:ok, _device} =
      DeviceManager.register_device(
        %{
          device_id: device_id,
          device_type: :desktop,
          capabilities: 0xFFFF,
          protocol_version: 1,
          deployment_metadata: %{"placement" => "docker_black_box"}
        },
        self()
      )

    {:ok, _deployment} =
      DeviceManager.deploy_automata(automata_id, device_id, sample_automata(automata_id))

    flush_send_binary_messages()

    :sys.replace_state(DeviceManager, fn state ->
      put_in(state, [:deployments, deployment_id, :status], :running)
    end)

    task = Task.async(fn -> DeviceManager.request_state(deployment_id) end)

    assert_receive {:send_binary, frame}, 1_000
    assert {:ok, :status, outbound} = AetheriumServer.EngineProtocol.decode(frame)
    assert outbound.run_id > 0

    DeviceManager.handle_device_message(device_id, :status, %{
      run_id: outbound.run_id,
      execution_state: 2,
      current_state: 2,
      variables: %{"enabled" => true},
      deployment_metadata: %{
        "placement" => "docker_black_box",
        "battery" => %{"percent" => 88.0},
        "latency" => %{"observed_ms" => 12}
      }
    })

    assert {:ok, snapshot} = Task.await(task, 1_000)
    assert snapshot.current_state == "Running"
    assert snapshot.variables["enabled"] == true
    assert snapshot.deployment_metadata["placement"] == "docker_black_box"
    assert snapshot.deployment_metadata["battery"]["percent"] == 88.0
    assert snapshot.deployment_metadata["latency"]["observed_ms"] == 12
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
      ],
      black_box: %{
        "ports" => [
          %{"name" => "enabled", "direction" => "input", "type" => "bool"}
        ],
        "observable_states" => ["idle", "running"],
        "emitted_events" => ["external_event"],
        "resources" => [
          %{"name" => "battery_pack", "kind" => "battery"}
        ]
      }
    }
  end

  defp sample_event_automata(id) do
    %{
      id: id,
      name: "DM Event Test",
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
          type: :event,
          event: "external_event"
        }
      },
      variables: [
        %{id: "v1", name: "enabled", type: "bool", direction: :input, default: false}
      ],
      black_box: %{
        "ports" => [
          %{"name" => "enabled", "direction" => "input", "type" => "bool"}
        ],
        "observable_states" => ["idle", "running"],
        "emitted_events" => ["external_event"],
        "resources" => [
          %{"name" => "battery_pack", "kind" => "battery"}
        ]
      }
    }
  end

  defp flush_send_binary_messages do
    receive do
      {:send_binary, _binary} -> flush_send_binary_messages()
    after
      0 -> :ok
    end
  end
end
