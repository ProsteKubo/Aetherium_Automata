defmodule AetheriumServer.TimeSeriesQuery do
  @moduledoc """
  Timeline query abstraction with backend selection and fallback handling.
  """

  alias AetheriumServer.TimeSeriesInfluxQuery
  alias AetheriumServer.TimeSeriesReplay
  alias AetheriumServer.TimeSeriesStore

  @default_limit 500
  @default_replay_limit 50_000

  @type timeline :: %{events: [map()], snapshots: [map()]}

  @spec list_timeline(String.t(), keyword()) :: timeline() | map()
  def list_timeline(deployment_id, opts \\ []) when is_binary(deployment_id) do
    opts = normalize_opts(opts)

    case backend() do
      :local ->
        local_timeline(deployment_id, opts)
        |> Map.put(:source, "local")

      :influx ->
        influx_timeline(deployment_id, opts)

      :auto ->
        if influx_enabled?() do
          influx_timeline(deployment_id, opts)
        else
          local_timeline(deployment_id, opts)
          |> Map.put(:source, "local")
        end
    end
  end

  @spec replay_state_at(String.t(), non_neg_integer()) :: {:ok, map()} | {:error, term()}
  def replay_state_at(deployment_id, timestamp_ms)
      when is_binary(deployment_id) and is_integer(timestamp_ms) and timestamp_ms >= 0 do
    case backend() do
      :local ->
        replay_local(deployment_id, timestamp_ms, "local")

      :influx ->
        replay_influx(deployment_id, timestamp_ms)

      :auto ->
        if influx_enabled?() do
          replay_influx(deployment_id, timestamp_ms)
        else
          replay_local(deployment_id, timestamp_ms, "local")
        end
    end
  end

  defp influx_timeline(deployment_id, opts) do
    influx_query_module = influx_query_module()

    case influx_query_module.list_timeline(deployment_id, opts) do
      {:ok, timeline} ->
        timeline
        |> normalize_timeline()
        |> Map.put(:source, "influx")

      {:error, reason} ->
        if fallback_to_local?() do
          local_timeline(deployment_id, opts)
          |> Map.put(:source, "local_fallback")
          |> Map.put(:backend_error, inspect(reason))
        else
          %{events: [], snapshots: [], source: "influx", error: inspect(reason)}
        end
    end
  end

  defp local_timeline(deployment_id, opts) do
    events =
      TimeSeriesStore.list_events(
        deployment_id,
        after_ts: opts[:after_ts],
        before_ts: opts[:before_ts],
        limit: opts[:limit],
        order: :asc
      )

    snapshots =
      TimeSeriesStore.list_snapshots(
        deployment_id,
        after_ts: opts[:after_ts],
        before_ts: opts[:before_ts],
        limit: opts[:limit],
        order: :asc
      )

    %{events: events, snapshots: snapshots}
  end

  defp normalize_timeline(%{events: events, snapshots: snapshots})
       when is_list(events) and is_list(snapshots) do
    %{events: events, snapshots: snapshots}
  end

  defp normalize_timeline(%{"events" => events, "snapshots" => snapshots})
       when is_list(events) and is_list(snapshots) do
    %{events: events, snapshots: snapshots}
  end

  defp normalize_timeline(_), do: %{events: [], snapshots: []}

  defp replay_influx(deployment_id, timestamp_ms) do
    influx_query_module = influx_query_module()

    replay_result =
      if function_exported?(influx_query_module, :latest_snapshot_before, 2) and
           function_exported?(influx_query_module, :list_events, 2) do
        do_replay_influx_targeted(influx_query_module, deployment_id, timestamp_ms)
      else
        do_replay_influx_legacy(influx_query_module, deployment_id, timestamp_ms)
      end

    case replay_result do
      {:ok, replay} ->
        {:ok, replay}

      {:error, reason} ->
        if fallback_to_local?() do
          with {:ok, replay} <- replay_local(deployment_id, timestamp_ms, "local_fallback") do
            {:ok, Map.put(replay, "backend_error", inspect(reason))}
          end
        else
          {:error, {:influx_query_failed, reason}}
        end
    end
  end

  defp replay_local(deployment_id, timestamp_ms, source) when is_binary(source) do
    case TimeSeriesStore.replay_state_at(deployment_id, timestamp_ms) do
      {:ok, replay} -> {:ok, Map.put(replay, "source", source)}
      {:error, reason} -> {:error, reason}
    end
  end

  defp do_replay_influx_targeted(influx_query_module, deployment_id, timestamp_ms) do
    with {:ok, base_snapshot} <-
           influx_query_module.latest_snapshot_before(deployment_id, timestamp_ms),
         {:ok, events} <-
           list_events_for_replay(influx_query_module, deployment_id, base_snapshot, timestamp_ms),
         snapshots = if(is_map(base_snapshot), do: [base_snapshot], else: []),
         {:ok, replay} <-
           TimeSeriesReplay.replay_state_at(deployment_id, timestamp_ms, snapshots, events) do
      {:ok, Map.put(replay, "source", "influx")}
    end
  end

  defp list_events_for_replay(influx_query_module, deployment_id, base_snapshot, timestamp_ms) do
    after_ts =
      if is_map(base_snapshot) do
        ts = base_snapshot["timestamp"] || base_snapshot[:timestamp]
        if is_integer(ts) and ts >= 0, do: ts + 1, else: nil
      else
        nil
      end

    influx_query_module.list_events(
      deployment_id,
      after_ts: after_ts,
      before_ts: timestamp_ms,
      limit: replay_limit()
    )
  end

  defp do_replay_influx_legacy(influx_query_module, deployment_id, timestamp_ms) do
    opts = [
      before_ts: timestamp_ms,
      limit: replay_limit()
    ]

    with {:ok, timeline} <- influx_query_module.list_timeline(deployment_id, opts),
         timeline = normalize_timeline(timeline),
         {:ok, replay} <-
           TimeSeriesReplay.replay_state_at(
             deployment_id,
             timestamp_ms,
             timeline.snapshots,
             timeline.events
           ) do
      {:ok, Map.put(replay, "source", "influx")}
    end
  end

  defp normalize_opts(opts) when is_list(opts) do
    after_ts = normalize_ts(opts[:after_ts])
    before_ts = normalize_ts(opts[:before_ts])
    limit = normalize_limit(opts[:limit])
    [after_ts: after_ts, before_ts: before_ts, limit: limit]
  end

  defp normalize_ts(value) when is_integer(value) and value >= 0, do: value
  defp normalize_ts(_), do: nil

  defp normalize_limit(value) when is_integer(value) and value > 0, do: value
  defp normalize_limit(_), do: @default_limit

  defp replay_limit do
    case Keyword.get(config(), :replay_limit, @default_replay_limit) do
      value when is_integer(value) and value > 0 -> value
      _ -> @default_replay_limit
    end
  end

  defp backend do
    case config() |> Keyword.get(:backend, :auto) |> to_string() do
      "local" -> :local
      "influx" -> :influx
      _ -> :auto
    end
  end

  defp fallback_to_local? do
    Keyword.get(config(), :fallback_to_local, true)
  end

  defp influx_enabled? do
    influx_config =
      Application.get_env(:aetherium_server, AetheriumServer.TimeSeriesInfluxSink, [])

    Keyword.get(influx_config, :enabled, false)
  end

  defp influx_query_module do
    Keyword.get(config(), :influx_query_module, TimeSeriesInfluxQuery)
  end

  defp config do
    Application.get_env(:aetherium_server, __MODULE__, [])
  end
end
