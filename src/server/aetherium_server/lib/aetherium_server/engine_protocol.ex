defmodule AetheriumServer.EngineProtocol do
  @moduledoc """
  Codec for the C++ engine binary protocol (MAGIC=0xAE01, big-endian).
  """

  @magic 0xAE01
  @version 0x01

  @type message_type :: :hello | :hello_ack | :load_automata | :load_ack | :start | :stop | :input | :output | :state_change | :telemetry | :ping | :pong | :error | :debug

  # MessageType values from C++ `protocol.hpp`
  @mt_hello 0x01
  @mt_hello_ack 0x02
  @mt_ping 0x04
  @mt_pong 0x05
  @mt_load_automata 0x40
  @mt_load_ack 0x41
  @mt_start 0x42
  @mt_stop 0x43
  @mt_input 0x80
  @mt_output 0x81
  @mt_state_change 0x83
  @mt_telemetry 0x84
  @mt_error 0xE0
  @mt_debug 0xD0

  @vf_void 0
  @vf_bool 1
  @vf_i32 2
  @vf_i64 3
  @vf_f32 4
  @vf_f64 5
  @vf_string 6
  @vf_binary 7

  def decode(bin) when is_binary(bin) do
    with {:ok, type, payload} <- decode_frame(bin) do
      {:ok, type, payload}
    end
  end

  def encode(:hello_ack, %{message_id: message_id, target_id: target_id, assigned_id: assigned_id, server_time: server_time}) do
    payload =
      <<message_id::32, 0::32, target_id::32, assigned_id::32, server_time::64, 1::8, 0::16>>

    {:ok, frame(@mt_hello_ack, payload)}
  end

  def encode(:load_automata, %{message_id: message_id, target_id: target_id, run_id: run_id, yaml: yaml}) when is_binary(yaml) do
    format_yaml = 0x02
    is_chunked = 0
    chunk_index = 0
    total_chunks = 1
    start_after_load = 0
    replace_existing = 1

    payload =
      <<message_id::32, 0::32, target_id::32, run_id::32, format_yaml::8, is_chunked::8,
        chunk_index::16, total_chunks::16, start_after_load::8, replace_existing::8,
        byte_size(yaml)::16, yaml::binary>>

    {:ok, frame(@mt_load_automata, payload)}
  end

  def encode(:start, %{message_id: message_id, target_id: target_id, run_id: run_id}) do
    has_start = 0
    payload = <<message_id::32, 0::32, target_id::32, run_id::32, has_start::8>>
    {:ok, frame(@mt_start, payload)}
  end

  def encode(:stop, %{message_id: message_id, target_id: target_id, run_id: run_id}) do
    save_state = 0
    payload = <<message_id::32, 0::32, target_id::32, run_id::32, save_state::8>>
    {:ok, frame(@mt_stop, payload)}
  end

  def encode(:input, %{message_id: message_id, target_id: target_id, run_id: run_id, name: name, value: value}) when is_binary(name) do
    var_id = 0
    {value_type, value_bin} = encode_value(value)
    payload =
      <<message_id::32, 0::32, target_id::32, run_id::32, var_id::16, byte_size(name)::16, name::binary,
        value_type::8, value_bin::binary>>

    {:ok, frame(@mt_input, payload)}
  end

  def encode(_type, _payload), do: {:error, :unsupported}

  # ---------------------------------------------------------------------------

  defp decode_frame(
         <<@magic::16, @version::8, type::8, len::16, payload::binary-size(len), _rest::binary>>
       ) do
    decode_payload(type, payload)
  end

  defp decode_frame(_), do: {:error, :invalid_frame}

  defp decode_payload(@mt_hello, <<message_id::32, source_id::32, _target_id::32, device_type::8, vmaj::8, vmin::8, vpatch::8, caps::16, name_len::16, name::binary-size(name_len)>>) do
    {:ok, :hello,
     %{
       message_id: message_id,
       source_id: source_id,
       device_type: device_type,
       version: {vmaj, vmin, vpatch},
       capabilities: caps,
       name: name
     }}
  end

  defp decode_payload(@mt_load_ack, <<message_id::32, source_id::32, _target_id::32, run_id::32, success::8, err_len::16, err::binary-size(err_len), warn_count::16, rest::binary>>) do
    {warnings, _} = decode_string_list(rest, warn_count, [])

    {:ok, :load_ack,
     %{message_id: message_id, source_id: source_id, run_id: run_id, success: success != 0, error: err, warnings: warnings}}
  end

  defp decode_payload(@mt_state_change, <<message_id::32, source_id::32, _target_id::32, run_id::32, prev::16, new::16, fired::16, ts::64>>) do
    {:ok, :state_change,
     %{message_id: message_id, source_id: source_id, run_id: run_id, previous_state: prev, new_state: new, fired_transition: fired, timestamp: ts}}
  end

  defp decode_payload(@mt_output, <<message_id::32, source_id::32, _target_id::32, run_id::32, var_id::16, name_len::16, name::binary-size(name_len), rest::binary>>) do
    with {:ok, value, rest2} <- decode_value(rest),
         <<ts::64>> <- rest2 do
      {:ok, :output,
       %{message_id: message_id, source_id: source_id, run_id: run_id, variable_id: var_id, name: name, value: value, timestamp: ts}}
    else
      _ -> {:error, :invalid_output}
    end
  end

  defp decode_payload(@mt_telemetry, <<message_id::32, source_id::32, _target_id::32, run_id::32, ts::64, heap_free::32, heap_total::32, cpu_fixed::16, tick_rate::32, var_count::16, rest::binary>>) do
    {vars, _} = decode_var_snapshot(rest, var_count, [])

    {:ok, :telemetry,
     %{
       message_id: message_id,
       source_id: source_id,
       run_id: run_id,
       timestamp: ts,
       heap_free: heap_free,
       heap_total: heap_total,
       cpu_usage: cpu_fixed / 100.0,
       tick_rate: tick_rate,
       variables: vars
     }}
  end

  defp decode_payload(@mt_ping, <<message_id::32, source_id::32, target_id::32, ts::64, seq::32>>) do
    {:ok, :ping, %{message_id: message_id, source_id: source_id, target_id: target_id, timestamp: ts, sequence: seq}}
  end

  defp decode_payload(@mt_pong, <<message_id::32, source_id::32, target_id::32, orig_ts::64, resp_ts::64, seq::32>>) do
    {:ok, :pong,
     %{message_id: message_id, source_id: source_id, target_id: target_id, original_timestamp: orig_ts, response_timestamp: resp_ts, sequence: seq}}
  end

  defp decode_payload(@mt_error, <<message_id::32, source_id::32, _target_id::32, code::16, msg_len::16, msg::binary-size(msg_len), ts::64>>) do
    {:ok, :error, %{message_id: message_id, source_id: source_id, code: code, message: msg, timestamp: ts}}
  end

  defp decode_payload(@mt_debug, <<message_id::32, source_id::32, _target_id::32, level::8, src_len::16, src::binary-size(src_len), msg_len::16, msg::binary-size(msg_len), ts::64>>) do
    {:ok, :debug, %{message_id: message_id, source_id: source_id, level: level, source: src, message: msg, timestamp: ts}}
  end

  defp decode_payload(_type, _payload), do: {:error, :unsupported}

  defp frame(type, payload) do
    <<@magic::16, @version::8, type::8, byte_size(payload)::16, payload::binary>>
  end

  defp encode_value(nil), do: {@vf_void, <<>>}
  defp encode_value(true), do: {@vf_bool, <<1::8>>}
  defp encode_value(false), do: {@vf_bool, <<0::8>>}

  defp encode_value(v) when is_integer(v) and v >= -2_147_483_648 and v <= 2_147_483_647 do
    {@vf_i32, <<v::signed-32>>}
  end

  defp encode_value(v) when is_integer(v) do
    {@vf_i64, <<v::signed-64>>}
  end

  defp encode_value(v) when is_float(v) do
    {@vf_f64, <<v::float-64>>}
  end

  defp encode_value(v) when is_binary(v) do
    {@vf_string, <<byte_size(v)::16, v::binary>>}
  end

  defp encode_value(v) when is_map(v) or is_list(v) do
    encoded = Jason.encode!(v)
    {@vf_string, <<byte_size(encoded)::16, encoded::binary>>}
  end

  defp decode_value(<<@vf_void::8, rest::binary>>), do: {:ok, nil, rest}
  defp decode_value(<<@vf_bool::8, b::8, rest::binary>>), do: {:ok, b != 0, rest}
  defp decode_value(<<@vf_i32::8, v::signed-32, rest::binary>>), do: {:ok, v, rest}
  defp decode_value(<<@vf_i64::8, v::signed-64, rest::binary>>), do: {:ok, v, rest}
  defp decode_value(<<@vf_f32::8, v::float-32, rest::binary>>), do: {:ok, v, rest}
  defp decode_value(<<@vf_f64::8, v::float-64, rest::binary>>), do: {:ok, v, rest}
  defp decode_value(<<@vf_string::8, len::16, s::binary-size(len), rest::binary>>), do: {:ok, s, rest}
  defp decode_value(<<@vf_binary::8, len::16, b::binary-size(len), rest::binary>>), do: {:ok, b, rest}
  defp decode_value(_), do: {:error, :invalid_value}

  defp decode_string_list(rest, 0, acc), do: {Enum.reverse(acc), rest}

  defp decode_string_list(<<len::16, s::binary-size(len), rest::binary>>, n, acc) when n > 0 do
    decode_string_list(rest, n - 1, [s | acc])
  end

  defp decode_string_list(rest, _n, acc), do: {Enum.reverse(acc), rest}

  defp decode_var_snapshot(rest, 0, acc), do: {Enum.reverse(acc), rest}

  defp decode_var_snapshot(<<id::16, rest::binary>>, n, acc) when n > 0 do
    case decode_value(rest) do
      {:ok, value, rest2} -> decode_var_snapshot(rest2, n - 1, [%{id: id, value: value} | acc])
      {:error, _} -> {Enum.reverse(acc), rest}
    end
  end
end
