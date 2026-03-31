defmodule AetheriumServer.TimeSeriesInfluxSinkTest do
  use ExUnit.Case, async: false

  alias AetheriumServer.DeviceManager
  alias AetheriumServer.TimeSeriesInfluxSink

  setup do
    old_env = Application.get_env(:aetherium_server, TimeSeriesInfluxSink, [])
    old_state = :sys.get_state(TimeSeriesInfluxSink)

    Application.put_env(
      :aetherium_server,
      TimeSeriesInfluxSink,
      Keyword.merge(old_env, enabled: true)
    )

    :sys.replace_state(TimeSeriesInfluxSink, fn state ->
      %{state | enabled: true, batch_size: 10_000, flush_interval_ms: 60_000, queue: []}
    end)

    on_exit(fn ->
      Application.put_env(:aetherium_server, TimeSeriesInfluxSink, old_env)
      :sys.replace_state(TimeSeriesInfluxSink, fn _state -> old_state end)
    end)

    :ok
  end

  test "append_device_status and append_device_metrics serialize dedicated measurements" do
    now = System.system_time(:millisecond)

    TimeSeriesInfluxSink.append_device_status(%{
      "device_id" => "device-a",
      "server_id" => "srv_test",
      "connector_type" => "websocket",
      "transport" => "websocket",
      "placement" => "device",
      "status" => "connected",
      "last_seen_at" => now,
      "connected_at" => now - 5_000,
      "has_session" => true,
      "deployment_id" => "deployment-a",
      "automata_id" => "automata-a",
      "deployment_status" => "running",
      "current_state" => "idle",
      "battery_percent" => 92.5,
      "battery_low" => false,
      "latency_budget_ms" => 50,
      "latency_warning_ms" => 25,
      "observed_latency_ms" => 18,
      "timestamp" => now
    })

    TimeSeriesInfluxSink.append_device_metrics(%{
      "device_id" => "device-a",
      "deployment_id" => "deployment-a",
      "server_id" => "srv_test",
      "connector_type" => "websocket",
      "transport" => "websocket",
      "placement" => "device",
      "link" => "ws://lab/device-a",
      "cpu_usage" => 12.5,
      "heap_free" => 128,
      "heap_total" => 256,
      "tick_rate" => 20,
      "run_id" => 42,
      "message_id" => 7,
      "source_id" => 3,
      "telemetry_timestamp_ms" => now,
      "received_at_ms" => now,
      "variable_count" => 2,
      "battery_percent" => 92.5,
      "battery_low" => false,
      "battery_present" => true,
      "battery_external_power" => false,
      "latency_budget_ms" => 50,
      "latency_warning_ms" => 25,
      "observed_latency_ms" => 18,
      "ingress_latency_ms" => 8,
      "egress_latency_ms" => 10,
      "send_timestamp_ms" => now - 20,
      "receive_timestamp_ms" => now - 12,
      "handle_timestamp_ms" => now - 2,
      "timestamp" => now
    })

    queue = wait_for_queue(fn entries -> length(entries) == 2 end)

    assert Enum.any?(queue, &String.starts_with?(&1, "aeth_device_status,"))
    assert Enum.any?(queue, &String.contains?(&1, "status=connected"))
    assert Enum.any?(queue, &String.starts_with?(&1, "aeth_device_metrics,"))
    assert Enum.any?(queue, &String.contains?(&1, "cpu_usage=12.500000"))
    assert Enum.any?(queue, &String.contains?(&1, "placement=device"))
    assert Enum.any?(queue, &String.contains?(&1, "battery_percent=92.500000"))
    assert Enum.any?(queue, &String.contains?(&1, "observed_latency_ms=18i"))
  end

  test "device manager persists telemetry and disconnect status for grafana measurements" do
    suffix = Integer.to_string(:erlang.unique_integer([:positive]))
    device_id = "grafana-device-#{suffix}"
    automata_id = "grafana-automata-#{suffix}"

    {:ok, _device} =
      DeviceManager.register_device(
        %{
          device_id: device_id,
          device_type: :desktop,
          capabilities: 0xFFFF,
          protocol_version: 1
        },
        self()
      )

    {:ok, _deployment} =
      DeviceManager.deploy_automata(automata_id, device_id, sample_automata(automata_id))

    DeviceManager.handle_device_message(device_id, :telemetry, %{
      message_id: 9,
      source_id: 5,
      run_id: 123,
      timestamp: System.system_time(:millisecond),
      heap_free: 64,
      heap_total: 128,
      cpu_usage: 1.5,
      tick_rate: 30,
      variables: [%{id: 1, value: true}],
      placement: "device",
      battery_present: true,
      battery_percent: 84.0,
      battery_low: false,
      battery_external_power: false,
      latency_budget_ms: 45,
      latency_warning_ms: 20,
      observed_latency_ms: 17,
      ingress_latency_ms: 7,
      egress_latency_ms: 10,
      send_timestamp: System.system_time(:millisecond) - 25,
      receive_timestamp: System.system_time(:millisecond) - 15,
      handle_timestamp: System.system_time(:millisecond) - 5
    })

    DeviceManager.device_disconnected(device_id)

    queue =
      wait_for_queue(fn entries ->
        Enum.any?(entries, &String.starts_with?(&1, "aeth_device_metrics,")) and
          Enum.any?(entries, &String.contains?(&1, "status=disconnected"))
      end)

    assert Enum.any?(queue, &String.contains?(&1, "deployment_id=#{automata_id}:#{device_id}"))
    assert Enum.any?(queue, &String.contains?(&1, "cpu_usage=1.500000"))
    assert Enum.any?(queue, &String.contains?(&1, "status=disconnected"))
    assert Enum.any?(queue, &String.contains?(&1, "battery_percent=84.000000"))
    assert Enum.any?(queue, &String.contains?(&1, "observed_latency_ms=17i"))
  end

  defp wait_for_queue(predicate, attempts \\ 20)

  defp wait_for_queue(predicate, attempts) when attempts > 0 do
    queue = :sys.get_state(TimeSeriesInfluxSink).queue

    if predicate.(queue) do
      queue
    else
      Process.sleep(25)
      wait_for_queue(predicate, attempts - 1)
    end
  end

  defp wait_for_queue(_predicate, 0) do
    flunk("Timed out waiting for influx queue contents")
  end

  defp sample_automata(id) do
    %{
      id: id,
      name: "Grafana Test",
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
        %{id: "v1", name: "enabled", type: "bool", direction: :input, default: false}
      ]
    }
  end
end
