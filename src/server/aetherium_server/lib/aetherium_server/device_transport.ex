defmodule AetheriumServer.DeviceTransport do
  @moduledoc false

  require Logger

  alias AetheriumServer.DeviceConnector
  alias AetheriumServer.DeviceSessionRef
  alias AetheriumServer.EngineProtocol

  @spec send_message(DeviceSessionRef.t() | nil, atom(), map()) ::
          {:ok, non_neg_integer()} | {:error, term()}
  def send_message(nil, _type, _payload), do: {:error, :device_not_connected}

  def send_message(%DeviceSessionRef{} = session_ref, message_type, payload) do
    message_id = next_message_id()

    bin_result =
      case message_type do
        :hello_ack ->
          EngineProtocol.encode(:hello_ack, Map.merge(payload, %{message_id: message_id}))

        :load_automata ->
          EngineProtocol.encode(:load_automata, Map.merge(payload, %{message_id: message_id}))

        :start ->
          EngineProtocol.encode(:start, Map.merge(payload, %{message_id: message_id}))

        :stop ->
          EngineProtocol.encode(:stop, Map.merge(payload, %{message_id: message_id}))

        :set_input ->
          EngineProtocol.encode(:input, Map.merge(payload, %{message_id: message_id}))

        :pause ->
          EngineProtocol.encode(:pause, Map.merge(payload, %{message_id: message_id}))

        :resume ->
          EngineProtocol.encode(:resume, Map.merge(payload, %{message_id: message_id}))

        :reset ->
          EngineProtocol.encode(:reset, Map.merge(payload, %{message_id: message_id}))

        :status ->
          EngineProtocol.encode(:status, Map.merge(payload, %{message_id: message_id}))

        _ ->
          {:error, {:unsupported_message_type, message_type}}
      end

    case bin_result do
      {:ok, binary} ->
        case DeviceConnector.send_frame(session_ref, binary) do
          :ok -> {:ok, message_id}
          {:error, reason} -> {:error, reason}
        end

      {:error, reason} ->
        Logger.error("Failed to encode #{inspect(message_type)}: #{inspect(reason)}")
        {:error, reason}
    end
  end

  @spec resolve_device_transport(map(), String.t()) ::
          {:ok, non_neg_integer(), DeviceSessionRef.t()} | {:error, term()}
  def resolve_device_transport(state, device_id) when is_map(state) and is_binary(device_id) do
    case Map.get(state.devices, device_id) do
      %{session_ref: %DeviceSessionRef{} = session_ref, protocol_id: protocol_id} ->
        {:ok, protocol_id, session_ref}

      nil ->
        {:error, :device_not_found}

      _ ->
        {:error, :device_not_connected}
    end
  end

  @spec supported_commands_for_device(map()) :: [String.t()]
  def supported_commands_for_device(_device) do
    [
      "deploy",
      "start_execution",
      "stop_execution",
      "pause_execution",
      "resume_execution",
      "reset_execution",
      "set_variable",
      "black_box_describe",
      "black_box_snapshot",
      "black_box_set_input",
      "black_box_trigger_event",
      "black_box_force_state",
      "request_state",
      "time_travel_query",
      "rewind_deployment"
    ]
  end

  defp next_message_id do
    rem(System.unique_integer([:positive]), 4_294_967_295)
  end
end
