defmodule AetheriumGateway.ProtocolTest do
  use ExUnit.Case, async: true

  alias AetheriumGateway.Protocol

  describe "encode/decode round-trip" do
    test "hello message" do
      {:ok, encoded} = Protocol.hello("device_001", :esp32, 0x0F)
      {:ok, :hello, decoded} = Protocol.decode(encoded)

      assert decoded.device_id == "device_001"
      assert decoded.device_type == :esp32
      assert decoded.capabilities == 0x0F
      assert decoded.protocol_version == 1
    end

    test "mcxn947 hello message" do
      {:ok, encoded} = Protocol.hello("mcxn947_001", :mcxn947, 0x03)
      {:ok, :hello, decoded} = Protocol.decode(encoded)

      assert decoded.device_id == "mcxn947_001"
      assert decoded.device_type == :mcxn947
      assert decoded.capabilities == 0x03
      assert decoded.protocol_version == 1
    end

    test "state_change message" do
      {:ok, encoded} = Protocol.state_change("idle", "running", "trans_001")
      {:ok, :state_change, decoded} = Protocol.decode(encoded)

      assert decoded.from_state == "idle"
      assert decoded.to_state == "running"
      assert decoded.transition_id == "trans_001"
      assert is_integer(decoded.timestamp)
    end

    test "set_variable message" do
      {:ok, encoded} = Protocol.set_variable("counter", 42)
      {:ok, :set_variable, _decoded} = Protocol.decode(encoded)
    end

    test "trigger_event message" do
      {:ok, encoded} = Protocol.trigger_event("button_pressed", nil)
      {:ok, :trigger_event, _decoded} = Protocol.decode(encoded)
    end
  end

  describe "value encoding" do
    test "encodes nil" do
      {:ok, encoded} = Protocol.set_variable("test", nil)
      {:ok, :set_variable, _} = Protocol.decode(encoded)
    end

    test "encodes boolean true" do
      {:ok, encoded} = Protocol.set_variable("flag", true)
      {:ok, :set_variable, _} = Protocol.decode(encoded)
    end

    test "encodes boolean false" do
      {:ok, encoded} = Protocol.set_variable("flag", false)
      {:ok, :set_variable, _} = Protocol.decode(encoded)
    end

    test "encodes integers" do
      {:ok, encoded} = Protocol.set_variable("count", 12345)
      {:ok, :set_variable, _} = Protocol.decode(encoded)
    end

    test "encodes large integers" do
      {:ok, encoded} = Protocol.set_variable("big", 9_999_999_999)
      {:ok, :set_variable, _} = Protocol.decode(encoded)
    end

    test "encodes floats" do
      {:ok, encoded} = Protocol.set_variable("temp", 23.5)
      {:ok, :set_variable, _} = Protocol.decode(encoded)
    end

    test "encodes strings" do
      {:ok, encoded} = Protocol.set_variable("name", "hello world")
      {:ok, :set_variable, _} = Protocol.decode(encoded)
    end
  end

  describe "CRC validation" do
    test "detects corrupted message" do
      {:ok, encoded} = Protocol.hello("device_001", :esp32, 0x0F)

      # Corrupt a byte in the middle
      <<head::binary-size(5), _byte::8, tail::binary>> = encoded
      corrupted = <<head::binary, 0xFF, tail::binary>>

      assert {:error, :crc_mismatch} = Protocol.decode(corrupted)
    end

    test "detects incomplete message" do
      {:ok, encoded} = Protocol.hello("device_001", :esp32, 0x0F)

      # Truncate the message
      truncated = binary_part(encoded, 0, byte_size(encoded) - 3)

      assert {:error, :incomplete_message} = Protocol.decode(truncated)
    end
  end

  describe "automata encoding" do
    test "encodes complete automata" do
      automata = %{
        name: "TestAutomata",
        version: "1.0.0",
        states: %{
          "s1" => %{id: "s1", name: "Initial", type: :initial, on_enter: "log \"entered\""},
          "s2" => %{id: "s2", name: "Running", type: :normal}
        },
        transitions: %{
          "t1" => %{
            id: "t1",
            from: "s1",
            to: "s2",
            type: :classic,
            condition: "ready == true",
            weight: 100
          }
        },
        variables: [
          %{id: "v1", name: "ready", type: "bool", direction: :input, default: false},
          %{id: "v2", name: "result", type: "int", direction: :output, default: 0}
        ]
      }

      {:ok, encoded} = Protocol.load_automata(automata)
      assert is_binary(encoded)
      assert byte_size(encoded) > 0
    end
  end
end
