defmodule AetheriumGatewayWeb.ServerChannelDeploymentTransferTest do
  use ExUnit.Case, async: false

  alias AetheriumGatewayWeb.ServerChannel

  test "deployment_transfer is broadcast to gateway and automata control topics" do
    :ok = Phoenix.PubSub.subscribe(AetheriumGateway.PubSub, "gateway:control")
    :ok = Phoenix.PubSub.subscribe(AetheriumGateway.PubSub, "automata:control")

    socket = %Phoenix.Socket{assigns: %{server_id: "srv-test"}}

    payload = %{
      "deployment_id" => "a1:d1",
      "device_id" => "d1",
      "stage" => "chunk_sent",
      "chunk_index" => 0,
      "total_chunks" => 2
    }

    assert {:noreply, _socket} = ServerChannel.handle_in("deployment_transfer", payload, socket)

    assert_receive %Phoenix.Socket.Broadcast{
      topic: "gateway:control",
      event: "deployment_transfer",
      payload: gateway_payload
    }

    assert gateway_payload["deployment_id"] == "a1:d1"
    assert gateway_payload["server_id"] == "srv-test"

    assert_receive %Phoenix.Socket.Broadcast{
      topic: "automata:control",
      event: "deployment_transfer",
      payload: automata_payload
    }

    assert automata_payload["deployment_id"] == "a1:d1"
    refute Map.has_key?(automata_payload, "server_id")
  end
end
