defmodule AetheriumServer.TimeSeriesInfluxIntegrationTest do
  use ExUnit.Case, async: false

  alias AetheriumServer.TimeSeriesInfluxQuery
  alias AetheriumServer.TimeSeriesQuery

  @run_integration? (System.get_env("RUN_INFLUX_INTEGRATION_TESTS") || "0") in [
                      "1",
                      "true",
                      "TRUE",
                      "yes",
                      "YES"
                    ]
  @moduletag :influx_integration
  @moduletag skip:
               if(!@run_integration?,
                 do: "Set RUN_INFLUX_INTEGRATION_TESTS=1 to run",
                 else: false
               )

  setup do
    sink_config = influx_config()

    old_sink = Application.get_env(:aetherium_server, AetheriumServer.TimeSeriesInfluxSink, [])
    old_query = Application.get_env(:aetherium_server, TimeSeriesQuery, [])

    Application.put_env(:aetherium_server, AetheriumServer.TimeSeriesInfluxSink, sink_config)

    Application.put_env(:aetherium_server, TimeSeriesQuery,
      backend: "influx",
      replay_limit: 10_000,
      fallback_to_local: false
    )

    on_exit(fn ->
      Application.put_env(:aetherium_server, AetheriumServer.TimeSeriesInfluxSink, old_sink)
      Application.put_env(:aetherium_server, TimeSeriesQuery, old_query)
    end)

    :ok
  end

  test "queries and replays timeline against real influxdb" do
    deployment_id = "influx-it-#{:erlang.unique_integer([:positive])}"
    t0 = System.system_time(:millisecond) - 2_000
    t1 = t0 + 100
    t2 = t0 + 200

    snapshot_state = %{
      "deployment_id" => deployment_id,
      "status" => "loading",
      "current_state" => "idle",
      "variables" => %{"enabled" => false}
    }

    lines = [
      line_snapshot(deployment_id, "seed", 1, snapshot_state, t0),
      line_event(
        deployment_id,
        "deployment_status",
        1,
        %{"status" => "running", "current_state" => "idle"},
        t1
      ),
      line_event(
        deployment_id,
        "variable_updated",
        2,
        %{"name" => "enabled", "value" => true},
        t2
      )
    ]

    assert :ok = write_lines(lines)
    Process.sleep(300)

    assert {:ok, snapshot} = TimeSeriesInfluxQuery.latest_snapshot_before(deployment_id, t2)
    assert snapshot["deployment_id"] == deployment_id
    assert snapshot["state"]["current_state"] == "idle"

    assert {:ok, events} =
             TimeSeriesInfluxQuery.list_events(
               deployment_id,
               after_ts: t0 + 1,
               before_ts: t2,
               limit: 10
             )

    assert length(events) == 2

    assert {:ok, replay} = TimeSeriesQuery.replay_state_at(deployment_id, t2)
    assert replay["source"] == "influx"
    assert replay["state"]["status"] == "running"
    assert replay["state"]["variables"]["enabled"] == true
    assert replay["events_replayed"] == 2
  end

  defp influx_config do
    [
      enabled: true,
      url: System.get_env("INFLUXDB_URL") || "http://localhost:8086",
      org: System.get_env("INFLUXDB_ORG") || "aetherium",
      bucket: System.get_env("INFLUXDB_BUCKET") || "aetherium_ts",
      token: System.get_env("INFLUXDB_TOKEN") || "aetherium-dev-token",
      timeout_ms: 5_000
    ]
  end

  defp write_lines(lines) do
    _ = :inets.start()

    config = influx_config()

    url =
      "#{String.trim_trailing(config[:url], "/")}/api/v2/write?org=#{URI.encode(config[:org])}&bucket=#{URI.encode(config[:bucket])}&precision=ns"

    body = Enum.join(lines, "\n")

    headers = [
      {~c"Authorization", String.to_charlist("Token " <> config[:token])},
      {~c"Content-Type", ~c"text/plain"}
    ]

    request = {String.to_charlist(url), headers, ~c"text/plain", body}
    http_opts = [timeout: config[:timeout_ms], connect_timeout: config[:timeout_ms]]

    case :httpc.request(:post, request, http_opts, body_format: :binary) do
      {:ok, {{_http, status, _reason}, _resp_headers, _resp_body}} when status in [200, 204] ->
        :ok

      {:ok, {{_http, status, _reason}, _resp_headers, resp_body}} ->
        flunk("Influx write failed with status=#{status}, body=#{inspect(resp_body)}")

      {:error, reason} ->
        flunk("Influx write request failed: #{inspect(reason)}")
    end
  end

  defp line_event(deployment_id, event_name, cursor, payload, timestamp_ms) do
    payload_json = payload |> Jason.encode!() |> escape_field_string()

    "aeth_timeline,kind=event,deployment_id=#{escape_tag(deployment_id)},event=#{escape_tag(event_name)} cursor=#{cursor}i,payload_json=\"#{payload_json}\" #{timestamp_ms * 1_000_000}"
  end

  defp line_snapshot(deployment_id, reason, snapshot_cursor, state_map, timestamp_ms) do
    state_json = state_map |> Jason.encode!() |> escape_field_string()

    "aeth_timeline,kind=snapshot,deployment_id=#{escape_tag(deployment_id)},reason=#{escape_tag(reason)} snapshot_cursor=#{snapshot_cursor}i,state_json=\"#{state_json}\" #{timestamp_ms * 1_000_000}"
  end

  defp escape_tag(value) when is_binary(value) do
    value
    |> String.replace("\\", "\\\\")
    |> String.replace(",", "\\,")
    |> String.replace(" ", "\\ ")
    |> String.replace("=", "\\=")
  end

  defp escape_field_string(value) when is_binary(value) do
    value
    |> String.replace("\\", "\\\\")
    |> String.replace("\"", "\\\"")
    |> String.replace("\n", "\\n")
    |> String.replace("\r", "\\r")
  end
end
