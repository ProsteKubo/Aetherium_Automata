defmodule AetheriumGatewayWeb.ServerChannelConnectorStatusTest do
  use ExUnit.Case, async: false

  alias AetheriumGatewayWeb.ServerChannel

  test "connector_status is broadcast to gateway control topic" do
    :ok = Phoenix.PubSub.subscribe(AetheriumGateway.PubSub, "gateway:control")

    socket = %Phoenix.Socket{assigns: %{server_id: "srv-test"}}

    payload = %{
      "connectors" => [
        %{"id" => "ws_default", "type" => "websocket", "status" => "running", "enabled" => true},
        %{"id" => "serial_lab", "type" => "serial", "status" => "stopped", "enabled" => true}
      ]
    }

    assert {:noreply, _socket} = ServerChannel.handle_in("connector_status", payload, socket)

    assert_receive %Phoenix.Socket.Broadcast{
      topic: "gateway:control",
      event: "connector_status",
      payload: gateway_payload
    }

    assert gateway_payload["server_id"] == "srv-test"
    assert is_list(gateway_payload["connectors"])
    assert Enum.count(gateway_payload["connectors"]) == 2
    assert Map.has_key?(gateway_payload, "timestamp")
  end
end
