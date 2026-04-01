defmodule AetheriumServer.DeploymentOrchestrator do
  @moduledoc false

  require Logger

  alias AetheriumServer.DeploymentObservability
  alias AetheriumServer.DeploymentTransfer

  @spec deploy_compiled(map(), String.t(), String.t(), map(), map(), map(), keyword()) ::
          {:reply, {:ok, map()} | {:error, term()}, map()}
  def deploy_compiled(compiled, automata_id, device_id, automata, device, state, opts \\ [])
      when is_map(compiled) and is_binary(automata_id) and is_binary(device_id) and
             is_map(automata) and is_map(device) and is_map(state) do
    if local_runtime_device?(device) do
      deploy_local_runtime(compiled, automata_id, device_id, automata, state)
    else
      deploy_remote(compiled, automata_id, device_id, automata, device, state, opts)
    end
  end

  defp deploy_remote(compiled, automata_id, device_id, automata, device, state, opts) do
    send_chunk = Keyword.fetch!(opts, :send_chunk)
    deployment_id = deployment_id_for(automata_id, device_id)
    run_id = run_id_for_deployment(deployment_id)

    yaml = compiled[:yaml]
    data = compiled[:data]
    state_id_map = compiled[:state_id_map] || %{}
    transition_id_map = compiled[:transition_id_map] || %{}
    profile_id = get_in(compiled, [:profile, :id]) || compiled.profile.id
    diagnostics = compiled[:diagnostics] || %{"warnings" => [], "errors" => []}

    if is_binary(yaml), do: maybe_dump_deploy_yaml(deployment_id, yaml)

    deployment =
      build_deployment(
        automata_id,
        device_id,
        run_id,
        :pending,
        nil,
        extract_default_variables(automata),
        state_id_map,
        transition_id_map,
        profile_id
      )

    new_state =
      state
      |> retire_device_deployments(device_id, deployment_id)
      |> put_in([:automata_cache, automata_id], automata)
      |> put_in([:deployments, deployment_id], deployment)
      |> put_in([:devices, device_id, :deployed_automata], [automata_id])

    case compiled[:format] do
      :yaml when is_binary(yaml) ->
        continue_remote_transfer(
          new_state,
          deployment,
          device,
          automata_id,
          device_id,
          profile_id,
          diagnostics,
          run_id,
          :yaml,
          yaml,
          send_chunk
        )

      :yaml ->
        {:reply, {:error, :missing_compiled_yaml}, state}

      :aeth_ir_v1 when is_binary(data) ->
        continue_remote_transfer(
          new_state,
          deployment,
          device,
          automata_id,
          device_id,
          profile_id,
          diagnostics,
          run_id,
          :aeth_ir_v1,
          data,
          send_chunk
        )

      :aeth_ir_v1 ->
        {:reply, {:error, :missing_compiled_artifact}, state}

      _other ->
        Logger.error(
          "Unsupported compiled deploy format #{inspect(compiled[:format])} for #{device_id}"
        )

        {:reply, {:error, {:unsupported_compiled_format, compiled[:format]}}, state}
    end
  end

  defp continue_remote_transfer(
         state,
         deployment,
         device,
         automata_id,
         device_id,
         profile_id,
         diagnostics,
         run_id,
         format,
         payload,
         send_chunk
       ) do
    case DeploymentTransfer.start_transfer(
           state,
           deployment,
           device,
           run_id,
           format,
           payload,
           send_chunk: send_chunk
         ) do
      {:ok, transfer_state} ->
        new_state = put_in(transfer_state, [:deployments, deployment.id, :status], :loading)
        DeploymentObservability.snapshot_deployment(new_state, deployment.id, "deploy_loading")

        if diagnostics["warnings"] != [] do
          DeploymentObservability.push_to_gateway(new_state, "deployment_validation", %{
            "automata_id" => automata_id,
            "device_id" => device_id,
            "target_profile" => profile_id,
            "diagnostics" => diagnostics
          })
        end

        DeploymentObservability.push_to_gateway(new_state, "deployment_status", %{
          "deployment_id" => deployment.id,
          "automata_id" => automata_id,
          "device_id" => device_id,
          "status" => "loading",
          "target_profile" => profile_id
        })

        Logger.info("Deploying automata #{automata_id} to device #{device_id} (#{profile_id})")
        {:reply, {:ok, Map.get(new_state.deployments, deployment.id)}, new_state}

      {:error, reason, failed_state} ->
        {:reply, {:error, reason}, failed_state}
    end
  end

  defp deploy_local_runtime(compiled, automata_id, device_id, automata, state) do
    deployment_id = deployment_id_for(automata_id, device_id)
    run_id = run_id_for_deployment(deployment_id)
    state_id_map = compiled[:state_id_map] || %{}
    transition_id_map = compiled[:transition_id_map] || %{}
    profile_id = get_in(compiled, [:profile, :id]) || compiled.profile.id
    diagnostics = compiled[:diagnostics] || %{"warnings" => [], "errors" => []}

    stop_runtime_if_running(deployment_id)

    deployment =
      build_deployment(
        automata_id,
        device_id,
        run_id,
        :stopped,
        initial_state_name(automata),
        extract_default_variables(automata),
        state_id_map,
        transition_id_map,
        profile_id
      )

    with :ok <- start_runtime_process(deployment_id, automata) do
      new_state =
        state
        |> put_in([:automata_cache, automata_id], automata)
        |> put_in([:deployments, deployment_id], deployment)
        |> update_in([:devices, device_id, :deployed_automata], &[automata_id | &1])

      if diagnostics["warnings"] != [] do
        DeploymentObservability.push_to_gateway(new_state, "deployment_validation", %{
          "automata_id" => automata_id,
          "device_id" => device_id,
          "target_profile" => profile_id,
          "diagnostics" => diagnostics
        })
      end

      DeploymentObservability.push_to_gateway(new_state, "deployment_status", %{
        "deployment_id" => deployment_id,
        "automata_id" => automata_id,
        "device_id" => device_id,
        "status" => "stopped",
        "current_state" => deployment.current_state,
        "variables" => deployment.variables,
        "target_profile" => profile_id
      })

      DeploymentObservability.snapshot_deployment(
        new_state,
        deployment_id,
        "deploy_local_runtime"
      )

      Logger.info(
        "Deploying automata #{automata_id} to local runtime device #{device_id} (#{profile_id})"
      )

      {:reply, {:ok, deployment}, new_state}
    else
      {:error, reason} ->
        {:reply, {:error, reason}, state}
    end
  end

  defp build_deployment(
         automata_id,
         device_id,
         run_id,
         status,
         current_state,
         variables,
         state_id_map,
         transition_id_map,
         profile_id
       ) do
    %{
      id: deployment_id_for(automata_id, device_id),
      automata_id: automata_id,
      device_id: device_id,
      run_id: run_id,
      status: status,
      current_state: current_state,
      variables: variables,
      state_id_map: state_id_map,
      transition_id_map: transition_id_map,
      deployed_at: System.system_time(:millisecond),
      error: nil,
      target_profile: profile_id,
      artifact_version_id: nil,
      snapshot_id: nil,
      migration_plan_ref: nil,
      patch_mode: "replace_restart",
      deployment_metadata: %{}
    }
  end

  defp extract_default_variables(automata) do
    variables = automata_variables(automata)

    variables
    |> Enum.map(fn var ->
      name = field(var, :name)
      default = field(var, :default)
      {name, default}
    end)
    |> Enum.reject(fn {name, _default} -> is_nil(name) end)
    |> Enum.into(%{})
  end

  defp automata_variables(automata) when is_map(automata) do
    field(automata, :variables, [])
  end

  defp automata_variables(_), do: []

  defp initial_state_name(automata) do
    states = automata[:states] || automata["states"] || %{}

    explicit =
      automata[:initial_state] ||
        automata["initial_state"] ||
        get_in(automata, [:automata, :initial_state]) ||
        get_in(automata, ["automata", "initial_state"])

    resolve_initial_state_ref(explicit, states) ||
      Enum.find_value(states, fn {key, state} ->
        type = state[:type] || state["type"]
        id = state[:id] || state["id"] || key

        if type in [:initial, "initial"], do: to_string(id), else: nil
      end) ||
      Enum.find_value(states, fn {key, state} ->
        id = state[:id] || state["id"] || key
        if is_nil(id), do: nil, else: to_string(id)
      end)
  end

  defp resolve_initial_state_ref(nil, _states), do: nil

  defp resolve_initial_state_ref(ref, states) do
    states
    |> Enum.find_value(fn {key, state} ->
      id = state[:id] || state["id"] || key
      if to_string(id) == to_string(ref), do: to_string(id), else: nil
    end)
  end

  defp local_runtime_device?(device) when is_map(device) do
    device[:connector_type] == :host_runtime or device[:transport] == "host_runtime"
  end

  defp local_runtime_device?(_), do: false

  defp retire_device_deployments(state, device_id, keep_deployment_id)
       when is_map(state) and is_binary(device_id) and is_binary(keep_deployment_id) do
    state.deployments
    |> Enum.reduce(state, fn
      {deployment_id, deployment}, acc
      when deployment_id != keep_deployment_id and deployment.device_id == device_id ->
        put_in(acc, [:deployments, deployment_id, :status], :stopped)

      _entry, acc ->
        acc
    end)
  end

  defp field(data, key, default \\ nil) when is_map(data) and is_atom(key) do
    Map.get(data, key, Map.get(data, Atom.to_string(key), default))
  end

  defp start_runtime_process(deployment_id, automata) do
    case DynamicSupervisor.start_child(
           AetheriumServer.RuntimeSupervisor,
           {AetheriumServer.AutomataRuntime, deployment_id: deployment_id, automata: automata}
         ) do
      {:ok, _pid} ->
        :ok

      {:error, {:already_started, _pid}} ->
        :ok

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp stop_runtime_if_running(deployment_id) do
    case Registry.lookup(AetheriumServer.RuntimeRegistry, deployment_id) do
      [{pid, _value}] ->
        DynamicSupervisor.terminate_child(AetheriumServer.RuntimeSupervisor, pid)

      _ ->
        :ok
    end
  end

  defp maybe_dump_deploy_yaml(deployment_id, yaml)
       when is_binary(deployment_id) and is_binary(yaml) do
    case System.get_env("AETHERIUM_DUMP_DEPLOY_YAML") do
      "1" ->
        safe_id = String.replace(deployment_id, ~r/[^A-Za-z0-9_.-]/, "_")
        path = Path.join(System.tmp_dir!(), "aetherium_deploy_#{safe_id}.yaml")

        _ = File.write(path, yaml)

        preview =
          yaml
          |> String.split("\n")
          |> Enum.take(40)
          |> Enum.join("\n")

        Logger.info("Dumped deploy YAML to #{path}\n#{preview}")
        :ok

      _ ->
        :ok
    end
  end

  defp deployment_id_for(automata_id, device_id), do: "#{automata_id}:#{device_id}"

  defp run_id_for_deployment(deployment_id) do
    :erlang.phash2(deployment_id, 4_294_967_295) + 1
  end
end
