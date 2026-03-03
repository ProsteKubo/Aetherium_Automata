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
end
