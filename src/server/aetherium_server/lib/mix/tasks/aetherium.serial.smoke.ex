defmodule Mix.Tasks.Aetherium.Serial.Smoke do
  use Mix.Task

  @moduledoc """
  Hardware smoke flow for a connected serial Arduino:
  1) wait for target device
  2) deploy minimal automata
  3) wait for deploy `:stopped`
  4) start and confirm `:running`
  5) stop and confirm `:stopped`
  """

  @shortdoc "Hardware smoke: wait for serial Arduino device and verify deploy/start/stop"

  alias AetheriumServer.DeviceManager

  @default_wait_ms 30_000
  @default_poll_ms 200
  @default_timeout_ms 20_000

  @impl true
  def run(args) do
    Mix.Task.run("app.start")

    opts = parse_args(args)
    device = wait_for_device(opts[:device_id], opts[:wait_ms], opts[:poll_ms])

    Mix.shell().info(
      "Using device #{device.id} (#{device.connector_type}/#{device.transport}) run through serial smoke"
    )

    automata_id = "serial-smoke-#{System.system_time(:millisecond)}"

    {:ok, deployment} =
      DeviceManager.deploy_automata(automata_id, device.id, sample_automata(automata_id))

    Mix.shell().info("Deployment created: #{deployment.id} (status=#{deployment.status})")

    deployment =
      wait_for_deployment_status(device.id, deployment.id, [:stopped, :error], opts[:timeout_ms])

    if deployment.status == :error do
      Mix.raise("Deploy failed: #{inspect(deployment.error || "unknown_error")}")
    end

    :ok = DeviceManager.start_automata(deployment.id)

    deployment =
      wait_for_deployment_status(device.id, deployment.id, [:running, :error], opts[:timeout_ms])

    if deployment.status == :error do
      Mix.raise("Start failed: #{inspect(deployment.error || "unknown_error")}")
    end

    :ok = DeviceManager.stop_automata(deployment.id)

    deployment =
      wait_for_deployment_status(device.id, deployment.id, [:stopped, :error], opts[:timeout_ms])

    if deployment.status == :error do
      Mix.raise("Stop failed: #{inspect(deployment.error || "unknown_error")}")
    end

    Mix.shell().info(
      "Serial smoke PASS (deployment=#{deployment.id}, status=#{deployment.status})"
    )
  end

  defp parse_args(args) do
    {opts, _rest, _invalid} =
      OptionParser.parse(args,
        strict: [
          device_id: :string,
          wait_ms: :integer,
          poll_ms: :integer,
          timeout_ms: :integer
        ]
      )

    [
      device_id: Keyword.get(opts, :device_id),
      wait_ms: max(Keyword.get(opts, :wait_ms, @default_wait_ms), 1),
      poll_ms: max(Keyword.get(opts, :poll_ms, @default_poll_ms), 10),
      timeout_ms: max(Keyword.get(opts, :timeout_ms, @default_timeout_ms), 1_000)
    ]
  end

  defp wait_for_device(nil, wait_ms, poll_ms) do
    wait_until(wait_ms, poll_ms, fn ->
      DeviceManager.list_devices()
      |> Enum.find(fn d ->
        d.status == :connected and d.connector_type == :serial and
          d.device_type in [:arduino, :esp32]
      end)
    end)
    |> case do
      nil -> Mix.raise("No connected serial Arduino/ESP32 device detected within #{wait_ms}ms")
      device -> device
    end
  end

  defp wait_for_device(device_id, wait_ms, poll_ms) when is_binary(device_id) do
    wait_until(wait_ms, poll_ms, fn ->
      case DeviceManager.get_device(device_id) do
        {:ok, d} when d.status == :connected -> d
        _ -> nil
      end
    end)
    |> case do
      nil -> Mix.raise("Device #{device_id} not connected within #{wait_ms}ms")
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
      name: "Serial Smoke",
      version: "1.0.0",
      states: %{
        "idle" => %{id: "idle", name: "Idle", type: :initial},
        "running" => %{id: "running", name: "Running", type: :normal}
      },
      transitions: %{
        "t1" => %{
          id: "t1",
          from: "idle",
          to: "running",
          type: :classic,
          condition: "enabled == true"
        }
      },
      variables: [
        %{id: "v1", name: "enabled", type: "bool", direction: :input, default: true}
      ]
    }
  end
end
