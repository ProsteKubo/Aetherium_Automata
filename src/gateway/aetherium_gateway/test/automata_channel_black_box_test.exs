defmodule AetheriumGatewayWeb.AutomataChannelBlackBoxTest do
  use ExUnit.Case, async: false

  alias AetheriumGateway.AutomataRegistry
  alias AetheriumGatewayWeb.AutomataChannel

  test "black_box_describe returns deployment-aware black-box interface" do
    suffix =
      "#{System.system_time(:microsecond)}-#{:erlang.unique_integer([:positive, :monotonic])}"

    automata_id = "bb-auto-#{suffix}"
    device_id = "bb-device-#{suffix}"
    server_id = "bb-server-#{suffix}"

    :ok = AutomataRegistry.register_automata(sample_automata(automata_id))

    {:ok, deployment} =
      AutomataRegistry.deploy_automata(automata_id, device_id, server_id, dispatch: false)

    :ok =
      AutomataRegistry.update_deployment_status(automata_id, device_id, :running, %{
        current_state: "running",
        deployment_metadata: %{
          "placement" => "docker_black_box",
          "latency" => %{"observed_ms" => 12},
          "battery" => %{"percent" => 88.0}
        }
      })

    Process.sleep(20)

    socket = %Phoenix.Socket{assigns: %{}}

    assert {:reply, {:ok, %{black_box: black_box}}, _socket} =
             AutomataChannel.handle_in("black_box_describe", %{"device_id" => device_id}, socket)

    assert black_box.deployment_id == deployment.deployment_id
    assert black_box.observable_state == "running"
    assert black_box.deployment_metadata["placement"] == "docker_black_box"
    assert black_box.deployment_metadata["battery"]["percent"] == 88.0
    assert Enum.any?(black_box.black_box["ports"], &(&1["name"] == "enabled"))
    assert Enum.member?(black_box.black_box["observable_states"], "running")

    AutomataRegistry.delete_automata(automata_id)
  end

  test "black-box commands validate ports, events, and states before dispatch" do
    suffix =
      "#{System.system_time(:microsecond)}-#{:erlang.unique_integer([:positive, :monotonic])}"

    automata_id = "bb-auto-#{suffix}"
    device_id = "bb-device-#{suffix}"
    server_id = "bb-server-#{suffix}"

    :ok = AutomataRegistry.register_automata(sample_automata(automata_id))

    {:ok, _deployment} =
      AutomataRegistry.deploy_automata(automata_id, device_id, server_id, dispatch: false)

    socket = %Phoenix.Socket{assigns: %{}}

    assert {:reply, {:ok, %{"status" => "ACK", "result" => %{"status" => "sent"}}}, _socket} =
             AutomataChannel.handle_in(
               "black_box_set_input",
               %{"device_id" => device_id, "port" => "enabled", "value" => true},
               socket
             )

    assert {:reply, {:ok, %{"status" => "NAK", "reason" => "black_box_port_not_input"}}, _socket} =
             AutomataChannel.handle_in(
               "black_box_set_input",
               %{"device_id" => device_id, "port" => "result", "value" => 1},
               socket
             )

    assert {:reply, {:ok, %{"status" => "ACK", "result" => %{"status" => "sent"}}}, _socket} =
             AutomataChannel.handle_in(
               "black_box_trigger_event",
               %{"device_id" => device_id, "event" => "completed"},
               socket
             )

    assert {:reply, {:ok, %{"status" => "NAK", "reason" => "invalid_black_box_event"}}, _socket} =
             AutomataChannel.handle_in(
               "black_box_trigger_event",
               %{"device_id" => device_id, "event" => "missing_event"},
               socket
             )

    assert {:reply, {:ok, %{"status" => "ACK", "result" => %{"status" => "sent"}}}, _socket} =
             AutomataChannel.handle_in(
               "black_box_force_state",
               %{"device_id" => device_id, "state" => "running"},
               socket
             )

    assert {:reply, {:ok, %{"status" => "NAK", "reason" => "invalid_black_box_state"}}, _socket} =
             AutomataChannel.handle_in(
               "black_box_force_state",
               %{"device_id" => device_id, "state" => "faulted"},
               socket
             )

    AutomataRegistry.delete_automata(automata_id)
  end

  defp sample_automata(id) do
    %{
      id: id,
      name: "Black Box Test",
      version: "1.0.0",
      states: %{
        "idle" => %{id: "idle", name: "Idle", type: :initial},
        "running" => %{id: "running", name: "Running", type: :normal}
      },
      transitions: %{
        "t1" => %{id: "t1", from: "idle", to: "running", type: :classic}
      },
      variables: [
        %{id: "v1", name: "enabled", type: "bool", direction: :input, default: false},
        %{id: "v2", name: "result", type: "int", direction: :output, default: 0}
      ],
      black_box: %{
        "ports" => [
          %{"name" => "enabled", "direction" => "input", "type" => "bool"},
          %{"name" => "result", "direction" => "output", "type" => "int"}
        ],
        "observable_states" => ["idle", "running"],
        "emitted_events" => ["completed"],
        "resources" => [%{"name" => "battery_pack", "kind" => "battery"}]
      }
    }
  end
end
