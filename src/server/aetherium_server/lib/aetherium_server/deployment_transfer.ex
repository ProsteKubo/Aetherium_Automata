defmodule AetheriumServer.DeploymentTransfer do
  @moduledoc false

  require Logger

  alias AetheriumServer.DeploymentObservability

  @default_chunk_ack_timeout_ms 2_000
  @default_chunk_ack_retries 3
  @default_final_load_ack_timeout_ms 5_000

  @spec start_transfer(map(), map(), map(), non_neg_integer(), atom(), binary(), keyword()) ::
          {:ok, map()} | {:error, term(), map()}
  def start_transfer(state, deployment, device, run_id, format, data, opts)
      when is_map(state) and is_map(deployment) and is_map(device) and is_integer(run_id) and
             is_atom(format) and is_binary(data) do
    send_chunk = Keyword.fetch!(opts, :send_chunk)
    chunk_size = deploy_chunk_size(device)
    chunks = chunk_binary(data, chunk_size)
    total_chunks = length(chunks)

    cond do
      total_chunks == 0 ->
        {:error, :empty_deploy_payload, state}

      total_chunks > 65_535 ->
        {:error, :deploy_payload_too_large, state}

      true ->
        pending = %{
          deployment_id: deployment.id,
          device_id: deployment.device_id,
          run_id: run_id,
          format: format,
          chunks: chunks,
          total_chunks: total_chunks,
          phase: :chunk_ack,
          awaiting_chunk_index: 0,
          next_chunk_index: 1,
          awaiting_message_id: nil,
          retry_count: 0,
          max_retries: chunk_ack_max_retries(),
          chunk_timeout_ms: chunk_ack_timeout_ms(),
          final_timeout_ms: final_load_ack_timeout_ms(),
          timer_ref: nil
        }

        case send_chunk_for_index(state, pending, 0, send_chunk) do
          {:ok, message_id} ->
            {phase, timer_ref} =
              if total_chunks == 1 do
                {:load_ack,
                 schedule_final_load_ack_timeout(
                   deployment.id,
                   message_id,
                   pending.final_timeout_ms
                 )}
              else
                {:chunk_ack,
                 schedule_chunk_ack_timeout(deployment.id, message_id, pending.chunk_timeout_ms)}
              end

            pending =
              pending
              |> Map.put(:phase, phase)
              |> Map.put(:awaiting_message_id, message_id)
              |> Map.put(:timer_ref, timer_ref)

            new_state = put_in(state, [:pending_chunk_deploys, deployment.id], pending)

            initial_stage =
              if phase == :load_ack do
                "awaiting_load_ack"
              else
                "chunk_sent"
              end

            emit_stage(pending, initial_stage, %{
              "chunk_index" => 0,
              "message_id" => message_id
            })

            {:ok, new_state}

          {:error, reason} ->
            {:error, reason, state}
        end
    end
  end

  @spec handle_chunk_ack_timeout(map(), String.t(), integer(), keyword()) :: map()
  def handle_chunk_ack_timeout(state, deployment_id, message_id, opts)
      when is_map(state) and is_binary(deployment_id) and is_integer(message_id) do
    send_chunk = Keyword.fetch!(opts, :send_chunk)

    handle_timeout(
      state,
      deployment_id,
      message_id,
      :chunk_ack,
      "chunk_ack_timeout",
      "chunk_resend_failed",
      "chunk_retry_sent",
      &schedule_chunk_ack_timeout/3,
      & &1.chunk_timeout_ms,
      send_chunk
    )
  end

  @spec handle_final_load_ack_timeout(map(), String.t(), integer(), keyword()) :: map()
  def handle_final_load_ack_timeout(state, deployment_id, message_id, opts)
      when is_map(state) and is_binary(deployment_id) and is_integer(message_id) do
    send_chunk = Keyword.fetch!(opts, :send_chunk)

    handle_timeout(
      state,
      deployment_id,
      message_id,
      :load_ack,
      "final_load_ack_timeout",
      "final_chunk_resend_failed",
      "final_chunk_retry_sent",
      &schedule_final_load_ack_timeout/3,
      & &1.final_timeout_ms,
      send_chunk
    )
  end

  @spec handle_ack(map(), String.t(), integer(), keyword()) :: map()
  def handle_ack(state, device_id, related_message_id, opts)
      when is_map(state) and is_binary(device_id) and is_integer(related_message_id) do
    send_chunk = Keyword.fetch!(opts, :send_chunk)

    case find_pending_by_device_and_message(state, device_id, related_message_id) do
      nil ->
        state

      pending ->
        if pending.phase != :chunk_ack do
          state
        else
          emit_stage(pending, "chunk_acked", %{
            "chunk_index" => pending.awaiting_chunk_index,
            "message_id" => related_message_id
          })

          advance_pending_transfer(state, pending, send_chunk)
        end
    end
  end

  @spec handle_nak(map(), String.t(), integer(), String.t()) :: map()
  def handle_nak(state, device_id, related_message_id, reason)
      when is_map(state) and is_binary(device_id) and is_integer(related_message_id) and
             is_binary(reason) do
    case find_pending_by_device_and_message(state, device_id, related_message_id) do
      nil ->
        state

      pending ->
        fail_pending_transfer(state, pending, "chunk_nak: #{reason}")
    end
  end

  @spec take_pending_by_device_and_run_id(map(), String.t(), integer()) :: {map(), map() | nil}
  def take_pending_by_device_and_run_id(state, device_id, run_id)
      when is_map(state) and is_binary(device_id) and is_integer(run_id) do
    case find_pending_by_device_and_run_id(state, device_id, run_id) do
      nil -> {state, nil}
      pending -> {clear_pending_transfer(state, pending.deployment_id), pending}
    end
  end

  def take_pending_by_device_and_run_id(state, _device_id, _run_id), do: {state, nil}

  @spec clear_for_device(map(), String.t()) :: map()
  def clear_for_device(state, device_id) when is_map(state) and is_binary(device_id) do
    state.pending_chunk_deploys
    |> Map.values()
    |> Enum.filter(&(&1.device_id == device_id))
    |> Enum.reduce(state, fn pending, acc ->
      clear_pending_transfer(acc, pending.deployment_id)
    end)
  end

  @spec emit_stage(map(), String.t(), map()) :: :ok
  def emit_stage(pending, stage, extra_fields)
      when is_map(pending) and is_binary(stage) and is_map(extra_fields) do
    payload =
      %{
        "deployment_id" => pending.deployment_id,
        "device_id" => pending.device_id,
        "run_id" => pending.run_id,
        "format" => to_string(pending.format),
        "phase" => to_string(pending.phase),
        "stage" => stage,
        "total_chunks" => pending.total_chunks,
        "awaiting_chunk_index" => pending.awaiting_chunk_index,
        "next_chunk_index" => pending.next_chunk_index,
        "retry_count" => pending.retry_count,
        "max_retries" => pending.max_retries
      }
      |> Map.merge(extra_fields)

    DeploymentObservability.push_to_gateway("deployment_transfer", payload)
  end

  defp handle_timeout(
         state,
         deployment_id,
         message_id,
         expected_phase,
         timeout_reason_prefix,
         resend_reason_prefix,
         retry_stage,
         schedule_timeout,
         timeout_selector,
         send_chunk
       ) do
    case Map.get(state.pending_chunk_deploys, deployment_id) do
      nil ->
        state

      pending ->
        cond do
          pending.phase != expected_phase or pending.awaiting_message_id != message_id ->
            state

          pending.retry_count >= pending.max_retries ->
            fail_pending_transfer(
              state,
              pending,
              "#{timeout_reason_prefix} at chunk #{pending.awaiting_chunk_index}"
            )

          true ->
            case resend_pending_chunk(state, pending, pending.awaiting_chunk_index, send_chunk) do
              {:ok, resent_message_id} ->
                timer_ref =
                  schedule_timeout.(
                    deployment_id,
                    resent_message_id,
                    timeout_selector.(pending)
                  )

                updated =
                  pending
                  |> Map.put(:retry_count, pending.retry_count + 1)
                  |> Map.put(:awaiting_message_id, resent_message_id)
                  |> Map.put(:timer_ref, timer_ref)

                new_state = put_in(state, [:pending_chunk_deploys, deployment_id], updated)

                emit_stage(updated, retry_stage, %{
                  "chunk_index" => updated.awaiting_chunk_index,
                  "message_id" => resent_message_id
                })

                new_state

              {:error, reason} ->
                fail_pending_transfer(
                  state,
                  pending,
                  "#{resend_reason_prefix}: #{inspect(reason)}"
                )
            end
        end
    end
  end

  defp advance_pending_transfer(state, pending, send_chunk) do
    if pending.timer_ref, do: Process.cancel_timer(pending.timer_ref)

    case send_chunk_for_index(state, pending, pending.next_chunk_index, send_chunk) do
      {:ok, message_id} ->
        {phase, timer_ref} =
          if pending.next_chunk_index + 1 < pending.total_chunks do
            {:chunk_ack,
             schedule_chunk_ack_timeout(
               pending.deployment_id,
               message_id,
               pending.chunk_timeout_ms
             )}
          else
            {:load_ack,
             schedule_final_load_ack_timeout(
               pending.deployment_id,
               message_id,
               pending.final_timeout_ms
             )}
          end

        updated =
          pending
          |> Map.put(:phase, phase)
          |> Map.put(:awaiting_chunk_index, pending.next_chunk_index)
          |> Map.put(:next_chunk_index, pending.next_chunk_index + 1)
          |> Map.put(:awaiting_message_id, message_id)
          |> Map.put(:retry_count, 0)
          |> Map.put(:timer_ref, timer_ref)

        new_state = put_in(state, [:pending_chunk_deploys, pending.deployment_id], updated)

        stage =
          if phase == :load_ack do
            "awaiting_load_ack"
          else
            "chunk_sent"
          end

        emit_stage(updated, stage, %{
          "chunk_index" => pending.next_chunk_index,
          "message_id" => message_id
        })

        new_state

      {:error, reason} ->
        fail_pending_transfer(state, pending, "chunk_send_failed: #{inspect(reason)}")
    end
  end

  defp resend_pending_chunk(state, pending, chunk_index, send_chunk) do
    send_chunk_for_index(state, pending, chunk_index, send_chunk)
  end

  defp send_chunk_for_index(state, pending, chunk_index, send_chunk) do
    with {:ok, chunk} <- fetch_pending_chunk(pending, chunk_index) do
      send_chunk.(state, pending, chunk_index, chunk)
    end
  end

  defp fail_pending_transfer(state, pending, error_message)
       when is_map(state) and is_map(pending) and is_binary(error_message) do
    emit_stage(pending, "failed", %{"error" => error_message})

    state = clear_pending_transfer(state, pending.deployment_id)
    deployment = Map.get(state.deployments, pending.deployment_id)

    if deployment do
      Logger.error(
        "Chunked deploy failed for #{deployment.id} on #{deployment.device_id}: #{inspect(error_message)}"
      )

      state
      |> put_in([:deployments, deployment.id, :status], :error)
      |> put_in([:deployments, deployment.id, :error], error_message)
      |> tap(fn updated_state ->
        DeploymentObservability.snapshot_deployment(
          updated_state,
          deployment.id,
          "deploy_transfer_failed"
        )

        DeploymentObservability.push_to_gateway(updated_state, "deployment_error", %{
          "deployment_id" => deployment.id,
          "automata_id" => deployment.automata_id,
          "device_id" => deployment.device_id,
          "code" => 13,
          "message" => error_message
        })

        DeploymentObservability.push_to_gateway(updated_state, "deployment_status", %{
          "deployment_id" => deployment.id,
          "automata_id" => deployment.automata_id,
          "device_id" => deployment.device_id,
          "status" => "error",
          "error" => error_message
        })
      end)
    else
      state
    end
  end

  defp clear_pending_transfer(state, deployment_id) when is_binary(deployment_id) do
    case Map.get(state.pending_chunk_deploys, deployment_id) do
      nil ->
        state

      pending ->
        if pending.timer_ref, do: Process.cancel_timer(pending.timer_ref)
        update_in(state, [:pending_chunk_deploys], &Map.delete(&1, deployment_id))
    end
  end

  defp find_pending_by_device_and_message(state, device_id, message_id)
       when is_integer(message_id) do
    state.pending_chunk_deploys
    |> Map.values()
    |> Enum.find(&(&1.device_id == device_id && &1.awaiting_message_id == message_id))
  end

  defp find_pending_by_device_and_message(_state, _device_id, _message_id), do: nil

  defp find_pending_by_device_and_run_id(state, device_id, run_id) when is_integer(run_id) do
    state.pending_chunk_deploys
    |> Map.values()
    |> Enum.find(&(&1.device_id == device_id && &1.run_id == run_id))
  end

  defp find_pending_by_device_and_run_id(_state, _device_id, _run_id), do: nil

  defp fetch_pending_chunk(pending, index) when is_map(pending) and is_integer(index) do
    case Enum.at(pending.chunks, index) do
      nil -> {:error, :pending_chunk_not_found}
      chunk -> {:ok, chunk}
    end
  end

  defp schedule_chunk_ack_timeout(deployment_id, message_id, timeout_ms)
       when is_binary(deployment_id) and is_integer(message_id) and is_integer(timeout_ms) do
    Process.send_after(self(), {:chunk_ack_timeout, deployment_id, message_id}, timeout_ms)
  end

  defp schedule_final_load_ack_timeout(deployment_id, message_id, timeout_ms)
       when is_binary(deployment_id) and is_integer(message_id) and is_integer(timeout_ms) do
    Process.send_after(self(), {:final_load_ack_timeout, deployment_id, message_id}, timeout_ms)
  end

  defp chunk_ack_timeout_ms do
    env_positive_int("AETHERIUM_DEPLOY_CHUNK_ACK_TIMEOUT_MS", @default_chunk_ack_timeout_ms)
  end

  defp final_load_ack_timeout_ms do
    env_positive_int(
      "AETHERIUM_DEPLOY_FINAL_LOAD_ACK_TIMEOUT_MS",
      @default_final_load_ack_timeout_ms
    )
  end

  defp chunk_ack_max_retries do
    env_positive_int("AETHERIUM_DEPLOY_CHUNK_ACK_RETRIES", @default_chunk_ack_retries)
  end

  defp env_positive_int(env_name, default) when is_binary(env_name) and is_integer(default) do
    case System.get_env(env_name) do
      nil ->
        default

      value ->
        case Integer.parse(value) do
          {parsed, _} when parsed > 0 -> parsed
          _ -> default
        end
    end
  end

  defp deploy_chunk_size(device) do
    from_env =
      case System.get_env("AETHERIUM_DEPLOY_CHUNK_SIZE") do
        nil ->
          nil

        value ->
          case Integer.parse(value) do
            {parsed, _} when parsed > 0 -> parsed
            _ -> nil
          end
      end

    default_size =
      case device[:connector_type] do
        :serial -> 1024
        _ -> 16_384
      end

    (from_env || default_size)
    |> min(65_509)
    |> max(1)
  end

  defp chunk_binary(data, chunk_size) when is_binary(data) and chunk_size > 0 do
    do_chunk_binary(data, chunk_size, [])
  end

  defp do_chunk_binary(<<>>, _chunk_size, acc), do: Enum.reverse(acc)

  defp do_chunk_binary(data, chunk_size, acc) when byte_size(data) <= chunk_size do
    Enum.reverse([data | acc])
  end

  defp do_chunk_binary(data, chunk_size, acc) do
    <<chunk::binary-size(chunk_size), rest::binary>> = data
    do_chunk_binary(rest, chunk_size, [chunk | acc])
  end
end
