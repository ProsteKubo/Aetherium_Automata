defmodule Mix.Tasks.Aetherium.Esp32.Timetravel.Demo do
  use Mix.Task

  @shortdoc "ESP32 serial demo: deploy/start/stop, then query and rewind timeline"

  alias AetheriumServer.DeviceManager

  @default_wait_ms 45_000
  @default_poll_ms 200
  @default_timeout_ms 25_000
  @default_run_ms 3_000
  @default_timeline_limit 250

  @impl true
  def run(args) do
    Mix.Task.run("app.start")

    opts = parse_args(args)
    device = wait_for_esp32_device(opts[:device_id], opts[:wait_ms], opts[:poll_ms])

    Mix.shell().info(
      "Using ESP32 device #{device.id} (connector=#{device.connector_type}, link=#{device.link})"
    )

    automata_id = "esp32-tt-#{System.system_time(:millisecond)}"

    {:ok, deployment} = DeviceManager.deploy_automata(automata_id, device.id, sample_automata(automata_id))

    Mix.shell().info("Deployment created: #{deployment.id} status=#{deployment.status}")

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

    :ok = DeviceManager.start_automata(deployment.id)

    deployment =
      wait_for_deployment_status(device.id, deployment.id, [:running, :error], opts[:timeout_ms])

    if deployment.status == :error do
      Mix.raise("Start failed: #{inspect(deployment.error || "unknown_error")}")
    end

    Process.sleep(opts[:run_ms])

    :ok = DeviceManager.stop_automata(deployment.id)
    _ = wait_for_deployment_status(device.id, deployment.id, [:stopped, :error], opts[:timeout_ms])

    timeline = DeviceManager.list_time_series(deployment.id, limit: opts[:timeline_limit])
    events = timeline[:events] || []
    snapshots = timeline[:snapshots] || []

    Mix.shell().info(
      "Timeline captured: events=#{length(events)} snapshots=#{length(snapshots)} source=#{timeline[:source] || "unknown"}"
    )

    rewind_ts = rewind_timestamp(events, snapshots)

    if is_nil(rewind_ts) do
      Mix.raise("No timeline timestamp available to rewind")
    end

    case DeviceManager.rewind_deployment(deployment.id, rewind_ts) do
      {:ok, rewind} ->
        Mix.shell().info(
          "Rewind PASS deployment=#{deployment.id} ts=#{rewind_ts} events_replayed=#{rewind[:events_replayed] || 0}"
        )

      {:error, reason} ->
        Mix.raise("Rewind failed: #{inspect(reason)}")
    end
  end

  defp parse_args(args) do
    {opts, _rest, _invalid} =
      OptionParser.parse(args,
        strict: [
          device_id: :string,
          wait_ms: :integer,
          poll_ms: :integer,
          timeout_ms: :integer,
          run_ms: :integer,
          timeline_limit: :integer
        ]
      )

    [
      device_id: Keyword.get(opts, :device_id),
      wait_ms: max(Keyword.get(opts, :wait_ms, @default_wait_ms), 1),
      poll_ms: max(Keyword.get(opts, :poll_ms, @default_poll_ms), 10),
      timeout_ms: max(Keyword.get(opts, :timeout_ms, @default_timeout_ms), 1_000),
      run_ms: max(Keyword.get(opts, :run_ms, @default_run_ms), 500),
      timeline_limit: max(Keyword.get(opts, :timeline_limit, @default_timeline_limit), 20)
    ]
  end

  defp wait_for_esp32_device(nil, wait_ms, poll_ms) do
    wait_until(wait_ms, poll_ms, fn ->
      DeviceManager.list_devices()
      |> Enum.find(fn d ->
        d.status == :connected and d.connector_type == :serial and d.device_type == :esp32
      end)
    end)
    |> case do
      nil -> Mix.raise("No connected serial ESP32 device detected within #{wait_ms}ms")
      device -> device
    end
  end

  defp wait_for_esp32_device(device_id, wait_ms, poll_ms) when is_binary(device_id) do
    wait_until(wait_ms, poll_ms, fn ->
      case DeviceManager.get_device(device_id) do
        {:ok, d} when d.status == :connected and d.device_type == :esp32 -> d
        _ -> nil
      end
    end)
    |> case do
      nil -> Mix.raise("ESP32 device #{device_id} not connected within #{wait_ms}ms")
      device -> device
    end
  end

  defp wait_for_deployment_status(device_id, deployment_id, statuses, timeout_ms) do
    wait_until(timeout_ms, @default_poll_ms, fn ->
      DeviceManager.get_device_deployments(device_id)
      |> Enum.find(fn d ->
        d.id == deployment_id and d.status in statuses
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

  defp rewind_timestamp(events, snapshots) do
    event_ts =
      case events do
        [] ->
          nil

        list ->
          idx = div(length(list), 2)
          list |> Enum.at(idx) |> extract_timestamp()
      end

    snapshot_ts =
      snapshots
      |> List.first()
      |> extract_timestamp()

    event_ts || snapshot_ts
  end

  defp extract_timestamp(nil), do: nil
  defp extract_timestamp(%{"timestamp" => ts}) when is_integer(ts), do: ts
  defp extract_timestamp(%{timestamp: ts}) when is_integer(ts), do: ts
  defp extract_timestamp(_), do: nil

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

  defp sample_automata(id) do
    %{
      id: id,
      name: "ESP32 Time Travel Demo",
      version: "1.0.0",
      initial_state: "idle",
      states: %{
        "idle" => %{id: "idle", name: "Idle", type: :initial},
        "running" => %{id: "running", name: "Running", type: :normal},
        "pulse" => %{id: "pulse", name: "Pulse", type: :normal}
      },
      transitions: %{
        "enable" => %{
          id: "enable",
          from: "idle",
          to: "running",
          type: :classic,
          condition: "enabled == true"
        },
        "running_to_pulse" => %{
          id: "running_to_pulse",
          from: "running",
          to: "pulse",
          type: :timed,
          after: 250
        },
        "pulse_to_running" => %{
          id: "pulse_to_running",
          from: "pulse",
          to: "running",
          type: :timed,
          after: 250
        }
      },
      variables: [
        %{id: "v1", name: "enabled", type: "bool", direction: :input, default: true}
      ]
    }
  end
end
