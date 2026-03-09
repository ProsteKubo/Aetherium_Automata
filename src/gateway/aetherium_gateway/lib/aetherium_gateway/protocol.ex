defmodule AetheriumGateway.Protocol do
  @moduledoc """
  Binary protocol implementation for Aetherium device communication.
  
  Message envelope format:
    [1 byte: message type]
    [2 bytes: payload length (big endian)]
    [N bytes: payload]
    [2 bytes: CRC16 checksum]
  
  Supports efficient encoding for embedded devices (ESP32, Pico, etc.)
  """

  import Bitwise

  # ============================================================================
  # Message Types (matching C++ engine protocol.hpp)
  # ============================================================================

  # Device → Server/Gateway
  @msg_hello 0x01
  @msg_hello_ack 0x02
  @msg_goodbye 0x03
  @msg_heartbeat 0x10
  @msg_heartbeat_ack 0x11
  @msg_state_change 0x20
  @msg_variable_update 0x21
  @msg_output_event 0x22
  @msg_log 0x23
  @msg_error 0x24
  @msg_transition_fired 0x25

  # Server/Gateway → Device
  @msg_load_automata 0x40
  @msg_load_ack 0x41
  @msg_start 0x42
  @msg_stop 0x43
  @msg_reset 0x44
  @msg_set_input 0x50
  @msg_set_variable 0x51
  @msg_force_state 0x52
  @msg_trigger_event 0x53
  @msg_sync_time 0x60
  @msg_request_state 0x61

  # Value types
  @type_null 0x00
  @type_bool 0x01
  @type_int32 0x02
  @type_int64 0x03
  @type_float32 0x04
  @type_float64 0x05
  @type_string 0x06

  # Device types
  @device_desktop 0x01
  @device_esp32 0x02
  @device_pico 0x03
  @device_stm32 0x04
  @device_mcxn947 0x06

  # ============================================================================
  # Public API
  # ============================================================================

  @doc "Encode a message to binary format"
  @spec encode(atom(), map()) :: {:ok, binary()} | {:error, term()}
  def encode(message_type, payload) do
    with {:ok, type_byte} <- message_type_to_byte(message_type),
         {:ok, payload_binary} <- encode_payload(message_type, payload) do
      length = byte_size(payload_binary)

      # Build message without CRC
      message = <<type_byte::8, length::16-big, payload_binary::binary>>

      # Calculate and append CRC
      crc = crc16(message)
      {:ok, <<message::binary, crc::16-big>>}
    end
  end

  @doc "Decode a binary message"
  @spec decode(binary()) :: {:ok, atom(), map()} | {:error, term()}
  def decode(<<type::8, length::16-big, rest::binary>>) do
    expected_size = length + 2  # payload + CRC

    if byte_size(rest) >= expected_size do
      <<payload::binary-size(length), crc::16-big, _rest::binary>> = rest

      # Verify CRC
      message = <<type::8, length::16-big, payload::binary>>
      calculated_crc = crc16(message)

      if crc == calculated_crc do
        with {:ok, message_type} <- byte_to_message_type(type),
             {:ok, decoded_payload} <- decode_payload(message_type, payload) do
          {:ok, message_type, decoded_payload}
        end
      else
        {:error, :crc_mismatch}
      end
    else
      {:error, :incomplete_message}
    end
  end

  def decode(_), do: {:error, :invalid_format}

  @doc "Create hello message"
  @spec hello(String.t(), atom(), integer()) :: {:ok, binary()}
  def hello(device_id, device_type, capabilities) do
    encode(:hello, %{
      device_id: device_id,
      device_type: device_type,
      capabilities: capabilities,
      protocol_version: 1
    })
  end

  @doc "Create load automata message"
  @spec load_automata(map()) :: {:ok, binary()}
  def load_automata(automata) do
    encode(:load_automata, %{automata: automata})
  end

  @doc "Create state change message"
  @spec state_change(String.t(), String.t(), String.t()) :: {:ok, binary()}
  def state_change(from_state, to_state, transition_id) do
    encode(:state_change, %{
      from_state: from_state,
      to_state: to_state,
      transition_id: transition_id,
      timestamp: System.system_time(:millisecond)
    })
  end

  @doc "Create set variable message"
  @spec set_variable(String.t(), any()) :: {:ok, binary()}
  def set_variable(name, value) do
    encode(:set_variable, %{name: name, value: value})
  end

  @doc "Create trigger event message"
  @spec trigger_event(String.t(), any()) :: {:ok, binary()}
  def trigger_event(event_name, data) do
    encode(:trigger_event, %{event: event_name, data: data})
  end

  # ============================================================================
  # Message Type Conversion
  # ============================================================================

  defp message_type_to_byte(:hello), do: {:ok, @msg_hello}
  defp message_type_to_byte(:hello_ack), do: {:ok, @msg_hello_ack}
  defp message_type_to_byte(:goodbye), do: {:ok, @msg_goodbye}
  defp message_type_to_byte(:heartbeat), do: {:ok, @msg_heartbeat}
  defp message_type_to_byte(:heartbeat_ack), do: {:ok, @msg_heartbeat_ack}
  defp message_type_to_byte(:state_change), do: {:ok, @msg_state_change}
  defp message_type_to_byte(:variable_update), do: {:ok, @msg_variable_update}
  defp message_type_to_byte(:output_event), do: {:ok, @msg_output_event}
  defp message_type_to_byte(:log), do: {:ok, @msg_log}
  defp message_type_to_byte(:error), do: {:ok, @msg_error}
  defp message_type_to_byte(:transition_fired), do: {:ok, @msg_transition_fired}
  defp message_type_to_byte(:load_automata), do: {:ok, @msg_load_automata}
  defp message_type_to_byte(:load_ack), do: {:ok, @msg_load_ack}
  defp message_type_to_byte(:start), do: {:ok, @msg_start}
  defp message_type_to_byte(:stop), do: {:ok, @msg_stop}
  defp message_type_to_byte(:reset), do: {:ok, @msg_reset}
  defp message_type_to_byte(:set_input), do: {:ok, @msg_set_input}
  defp message_type_to_byte(:set_variable), do: {:ok, @msg_set_variable}
  defp message_type_to_byte(:force_state), do: {:ok, @msg_force_state}
  defp message_type_to_byte(:trigger_event), do: {:ok, @msg_trigger_event}
  defp message_type_to_byte(:sync_time), do: {:ok, @msg_sync_time}
  defp message_type_to_byte(:request_state), do: {:ok, @msg_request_state}
  defp message_type_to_byte(_), do: {:error, :unknown_message_type}

  defp byte_to_message_type(@msg_hello), do: {:ok, :hello}
  defp byte_to_message_type(@msg_hello_ack), do: {:ok, :hello_ack}
  defp byte_to_message_type(@msg_goodbye), do: {:ok, :goodbye}
  defp byte_to_message_type(@msg_heartbeat), do: {:ok, :heartbeat}
  defp byte_to_message_type(@msg_heartbeat_ack), do: {:ok, :heartbeat_ack}
  defp byte_to_message_type(@msg_state_change), do: {:ok, :state_change}
  defp byte_to_message_type(@msg_variable_update), do: {:ok, :variable_update}
  defp byte_to_message_type(@msg_output_event), do: {:ok, :output_event}
  defp byte_to_message_type(@msg_log), do: {:ok, :log}
  defp byte_to_message_type(@msg_error), do: {:ok, :error}
  defp byte_to_message_type(@msg_transition_fired), do: {:ok, :transition_fired}
  defp byte_to_message_type(@msg_load_automata), do: {:ok, :load_automata}
  defp byte_to_message_type(@msg_load_ack), do: {:ok, :load_ack}
  defp byte_to_message_type(@msg_start), do: {:ok, :start}
  defp byte_to_message_type(@msg_stop), do: {:ok, :stop}
  defp byte_to_message_type(@msg_reset), do: {:ok, :reset}
  defp byte_to_message_type(@msg_set_input), do: {:ok, :set_input}
  defp byte_to_message_type(@msg_set_variable), do: {:ok, :set_variable}
  defp byte_to_message_type(@msg_force_state), do: {:ok, :force_state}
  defp byte_to_message_type(@msg_trigger_event), do: {:ok, :trigger_event}
  defp byte_to_message_type(@msg_sync_time), do: {:ok, :sync_time}
  defp byte_to_message_type(@msg_request_state), do: {:ok, :request_state}
  defp byte_to_message_type(_), do: {:error, :unknown_message_type}

  # ============================================================================
  # Payload Encoding
  # ============================================================================

  defp encode_payload(:hello, %{device_id: device_id, device_type: device_type, capabilities: caps, protocol_version: version}) do
    device_type_byte = device_type_to_byte(device_type)
    device_id_bin = encode_string(device_id)
    {:ok, <<version::8, device_type_byte::8, caps::32-big, device_id_bin::binary>>}
  end

  defp encode_payload(:hello_ack, %{server_time: server_time, session_id: session_id}) do
    session_bin = encode_string(session_id)
    {:ok, <<server_time::64-big, session_bin::binary>>}
  end

  defp encode_payload(:heartbeat, _payload) do
    ts = System.system_time(:millisecond)
    {:ok, <<ts::64-big>>}
  end

  defp encode_payload(:heartbeat_ack, %{server_time: server_time}) do
    {:ok, <<server_time::64-big>>}
  end

  defp encode_payload(:state_change, %{from_state: from, to_state: to, transition_id: tid, timestamp: ts}) do
    from_bin = encode_string(from)
    to_bin = encode_string(to)
    tid_bin = encode_string(tid)
    {:ok, <<ts::64-big, from_bin::binary, to_bin::binary, tid_bin::binary>>}
  end

  defp encode_payload(:variable_update, %{name: name, value: value}) do
    name_bin = encode_string(name)
    value_bin = encode_value(value)
    {:ok, <<name_bin::binary, value_bin::binary>>}
  end

  defp encode_payload(:transition_fired, %{from: from, to: to, transition_id: tid, weight_used: weight, timestamp: ts}) do
    from_bin = encode_string(from)
    to_bin = encode_string(to)
    tid_bin = encode_string(tid)
    {:ok, <<ts::64-big, from_bin::binary, to_bin::binary, tid_bin::binary, weight::16-big>>}
  end

  defp encode_payload(:load_automata, %{automata: automata}) do
    # Encode automata as compact binary format
    automata_bin = encode_automata(automata)
    {:ok, automata_bin}
  end

  defp encode_payload(:start, _payload) do
    {:ok, <<>>}
  end

  defp encode_payload(:stop, _payload) do
    {:ok, <<>>}
  end

  defp encode_payload(:reset, _payload) do
    {:ok, <<>>}
  end

  defp encode_payload(:set_input, %{name: name, value: value}) do
    name_bin = encode_string(name)
    value_bin = encode_value(value)
    {:ok, <<name_bin::binary, value_bin::binary>>}
  end

  defp encode_payload(:set_variable, %{name: name, value: value}) do
    name_bin = encode_string(name)
    value_bin = encode_value(value)
    {:ok, <<name_bin::binary, value_bin::binary>>}
  end

  defp encode_payload(:force_state, %{state_id: state_id}) do
    state_bin = encode_string(state_id)
    {:ok, state_bin}
  end

  defp encode_payload(:trigger_event, %{event: event, data: data}) do
    event_bin = encode_string(event)
    data_bin = encode_value(data)
    {:ok, <<event_bin::binary, data_bin::binary>>}
  end

  defp encode_payload(:sync_time, _payload) do
    ts = System.system_time(:millisecond)
    {:ok, <<ts::64-big>>}
  end

  defp encode_payload(:request_state, _payload) do
    {:ok, <<>>}
  end

  defp encode_payload(:log, %{level: level, message: message}) do
    level_byte = log_level_to_byte(level)
    ts = System.system_time(:millisecond)
    message_bin = encode_string(message)
    {:ok, <<ts::64-big, level_byte::8, message_bin::binary>>}
  end

  defp encode_payload(:error, %{code: code, message: message}) do
    message_bin = encode_string(message)
    {:ok, <<code::16-big, message_bin::binary>>}
  end

  defp encode_payload(_type, _payload) do
    {:ok, <<>>}
  end

  # ============================================================================
  # Payload Decoding
  # ============================================================================

  defp decode_payload(:hello, <<version::8, device_type::8, caps::32-big, rest::binary>>) do
    with {:ok, device_id, _rest} <- decode_string(rest) do
      {:ok, %{
        protocol_version: version,
        device_type: byte_to_device_type(device_type),
        capabilities: caps,
        device_id: device_id
      }}
    end
  end

  defp decode_payload(:heartbeat, <<ts::64-big>>) do
    {:ok, %{timestamp: ts}}
  end

  defp decode_payload(:state_change, <<ts::64-big, rest::binary>>) do
    with {:ok, from, rest1} <- decode_string(rest),
         {:ok, to, rest2} <- decode_string(rest1),
         {:ok, tid, _rest3} <- decode_string(rest2) do
      {:ok, %{
        timestamp: ts,
        from_state: from,
        to_state: to,
        transition_id: tid
      }}
    end
  end

  defp decode_payload(:variable_update, payload) do
    with {:ok, name, rest} <- decode_string(payload),
         {:ok, value, _rest} <- decode_value(rest) do
      {:ok, %{name: name, value: value}}
    end
  end

  defp decode_payload(:transition_fired, <<ts::64-big, rest::binary>>) do
    with {:ok, from, rest1} <- decode_string(rest),
         {:ok, to, rest2} <- decode_string(rest1),
         {:ok, tid, <<weight::16-big, _::binary>>} <- decode_string(rest2) do
      {:ok, %{
        timestamp: ts,
        from: from,
        to: to,
        transition_id: tid,
        weight_used: weight
      }}
    end
  end

  defp decode_payload(:log, <<ts::64-big, level::8, rest::binary>>) do
    with {:ok, message, _rest} <- decode_string(rest) do
      {:ok, %{
        timestamp: ts,
        level: byte_to_log_level(level),
        message: message
      }}
    end
  end

  defp decode_payload(:error, <<code::16-big, rest::binary>>) do
    with {:ok, message, _rest} <- decode_string(rest) do
      {:ok, %{code: code, message: message}}
    end
  end

  defp decode_payload(_type, _payload) do
    {:ok, %{}}
  end

  # ============================================================================
  # Value Encoding/Decoding
  # ============================================================================

  defp encode_value(nil), do: <<@type_null::8>>
  defp encode_value(true), do: <<@type_bool::8, 1::8>>
  defp encode_value(false), do: <<@type_bool::8, 0::8>>

  defp encode_value(value) when is_integer(value) and value >= -2_147_483_648 and value <= 2_147_483_647 do
    <<@type_int32::8, value::32-big-signed>>
  end

  defp encode_value(value) when is_integer(value) do
    <<@type_int64::8, value::64-big-signed>>
  end

  defp encode_value(value) when is_float(value) do
    <<@type_float64::8, value::64-float-big>>
  end

  defp encode_value(value) when is_binary(value) do
    <<@type_string::8>> <> encode_string(value)
  end

  defp encode_value(_), do: <<@type_null::8>>

  defp decode_value(<<@type_null::8, rest::binary>>), do: {:ok, nil, rest}
  defp decode_value(<<@type_bool::8, 0::8, rest::binary>>), do: {:ok, false, rest}
  defp decode_value(<<@type_bool::8, 1::8, rest::binary>>), do: {:ok, true, rest}
  defp decode_value(<<@type_int32::8, value::32-big-signed, rest::binary>>), do: {:ok, value, rest}
  defp decode_value(<<@type_int64::8, value::64-big-signed, rest::binary>>), do: {:ok, value, rest}
  defp decode_value(<<@type_float32::8, value::32-float-big, rest::binary>>), do: {:ok, value, rest}
  defp decode_value(<<@type_float64::8, value::64-float-big, rest::binary>>), do: {:ok, value, rest}

  defp decode_value(<<@type_string::8, rest::binary>>) do
    decode_string(rest)
  end

  defp decode_value(_), do: {:error, :invalid_value}

  # ============================================================================
  # String Encoding (length-prefixed)
  # ============================================================================

  defp encode_string(str) when is_binary(str) do
    len = byte_size(str)
    <<len::16-big, str::binary>>
  end

  defp decode_string(<<len::16-big, rest::binary>>) when byte_size(rest) >= len do
    <<str::binary-size(len), remaining::binary>> = rest
    {:ok, str, remaining}
  end

  defp decode_string(_), do: {:error, :invalid_string}

  # ============================================================================
  # Automata Binary Encoding
  # ============================================================================

  defp encode_automata(automata) do
    # Header: name, version, counts
    name_bin = encode_string(automata[:name] || "")
    version_bin = encode_string(automata[:version] || "1.0.0")

    states = automata[:states] || %{}
    transitions = automata[:transitions] || %{}
    variables = automata[:variables] || []

    state_count = map_size(states)
    trans_count = map_size(transitions)
    var_count = length(variables)

    header = <<
      name_bin::binary,
      version_bin::binary,
      state_count::16-big,
      trans_count::16-big,
      var_count::16-big
    >>

    # Encode states
    states_bin =
      states
      |> Enum.map(fn {_id, state} -> encode_state(state) end)
      |> Enum.join()

    # Encode transitions
    trans_bin =
      transitions
      |> Enum.map(fn {_id, trans} -> encode_transition(trans) end)
      |> Enum.join()

    # Encode variables
    vars_bin =
      variables
      |> Enum.map(&encode_variable_spec/1)
      |> Enum.join()

    <<header::binary, states_bin::binary, trans_bin::binary, vars_bin::binary>>
  end

  defp encode_state(state) do
    id_bin = encode_string(state[:id] || "")
    name_bin = encode_string(state[:name] || "")
    type_byte = state_type_to_byte(state[:type])

    # Flags: has_on_enter, has_on_exit, has_on_tick
    flags =
      (if state[:on_enter], do: 0x01, else: 0) |||
      (if state[:on_exit], do: 0x02, else: 0) |||
      (if state[:on_tick], do: 0x04, else: 0)

    on_enter_bin = encode_string(state[:on_enter] || "")
    on_exit_bin = encode_string(state[:on_exit] || "")
    on_tick_bin = encode_string(state[:on_tick] || "")

    <<
      id_bin::binary,
      name_bin::binary,
      type_byte::8,
      flags::8,
      on_enter_bin::binary,
      on_exit_bin::binary,
      on_tick_bin::binary
    >>
  end

  defp encode_transition(trans) do
    id_bin = encode_string(trans[:id] || "")
    from_bin = encode_string(trans[:from] || "")
    to_bin = encode_string(trans[:to] || "")
    type_byte = transition_type_to_byte(trans[:type])
    priority = trans[:priority] || 0
    weight = trans[:weight] || 0
    condition_bin = encode_string(trans[:condition] || "")

    # Encode timed config if present
    timed_bin = encode_timed_config(trans[:timed])

    <<
      id_bin::binary,
      from_bin::binary,
      to_bin::binary,
      type_byte::8,
      priority::16-big-signed,
      weight::16-big,
      condition_bin::binary,
      timed_bin::binary
    >>
  end

  defp encode_timed_config(nil), do: <<0::8>>  # No timed config
  defp encode_timed_config(config) do
    mode_byte = timed_mode_to_byte(config[:mode])
    delay_ms = config[:delay_ms] || 0
    jitter_ms = config[:jitter_ms] || 0
    <<1::8, mode_byte::8, delay_ms::32-big, jitter_ms::32-big>>
  end

  defp encode_variable_spec(spec) do
    id_bin = encode_string(spec[:id] || "")
    name_bin = encode_string(spec[:name] || "")
    type_bin = encode_string(spec[:type] || "int")
    direction_byte = direction_to_byte(spec[:direction])
    default_bin = encode_value(spec[:default])

    <<
      id_bin::binary,
      name_bin::binary,
      type_bin::binary,
      direction_byte::8,
      default_bin::binary
    >>
  end

  # ============================================================================
  # Type Conversions
  # ============================================================================

  defp device_type_to_byte(:desktop), do: @device_desktop
  defp device_type_to_byte(:esp32), do: @device_esp32
  defp device_type_to_byte(:pico), do: @device_pico
  defp device_type_to_byte(:stm32), do: @device_stm32
  defp device_type_to_byte(:mcxn947), do: @device_mcxn947
  defp device_type_to_byte(_), do: @device_desktop

  defp byte_to_device_type(@device_desktop), do: :desktop
  defp byte_to_device_type(@device_esp32), do: :esp32
  defp byte_to_device_type(@device_pico), do: :pico
  defp byte_to_device_type(@device_stm32), do: :stm32
  defp byte_to_device_type(@device_mcxn947), do: :mcxn947
  defp byte_to_device_type(_), do: :unknown

  defp state_type_to_byte(:initial), do: 0x01
  defp state_type_to_byte(:final), do: 0x02
  defp state_type_to_byte(_), do: 0x00  # normal

  defp transition_type_to_byte(:classic), do: 0x00
  defp transition_type_to_byte(:timed), do: 0x01
  defp transition_type_to_byte(:event), do: 0x02
  defp transition_type_to_byte(:probabilistic), do: 0x03
  defp transition_type_to_byte(:immediate), do: 0x04
  defp transition_type_to_byte(_), do: 0x00

  defp timed_mode_to_byte(:after), do: 0x00
  defp timed_mode_to_byte(:at), do: 0x01
  defp timed_mode_to_byte(:every), do: 0x02
  defp timed_mode_to_byte(:timeout), do: 0x03
  defp timed_mode_to_byte(:window), do: 0x04
  defp timed_mode_to_byte(_), do: 0x00

  defp direction_to_byte(:input), do: 0x01
  defp direction_to_byte(:output), do: 0x02
  defp direction_to_byte(:internal), do: 0x00
  defp direction_to_byte(_), do: 0x00

  defp log_level_to_byte(:debug), do: 0x00
  defp log_level_to_byte(:info), do: 0x01
  defp log_level_to_byte(:warn), do: 0x02
  defp log_level_to_byte(:error), do: 0x03
  defp log_level_to_byte(_), do: 0x01

  defp byte_to_log_level(0x00), do: :debug
  defp byte_to_log_level(0x01), do: :info
  defp byte_to_log_level(0x02), do: :warn
  defp byte_to_log_level(0x03), do: :error
  defp byte_to_log_level(_), do: :info

  # ============================================================================
  # CRC16 Calculation (CCITT)
  # ============================================================================

  @crc_table (
    for i <- 0..255 do
      crc = bsl(i, 8)
      Enum.reduce(0..7, crc, fn _, acc ->
        if band(acc, 0x8000) != 0 do
          bxor(bsl(acc, 1), 0x1021)
        else
          bsl(acc, 1)
        end
        |> band(0xFFFF)
      end)
    end
    |> List.to_tuple()
  )

  defp crc16(data) when is_binary(data) do
    data
    |> :binary.bin_to_list()
    |> Enum.reduce(0xFFFF, fn byte, crc ->
      index = band(bxor(bsr(crc, 8), byte), 0xFF)
      band(bxor(bsl(crc, 8), elem(@crc_table, index)), 0xFFFF)
    end)
  end
end
