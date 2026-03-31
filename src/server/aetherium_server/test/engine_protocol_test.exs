defmodule AetheriumServer.EngineProtocolTest do
  use ExUnit.Case, async: true

  alias AetheriumServer.EngineProtocol

  test "encodes load_automata with default non-chunked fields" do
    assert {:ok, frame} =
             EngineProtocol.encode(:load_automata, %{
               message_id: 10,
               target_id: 2,
               run_id: 99,
               format: :aeth_ir_v1,
               data: <<1, 2, 3>>
             })

    assert {:ok, %{chunked: 0, chunk_index: 0, total_chunks: 1, payload: <<1, 2, 3>>}} =
             decode_load(frame)
  end

  test "encodes load_automata chunk metadata when provided" do
    assert {:ok, frame} =
             EngineProtocol.encode(:load_automata, %{
               message_id: 10,
               target_id: 2,
               run_id: 99,
               format: :aeth_ir_v1,
               data: <<1, 2, 3, 4>>,
               is_chunked: true,
               chunk_index: 2,
               total_chunks: 5,
               start_after_load: true,
               replace_existing: false
             })

    assert {:ok,
            %{
              chunked: 1,
              chunk_index: 2,
              total_chunks: 5,
              start_after_load: 1,
              replace_existing: 0,
              payload: <<1, 2, 3, 4>>
            }} = decode_load(frame)
  end

  test "rejects invalid chunking fields" do
    assert {:error, {:invalid_chunking, :fields}} =
             EngineProtocol.encode(:load_automata, %{
               message_id: 1,
               target_id: 1,
               run_id: 1,
               format: :aeth_ir_v1,
               data: <<0>>,
               is_chunked: true,
               chunk_index: 3,
               total_chunks: 3
             })
  end

  test "decodes hello with deployment metadata extension" do
    payload =
      <<77::32, 9::32, 0::32, 0x01::8, 0::8, 2::8, 0::8, 0x0007::16, 5::16, "probe"::binary, 1::8,
        16::16, "docker_black_box"::binary, 9::16, "websocket"::binary, 6::16, "server"::binary,
        10::16, "desktop_v1"::binary, 1::8, 0::8, 0::8, 8750::16, 50::32, 20::32, 0::32, 0::32,
        0::32, 0::64, 0::64, 0::64, 0::16, 7::16, "staging"::binary, 4::32>>

    assert {:ok, :hello, payload} = EngineProtocol.decode(frame(0x01, payload))
    assert payload.name == "probe"
    assert payload.deployment_metadata["placement"] == "docker_black_box"
    assert payload.deployment_metadata["runtime"]["target_profile"] == "desktop_v1"
    assert payload.deployment_metadata["battery"]["present"] == true
    assert payload.deployment_metadata["trace"]["fault_profile"] == "staging"
  end

  test "decodes status with named variable snapshot and deployment metadata extension" do
    payload =
      <<88::32, 4::32, 0::32, 111::32, 2::8, 7::16, 900::64, 3::64, 14::64, 1::32, 2::16, 5::16,
        "armed"::binary, 1::8, 1::8, 11::16, "status_code"::binary, 2::8, 2::signed-32, 1::8,
        16::16, "docker_black_box"::binary, 9::16, "websocket"::binary, 6::16, "server"::binary,
        10::16, "desktop_v1"::binary, 1::8, 1::8, 0::8, 1425::16, 45::32, 20::32, 17::32, 7::32,
        10::32, 1000::64, 1010::64, 1020::64, 16::16, "/tmp/trace.jsonl"::binary, 11::16,
        "lab_profile"::binary, 12::32>>

    assert {:ok, :status, payload} = EngineProtocol.decode(frame(0x45, payload))
    assert payload.variables == %{"armed" => true, "status_code" => 2}
    assert payload.deployment_metadata["placement"] == "docker_black_box"
    assert payload.deployment_metadata["battery"]["low"] == true
    assert payload.deployment_metadata["latency"]["observed_ms"] == 17
    assert payload.deployment_metadata["trace"]["trace_event_count"] == 12
  end

  test "decodes telemetry with named variable snapshot and deployment metadata extension" do
    payload =
      <<99::32, 4::32, 0::32, 111::32, 1_700_000_000_000::64, 64::32, 128::32, 150::16, 30::32,
        1::16, 1::16, 1::8, 1::8, 2::16, 5::16, "armed"::binary, 1::8, 1::8, 11::16,
        "status_code"::binary, 2::8, 2::signed-32, 1::8, 16::16, "docker_black_box"::binary,
        9::16, "websocket"::binary, 6::16, "server"::binary, 10::16, "desktop_v1"::binary, 1::8,
        0::8, 0::8, 9150::16, 45::32, 20::32, 19::32, 8::32, 11::32, 2000::64, 2010::64, 2020::64,
        16::16, "/tmp/trace.jsonl"::binary, 11::16, "lab_profile"::binary, 21::32>>

    assert {:ok, :telemetry, payload} = EngineProtocol.decode(frame(0x84, payload))
    assert payload.variables == %{"armed" => true, "status_code" => 2}
    assert payload.deployment_metadata["placement"] == "docker_black_box"
    assert payload.deployment_metadata["battery"]["percent"] == 91.5
    assert payload.deployment_metadata["latency"]["ingress_ms"] == 8
  end

  defp decode_load(
         <<0xAE, 0x01, 0x01, 0x40, len::16-big, message_id::32, source_id::32, target_id::32,
           run_id::32, format::8, is_chunked::8, chunk_index::16-big, total_chunks::16-big,
           start_after::8, replace::8, payload_len::16-big, payload::binary-size(payload_len)>>
       )
       when len == byte_size(payload) + 26 do
    {:ok,
     %{
       message_id: message_id,
       source_id: source_id,
       target_id: target_id,
       run_id: run_id,
       format: format,
       chunked: is_chunked,
       chunk_index: chunk_index,
       total_chunks: total_chunks,
       start_after_load: start_after,
       replace_existing: replace,
       payload: payload
     }}
  end

  defp decode_load(_), do: {:error, :invalid}

  defp frame(type, payload) do
    <<0xAE01::16, 0x01::8, type::8, byte_size(payload)::16, payload::binary>>
  end
end
