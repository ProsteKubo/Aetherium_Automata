defmodule AetheriumGatewayWeb.ServerChannelHeartbeatTest do
  use ExUnit.Case, async: false

  alias AetheriumGateway.ServerTracker
  alias AetheriumGatewayWeb.ServerChannel

  test "heartbeat records gateway link metrics and broadcasts server link status" do
    :ok = Phoenix.PubSub.subscribe(AetheriumGateway.PubSub, "gateway:control")
    :ok = ServerTracker.unregister("srv-test")
    :ok = ServerTracker.register("srv-test", self())

    on_exit(fn ->
      ServerTracker.unregister("srv-test")
    end)

    socket = %Phoenix.Socket{assigns: %{server_id: "srv-test"}}

    assert {:reply, {:ok, reply}, _socket} =
             ServerChannel.handle_in(
               "heartbeat",
               %{"server_sent_at_ms" => 1_700_000_000_000, "heartbeat_interval_ms" => 10_000},
               socket
             )

    assert is_integer(reply.gateway_received_at_ms)
    assert is_integer(reply.gateway_sent_at_ms)

    assert_receive %Phoenix.Socket.Broadcast{
      topic: "gateway:control",
      event: "server_link_status",
      payload: payload
    }

    assert payload["server_id"] == "srv-test"
    assert payload["server_sent_at_ms"] == 1_700_000_000_000
    assert is_integer(payload["gateway_received_at_ms"])
    assert is_integer(payload["gateway_sent_at_ms"])

    server =
      ServerTracker.list_servers()
      |> Enum.find(&(&1.server_id == "srv-test"))

    assert server.gateway_link["server_sent_at_ms"] == 1_700_000_000_000
    assert server.gateway_link["heartbeat_interval_ms"] == 10_000
  end
end
