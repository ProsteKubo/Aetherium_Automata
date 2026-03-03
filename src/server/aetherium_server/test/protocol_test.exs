defmodule AetheriumServer.ProtocolTest do
  use ExUnit.Case, async: true

  alias AetheriumServer.Protocol

  describe "server-side encoding" do
    test "encodes hello_ack" do
      {:ok, encoded} = Protocol.hello_ack("session-123")
      {:ok, :hello_ack, _decoded} = Protocol.decode(encoded)
    end

    test "encodes start command" do
      {:ok, encoded} = Protocol.start_command()
      assert is_binary(encoded)
    end

    test "encodes stop command" do
      {:ok, encoded} = Protocol.stop_command()
      assert is_binary(encoded)
    end

    test "encodes reset command" do
      {:ok, encoded} = Protocol.reset_command()
      assert is_binary(encoded)
    end

    test "encodes set_input" do
      {:ok, encoded} = Protocol.set_input("counter", 42)
      assert is_binary(encoded)
    end

    test "encodes trigger_event" do
      {:ok, encoded} = Protocol.trigger_event("button_press", %{button: 1})
      assert is_binary(encoded)
    end
  end

  describe "message roundtrip" do
    test "start command roundtrip" do
      {:ok, encoded} = Protocol.start_command()
      {:ok, :start, _payload} = Protocol.decode(encoded)
    end

    test "stop command roundtrip" do
      {:ok, encoded} = Protocol.stop_command()
      {:ok, :stop, _payload} = Protocol.decode(encoded)
    end

    test "reset command roundtrip" do
      {:ok, encoded} = Protocol.reset_command()
      {:ok, :reset, _payload} = Protocol.decode(encoded)
    end

    # set_input and trigger_event are sent to devices, not decoded from them
    # The decode_payload for these returns an empty map
    test "set_input encodes valid binary" do
      {:ok, encoded} = Protocol.set_input("counter", 42)
      # Can decode the message type at least
      {:ok, :set_input, _payload} = Protocol.decode(encoded)
    end

    test "trigger_event encodes valid binary" do
      {:ok, encoded} = Protocol.trigger_event("button_press", "data")
      {:ok, :trigger_event, _payload} = Protocol.decode(encoded)
    end
  end
end
