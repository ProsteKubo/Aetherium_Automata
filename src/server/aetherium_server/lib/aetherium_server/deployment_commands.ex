defmodule AetheriumServer.DeploymentCommands do
  @moduledoc false

  require Logger

  alias AetheriumServer.DeploymentObservability
  alias AetheriumServer.DeviceSessionRef
  alias AetheriumServer.DeviceTransport

  @spec set_input(map(), map(), String.t(), any(), map()) :: {:ok, map()} | {:error, term()}
  def set_input(state, deployment, input_name, value, opts)
      when is_map(state) and is_map(deployment) and is_binary(input_name) and is_map(opts) do
    cond do
      duplicate_topic_delivery?(state, deployment.id, opts) ->
        {:ok, state}

      true ->
        device = Map.get(state.devices, deployment.device_id)
        started_at_ms = System.monotonic_time(:millisecond)

        result =
          cond do
            runtime_registered?(deployment.id) ->
              AetheriumServer.AutomataRuntime.set_input(deployment.id, input_name, value)
              :ok

            match?(%{session_ref: %DeviceSessionRef{}, protocol_id: _}, device) ->
              %{session_ref: session_ref, protocol_id: protocol_id} = device

              DeviceTransport.send_message(session_ref, :set_input, %{
                target_id: protocol_id,
                run_id: deployment.run_id,
                name: input_name,
                value: value
              })

              :ok

            true ->
              {:error, :device_not_connected}
          end

        case result do
          :ok ->
            DeploymentObservability.maybe_record_set_input_event(
              deployment,
              input_name,
              value,
              opts
            )

            next_state =
              state
              |> remember_topic_delivery(deployment.id, opts)
              |> maybe_log_set_input_delay(deployment.id, opts, started_at_ms)

            {:ok, next_state}

          {:error, reason} ->
            {:error, reason}
        end
    end
  end

  @spec trigger_event(map(), map(), String.t(), any()) :: :ok | {:error, term()}
  def trigger_event(state, deployment, event_name, data)
      when is_map(state) and is_map(deployment) and is_binary(event_name) do
    with :ok <- DeploymentObservability.validate_black_box_event(deployment, state, event_name) do
      cond do
        runtime_registered?(deployment.id) ->
          :ok = AetheriumServer.AutomataRuntime.trigger_event(deployment.id, event_name, data)
          :ok

        true ->
          Logger.warning(
            "trigger_event unsupported for device #{deployment.device_id}: #{event_name} #{inspect(data)}"
          )

          {:error, :unsupported_command}
      end
    end
  end

  @spec force_state(map(), map(), String.t()) :: :ok | {:error, term()}
  def force_state(state, deployment, state_id)
      when is_map(state) and is_map(deployment) and is_binary(state_id) do
    with :ok <- DeploymentObservability.validate_black_box_state(deployment, state, state_id) do
      if runtime_registered?(deployment.id) do
        AetheriumServer.AutomataRuntime.force_state(deployment.id, state_id)
      else
        Logger.warning(
          "force_state unsupported for deployment #{deployment.id}: runtime unavailable"
        )

        {:error, :unsupported_command}
      end
    end
  end

  defp runtime_registered?(deployment_id) do
    match?([{_pid, _value}], Registry.lookup(AetheriumServer.RuntimeRegistry, deployment_id))
  end

  defp duplicate_topic_delivery?(state, deployment_id, opts)
       when is_map(state) and is_binary(deployment_id) and is_map(opts) do
    topic = opts["topic"] || opts[:topic]
    topic_version = opts["topic_version"] || opts[:topic_version]
    force_replay = opts["force_replay"] || opts[:force_replay]

    cond do
      force_replay ->
        false

      !is_binary(topic) or topic == "" or !is_integer(topic_version) ->
        false

      true ->
        Map.get(state.delivered_topic_versions, {deployment_id, topic}) == topic_version
    end
  end

  defp duplicate_topic_delivery?(_state, _deployment_id, _opts), do: false

  defp remember_topic_delivery(state, deployment_id, opts)
       when is_map(state) and is_binary(deployment_id) and is_map(opts) do
    topic = opts["topic"] || opts[:topic]
    topic_version = opts["topic_version"] || opts[:topic_version]

    if is_binary(topic) and topic != "" and is_integer(topic_version) do
      put_in(state, [:delivered_topic_versions, {deployment_id, topic}], topic_version)
    else
      state
    end
  end

  defp remember_topic_delivery(state, _deployment_id, _opts), do: state

  defp maybe_log_set_input_delay(state, deployment_id, opts, started_at_ms)
       when is_map(state) and is_binary(deployment_id) and is_map(opts) and
              is_integer(started_at_ms) do
    dispatched_at_ms = opts["topic_dispatched_at_ms"] || opts[:topic_dispatched_at_ms]
    server_elapsed_ms = System.monotonic_time(:millisecond) - started_at_ms

    if is_integer(dispatched_at_ms) do
      total_lag_ms = System.system_time(:millisecond) - dispatched_at_ms

      if total_lag_ms > 200 or server_elapsed_ms > 200 do
        Logger.warning(
          "set_input forwarding for #{deployment_id} took #{server_elapsed_ms}ms in DeviceManager " <>
            "(end_to_end=#{total_lag_ms}ms)"
        )
      end
    end

    state
  end

  defp maybe_log_set_input_delay(state, _deployment_id, _opts, _started_at_ms), do: state
end
