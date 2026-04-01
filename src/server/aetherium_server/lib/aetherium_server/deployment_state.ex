defmodule AetheriumServer.DeploymentState do
  @moduledoc false

  alias AetheriumServer.DeploymentObservability

  @spec update_runtime_variable(map(), String.t(), map()) :: map()
  def update_runtime_variable(state, deployment_id, payload)
      when is_map(state) and is_binary(deployment_id) and is_map(payload) do
    case payload["name"] do
      name when is_binary(name) ->
        put_in(state, [:deployments, deployment_id, :variables, name], payload["value"])

      _ ->
        state
    end
  end

  @spec find_active_deployment(String.t(), map(), map()) :: map() | nil
  def find_active_deployment(device_id, payload, state)
      when is_binary(device_id) and is_map(payload) and is_map(state) do
    run_id = payload[:run_id] || payload["run_id"]

    case find_deployment_by_device_and_run_id(device_id, run_id, state) do
      nil -> find_active_deployment(device_id, state)
      deployment -> deployment
    end
  end

  @spec find_active_deployment(String.t(), map()) :: map() | nil
  def find_active_deployment(device_id, state) when is_binary(device_id) and is_map(state) do
    state.deployments
    |> Map.values()
    |> Enum.filter(&(&1.device_id == device_id && &1.status in [:loading, :running, :paused]))
    |> Enum.sort_by(
      fn deployment -> {deployment_priority(deployment.status), deployment.deployed_at || 0} end,
      :desc
    )
    |> List.first()
  end

  @spec find_deployment_by_device_and_run_id(String.t(), integer(), map()) :: map() | nil
  def find_deployment_by_device_and_run_id(device_id, run_id, state)
      when is_binary(device_id) and is_integer(run_id) and is_map(state) do
    state.deployments
    |> Map.values()
    |> Enum.find(&(&1.device_id == device_id && &1.run_id == run_id))
  end

  def find_deployment_by_device_and_run_id(_device_id, _run_id, _state), do: nil

  @spec snapshot_for_deployment(map(), map()) :: map()
  def snapshot_for_deployment(deployment, state) when is_map(deployment) and is_map(state) do
    %{
      deployment_id: deployment.id,
      automata_id: deployment.automata_id,
      device_id: deployment.device_id,
      running: deployment.status == :running,
      current_state: deployment.current_state,
      variables: deployment.variables,
      source: "device_manager_snapshot"
    }
    |> DeploymentObservability.enrich_black_box_snapshot(deployment, state)
  end

  @spec maybe_merge_deployment_snapshot(map(), String.t(), map(), map()) :: map()
  def maybe_merge_deployment_snapshot(state, deployment_id, variables, deployment_metadata)
      when is_map(state) and is_binary(deployment_id) do
    state =
      if is_map(variables) and map_size(variables) > 0 do
        put_in(state, [:deployments, deployment_id, :variables], variables)
      else
        state
      end

    if is_map(deployment_metadata) and map_size(deployment_metadata) > 0 do
      deployment = get_in(state, [:deployments, deployment_id]) || %{}

      merged_metadata =
        merge_deployment_metadata(deployment[:deployment_metadata] || %{}, deployment_metadata)

      put_in(state, [:deployments, deployment_id, :deployment_metadata], merged_metadata)
    else
      state
    end
  end

  @spec maybe_put_device_metadata(map(), String.t(), map()) :: map()
  def maybe_put_device_metadata(state, device_id, deployment_metadata)
      when is_map(state) and is_binary(device_id) and is_map(deployment_metadata) do
    if map_size(deployment_metadata) > 0 and get_in(state, [:devices, device_id]) do
      device = get_in(state, [:devices, device_id])
      merged = merge_deployment_metadata(device[:deployment_metadata] || %{}, deployment_metadata)
      put_in(state, [:devices, device_id, :deployment_metadata], merged)
    else
      state
    end
  end

  def maybe_put_device_metadata(state, _device_id, _deployment_metadata), do: state

  @spec merge_deployment_metadata(map(), map()) :: map()
  def merge_deployment_metadata(existing, incoming) when is_map(existing) and is_map(incoming) do
    Map.merge(existing, incoming, fn _key, left, right ->
      if is_map(left) and is_map(right) do
        Map.merge(left, right)
      else
        right
      end
    end)
  end

  def merge_deployment_metadata(_existing, incoming) when is_map(incoming), do: incoming
  def merge_deployment_metadata(existing, _incoming) when is_map(existing), do: existing
  def merge_deployment_metadata(_existing, _incoming), do: %{}

  defp deployment_priority(status) when status in [:running, :paused, :loading], do: 2
  defp deployment_priority(status) when status in [:stopped, :pending], do: 1
  defp deployment_priority(:error), do: 0
  defp deployment_priority(_status), do: 0
end
