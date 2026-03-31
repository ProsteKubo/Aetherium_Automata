defmodule AetheriumGatewayWeb.ServerChannelVariableUpdateTest do
  use ExUnit.Case, async: false

  alias AetheriumGateway.AutomataRegistry
  alias AetheriumGatewayWeb.ServerChannel

  test "variable_updated keeps deployment variables current in registry" do
    suffix =
      "#{System.system_time(:microsecond)}-#{:erlang.unique_integer([:positive, :monotonic])}"

    automata_id = "bb-auto-#{suffix}"
    device_id = "bb-device-#{suffix}"
    server_id = "bb-server-#{suffix}"

    :ok = AutomataRegistry.register_automata(sample_automata(automata_id))

    {:ok, _deployment} =
      AutomataRegistry.deploy_automata(automata_id, device_id, server_id, dispatch: false)

    socket = %Phoenix.Socket{assigns: %{server_id: server_id}}

    assert {:noreply, _socket} =
             ServerChannel.handle_in(
               "variable_updated",
               %{
                 "automata_id" => automata_id,
                 "device_id" => device_id,
                 "deployment_id" => "#{automata_id}:#{device_id}",
                 "direction" => "output",
                 "name" => "result",
                 "value" => 7
               },
               socket
             )

    Process.sleep(20)

    assert {:ok, deployment} =
             AutomataRegistry.get_device_deployment(device_id, automata_id: automata_id)

    assert deployment.variables["result"] == 7

    AutomataRegistry.delete_automata(automata_id)
  end

  defp sample_automata(id) do
    %{
      id: id,
      name: "Server Variable Update Test",
      version: "1.0.0",
      states: %{
        "idle" => %{id: "idle", name: "Idle", type: :initial}
      },
      transitions: %{},
      variables: [
        %{id: "v1", name: "result", type: "int", direction: :output, default: 0}
      ]
    }
  end
end
