defmodule Mix.Tasks.Aetherium.Showcase.Deploy do
  use Mix.Task

  @shortdoc "List/deploy curated showcase automata to connected devices"

  alias AetheriumServer.DeviceManager
  alias AetheriumServer.ShowcaseCatalog

  @default_wait_ms 30_000
  @default_poll_ms 200
  @default_timeout_ms 20_000

  @impl true
  def run(args) do
    opts = parse_args(args)

    if opts[:list] do
      list_showcase_entries()
    else
      run_deploy(opts)
    end
  end

  defp run_deploy(opts) do
    Mix.Task.run("app.start")

    target = opts[:showcase]

    if is_nil(target) or target == "" do
      Mix.raise("Missing --showcase. Use --list to inspect available entries.")
    end

    device =
      wait_for_device(opts[:device_id], opts[:wait_ms], opts[:poll_ms], opts[:connector_type])

    with {:ok, loaded} <- ShowcaseCatalog.load_automata(target),
         %{entry: entry, automata: automata} = loaded do
      timestamp = System.system_time(:millisecond)
      automata_id = "showcase-#{entry.id}-#{timestamp}"

      Mix.shell().info("Deploying #{entry.id} (#{entry.relative_path}) to device #{device.id}")

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
          end

          Mix.shell().info(
            "Showcase deploy PASS (id=#{entry.id}, deployment=#{deployment.id}, status=#{deployment.status})"
          )

        {:error, reason} ->
          Mix.raise("Deploy failed: #{inspect(reason)}")
      end
    else
      {:error, {:showcase_not_found, missing}} ->
        Mix.raise("Showcase entry not found: #{missing}. Use --list.")

      {:error, reason} ->
        Mix.raise("Failed to load showcase: #{inspect(reason)}")
    end
  end

  defp list_showcase_entries do
    case ShowcaseCatalog.list_entries() do
      {:ok, entries} ->
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
          device_id: :string,
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
      device_id: Keyword.get(opts, :device_id),
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

  defp connector_matches?(_device, nil), do: true

  defp connector_matches?(device, connector_type) do
    to_string(device.connector_type || "") == connector_type
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
end
