defmodule AetheriumServer.EngineProtocol do
  @moduledoc """
  Codec for the C++ engine binary protocol (MAGIC=0xAE01, big-endian).
  """

  @magic 0xAE01
  @version 0x01

  @type message_type ::
          :hello
          | :hello_ack
          | :discover
          | :load_automata
          | :load_ack
          | :start
          | :stop
          | :reset
          | :status
          | :pause
          | :resume
          | :goodbye
          | :provision
          | :input
          | :output
          | :variable
          | :state_change
          | :telemetry
          | :transition_fired
          | :ping
          | :pong
          | :error
          | :debug
          | :ack
          | :nak

  # MessageType values from C++ `protocol.hpp`
  @mt_hello 0x01
  @mt_hello_ack 0x02
  @mt_discover 0x03
  @mt_ping 0x04
  @mt_pong 0x05
  @mt_provision 0x06
  @mt_goodbye 0x07
  @mt_load_automata 0x40
  @mt_load_ack 0x41
  @mt_start 0x42
  @mt_stop 0x43
  @mt_reset 0x44
  @mt_status 0x45
  @mt_pause 0x46
  @mt_resume 0x47
  @mt_input 0x80
  @mt_output 0x81
  @mt_variable 0x82
  @mt_state_change 0x83
  @mt_telemetry 0x84
  @mt_transition_fired 0x85
  @mt_error 0xE0
  @mt_debug 0xD0
  @mt_ack 0xF0
  @mt_nak 0xF1

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

  def encode(:hello_ack, %{
        message_id: message_id,
        target_id: target_id,
        assigned_id: assigned_id,
        server_time: server_time
      }) do
    payload =
      <<message_id::32, 0::32, target_id::32, assigned_id::32, server_time::64, 1::8, 0::16>>

    {:ok, frame(@mt_hello_ack, payload)}
  end

  def encode(
        :load_automata,
        %{message_id: message_id, target_id: target_id, run_id: run_id, yaml: yaml}
      )
      when is_binary(yaml) do
    encode(:load_automata, %{
      message_id: message_id,
      target_id: target_id,
      run_id: run_id,
      format: :yaml,
      data: yaml
    })
  end

  def encode(
        :load_automata,
        %{message_id: message_id, target_id: target_id, run_id: run_id, data: data} = payload
      )
      when is_binary(data) do
    with {:ok, format_byte} <- encode_automata_format(payload[:format] || :yaml) do
      is_chunked = encode_bool(payload[:is_chunked], false)
      chunk_index = payload[:chunk_index] || 0
      total_chunks = payload[:total_chunks] || 1
      start_after_load = encode_bool(payload[:start_after_load], false)
      replace_existing = encode_bool(payload[:replace_existing], true)
      data_size = byte_size(data)

      with :ok <- validate_u16(chunk_index, :chunk_index),
           :ok <- validate_u16(total_chunks, :total_chunks),
           :ok <- validate_u16(data_size, :data_size),
           :ok <- validate_load_payload_size(data_size),
           :ok <- validate_chunking(is_chunked, chunk_index, total_chunks) do
        encoded_payload =
          <<message_id::32, 0::32, target_id::32, run_id::32, format_byte::8, is_chunked::8,
            chunk_index::16, total_chunks::16, start_after_load::8, replace_existing::8,
            data_size::16, data::binary>>

        {:ok, frame(@mt_load_automata, encoded_payload)}
      end
    end
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

  def encode(:reset, %{message_id: message_id, target_id: target_id, run_id: run_id}) do
    payload = <<message_id::32, 0::32, target_id::32, run_id::32>>
    {:ok, frame(@mt_reset, payload)}
  end

  def encode(:status, %{message_id: message_id, target_id: target_id, run_id: run_id}) do
    payload =
      <<message_id::32, 0::32, target_id::32, run_id::32, 0::8, 0::16, 0::64, 0::64, 0::64,
        0::32>>

    {:ok, frame(@mt_status, payload)}
  end

  def encode(:pause, %{message_id: message_id, target_id: target_id, run_id: run_id}) do
    payload = <<message_id::32, 0::32, target_id::32, run_id::32>>
    {:ok, frame(@mt_pause, payload)}
  end

  def encode(:resume, %{message_id: message_id, target_id: target_id, run_id: run_id}) do
    payload = <<message_id::32, 0::32, target_id::32, run_id::32>>
    {:ok, frame(@mt_resume, payload)}
  end

  def encode(:input, %{
        message_id: message_id,
        target_id: target_id,
        run_id: run_id,
        name: name,
        value: value
      })
      when is_binary(name) do
    var_id = 0
    {value_type, value_bin} = encode_value(value)

    payload =
      <<message_id::32, 0::32, target_id::32, run_id::32, var_id::16, byte_size(name)::16,
        name::binary, value_type::8, value_bin::binary>>

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

  defp decode_payload(
         @mt_hello,
         <<message_id::32, source_id::32, _target_id::32, device_type::8, vmaj::8, vmin::8,
           vpatch::8, caps::16, name_len::16, name::binary-size(name_len), rest::binary>>
       ) do
    with {:ok, deployment_metadata, _rest} <- decode_deployment_extension(rest) do
      {:ok, :hello,
       %{
         message_id: message_id,
         source_id: source_id,
         device_type: device_type,
         version: {vmaj, vmin, vpatch},
         capabilities: caps,
         name: name,
         deployment_metadata: deployment_metadata
       }}
    else
      _ -> {:error, :invalid_hello}
    end
  end

  defp decode_payload(
         @mt_discover,
         <<message_id::32, source_id::32, target_id::32, _rest::binary>>
       ) do
    {:ok, :discover, %{message_id: message_id, source_id: source_id, target_id: target_id}}
  end

  defp decode_payload(
         @mt_load_ack,
         <<message_id::32, source_id::32, _target_id::32, run_id::32, success::8, err_len::16,
           err::binary-size(err_len), warn_count::16, rest::binary>>
       ) do
    {warnings, _} = decode_string_list(rest, warn_count, [])

    {:ok, :load_ack,
     %{
       message_id: message_id,
       source_id: source_id,
       run_id: run_id,
       success: success != 0,
       error: err,
       warnings: warnings
     }}
  end

  defp decode_payload(
         @mt_goodbye,
         <<message_id::32, source_id::32, target_id::32, _rest::binary>>
       ) do
    {:ok, :goodbye, %{message_id: message_id, source_id: source_id, target_id: target_id}}
  end

  defp decode_payload(
         @mt_provision,
         <<message_id::32, source_id::32, target_id::32, _rest::binary>>
       ) do
    {:ok, :provision, %{message_id: message_id, source_id: source_id, target_id: target_id}}
  end

  defp decode_payload(
         @mt_state_change,
         <<message_id::32, source_id::32, _target_id::32, run_id::32, prev::16, new::16,
           fired::16, ts::64>>
       ) do
    {:ok, :state_change,
     %{
       message_id: message_id,
       source_id: source_id,
       run_id: run_id,
       previous_state: prev,
       new_state: new,
       fired_transition: fired,
       timestamp: ts
     }}
  end

  defp decode_payload(
         @mt_status,
         <<message_id::32, source_id::32, _target_id::32, run_id::32, execution_state::8,
           current_state::16, uptime::64, transition_count::64, tick_count::64, error_count::32,
           rest::binary>>
       ) do
    with {:ok, variables, rest2} <- decode_named_var_snapshot(rest),
         {:ok, deployment_metadata, _rest3} <- decode_deployment_extension(rest2) do
      {:ok, :status,
       %{
         message_id: message_id,
         source_id: source_id,
         run_id: run_id,
         execution_state: execution_state,
         current_state: current_state,
         uptime: uptime,
         transition_count: transition_count,
         tick_count: tick_count,
         error_count: error_count,
         variables: variables,
         deployment_metadata: deployment_metadata
       }}
    else
      _ -> {:error, :invalid_status}
    end
  end

  defp decode_payload(
         @mt_output,
         <<message_id::32, source_id::32, _target_id::32, run_id::32, var_id::16, name_len::16,
           name::binary-size(name_len), rest::binary>>
       ) do
    with {:ok, value, rest2} <- decode_value(rest),
         <<ts::64>> <- rest2 do
      {:ok, :output,
       %{
         message_id: message_id,
         source_id: source_id,
         run_id: run_id,
         variable_id: var_id,
         name: name,
         value: value,
         timestamp: ts
       }}
    else
      _ -> {:error, :invalid_output}
    end
  end

  defp decode_payload(
         @mt_variable,
         <<message_id::32, source_id::32, _target_id::32, run_id::32, var_id::16, name_len::16,
           name::binary-size(name_len), rest::binary>>
       ) do
    with {:ok, value, rest2} <- decode_value(rest),
         <<ts::64>> <- rest2 do
      {:ok, :variable,
       %{
         message_id: message_id,
         source_id: source_id,
         run_id: run_id,
         variable_id: var_id,
         name: name,
         value: value,
         timestamp: ts
       }}
    else
      _ -> {:error, :invalid_variable}
    end
  end

  defp decode_payload(
         @mt_telemetry,
         <<message_id::32, source_id::32, _target_id::32, run_id::32, ts::64, heap_free::32,
           heap_total::32, cpu_fixed::16, tick_rate::32, var_count::16, rest::binary>>
       ) do
    {legacy_vars, rest2} = decode_var_snapshot(rest, var_count, [])

    with {:ok, named_vars, rest3} <- decode_named_var_snapshot(rest2),
         {:ok, deployment_metadata, _rest4} <- decode_deployment_extension(rest3) do
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
         variables: if(map_size(named_vars) > 0, do: named_vars, else: legacy_vars),
         deployment_metadata: deployment_metadata
       }}
    else
      _ -> {:error, :invalid_telemetry}
    end
  end

  defp decode_payload(
         @mt_transition_fired,
         <<message_id::32, source_id::32, _target_id::32, run_id::32, transition_id::16, ts::64>>
       ) do
    {:ok, :transition_fired,
     %{
       message_id: message_id,
       source_id: source_id,
       run_id: run_id,
       transition_id: transition_id,
       timestamp: ts
     }}
  end

  defp decode_payload(@mt_ping, <<message_id::32, source_id::32, target_id::32, ts::64, seq::32>>) do
    {:ok, :ping,
     %{
       message_id: message_id,
       source_id: source_id,
       target_id: target_id,
       timestamp: ts,
       sequence: seq
     }}
  end

  defp decode_payload(
         @mt_pong,
         <<message_id::32, source_id::32, target_id::32, orig_ts::64, resp_ts::64, seq::32>>
       ) do
    {:ok, :pong,
     %{
       message_id: message_id,
       source_id: source_id,
       target_id: target_id,
       original_timestamp: orig_ts,
       response_timestamp: resp_ts,
       sequence: seq
     }}
  end

  defp decode_payload(
         @mt_error,
         <<message_id::32, source_id::32, _target_id::32, code::16, msg_len::16,
           msg::binary-size(msg_len), has_run_id::8, rest::binary>>
       ) do
    with {:ok, run_id, rest2} <- decode_optional_u32(rest, has_run_id),
         <<has_related::8, rest3::binary>> <- rest2,
         {:ok, related_message_id, _rest4} <- decode_optional_u32(rest3, has_related) do
      {:ok, :error,
       %{
         message_id: message_id,
         source_id: source_id,
         code: code,
         message: msg,
         run_id: run_id,
         related_message_id: related_message_id
       }}
    else
      _ -> {:error, :invalid_error}
    end
  end

  defp decode_payload(
         @mt_debug,
         <<message_id::32, source_id::32, _target_id::32, level::8, src_len::16,
           src::binary-size(src_len), msg_len::16, msg::binary-size(msg_len), ts::64>>
       ) do
    {:ok, :debug,
     %{
       message_id: message_id,
       source_id: source_id,
       level: level,
       source: src,
       message: msg,
       timestamp: ts
     }}
  end

  defp decode_payload(
         @mt_ack,
         <<message_id::32, source_id::32, target_id::32, related_message_id::32, info_len::16,
           info::binary-size(info_len)>>
       ) do
    {:ok, :ack,
     %{
       message_id: message_id,
       source_id: source_id,
       target_id: target_id,
       related_message_id: related_message_id,
       info: info
     }}
  end

  defp decode_payload(
         @mt_nak,
         <<message_id::32, source_id::32, target_id::32, related_message_id::32, reason_code::16,
           reason_len::16, reason::binary-size(reason_len)>>
       ) do
    {:ok, :nak,
     %{
       message_id: message_id,
       source_id: source_id,
       target_id: target_id,
       related_message_id: related_message_id,
       reason_code: reason_code,
       reason: reason
     }}
  end

  defp decode_payload(_type, _payload), do: {:error, :unsupported}

  defp frame(type, payload) do
    <<@magic::16, @version::8, type::8, byte_size(payload)::16, payload::binary>>
  end

  defp encode_automata_format(:binary), do: {:ok, 0x01}
  defp encode_automata_format(:aeth_ir_v1), do: {:ok, 0x01}
  defp encode_automata_format(:yaml), do: {:ok, 0x02}
  defp encode_automata_format(:json), do: {:ok, 0x03}
  defp encode_automata_format(:messagepack), do: {:ok, 0x04}
  defp encode_automata_format(other), do: {:error, {:unsupported_automata_format, other}}

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

  defp decode_value(<<@vf_string::8, len::16, s::binary-size(len), rest::binary>>),
    do: {:ok, s, rest}

  defp decode_value(<<@vf_binary::8, len::16, b::binary-size(len), rest::binary>>),
    do: {:ok, b, rest}

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

  defp decode_named_var_snapshot(<<>>), do: {:ok, %{}, <<>>}

  defp decode_named_var_snapshot(<<count::16, rest::binary>>) do
    do_decode_named_var_snapshot(rest, count, %{})
  end

  defp decode_named_var_snapshot(_rest), do: {:error, :invalid_named_var_snapshot}

  defp do_decode_named_var_snapshot(rest, 0, acc), do: {:ok, acc, rest}

  defp do_decode_named_var_snapshot(
         <<name_len::16, name::binary-size(name_len), rest::binary>>,
         n,
         acc
       )
       when n > 0 do
    with {:ok, value, rest2} <- decode_value(rest) do
      do_decode_named_var_snapshot(rest2, n - 1, Map.put(acc, name, value))
    else
      _ -> {:error, :invalid_named_var_snapshot}
    end
  end

  defp do_decode_named_var_snapshot(_rest, _n, _acc), do: {:error, :invalid_named_var_snapshot}

  defp decode_deployment_extension(<<>>), do: {:ok, %{}, <<>>}
  defp decode_deployment_extension(<<0::8, rest::binary>>), do: {:ok, %{}, rest}

  defp decode_deployment_extension(
         <<1::8, placement_len::16, placement::binary-size(placement_len), transport_len::16,
           transport::binary-size(transport_len), control_plane_len::16,
           control_plane::binary-size(control_plane_len), target_class_len::16,
           target_class::binary-size(target_class_len), battery_present::8, battery_low::8,
           battery_external_power::8, battery_percent::16, latency_budget_ms::32,
           latency_warning_ms::32, observed_latency_ms::32, ingress_latency_ms::32,
           egress_latency_ms::32, send_timestamp::64, receive_timestamp::64, handle_timestamp::64,
           trace_file_len::16, trace_file::binary-size(trace_file_len), fault_profile_len::16,
           fault_profile::binary-size(fault_profile_len), trace_event_count::32, rest::binary>>
       ) do
    metadata =
      compact_map(%{
        "placement" => blank_to_nil(placement),
        "transport" =>
          compact_map(%{
            "type" => blank_to_nil(transport)
          }),
        "runtime" =>
          compact_map(%{
            "control_plane_instance" => blank_to_nil(control_plane),
            "target_profile" => blank_to_nil(target_class)
          }),
        "battery" =>
          compact_map(%{
            "present" => battery_present != 0,
            "low" => battery_low != 0,
            "external_power" => battery_external_power != 0,
            "percent" => battery_percent / 100.0
          }),
        "latency" =>
          compact_map(%{
            "budget_ms" => latency_budget_ms,
            "warning_ms" => latency_warning_ms,
            "observed_ms" => observed_latency_ms,
            "ingress_ms" => ingress_latency_ms,
            "egress_ms" => egress_latency_ms,
            "send_timestamp" => send_timestamp,
            "receive_timestamp" => receive_timestamp,
            "handle_timestamp" => handle_timestamp
          }),
        "trace" =>
          compact_map(%{
            "trace_file" => blank_to_nil(trace_file),
            "fault_profile" => blank_to_nil(fault_profile),
            "trace_event_count" => trace_event_count
          })
      })

    {:ok, metadata, rest}
  end

  defp decode_deployment_extension(_rest), do: {:error, :invalid_deployment_extension}

  defp compact_map(map) when is_map(map) do
    map
    |> Enum.reject(fn
      {_key, nil} -> true
      {_key, ""} -> true
      {_key, 0} -> true
      {_key, false} -> false
      {_key, value} when is_map(value) -> map_size(value) == 0
      _ -> false
    end)
    |> Enum.into(%{})
  end

  defp blank_to_nil(""), do: nil
  defp blank_to_nil(value), do: value

  defp decode_optional_u32(rest, 0), do: {:ok, nil, rest}
  defp decode_optional_u32(<<value::32, rest::binary>>, 1), do: {:ok, value, rest}
  defp decode_optional_u32(_rest, _flag), do: {:error, :invalid_optional_u32}

  defp encode_bool(value, default) do
    normalized =
      case value do
        nil -> default
        v when v in [true, 1, "1", "true", true] -> true
        _ -> false
      end

    if normalized, do: 1, else: 0
  end

  defp validate_u16(value, _field) when is_integer(value) and value >= 0 and value <= 65_535,
    do: :ok

  defp validate_u16(_value, field), do: {:error, {:invalid_u16, field}}

  defp validate_chunking(is_chunked, chunk_index, total_chunks) do
    cond do
      total_chunks == 0 ->
        {:error, {:invalid_chunking, :total_chunks}}

      is_chunked == 0 and total_chunks == 1 and chunk_index == 0 ->
        :ok

      is_chunked == 1 and chunk_index < total_chunks ->
        :ok

      true ->
        {:error, {:invalid_chunking, :fields}}
    end
  end

  defp validate_load_payload_size(data_size) when is_integer(data_size) do
    if data_size + 26 <= 65_535 do
      :ok
    else
      {:error, {:payload_too_large, :load_automata}}
    end
  end
end
