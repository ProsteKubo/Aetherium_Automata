defmodule AetheriumServer.LiveStateRequests do
  @moduledoc false

  alias AetheriumServer.DeploymentState

  @spec request_snapshot(map(), map(), term(), keyword()) ::
          {:pending, map()} | {:reply, {:ok, map()} | {:error, term()}, map()}
  def request_snapshot(state, deployment, from, opts \\ [])
      when is_map(state) and is_map(deployment) do
    timeout_ms = Keyword.fetch!(opts, :timeout_ms)
    request_status = Keyword.fetch!(opts, :request_status)

    cond do
      deployment.status not in [:running, :paused] ->
        {:reply, {:ok, DeploymentState.snapshot_for_deployment(deployment, state)}, state}

      true ->
        case request_status.() do
          {:ok, _message_id} ->
            timer_ref =
              case Map.get(state.pending_state_requests, deployment.id) do
                nil ->
                  Process.send_after(self(), {:request_state_timeout, deployment.id}, timeout_ms)

                %{timer_ref: existing_timer_ref} ->
                  existing_timer_ref
              end

            pending =
              state.pending_state_requests
              |> Map.get(deployment.id, %{callers: [], timer_ref: timer_ref})
              |> Map.update!(:callers, &[from | &1])
              |> Map.put(:timer_ref, timer_ref)

            {:pending, put_in(state, [:pending_state_requests, deployment.id], pending)}

          {:error, _reason} ->
            {:reply, {:ok, DeploymentState.snapshot_for_deployment(deployment, state)}, state}
        end
    end
  end

  @spec handle_timeout(map(), String.t()) :: map()
  def handle_timeout(state, deployment_id) when is_map(state) and is_binary(deployment_id) do
    case Map.get(state.pending_state_requests, deployment_id) do
      nil ->
        state

      %{callers: callers} ->
        reply =
          case Map.get(state.deployments, deployment_id) do
            nil ->
              {:error, :deployment_not_found}

            deployment ->
              {:ok, DeploymentState.snapshot_for_deployment(deployment, state)}
          end

        Enum.each(callers, &GenServer.reply(&1, reply))
        clear_request(state, deployment_id)
    end
  end

  @spec fulfill_request(map(), String.t()) :: map()
  def fulfill_request(state, deployment_id) when is_map(state) and is_binary(deployment_id) do
    case Map.get(state.pending_state_requests, deployment_id) do
      nil ->
        state

      %{callers: callers, timer_ref: timer_ref} ->
        if is_reference(timer_ref), do: Process.cancel_timer(timer_ref)

        case Map.get(state.deployments, deployment_id) do
          nil ->
            Enum.each(callers, &GenServer.reply(&1, {:error, :deployment_not_found}))

          deployment ->
            snapshot = DeploymentState.snapshot_for_deployment(deployment, state)
            Enum.each(callers, &GenServer.reply(&1, {:ok, snapshot}))
        end

        clear_request(state, deployment_id)
    end
  end

  @spec clear_request(map(), String.t()) :: map()
  def clear_request(state, deployment_id) when is_map(state) and is_binary(deployment_id) do
    update_in(state, [:pending_state_requests], &Map.delete(&1, deployment_id))
  end
end
