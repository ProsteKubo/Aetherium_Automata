defmodule Mix.Tasks.Aetherium.Showcase.Deploy do
  use Mix.Task

  @shortdoc "List/deploy curated showcase entries or the flagship desktop bundle"

  alias AetheriumServer.DeviceManager
  alias AetheriumServer.ShowcaseCatalog

  @default_bundle "flagship_desktop"
  @default_wait_ms 30_000
  @default_poll_ms 200
  @default_timeout_ms 20_000

  @impl true
  def run(args) do
    opts = parse_args(args)

    cond do
      opts[:list] ->
        list_showcase_targets()

      present?(opts[:showcase]) and present?(opts[:bundle]) ->
        Mix.raise("Use either --showcase or --bundle, not both.")

      present?(opts[:showcase]) ->
        run_single_deploy(opts)

      true ->
        run_bundle_deploy(opts)
    end
  end

  defp run_single_deploy(opts) do
    Mix.Task.run("app.start")

    target = opts[:showcase]

    if is_nil(target) or target == "" do
      Mix.raise("Missing --showcase. Use --list to inspect available entries.")
    end

    device =
      wait_for_device(
        opts[:device_id] || opts[:host_device_id],
        opts[:wait_ms],
        opts[:poll_ms],
        opts[:connector_type]
      )

    with {:ok, loaded} <- ShowcaseCatalog.load_automata(target),
         %{entry: entry, automata: automata} = loaded do
      timestamp = System.system_time(:millisecond)
      automata_id = "showcase-#{entry.id}-#{timestamp}"

      Mix.shell().info("Deploying #{entry.id} (#{entry.relative_path}) to device #{device.id}")

      deployment = deploy_and_maybe_start!(automata_id, device, automata, opts)

      Mix.shell().info(
        "Showcase deploy PASS (id=#{entry.id}, deployment=#{deployment.id}, status=#{deployment.status})"
      )
    else
      {:error, {:showcase_not_found, missing}} ->
        Mix.raise("Showcase entry not found: #{missing}. Use --list.")

      {:error, reason} ->
        Mix.raise("Failed to load showcase: #{inspect(reason)}")
    end
  end

  defp run_bundle_deploy(opts) do
    Mix.Task.run("app.start")

    bundle_id = opts[:bundle] || @default_bundle

    with {:ok, bundle} <- ShowcaseCatalog.load_bundle(bundle_id) do
      role_devices = resolve_bundle_devices(bundle, opts)
      timestamp = System.system_time(:millisecond)

      {results, skipped} =
        bundle.members
        |> Enum.with_index(1)
        |> Enum.reduce({[], []}, fn {member, index}, {results, skipped} ->
          case Map.get(role_devices, member.device_role) do
            nil ->
              skipped_entry = %{member: member, reason: "missing_#{member.device_role}_device"}

              Mix.shell().info(
                "Skipping #{member.entry.id} (#{member.entry.relative_path}) because no #{member.device_role} device is connected"
              )

              {results, skipped ++ [skipped_entry]}

            device ->
              automata_id = "showcase-#{bundle.id}-#{String.pad_leading(Integer.to_string(index), 2, "0")}-#{timestamp}"

              Mix.shell().info(
                "Deploying #{member.entry.id} [#{member.network}] to device #{device.id} as #{member.device_role}"
              )

              deployment = deploy_and_maybe_start!(automata_id, device, member.automata, opts)

              result = %{
                member: member,
                device: device,
                deployment: deployment,
                automata_id: automata_id
              }

              {results ++ [result], skipped}
          end
        end)

      print_bundle_summary(bundle, results, skipped)
    else
      {:error, {:showcase_bundle_not_found, missing}} ->
        Mix.raise("Showcase bundle not found: #{missing}. Use --list.")

      {:error, reason} ->
        Mix.raise("Failed to load showcase bundle: #{inspect(reason)}")
    end
  end

  defp deploy_and_maybe_start!(automata_id, device, automata, opts) do
    case DeviceManager.deploy_automata(automata_id, device.id, automata) do
      {:ok, deployment} ->
        deployment =
          wait_for_deployment_status(
            device.id,
            deployment.id,
            [:stopped, :running, :error],
            opts[:timeout_ms]
          )

        if deployment.status == :error do
          Mix.raise("Deploy failed: #{inspect(deployment.error || "unknown_error")}")
        end

        if opts[:start] and deployment.status != :running do
          :ok = DeviceManager.start_automata(deployment.id)

          deployment =
            wait_for_deployment_status(
              device.id,
              deployment.id,
              [:running, :error],
              opts[:timeout_ms]
            )

          if deployment.status == :error do
            Mix.raise("Start failed: #{inspect(deployment.error || "unknown_error")}")
          end

          deployment
        else
          deployment
        end

      {:error, reason} ->
        Mix.raise("Deploy failed: #{inspect(reason)}")
    end
  end

  defp resolve_bundle_devices(bundle, opts) do
    roles = bundle.members |> Enum.map(& &1.device_role) |> Enum.uniq()

    Enum.reduce(roles, %{}, fn role, acc ->
      Map.put(acc, role, resolve_device_for_role(role, opts))
    end)
  end

  defp resolve_device_for_role("host", opts) do
    wait_for_matching_device(
      opts[:host_device_id] || opts[:device_id],
      opts[:wait_ms],
      opts[:poll_ms],
      opts[:connector_type],
      fn device -> connected_host_device?(device, opts[:connector_type]) end,
      "No connected host/runtime device found within #{opts[:wait_ms]}ms"
    )
  end

  defp resolve_device_for_role("black_box", opts) do
    wait_for_matching_device(
      opts[:black_box_device_id],
      opts[:wait_ms],
      opts[:poll_ms],
      nil,
      &connected_black_box_device?/1,
      nil
    )
  end

  defp resolve_device_for_role(_role, _opts), do: nil

  defp print_bundle_summary(bundle, results, skipped) do
    Mix.shell().info(
      "Flagship bundle deploy PASS (bundle=#{bundle.id}, deployed=#{length(results)}, skipped=#{length(skipped)})"
    )

    Enum.each(results, fn result ->
      Mix.shell().info(
        "  #{result.member.network} :: #{result.member.entry.name} -> #{result.device.id} (deployment=#{result.deployment.id}, status=#{result.deployment.status})"
      )
    end)

    if skipped != [] do
      Enum.each(skipped, fn skipped_entry ->
        Mix.shell().info(
          "  skipped #{skipped_entry.member.entry.name} (reason=#{skipped_entry.reason})"
        )
      end)
    end
  end

  defp list_showcase_targets do
    {:ok, bundles} = ShowcaseCatalog.list_bundles()

    case ShowcaseCatalog.list_entries() do
      {:ok, entries} ->
        Mix.shell().info("Showcase bundles (#{length(bundles)}):")

        Enum.each(bundles, fn bundle ->
          Mix.shell().info(
            "  #{bundle.id}  members=#{bundle.member_count}  roles=#{Enum.join(bundle.device_roles, ",")}"
          )

          Mix.shell().info("    #{bundle.description}")
          Mix.shell().info("    networks: #{Enum.join(bundle.networks, ", ")}")
        end)

        Mix.shell().info("Showcase catalog entries (#{length(entries)}):")

        Enum.each(entries, fn entry ->
          Mix.shell().info("  #{entry.id}  #{entry.category}  #{entry.name}")
          Mix.shell().info("    #{entry.relative_path}")
        end)

      {:error, reason} ->
        Mix.raise("Failed to list showcase catalog: #{inspect(reason)}")
    end
  end

  defp parse_args(args) do
    {opts, _rest, _invalid} =
      OptionParser.parse(args,
        strict: [
          list: :boolean,
          showcase: :string,
          bundle: :string,
          device_id: :string,
          host_device_id: :string,
          black_box_device_id: :string,
          connector_type: :string,
          wait_ms: :integer,
          poll_ms: :integer,
          timeout_ms: :integer,
          start: :string
        ]
      )

    [
      list: Keyword.get(opts, :list, false),
      showcase: Keyword.get(opts, :showcase),
      bundle: Keyword.get(opts, :bundle),
      device_id: Keyword.get(opts, :device_id),
      host_device_id: Keyword.get(opts, :host_device_id),
      black_box_device_id: Keyword.get(opts, :black_box_device_id),
      connector_type: Keyword.get(opts, :connector_type),
      wait_ms: max(Keyword.get(opts, :wait_ms, @default_wait_ms), 1),
      poll_ms: max(Keyword.get(opts, :poll_ms, @default_poll_ms), 10),
      timeout_ms: max(Keyword.get(opts, :timeout_ms, @default_timeout_ms), 1_000),
      start: parse_bool(Keyword.get(opts, :start, "true"))
    ]
  end

  defp parse_bool(value) when value in [true, "true", "1", "yes", "on"], do: true
  defp parse_bool(_), do: false

  defp wait_for_device(nil, wait_ms, poll_ms, connector_type) do
    wait_until(wait_ms, poll_ms, fn ->
      DeviceManager.list_devices()
      |> Enum.find(fn device ->
        device.status == :connected and connector_matches?(device, connector_type)
      end)
    end)
    |> case do
      nil ->
        Mix.raise("No connected device found within #{wait_ms}ms")

      device ->
        device
    end
  end

  defp wait_for_device(device_id, wait_ms, poll_ms, _connector_type) when is_binary(device_id) do
    wait_until(wait_ms, poll_ms, fn ->
      case DeviceManager.get_device(device_id) do
        {:ok, device} when device.status == :connected -> device
        _ -> nil
      end
    end)
    |> case do
      nil -> Mix.raise("Device #{device_id} not connected within #{wait_ms}ms")
      device -> device
    end
  end

  defp wait_for_matching_device(nil, wait_ms, poll_ms, _connector_type, matcher, error_message)
       when is_function(matcher, 1) do
    wait_until(wait_ms, poll_ms, fn ->
      DeviceManager.list_devices()
      |> Enum.find(matcher)
    end)
    |> case do
      nil ->
        if is_binary(error_message), do: Mix.raise(error_message), else: nil

      device ->
        device
    end
  end

  defp wait_for_matching_device(device_id, wait_ms, poll_ms, _connector_type, matcher, error_message)
       when is_binary(device_id) and is_function(matcher, 1) do
    wait_until(wait_ms, poll_ms, fn ->
      case DeviceManager.get_device(device_id) do
        {:ok, device} ->
          if matcher.(device), do: device, else: nil

        _ ->
          nil
      end
    end)
    |> case do
      nil ->
        message = error_message || "Device #{device_id} not connected within #{wait_ms}ms"
        Mix.raise(message)

      device ->
        device
    end
  end

  defp connected_host_device?(device, connector_type) do
    device.status == :connected and connector_matches?(device, connector_type) and
      not connected_black_box_device?(device)
  end

  defp connected_black_box_device?(device) do
    device.status == :connected and
      (device_placement(device) == "docker_black_box" or
         String.contains?(String.downcase(to_string(device.id || "")), "black_box"))
  end

  defp connector_matches?(_device, nil), do: true

  defp connector_matches?(device, connector_type) do
    to_string(device.connector_type || "") == connector_type
  end

  defp device_placement(device) do
    metadata = device[:deployment_metadata] || device["deployment_metadata"] || %{}
    to_string(metadata[:placement] || metadata["placement"] || "")
  end

  defp wait_for_deployment_status(device_id, deployment_id, statuses, timeout_ms) do
    wait_until(timeout_ms, @default_poll_ms, fn ->
      DeviceManager.get_device_deployments(device_id)
      |> Enum.find(fn deployment ->
        deployment.id == deployment_id and deployment.status in statuses
      end)
    end)
    |> case do
      nil ->
        Mix.raise(
          "Deployment #{deployment_id} did not reach #{inspect(statuses)} within #{timeout_ms}ms"
        )

      deployment ->
        deployment
    end
  end

  defp wait_until(timeout_ms, poll_ms, fun) when is_function(fun, 0) do
    deadline = System.monotonic_time(:millisecond) + timeout_ms
    do_wait_until(deadline, poll_ms, fun)
  end

  defp do_wait_until(deadline, poll_ms, fun) do
    case fun.() do
      nil ->
        if System.monotonic_time(:millisecond) >= deadline do
          nil
        else
          Process.sleep(poll_ms)
          do_wait_until(deadline, poll_ms, fun)
        end

      value ->
        value
    end
  end

  defp present?(value) when is_binary(value), do: String.trim(value) != ""
  defp present?(_), do: false
end
