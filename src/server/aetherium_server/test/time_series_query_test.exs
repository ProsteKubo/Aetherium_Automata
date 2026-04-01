defmodule AetheriumServer.TimeSeriesQueryTest do
  use ExUnit.Case, async: false

  alias AetheriumServer.TimeSeriesQuery
  alias AetheriumServer.TimeSeriesStore

  defmodule FakeInfluxOk do
    def list_timeline(_deployment_id, _opts) do
      {:ok,
       %{
         events: [
           %{"deployment_id" => "dep", "event" => "deployment_status", "timestamp" => 1234}
         ],
         snapshots: [%{"deployment_id" => "dep", "timestamp" => 1230, "state" => %{}}]
       }}
    end
  end

  defmodule FakeInfluxReplay do
    def list_timeline(_deployment_id, _opts) do
      {:ok,
       %{
         snapshots: [
           %{
             "deployment_id" => "dep",
             "timestamp" => 1_000,
             "state" => %{
               "deployment_id" => "dep",
               "status" => "loading",
               "current_state" => "idle",
               "variables" => %{"enabled" => false}
             }
           }
         ],
         events: [
           %{
             "deployment_id" => "dep",
             "event" => "deployment_status",
             "timestamp" => 1_100,
             "cursor" => 101,
             "payload" => %{"status" => "running", "current_state" => "idle"}
           },
           %{
             "deployment_id" => "dep",
             "event" => "variable_updated",
             "timestamp" => 1_200,
             "cursor" => 102,
             "payload" => %{"name" => "enabled", "value" => true}
           },
           %{
             "deployment_id" => "dep",
             "event" => "state_changed",
             "timestamp" => 1_300,
             "cursor" => 103,
             "payload" => %{
               "from_state" => "idle",
               "to_state" => "running",
               "transition_id" => "t1"
             }
           }
         ]
       }}
    end
  end

  defmodule FakeInfluxReplayTargeted do
    def latest_snapshot_before("dep", 1_350) do
      {:ok,
       %{
         "deployment_id" => "dep",
         "timestamp" => 1_000,
         "state" => %{
           "deployment_id" => "dep",
           "status" => "loading",
           "current_state" => "idle",
           "variables" => %{"enabled" => false}
         }
       }}
    end

    def list_events("dep", opts) do
      if opts[:after_ts] == 1_001 and opts[:before_ts] == 1_350 do
        {:ok,
         [
           %{
             "deployment_id" => "dep",
             "event" => "deployment_status",
             "timestamp" => 1_100,
             "cursor" => 201,
             "payload" => %{
               "status" => "running",
               "current_state" => "idle",
               "deployment_metadata" => %{
                 "trace" => %{"fault_profile" => "staging"},
                 "latency" => %{"observed_ms" => 18, "budget_ms" => 30}
               }
             }
           },
           %{
             "deployment_id" => "dep",
             "event" => "variable_updated",
             "timestamp" => 1_200,
             "cursor" => 202,
             "payload" => %{"name" => "enabled", "value" => true}
           },
           %{
             "deployment_id" => "dep",
             "event" => "state_changed",
             "timestamp" => 1_300,
             "cursor" => 203,
             "payload" => %{
               "from_state" => "idle",
               "to_state" => "running",
               "transition_id" => "t1"
             }
           }
         ]}
      else
        {:error, {:unexpected_opts, opts}}
      end
    end

    # Must not be used for targeted replay.
    def list_timeline(_deployment_id, _opts), do: {:error, :should_not_call_list_timeline}
  end

  defmodule FakeInfluxError do
    def list_timeline(_deployment_id, _opts), do: {:error, :influx_unavailable}
  end

  test "uses local backend when configured" do
    put_time_series_query_env(backend: "local", fallback_to_local: true)

    suffix = Integer.to_string(:erlang.unique_integer([:positive]))
    deployment_id = "query-local-#{suffix}"

    assert {:ok, _} =
             TimeSeriesStore.append_snapshot(%{
               deployment_id: deployment_id,
               timestamp: 1_000,
               state: %{"deployment_id" => deployment_id, "status" => "loading"}
             })

    assert {:ok, _} =
             TimeSeriesStore.append_event(%{
               deployment_id: deployment_id,
               event: "deployment_status",
               timestamp: 1_100,
               payload: %{"status" => "running"}
             })

    timeline = TimeSeriesQuery.list_timeline(deployment_id, limit: 10)
    assert timeline.source == "local"
    assert length(timeline.events) == 1
    assert length(timeline.snapshots) == 1
  end

  test "uses influx backend when available" do
    put_time_series_query_env(
      backend: "influx",
      fallback_to_local: true,
      influx_query_module: FakeInfluxOk
    )

    timeline = TimeSeriesQuery.list_timeline("dep", limit: 10)
    assert timeline.source == "influx"
    assert length(timeline.events) == 1
    assert length(timeline.snapshots) == 1
  end

  test "falls back to local backend when influx query fails" do
    put_time_series_query_env(
      backend: "influx",
      fallback_to_local: true,
      influx_query_module: FakeInfluxError
    )

    suffix = Integer.to_string(:erlang.unique_integer([:positive]))
    deployment_id = "query-fallback-#{suffix}"

    assert {:ok, _} =
             TimeSeriesStore.append_event(%{
               deployment_id: deployment_id,
               event: "deployment_status",
               timestamp: 2_100,
               payload: %{"status" => "running"}
             })

    timeline = TimeSeriesQuery.list_timeline(deployment_id, limit: 10)
    assert timeline.source == "local_fallback"
    assert timeline.events != []
    assert timeline.backend_error =~ "influx_unavailable"
  end

  test "replays deployment state from targeted influx backend" do
    put_time_series_query_env(
      backend: "influx",
      fallback_to_local: true,
      replay_limit: 1_000,
      influx_query_module: FakeInfluxReplayTargeted
    )

    assert {:ok, replay} = TimeSeriesQuery.replay_state_at("dep", 1_350)
    assert replay["source"] == "influx"
    assert replay["state"]["status"] == "running"
    assert replay["state"]["current_state"] == "running"
    assert replay["state"]["variables"]["enabled"] == true
    assert get_in(replay["state"], ["deployment_metadata", "trace", "fault_profile"]) == "staging"
    assert get_in(replay["state"], ["deployment_metadata", "latency", "observed_ms"]) == 18
    assert replay["events_replayed"] == 3
    assert is_binary(replay["state_fingerprint"])
    assert String.length(replay["state_fingerprint"]) == 64
    assert is_integer(replay["event_cursor_start"])
    assert is_integer(replay["event_cursor_end"])
  end

  test "replays deployment state from legacy influx timeline path" do
    put_time_series_query_env(
      backend: "influx",
      fallback_to_local: false,
      replay_limit: 1_000,
      influx_query_module: FakeInfluxReplay
    )

    assert {:ok, replay} = TimeSeriesQuery.replay_state_at("dep", 1_350)
    assert replay["source"] == "influx"
    assert replay["state"]["current_state"] == "running"
  end

  test "replay falls back to local backend when influx replay query fails" do
    put_time_series_query_env(
      backend: "influx",
      fallback_to_local: true,
      replay_limit: 1_000,
      influx_query_module: FakeInfluxError
    )

    suffix = Integer.to_string(:erlang.unique_integer([:positive]))
    deployment_id = "replay-fallback-#{suffix}"

    assert {:ok, _} =
             TimeSeriesStore.append_snapshot(%{
               deployment_id: deployment_id,
               timestamp: 5_000,
               state: %{
                 deployment_id: deployment_id,
                 status: "loading",
                 current_state: "idle",
                 variables: %{"enabled" => false}
               }
             })

    assert {:ok, _} =
             TimeSeriesStore.append_event(%{
               deployment_id: deployment_id,
               event: "variable_updated",
               timestamp: 5_100,
               payload: %{name: "enabled", value: true}
             })

    assert {:ok, replay} = TimeSeriesQuery.replay_state_at(deployment_id, 5_200)
    assert replay["source"] == "local_fallback"
    assert replay["state"]["variables"]["enabled"] == true
    assert replay["backend_error"] =~ "influx_unavailable"
  end

  defp put_time_series_query_env(opts) do
    old = Application.get_env(:aetherium_server, TimeSeriesQuery, [])
    Application.put_env(:aetherium_server, TimeSeriesQuery, opts)
    on_exit(fn -> Application.put_env(:aetherium_server, TimeSeriesQuery, old) end)
  end
end
