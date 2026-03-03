defmodule AetheriumServer.TimeSeriesReplay do
  @moduledoc """
  Shared replay logic for reconstructing deployment state from timeline data.
  """

  @spec replay_state_at(String.t(), non_neg_integer(), [map()], [map()]) ::
          {:ok, map()} | {:error, term()}
  def replay_state_at(deployment_id, timestamp_ms, snapshots, events)
      when is_binary(deployment_id) and is_integer(timestamp_ms) and timestamp_ms >= 0 and
             is_list(snapshots) and is_list(events) do
    base_snapshot =
      snapshots
      |> Enum.sort_by(&entry_timestamp/1, :desc)
      |> Enum.find(fn snapshot ->
        entry_timestamp(snapshot) <= timestamp_ms
      end)

    base_state =
      case base_snapshot do
        nil ->
          %{
            "deployment_id" => deployment_id,
            "status" => "unknown",
            "current_state" => nil,
            "variables" => %{},
            "error" => nil
          }

        snapshot ->
          snapshot["state"] || %{}
      end

    base_ts = if base_snapshot, do: entry_timestamp(base_snapshot), else: -1

    replay_events =
      events
      |> Enum.filter(fn event ->
        ts = entry_timestamp(event)
        ts > base_ts and ts <= timestamp_ms
      end)
      |> Enum.sort_by(&entry_timestamp/1, :asc)

    replayed_cursors =
      replay_events
      |> Enum.map(&entry_cursor/1)
      |> Enum.filter(&is_integer/1)

    state_at_time =
      Enum.reduce(replay_events, base_state, fn event, acc ->
        apply_event(acc, event)
      end)

    {:ok,
     %{
       "deployment_id" => deployment_id,
       "requested_timestamp" => timestamp_ms,
       "base_snapshot" => base_snapshot,
       "state" => state_at_time,
       "events_replayed" => length(replay_events),
       "event_cursor_start" => List.first(replayed_cursors),
       "event_cursor_end" => List.last(replayed_cursors),
       "state_fingerprint" => state_fingerprint(state_at_time)
     }}
  end

  def replay_state_at(_deployment_id, _timestamp_ms, _snapshots, _events) do
    {:error, :invalid_arguments}
  end

  defp apply_event(state, event) when is_map(state) and is_map(event) do
    event_name = event["event"] || event["kind"] || ""
    payload = event["payload"] || event["data"] || %{}

    case event_name do
      "deployment_status" ->
        state
        |> maybe_put_if_present("status", payload["status"])
        |> maybe_put_if_present("current_state", payload["current_state"])
        |> maybe_put_if_present("error", payload["error"])
        |> maybe_merge_variables(payload["variables"])

      "state_changed" ->
        state
        |> maybe_put_if_present("previous_state", payload["from_state"])
        |> maybe_put_if_present("current_state", payload["to_state"])
        |> maybe_put_if_present("last_transition", payload["transition_id"])

      "variable_updated" ->
        variables = state["variables"] || %{}
        name = payload["name"]
        value = payload["value"]

        if is_binary(name) do
          Map.put(state, "variables", Map.put(variables, name, value))
        else
          state
        end

      "deployment_error" ->
        state
        |> Map.put("status", "error")
        |> Map.put("error", payload["message"] || payload["error"])

      "time_travel_rewind_marker" ->
        payload["state"] || state

      _ ->
        state
    end
  end

  defp apply_event(state, _), do: state

  defp maybe_merge_variables(state, value) when is_map(value) do
    Map.put(state, "variables", Map.merge(state["variables"] || %{}, value))
  end

  defp maybe_merge_variables(state, _), do: state

  defp maybe_put_if_present(state, _key, nil), do: state
  defp maybe_put_if_present(state, key, value), do: Map.put(state, key, value)

  defp entry_timestamp(entry) when is_map(entry) do
    value = entry["timestamp"] || entry[:timestamp]
    if is_integer(value), do: value, else: 0
  end

  defp entry_cursor(entry) when is_map(entry) do
    value = entry["cursor"] || entry[:cursor]
    if is_integer(value), do: value, else: nil
  end

  defp state_fingerprint(state) when is_map(state) do
    state
    |> :erlang.term_to_binary()
    |> then(&:crypto.hash(:sha256, &1))
    |> Base.encode16(case: :lower)
  end
end
