defmodule AetheriumServer.AethIrArtifactTest do
  use ExUnit.Case, async: true

  alias AetheriumServer.AethIrArtifact

  test "encode/decode yaml artifact roundtrip" do
    yaml = "version: 0.0.1\nconfig:\n  name: test\n"

    assert {:ok, bin} = AethIrArtifact.encode_yaml(yaml, ".")
    assert is_binary(bin)
    assert byte_size(bin) > byte_size(yaml)

    assert {:ok, decoded} = AethIrArtifact.decode(bin)
    assert decoded.format == :aeth_ir_v1
    assert decoded.version_major == 0
    assert decoded.version_minor == 1
    assert decoded.payload_kind == :yaml_text
    assert decoded.source_label == "."
    assert decoded.payload == yaml
  end

  test "encode/decode engine bytecode artifact roundtrip" do
    payload = <<0x41, 0x45, 0x54, 0x48, 0x42, 0x43, 0x30, 0x31, 0, 0, 0, 1>>

    assert {:ok, bin} = AethIrArtifact.encode_engine_bytecode(payload, "avr_uno_v1")
    assert is_binary(bin)

    assert {:ok, decoded} = AethIrArtifact.decode(bin)
    assert decoded.payload_kind == :engine_bytecode
    assert decoded.source_label == "avr_uno_v1"
    assert decoded.payload == payload
  end
end
