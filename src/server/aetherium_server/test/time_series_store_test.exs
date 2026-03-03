defmodule AetheriumServer.TimeSeriesStoreTest do
  use ExUnit.Case, async: false

  alias AetheriumServer.TimeSeriesStore

  test "stores events/snapshots and reconstructs state at target timestamp" do
    suffix = Integer.to_string(:erlang.unique_integer([:positive]))
    deployment_id = "tt-deploy-#{suffix}"

    assert {:ok, _cursor} =
             TimeSeriesStore.append_snapshot(%{
               deployment_id: deployment_id,
               timestamp: 1_000,
               state: %{
                 deployment_id: deployment_id,
                 status: "loading",
                 current_state: "idle",
                 variables: %{"enabled" => false},
                 error: nil
               }
             })

    assert {:ok, _cursor} =
             TimeSeriesStore.append_event(%{
               deployment_id: deployment_id,
               event: "deployment_status",
               timestamp: 1_100,
               payload: %{
                 status: "running",
                 current_state: "idle"
               }
             })

    assert {:ok, _cursor} =
             TimeSeriesStore.append_event(%{
               deployment_id: deployment_id,
               event: "variable_updated",
               timestamp: 1_200,
               payload: %{
                 name: "enabled",
                 value: true
               }
             })

    assert {:ok, _cursor} =
             TimeSeriesStore.append_event(%{
               deployment_id: deployment_id,
               event: "state_changed",
               timestamp: 1_300,
               payload: %{
                 from_state: "idle",
                 to_state: "running",
                 transition_id: "t1"
               }
             })

    assert {:ok, replay_mid} = TimeSeriesStore.replay_state_at(deployment_id, 1_250)
    assert replay_mid["state"]["status"] == "running"
    assert replay_mid["state"]["current_state"] == "idle"
    assert replay_mid["state"]["variables"]["enabled"] == true
    assert is_binary(replay_mid["state_fingerprint"])
    assert String.length(replay_mid["state_fingerprint"]) == 64
    assert is_integer(replay_mid["event_cursor_start"])
    assert is_integer(replay_mid["event_cursor_end"])
    assert replay_mid["event_cursor_start"] <= replay_mid["event_cursor_end"]

    assert {:ok, replay_end} = TimeSeriesStore.replay_state_at(deployment_id, 1_350)
    assert replay_end["state"]["current_state"] == "running"
    assert replay_end["state"]["last_transition"] == "t1"
    assert is_binary(replay_end["state_fingerprint"])
    assert String.length(replay_end["state_fingerprint"]) == 64
    assert is_integer(replay_end["event_cursor_start"])
    assert is_integer(replay_end["event_cursor_end"])
    assert replay_end["event_cursor_start"] <= replay_end["event_cursor_end"]
    assert replay_end["events_replayed"] >= 1

    assert {:ok, replay_end_again} = TimeSeriesStore.replay_state_at(deployment_id, 1_350)
    assert replay_end_again["state_fingerprint"] == replay_end["state_fingerprint"]
  end
end
