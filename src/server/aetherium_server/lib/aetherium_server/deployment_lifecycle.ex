defmodule AetheriumServer.DeploymentLifecycle do
  @moduledoc false

  require Logger

  alias AetheriumServer.DeploymentObservability
  alias AetheriumServer.DeploymentTransfer

  @spec stop_command_applied(map(), map()) :: map()
  def stop_command_applied(state, deployment) when is_map(state) and is_map(deployment) do
    new_state = put_in(state, [:deployments, deployment.id, :status], :stopped)

    DeploymentObservability.snapshot_deployment(new_state, deployment.id, "stop_automata")

    DeploymentObservability.push_to_gateway(new_state, "deployment_status", %{
      "deployment_id" => deployment.id,
      "automata_id" => deployment.automata_id,
      "device_id" => deployment.device_id,
      "status" => "stopped"
    })

    new_state
  end

  @spec running_command_applied(map(), map(), map() | nil, String.t()) :: map()
  def running_command_applied(state, deployment, runtime_state, reason)
      when is_map(state) and is_map(deployment) and is_binary(reason) do
    new_state =
      state
      |> put_in([:deployments, deployment.id, :status], :running)
      |> maybe_put_runtime_state(deployment.id, runtime_state)

    DeploymentObservability.push_to_gateway(new_state, "deployment_status", %{
      "deployment_id" => deployment.id,
      "automata_id" => deployment.automata_id,
      "device_id" => deployment.device_id,
      "status" => "running",
      "current_state" => runtime_state && runtime_state.current_state,
      "variables" => runtime_state && runtime_state.variables
    })

    DeploymentObservability.snapshot_deployment(new_state, deployment.id, reason)
    new_state
  end

  @spec paused_command_applied(map(), map(), String.t()) :: map()
  def paused_command_applied(state, deployment, reason)
      when is_map(state) and is_map(deployment) and is_binary(reason) do
    new_state = put_in(state, [:deployments, deployment.id, :status], :paused)

    DeploymentObservability.push_to_gateway(new_state, "deployment_status", %{
      "deployment_id" => deployment.id,
      "automata_id" => deployment.automata_id,
      "device_id" => deployment.device_id,
      "status" => "paused"
    })

    DeploymentObservability.snapshot_deployment(new_state, deployment.id, reason)
    new_state
  end

  @spec reset_command_applied(map(), map(), map() | nil) :: map()
  def reset_command_applied(state, deployment, runtime_state)
      when is_map(state) and is_map(deployment) do
    new_state =
      state
      |> put_in([:deployments, deployment.id, :status], :stopped)
      |> maybe_put_runtime_state(deployment.id, runtime_state)

    DeploymentObservability.append_time_series_event(deployment.id, "reset_automata", %{
      "automata_id" => deployment.automata_id,
      "device_id" => deployment.device_id,
      "run_id" => deployment.run_id
    })

    DeploymentObservability.push_to_gateway(new_state, "deployment_status", %{
      "deployment_id" => deployment.id,
      "automata_id" => deployment.automata_id,
      "device_id" => deployment.device_id,
      "status" => "stopped",
      "current_state" => runtime_state && runtime_state.current_state,
      "variables" => runtime_state && runtime_state.variables
    })

    new_state
  end

  @spec load_ack_succeeded(map(), map(), map() | nil) :: map()
  def load_ack_succeeded(state, deployment, pending)
      when is_map(state) and is_map(deployment) do
    Logger.info("Automata loaded on device #{deployment.device_id}")

    if pending do
      DeploymentTransfer.emit_stage(pending, "completed", %{"success" => true})
    end

    new_state = put_in(state, [:deployments, deployment.id, :status], :stopped)

    DeploymentObservability.push_to_gateway(new_state, "deployment_status", %{
      "deployment_id" => deployment.id,
      "automata_id" => deployment.automata_id,
      "device_id" => deployment.device_id,
      "status" => "stopped"
    })

    DeploymentObservability.snapshot_deployment(new_state, deployment.id, "load_ack_success")
    new_state
  end

  @spec load_ack_failed(map(), map(), String.t(), map() | nil) :: map()
  def load_ack_failed(state, deployment, error_message, pending)
      when is_map(state) and is_map(deployment) and is_binary(error_message) do
    Logger.error(
      "Automata load failed on device #{deployment.device_id}: #{inspect(error_message)}"
    )

    if pending do
      DeploymentTransfer.emit_stage(pending, "completed", %{
        "success" => false,
        "error" => error_message
      })
    end

    new_state =
      state
      |> put_in([:deployments, deployment.id, :status], :error)
      |> put_in([:deployments, deployment.id, :error], error_message)

    DeploymentObservability.push_to_gateway(new_state, "deployment_error", %{
      "deployment_id" => deployment.id,
      "automata_id" => deployment.automata_id,
      "device_id" => deployment.device_id,
      "code" => 13,
      "message" => error_message
    })

    DeploymentObservability.push_to_gateway(new_state, "deployment_status", %{
      "deployment_id" => deployment.id,
      "automata_id" => deployment.automata_id,
      "device_id" => deployment.device_id,
      "status" => "error",
      "error" => error_message
    })

    DeploymentObservability.snapshot_deployment(new_state, deployment.id, "load_ack_error")
    new_state
  end

  defp maybe_put_runtime_state(state, deployment_id, runtime_state) when is_map(runtime_state) do
    state
    |> put_in([:deployments, deployment_id, :current_state], runtime_state.current_state)
    |> put_in([:deployments, deployment_id, :variables], runtime_state.variables)
  end

  defp maybe_put_runtime_state(state, _deployment_id, _runtime_state), do: state
end
