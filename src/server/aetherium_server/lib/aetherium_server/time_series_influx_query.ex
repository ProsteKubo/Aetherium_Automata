defmodule AetheriumServer.TimeSeriesInfluxQuery do
  @moduledoc """
  InfluxDB query adapter for deployment timeline data.
  """

  @default_timeout_ms 5_000
  @measurement "aeth_timeline"

  @spec list_timeline(String.t(), keyword()) ::
          {:ok, %{events: [map()], snapshots: [map()]}} | {:error, term()}
  def list_timeline(deployment_id, opts \\ []) when is_binary(deployment_id) do
    with {:ok, events} <- list_events(deployment_id, opts),
         {:ok, snapshots} <- list_snapshots(deployment_id, opts) do
      {:ok, %{events: events, snapshots: snapshots}}
    end
  end

  @spec latest_snapshot_before(String.t(), non_neg_integer()) ::
          {:ok, map() | nil} | {:error, term()}
  def latest_snapshot_before(deployment_id, timestamp_ms)
      when is_binary(deployment_id) and is_integer(timestamp_ms) and timestamp_ms >= 0 do
    stop_expr = flux_stop_expr(timestamp_ms)

    query = """
    from(bucket: "#{escape_flux_string(bucket())}")
      |> range(start: time(v: 0), stop: #{stop_expr})
      |> filter(fn: (r) => r._measurement == "#{@measurement}" and r.deployment_id == "#{escape_flux_string(deployment_id)}" and r.kind == "snapshot")
      |> pivot(rowKey: ["_time", "deployment_id", "reason"], columnKey: ["_field"], valueColumn: "_value")
      |> sort(columns: ["_time"], desc: true)
      |> limit(n: 1)
    """

    with {:ok, rows} <- run_query(query) do
      snapshot =
        rows
        |> Enum.map(&snapshot_from_row/1)
        |> Enum.reject(&is_nil/1)
        |> List.first()

      {:ok, snapshot}
    end
  end

  @spec list_events(String.t(), keyword()) :: {:ok, [map()]} | {:error, term()}
  def list_events(deployment_id, opts \\ []) when is_binary(deployment_id) do
    limit = normalize_limit(Keyword.get(opts, :limit, 500))
    start_expr = flux_start_expr(Keyword.get(opts, :after_ts))
    stop_expr = flux_stop_expr(Keyword.get(opts, :before_ts))

    query = """
    from(bucket: "#{escape_flux_string(bucket())}")
      |> range(start: #{start_expr}, stop: #{stop_expr})
      |> filter(fn: (r) => r._measurement == "#{@measurement}" and r.deployment_id == "#{escape_flux_string(deployment_id)}" and r.kind == "event")
      |> pivot(rowKey: ["_time", "deployment_id", "event"], columnKey: ["_field"], valueColumn: "_value")
      |> sort(columns: ["_time"], desc: false)
      |> limit(n: #{limit})
    """

    with {:ok, rows} <- run_query(query) do
      events =
        rows
        |> Enum.map(&event_from_row/1)
        |> Enum.reject(&is_nil/1)

      {:ok, events}
    end
  end

  @spec list_snapshots(String.t(), keyword()) :: {:ok, [map()]} | {:error, term()}
  def list_snapshots(deployment_id, opts \\ []) when is_binary(deployment_id) do
    limit = normalize_limit(Keyword.get(opts, :limit, 500))
    start_expr = flux_start_expr(Keyword.get(opts, :after_ts))
    stop_expr = flux_stop_expr(Keyword.get(opts, :before_ts))

    query = """
    from(bucket: "#{escape_flux_string(bucket())}")
      |> range(start: #{start_expr}, stop: #{stop_expr})
      |> filter(fn: (r) => r._measurement == "#{@measurement}" and r.deployment_id == "#{escape_flux_string(deployment_id)}" and r.kind == "snapshot")
      |> pivot(rowKey: ["_time", "deployment_id", "reason"], columnKey: ["_field"], valueColumn: "_value")
      |> sort(columns: ["_time"], desc: false)
      |> limit(n: #{limit})
    """

    with {:ok, rows} <- run_query(query) do
      snapshots =
        rows
        |> Enum.map(&snapshot_from_row/1)
        |> Enum.reject(&is_nil/1)

      {:ok, snapshots}
    end
  end

  defp run_query(query) when is_binary(query) do
    _ = :inets.start()

    url =
      "#{String.trim_trailing(base_url(), "/")}/api/v2/query?org=#{URI.encode(org())}"

    headers = [
      {~c"Authorization", String.to_charlist("Token " <> token())},
      {~c"Accept", ~c"text/csv"},
      {~c"Content-Type", ~c"application/json"}
    ]

    body = Jason.encode!(%{"query" => query, "type" => "flux"})
    request = {String.to_charlist(url), headers, ~c"application/json", body}
    timeout_ms = max(timeout_ms(), 500)
    http_opts = [timeout: timeout_ms, connect_timeout: timeout_ms]

    case :httpc.request(:post, request, http_opts, body_format: :binary) do
      {:ok, {{_http, 200, _reason}, _headers, response_body}} ->
        {:ok, parse_query_csv(response_body)}

      {:ok, {{_http, status, _reason}, _headers, response_body}} ->
        {:error, {:http_status, status, response_body}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp parse_query_csv(body) when is_binary(body) do
    {_, rows} =
      body
      |> String.split("\n")
      |> Enum.reduce({nil, []}, fn raw_line, {header, acc} ->
        line = String.trim_trailing(raw_line, "\r")

        cond do
          line == "" ->
            {header, acc}

          String.starts_with?(line, "#") ->
            {header, acc}

          true ->
            columns = parse_csv_line(line)

            if header_row?(columns) do
              {columns, acc}
            else
              if is_nil(header) do
                {header, acc}
              else
                row =
                  header
                  |> Enum.zip(columns)
                  |> Enum.into(%{})

                {header, [row | acc]}
              end
            end
        end
      end)

    Enum.reverse(rows)
  end

  defp header_row?(columns) when is_list(columns) do
    Enum.member?(columns, "_time") and Enum.member?(columns, "table")
  end

  defp event_from_row(row) when is_map(row) do
    deployment_id = row["deployment_id"] || ""
    event = row["event"] || "unknown"
    timestamp = parse_timestamp_ms(row["_time"])
    cursor = parse_int(row["cursor"])
    payload = decode_json_map(row["payload_json"])

    if deployment_id == "" do
      nil
    else
      %{
        "deployment_id" => deployment_id,
        "event" => event,
        "timestamp" => timestamp,
        "cursor" => cursor,
        "payload" => payload
      }
    end
  end

  defp snapshot_from_row(row) when is_map(row) do
    deployment_id = row["deployment_id"] || ""
    reason = row["reason"] || "snapshot"
    timestamp = parse_timestamp_ms(row["_time"])
    snapshot_cursor = parse_int(row["snapshot_cursor"])
    snapshot_state = decode_json_map(row["state_json"])

    if deployment_id == "" do
      nil
    else
      %{
        "deployment_id" => deployment_id,
        "reason" => reason,
        "timestamp" => timestamp,
        "snapshot_cursor" => snapshot_cursor,
        "state" => snapshot_state
      }
    end
  end

  defp parse_csv_line(line), do: parse_csv_line(line, "", [], false)

  defp parse_csv_line(<<>>, field, acc, _in_quotes) do
    Enum.reverse([field | acc])
  end

  defp parse_csv_line(<<34, 34, rest::binary>>, field, acc, true) do
    parse_csv_line(rest, field <> "\"", acc, true)
  end

  defp parse_csv_line(<<34, rest::binary>>, field, acc, in_quotes) do
    parse_csv_line(rest, field, acc, !in_quotes)
  end

  defp parse_csv_line(<<44, rest::binary>>, field, acc, false) do
    parse_csv_line(rest, "", [field | acc], false)
  end

  defp parse_csv_line(<<char::utf8, rest::binary>>, field, acc, in_quotes) do
    parse_csv_line(rest, field <> <<char::utf8>>, acc, in_quotes)
  end

  defp parse_timestamp_ms(value) when is_binary(value) do
    case DateTime.from_iso8601(value) do
      {:ok, dt, _offset} ->
        DateTime.to_unix(dt, :millisecond)

      _ ->
        parse_int(value)
    end
  end

  defp parse_timestamp_ms(value) when is_integer(value), do: value
  defp parse_timestamp_ms(_), do: 0

  defp parse_int(value) when is_integer(value), do: value

  defp parse_int(value) when is_binary(value) do
    case Integer.parse(value) do
      {int, ""} -> int
      _ -> 0
    end
  end

  defp parse_int(_), do: 0

  defp decode_json_map(value) when is_binary(value) and value != "" do
    case Jason.decode(value) do
      {:ok, map} when is_map(map) -> map
      _ -> %{}
    end
  end

  defp decode_json_map(_), do: %{}

  defp normalize_limit(value) when is_integer(value) and value > 0, do: value
  defp normalize_limit(_), do: 500

  defp flux_start_expr(value) when is_integer(value) and value >= 0 do
    ~s|time(v: "#{ms_to_rfc3339(value)}")|
  end

  defp flux_start_expr(_), do: "time(v: 0)"

  defp flux_stop_expr(value) when is_integer(value) and value >= 0 do
    # Influx range(stop:) is exclusive; +1ms keeps external API semantics inclusive.
    ~s|time(v: "#{ms_to_rfc3339(value + 1)}")|
  end

  defp flux_stop_expr(_), do: "now()"

  defp ms_to_rfc3339(ms) do
    ms
    |> DateTime.from_unix!(:millisecond)
    |> DateTime.to_iso8601()
  end

  defp escape_flux_string(value) when is_binary(value) do
    value
    |> String.replace("\\", "\\\\")
    |> String.replace("\"", "\\\"")
    |> String.replace("\n", "\\n")
    |> String.replace("\r", "\\r")
  end

  defp config do
    Application.get_env(:aetherium_server, AetheriumServer.TimeSeriesInfluxSink, [])
  end

  defp base_url, do: Keyword.get(config(), :url, "http://localhost:8086")
  defp org, do: Keyword.get(config(), :org, "aetherium")
  defp bucket, do: Keyword.get(config(), :bucket, "aetherium_ts")
  defp token, do: Keyword.get(config(), :token, "")
  defp timeout_ms, do: Keyword.get(config(), :timeout_ms, @default_timeout_ms)
end
