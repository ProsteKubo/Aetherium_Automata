defmodule AetheriumServer.GatewayConnection do
  use GenServer
  require Logger

  @default_url "ws://localhost:4000/socket/websocket"
  @default_auth_token nil
  @default_server_id "srv_01"
  @default_heartbeat_interval 10_000
  @default_join_retry_interval 2_000

  def start_link(_opts) do
    GenServer.start_link(__MODULE__, nil, name: __MODULE__)
  end

  @impl true
  def init(_opts) do
    config = Application.fetch_env!(:aetherium_server, :gateway)

    url = config[:url] || @default_url
    token = config[:auth_token] || @default_auth_token
    server_id = config[:server_id] || @default_server_id
    heartbeat_interval = config[:heartbeat_interval] || @default_heartbeat_interval
    join_retry_interval = config[:join_retry_interval] || @default_join_retry_interval

    {:ok, socket} =
      PhoenixClient.Socket.start_link(
        url: url,
        params: %{
          "token" => token,
          "server_id" => server_id
        }
      )

    send(self(), :try_join)

    {:ok,
     %{
       socket: socket,
       channel: nil,
       config: config,
       url: url,
       token: token,
       server_id: server_id,
       heartbeat_interval: heartbeat_interval,
       join_retry_interval: join_retry_interval,
       gateway_link: %{}
     }}
  end

  def report_devices(devices), do: GenServer.cast(__MODULE__, {:report_devices, devices})
  def report_alert(alert), do: GenServer.cast(__MODULE__, {:report_alert, alert})

  def push(event, payload) when is_binary(event) and is_map(payload) do
    GenServer.cast(__MODULE__, {:push, event, payload})
  end

  @impl true
  def handle_cast({:report_devices, devices}, %{channel: channel} = state)
      when not is_nil(channel) do
    PhoenixClient.Channel.push_async(
      channel,
      "device_update",
      decorate_gateway_payload(state, "device_update", %{"devices" => devices})
    )

    {:noreply, state}
  end

  def handle_cast({:report_devices, _devices}, state), do: {:noreply, state}

  @impl true
  def handle_cast({:report_alert, alert}, %{channel: channel} = state) when not is_nil(channel) do
    PhoenixClient.Channel.push_async(
      channel,
      "device_alert",
      decorate_gateway_payload(state, "device_alert", alert)
    )

    {:noreply, state}
  end

  def handle_cast({:report_alert, _alert}, state), do: {:noreply, state}

  @impl true
  def handle_cast({:push, event, payload}, %{channel: channel} = state)
      when not is_nil(channel) do
    PhoenixClient.Channel.push_async(
      channel,
      event,
      decorate_gateway_payload(state, event, payload)
    )

    {:noreply, state}
  end

  def handle_cast({:push, _event, _payload}, state), do: {:noreply, state}

  @impl true
  def handle_info(:send_heartbeat, %{channel: nil} = state), do: {:noreply, state}

  def handle_info(
        :send_heartbeat,
        %{channel: channel, heartbeat_interval: heartbeat_interval} = state
      ) do
    state = send_gateway_heartbeat(state, channel)
    push_live_deployments(state)
    push_connector_statuses(state)
    Process.send_after(self(), :send_heartbeat, heartbeat_interval)
    {:noreply, state}
  end

  @impl true
  def handle_info(:try_join, %{socket: socket} = state) do
    join_payload = %{"token" => state.token, "server_id" => state.server_id}

    case PhoenixClient.Channel.join(socket, "server:gateway", join_payload) do
      {:ok, _response, channel} ->
        Logger.info("Connected to gateway and joined server:gateway")
        joined_state = %{state | channel: channel}
        push_current_devices(joined_state)
        push_live_deployments(joined_state)
        push_connector_statuses(joined_state)
        Process.send_after(self(), :send_heartbeat, state.heartbeat_interval)
        {:noreply, joined_state}

      {:error, :socket_not_connected} ->
        Process.send_after(self(), :try_join, state.join_retry_interval)
        {:noreply, state}

      {:error, reason} ->
        Logger.warning("Failed to join server:gateway: #{inspect(reason)}")
        Process.send_after(self(), :try_join, state.join_retry_interval)
        {:noreply, state}
    end
  end

  @impl true
  def handle_info(%PhoenixClient.Message{event: "device_command", payload: payload}, state) do
    Logger.info("Received command from gateway: #{inspect(payload)}")
    {:noreply, state}
  end

  @impl true
  def handle_info(%PhoenixClient.Message{event: "deploy_automata", payload: payload}, state) do
    {payload, envelope} = split_envelope(payload)
    automata_id = payload["automata_id"]
    device_id = payload["device_id"]
    automata = normalize_automata(payload["automata"])

    result =
      cond do
        is_nil(automata_id) or is_nil(device_id) or !is_map(automata) ->
          {:nak, :invalid_payload, %{}}

        true ->
          case AetheriumServer.DeviceManager.deploy_automata(automata_id, device_id, automata) do
            {:ok, deployment} ->
              push_to_gateway(state, "deployment_status", %{
                deployment_id: deployment.id,
                automata_id: automata_id,
                device_id: device_id,
                status: "loading"
              })

              {:ack, :ok, %{"deployment_id" => deployment.id}}

            {:error, reason} ->
              Logger.error("Failed to deploy automata: #{inspect(reason)}")

              push_to_gateway(
                state,
                "deployment_error",
                deployment_error_payload(automata_id, device_id, reason)
              )

              {:error, reason, %{}}
          end
      end

    push_command_outcome(state, envelope, "deploy_automata", result)
    {:noreply, state}
  end

  @impl true
  def handle_info(%PhoenixClient.Message{event: "stop_automata", payload: payload}, state) do
    {payload, envelope} = split_envelope(payload)
    deployment_id = resolve_deployment_id(payload)

    result =
      cond do
        is_nil(deployment_id) ->
          {:nak, :deployment_not_found, %{}}

        true ->
          case AetheriumServer.DeviceManager.stop_automata(deployment_id) do
            :ok ->
              push_to_gateway(state, "deployment_status", %{
                deployment_id: deployment_id,
                status: "stopped"
              })

              {:ack, :ok, %{"deployment_id" => deployment_id}}

            {:error, reason} ->
              Logger.error("Failed to stop automata: #{inspect(reason)}")
              {:error, reason, %{}}
          end
      end

    push_command_outcome(state, envelope, "stop_automata", result)
    {:noreply, state}
  end

  @impl true
  def handle_info(%PhoenixClient.Message{event: "start_automata", payload: payload}, state) do
    {payload, envelope} = split_envelope(payload)
    deployment_id = resolve_deployment_id(payload)

    result =
      cond do
        is_nil(deployment_id) ->
          {:nak, :deployment_not_found, %{}}

        true ->
          case AetheriumServer.DeviceManager.start_automata(deployment_id) do
            :ok ->
              push_to_gateway(state, "deployment_status", %{
                deployment_id: deployment_id,
                status: "running"
              })

              {:ack, :ok, %{"deployment_id" => deployment_id}}

            {:error, reason} ->
              {:error, reason, %{}}
          end
      end

    push_command_outcome(state, envelope, "start_automata", result)
    {:noreply, state}
  end

  @impl true
  def handle_info(%PhoenixClient.Message{event: "pause_automata", payload: payload}, state) do
    {payload, envelope} = split_envelope(payload)
    deployment_id = resolve_deployment_id(payload)

    result =
      cond do
        is_nil(deployment_id) ->
          {:nak, :deployment_not_found, %{}}

        true ->
          case AetheriumServer.DeviceManager.pause_automata(deployment_id) do
            :ok ->
              push_to_gateway(state, "deployment_status", %{
                deployment_id: deployment_id,
                status: "paused"
              })

              {:ack, :ok, %{"deployment_id" => deployment_id}}

            {:error, reason} ->
              {:error, reason, %{}}
          end
      end

    push_command_outcome(state, envelope, "pause_automata", result)
    {:noreply, state}
  end

  @impl true
  def handle_info(%PhoenixClient.Message{event: "resume_automata", payload: payload}, state) do
    {payload, envelope} = split_envelope(payload)
    deployment_id = resolve_deployment_id(payload)

    result =
      cond do
        is_nil(deployment_id) ->
          {:nak, :deployment_not_found, %{}}

        true ->
          case AetheriumServer.DeviceManager.resume_automata(deployment_id) do
            :ok ->
              push_to_gateway(state, "deployment_status", %{
                deployment_id: deployment_id,
                status: "running"
              })

              {:ack, :ok, %{"deployment_id" => deployment_id}}

            {:error, reason} ->
              {:error, reason, %{}}
          end
      end

    push_command_outcome(state, envelope, "resume_automata", result)
    {:noreply, state}
  end

  @impl true
  def handle_info(%PhoenixClient.Message{event: "reset_automata", payload: payload}, state) do
    {payload, envelope} = split_envelope(payload)
    deployment_id = resolve_deployment_id(payload)

    result =
      cond do
        is_nil(deployment_id) ->
          {:nak, :deployment_not_found, %{}}

        true ->
          case AetheriumServer.DeviceManager.reset_automata(deployment_id) do
            :ok -> {:ack, :ok, %{"deployment_id" => deployment_id}}
            {:error, reason} -> {:error, reason, %{}}
          end
      end

    push_command_outcome(state, envelope, "reset_automata", result)
    {:noreply, state}
  end

  @impl true
  def handle_info(%PhoenixClient.Message{event: "set_input", payload: payload}, state) do
    {payload, envelope} = split_envelope(payload)
    result = handle_set_input(payload)
    push_command_outcome(state, envelope, "set_input", result)
    {:noreply, state}
  end

  @impl true
  def handle_info(%PhoenixClient.Message{event: "trigger_event", payload: payload}, state) do
    {payload, envelope} = split_envelope(payload)
    deployment_id = resolve_deployment_id(payload)
    event_name = payload["event"]
    data = payload["data"]

    result =
      cond do
        is_nil(deployment_id) ->
          {:nak, :deployment_not_found, %{}}

        is_nil(event_name) or event_name == "" ->
          {:nak, :invalid_payload, %{"reason" => "missing_event"}}

        true ->
          case AetheriumServer.DeviceManager.trigger_event(deployment_id, event_name, data) do
            :ok ->
              {:ack, :ok, %{"deployment_id" => deployment_id}}

            {:error, :invalid_black_box_event} ->
              {:nak, :invalid_black_box_event, %{"deployment_id" => deployment_id}}

            {:error, :unsupported_command} ->
              {:nak, :unsupported_command, %{"deployment_id" => deployment_id}}

            {:error, reason} ->
              {:error, reason, %{"deployment_id" => deployment_id}}
          end
      end

    push_command_outcome(state, envelope, "trigger_event", result)
    {:noreply, state}
  end

  @impl true
  def handle_info(%PhoenixClient.Message{event: "force_state", payload: payload}, state) do
    {payload, envelope} = split_envelope(payload)
    deployment_id = resolve_deployment_id(payload)
    state_id = payload["state_id"]

    result =
      cond do
        is_nil(deployment_id) ->
          {:nak, :deployment_not_found, %{}}

        is_nil(state_id) or state_id == "" ->
          {:nak, :invalid_payload, %{"reason" => "missing_state_id"}}

        true ->
          case AetheriumServer.DeviceManager.force_state(deployment_id, state_id) do
            :ok ->
              {:ack, :ok, %{"deployment_id" => deployment_id, "state_id" => state_id}}

            {:error, :invalid_black_box_state} ->
              {:nak, :invalid_black_box_state, %{"deployment_id" => deployment_id}}

            {:error, :unsupported_command} ->
              {:nak, :unsupported_command, %{"deployment_id" => deployment_id}}

            {:error, reason} ->
              {:error, reason, %{"deployment_id" => deployment_id}}
          end
      end

    push_command_outcome(state, envelope, "force_state", result)
    {:noreply, state}
  end

  @impl true
  def handle_info(%PhoenixClient.Message{event: "request_state", payload: payload}, state) do
    {payload, envelope} = split_envelope(payload)
    deployment_id = resolve_deployment_id(payload)

    result =
      cond do
        is_nil(deployment_id) ->
          {:nak, :deployment_not_found, %{}}

        true ->
          case AetheriumServer.DeviceManager.request_state(deployment_id) do
            {:ok, runtime_state} ->
              running? =
                case runtime_state do
                  %{running: running} -> running
                  %{"running" => running} -> running
                  %{execution_state: 2} -> true
                  %{"execution_state" => 2} -> true
                  _ -> false
                end

              push_to_gateway(state, "deployment_status", %{
                deployment_id: deployment_id,
                automata_id: runtime_state[:automata_id] || runtime_state["automata_id"],
                device_id: runtime_state[:device_id] || runtime_state["device_id"],
                status: if(running?, do: "running", else: "stopped"),
                current_state: runtime_state[:current_state] || runtime_state["current_state"],
                variables: runtime_state[:variables] || runtime_state["variables"] || %{},
                deployment_metadata:
                  runtime_state[:deployment_metadata] || runtime_state["deployment_metadata"] ||
                    %{}
              })

              {:ack, :ok, %{"deployment_id" => deployment_id, "state" => runtime_state}}

            {:error, reason} ->
              {:error, reason, %{"deployment_id" => deployment_id}}
          end
      end

    push_command_outcome(state, envelope, "request_state", result)
    {:noreply, state}
  end

  @impl true
  def handle_info(%PhoenixClient.Message{event: "time_travel_query", payload: payload}, state) do
    {payload, envelope} = split_envelope(payload)
    deployment_id = resolve_deployment_id(payload)

    result =
      cond do
        is_nil(deployment_id) ->
          {:nak, :deployment_not_found, %{}}

        true ->
          opts =
            []
            |> maybe_put_opt(
              :after_ts,
              parse_optional_non_negative_int(payload["after_ts"] || payload["from_ts"])
            )
            |> maybe_put_opt(
              :before_ts,
              parse_optional_non_negative_int(payload["before_ts"] || payload["to_ts"])
            )
            |> maybe_put_opt(:limit, parse_optional_positive_int(payload["limit"]))

          timeline = AetheriumServer.DeviceManager.list_time_series(deployment_id, opts)
          {:ack, :ok, %{"deployment_id" => deployment_id, "timeline" => timeline}}
      end

    push_command_outcome(state, envelope, "time_travel_query", result)
    {:noreply, state}
  end

  @impl true
  def handle_info(%PhoenixClient.Message{event: "rewind_deployment", payload: payload}, state) do
    {payload, envelope} = split_envelope(payload)
    deployment_id = resolve_deployment_id(payload)

    target_ts =
      parse_optional_non_negative_int(
        payload["target_timestamp"] || payload["target_ts"] || payload["timestamp"]
      )

    result =
      cond do
        is_nil(deployment_id) ->
          {:nak, :deployment_not_found, %{}}

        is_nil(target_ts) ->
          {:nak, :invalid_payload, %{"reason" => "missing_target_timestamp"}}

        true ->
          case AetheriumServer.DeviceManager.rewind_deployment(deployment_id, target_ts) do
            {:ok, rewind} ->
              {:ack, :ok, stringify_keys(rewind)}

            {:error, reason} ->
              {:error, reason, %{"deployment_id" => deployment_id}}
          end
      end

    push_command_outcome(state, envelope, "rewind_deployment", result)
    {:noreply, state}
  end

  @impl true
  def handle_info(%PhoenixClient.Message{event: "analyzer_query", payload: payload}, state) do
    {payload, envelope} = split_envelope(payload)

    result =
      case AetheriumServer.DeviceManager.query_analyzer(payload) do
        {:ok, bundle} ->
          {:ack, :ok, stringify_keys(bundle)}

        {:error, reason} ->
          {:error, reason, %{}}
      end

    push_command_outcome(state, envelope, "analyzer_query", result)
    {:noreply, state}
  end

  @impl true
  def handle_info(%PhoenixClient.Message{event: "phx_error"} = message, state) do
    Logger.warning("Gateway channel error: #{inspect(message.payload)}")
    Process.send_after(self(), :try_join, state.join_retry_interval)
    {:noreply, %{state | channel: nil}}
  end

  @impl true
  def handle_info(%PhoenixClient.Message{event: "phx_close"} = message, state) do
    Logger.warning("Gateway channel closed: #{inspect(message.payload)}")
    Process.send_after(self(), :try_join, state.join_retry_interval)
    {:noreply, %{state | channel: nil}}
  end

  @impl true
  def handle_info(%PhoenixClient.Message{event: event, payload: payload}, state) do
    Logger.debug("Ignoring gateway event #{event}: #{inspect(payload)}")
    {:noreply, state}
  end

  @impl true
  def handle_info({:disconnected, reason, _transport_pid}, state) do
    Logger.warning("Disconnected from gateway: #{inspect(reason)}")
    Process.send_after(self(), :try_join, state.join_retry_interval)
    {:noreply, %{state | channel: nil}}
  end

  @impl true
  def handle_info(message, state) do
    Logger.debug("Ignoring GatewayConnection message: #{inspect(message)}")
    {:noreply, state}
  end

  defp handle_set_input(payload) do
    command_opts = propagated_input_opts(payload)

    case payload do
      %{"deployment_id" => deployment_id, "input" => input, "value" => value}
      when is_binary(deployment_id) and deployment_id != "" ->
        maybe_log_propagation_delay(payload)

        case AetheriumServer.DeviceManager.set_input(deployment_id, input, value, command_opts) do
          :ok -> {:ack, :ok, %{"target_count" => 1}}
          {:error, reason} -> {:error, reason, %{"target_count" => 0}}
        end

      %{"device_id" => device_id, "input" => input, "value" => value}
      when is_binary(device_id) and device_id != "" ->
        apply_to_deployments(
          resolve_deployments_for_device(device_id),
          input,
          value,
          command_opts
        )

      %{"automata_id" => automata_id, "input" => input, "value" => value}
      when is_binary(automata_id) and automata_id != "" ->
        apply_to_deployments(
          find_deployments_by_automata(automata_id),
          input,
          value,
          command_opts
        )

      _ ->
        {:nak, :invalid_payload, %{}}
    end
  end

  defp apply_to_deployments([], _input, _value, _opts),
    do: {:nak, :deployment_not_found, %{"target_count" => 0}}

  defp apply_to_deployments(deployments, input, value, opts) do
    {ok_count, errors} =
      Enum.reduce(deployments, {0, []}, fn deployment, {oks, errs} ->
        case AetheriumServer.DeviceManager.set_input(deployment.id, input, value, opts) do
          :ok -> {oks + 1, errs}
          {:error, reason} -> {oks, [{deployment.id, reason} | errs]}
        end
      end)

    if errors == [] do
      {:ack, :ok, %{"target_count" => ok_count}}
    else
      {:error, :partial_failure, %{"target_count" => ok_count, "errors" => Enum.reverse(errors)}}
    end
  end

  defp resolve_deployments_for_device(device_id) do
    AetheriumServer.DeviceManager.get_device_deployments(device_id)
    |> Enum.filter(&active_deployment?/1)
  end

  defp resolve_deployment_id(payload) do
    deployment_id = payload["deployment_id"]
    device_id = payload["device_id"]
    automata_id = payload["automata_id"]

    cond do
      is_binary(deployment_id) and deployment_id != "" and
          deployment_exists?(deployment_id, device_id, automata_id) ->
        deployment_id

      is_binary(device_id) and device_id != "" ->
        select_deployment_id_for_device(device_id, automata_id)

      true ->
        nil
    end
  end

  defp deployment_exists?(deployment_id, device_id, automata_id) do
    candidate_device_id =
      case device_id do
        did when is_binary(did) and did != "" ->
          did

        _ ->
          case String.split(deployment_id, ":", parts: 2) do
            [_automata, did] when did != "" -> did
            _ -> nil
          end
      end

    if is_nil(candidate_device_id) do
      false
    else
      candidate_deployments =
        AetheriumServer.DeviceManager.get_device_deployments(candidate_device_id)

      Enum.any?(candidate_deployments, fn deployment ->
        deployment.id == deployment_id and
          (is_nil(automata_id) or automata_id == deployment.automata_id)
      end)
    end
  end

  defp select_deployment_id_for_device(device_id, automata_id) do
    deployments =
      device_id
      |> AetheriumServer.DeviceManager.get_device_deployments()
      |> Enum.sort_by(fn deployment -> deployment.deployed_at || 0 end, :desc)

    active_deployments = Enum.filter(deployments, &active_deployment?/1)

    if(active_deployments == [], do: deployments, else: active_deployments)
    |> maybe_filter_deployments_by_automata(automata_id)
    |> List.first()
    |> case do
      nil -> nil
      deployment -> deployment.id
    end
  end

  defp maybe_filter_deployments_by_automata(deployments, nil), do: deployments

  defp maybe_filter_deployments_by_automata(deployments, automata_id) do
    filtered = Enum.filter(deployments, &(&1.automata_id == automata_id))
    if filtered == [], do: deployments, else: filtered
  end

  defp maybe_put_opt(opts, _key, nil), do: opts
  defp maybe_put_opt(opts, _key, ""), do: opts
  defp maybe_put_opt(opts, key, value), do: Keyword.put(opts, key, value)

  defp parse_optional_non_negative_int(value) when is_integer(value) and value >= 0, do: value

  defp parse_optional_non_negative_int(value) when is_binary(value) do
    case Integer.parse(value) do
      {n, ""} when n >= 0 -> n
      _ -> nil
    end
  end

  defp parse_optional_non_negative_int(_), do: nil

  defp parse_optional_positive_int(value) when is_integer(value) and value > 0, do: value

  defp parse_optional_positive_int(value) when is_binary(value) do
    case Integer.parse(value) do
      {n, ""} when n > 0 -> n
      _ -> nil
    end
  end

  defp parse_optional_positive_int(_), do: nil

  defp split_envelope(payload) when is_map(payload) do
    payload = stringify_keys(payload)
    {Map.delete(payload, "envelope"), normalize_envelope(payload["envelope"])}
  end

  defp split_envelope(_), do: {%{}, %{}}

  defp normalize_envelope(envelope) when is_map(envelope), do: stringify_keys(envelope)
  defp normalize_envelope(_), do: %{}

  defp propagated_input_opts(payload) when is_map(payload) do
    payload
    |> Map.take([
      "internal_propagation",
      "topic",
      "topic_version",
      "origin_deployment_id",
      "topic_dispatched_at_ms",
      "force_replay"
    ])
    |> stringify_keys()
  end

  defp propagated_input_opts(_payload), do: %{}

  defp maybe_log_propagation_delay(payload) when is_map(payload) do
    case parse_optional_non_negative_int(payload["topic_dispatched_at_ms"]) do
      dispatched_at_ms ->
        if is_integer(dispatched_at_ms) do
          lag_ms = System.system_time(:millisecond) - dispatched_at_ms

          if lag_ms > 200 do
            target_id = payload["deployment_id"] || payload["automata_id"] || "unknown"

            Logger.warning(
              "Propagated set_input for #{target_id} " <>
                "spent #{lag_ms}ms before server handling"
            )
          end
        end
    end
  end

  defp maybe_log_propagation_delay(_payload), do: :ok

  defp push_command_outcome(state, envelope, command_type, {:ack, _ok, data}) do
    push_to_gateway(
      state,
      "command_outcome",
      outcome_payload(envelope, command_type, "ACK", nil, data)
    )
  end

  defp push_command_outcome(state, envelope, command_type, {:nak, reason, data}) do
    push_to_gateway(
      state,
      "command_outcome",
      outcome_payload(envelope, command_type, "NAK", reason, data)
    )
  end

  defp push_command_outcome(state, envelope, command_type, {:error, reason, data}) do
    push_to_gateway(
      state,
      "command_outcome",
      outcome_payload(envelope, command_type, "ERROR", reason, data)
    )
  end

  defp outcome_payload(envelope, command_type, status, reason, data) do
    payload =
      %{
        "status" => status,
        "command_type" => command_type,
        "command_id" => envelope["command_id"],
        "correlation_id" => envelope["correlation_id"],
        "idempotency_key" => envelope["idempotency_key"],
        "timestamp" => System.system_time(:millisecond),
        "data" => stringify_keys(data || %{})
      }

    if is_nil(reason) do
      payload
    else
      Map.put(payload, "reason", format_reason(reason))
    end
  end

  defp format_reason(reason) when is_atom(reason), do: Atom.to_string(reason)
  defp format_reason(reason) when is_binary(reason), do: reason
  defp format_reason(reason), do: inspect(reason)

  defp send_gateway_heartbeat(state, channel) do
    server_sent_at_ms = System.system_time(:millisecond)

    payload =
      %{
        "server_id" => state.server_id,
        "server_sent_at_ms" => server_sent_at_ms,
        "heartbeat_interval_ms" => state.heartbeat_interval
      }
      |> maybe_put_map("gateway_link", gateway_link_snapshot(state))

    case PhoenixClient.Channel.push(channel, "heartbeat", payload) do
      {:ok, reply} when is_map(reply) ->
        gateway_ack_at_ms = System.system_time(:millisecond)
        round_trip_latency_ms = max(gateway_ack_at_ms - server_sent_at_ms, 0)
        gateway_received_at_ms = reply["gateway_received_at_ms"] || gateway_ack_at_ms
        gateway_sent_at_ms = reply["gateway_sent_at_ms"] || gateway_received_at_ms

        gateway_link = %{
          "status" => "ok",
          "server_sent_at_ms" => server_sent_at_ms,
          "gateway_received_at_ms" => gateway_received_at_ms,
          "gateway_sent_at_ms" => gateway_sent_at_ms,
          "server_ack_at_ms" => gateway_ack_at_ms,
          "round_trip_latency_ms" => round_trip_latency_ms,
          "heartbeat_interval_ms" => state.heartbeat_interval,
          "clock_skew_ms" => gateway_received_at_ms - server_sent_at_ms
        }

        %{state | gateway_link: gateway_link}

      {:error, reason} ->
        Logger.warning("Gateway heartbeat failed: #{inspect(reason)}")

        %{state | gateway_link: %{"status" => "error", "reason" => inspect(reason)}}
    end
  end

  defp decorate_gateway_payload(state, event, payload)
       when is_map(state) and is_binary(event) and is_map(payload) do
    payload = stringify_keys(payload)
    gateway_link = gateway_link_snapshot(state)

    payload =
      payload
      |> maybe_put_map("gateway_link", gateway_link)
      |> maybe_put_int("reported_at_ms", System.system_time(:millisecond))

    case build_deployment_metadata_for_payload(state, payload) do
      %{} ->
        payload

      metadata ->
        payload
        |> Map.update("deployment_metadata", metadata, fn existing ->
          existing =
            case stringify_keys(existing) do
              %{} = existing_map -> existing_map
              _ -> %{}
            end

          Map.merge(metadata, existing)
        end)
    end
  end

  defp decorate_gateway_payload(_state, _event, payload), do: payload

  defp build_deployment_metadata_for_payload(state, payload) when is_map(payload) do
    device = find_device_for_payload(payload)
    deployment = find_deployment_for_payload(payload, device)
    build_deployment_metadata(state, payload, device, deployment)
  end

  defp build_deployment_metadata(state, payload, device, deployment) do
    transport =
      compact_map(%{
        "type" => device && device.transport,
        "link" => device && device.link,
        "connector_id" => device && device.connector_id,
        "connector_type" => normalize_text(device && device.connector_type)
      })

    runtime =
      compact_map(%{
        "run_id" => deployment && deployment.run_id,
        "target_profile" =>
          (deployment && deployment.target_profile) || payload["target_profile"],
        "patch_mode" => deployment && deployment.patch_mode,
        "artifact_version_id" => deployment && deployment.artifact_version_id,
        "snapshot_id" => deployment && deployment.snapshot_id,
        "migration_plan_ref" => deployment && deployment.migration_plan_ref
      })

    battery =
      compact_map(%{
        "present" => payload["battery_present"],
        "percent" => payload["battery_percent"],
        "low" => payload["battery_low"],
        "external_power" => payload["battery_external_power"]
      })

    latency =
      compact_map(%{
        "budget_ms" => payload["latency_budget_ms"],
        "warning_ms" => payload["latency_warning_ms"],
        "observed_ms" => payload["observed_latency_ms"],
        "ingress_ms" => payload["ingress_latency_ms"],
        "egress_ms" => payload["egress_latency_ms"],
        "send_timestamp" => payload["send_timestamp"],
        "receive_timestamp" => payload["receive_timestamp"],
        "handle_timestamp" => payload["handle_timestamp"]
      })
      |> maybe_put_map("gateway_link", gateway_link_snapshot(state))

    black_box =
      payload["black_box"] ||
        payload["black_box_contract"] ||
        payload["contract"] ||
        existing_metadata(payload, ["black_box", "contract"])

    trace =
      compact_map(%{
        "trace_file" => payload["trace_file"],
        "trace_event_count" => payload["trace_event_count"],
        "fault_profile" => payload["fault_profile"]
      })

    compact_map(%{
      "server" =>
        compact_map(%{
          "server_id" => state.server_id,
          "reported_at_ms" => System.system_time(:millisecond)
        }),
      "placement" =>
        payload["placement"] || existing_metadata(payload, ["placement"]) ||
          infer_placement(device, deployment),
      "transport" => transport,
      "runtime" => runtime,
      "battery" => battery,
      "latency" => latency,
      "black_box" => black_box,
      "trace" => trace
    })
  end

  defp find_device_for_payload(payload) when is_map(payload) do
    case payload["device_id"] do
      device_id when is_binary(device_id) and device_id != "" ->
        case AetheriumServer.DeviceManager.get_device(device_id) do
          {:ok, device} -> device
          _ -> nil
        end

      _ ->
        nil
    end
  end

  defp find_deployment_for_payload(payload, device) when is_map(payload) do
    deployment_id = payload["deployment_id"]
    automata_id = payload["automata_id"]

    deployments =
      case device do
        %{id: device_id} -> AetheriumServer.DeviceManager.get_device_deployments(device_id)
        _ -> []
      end

    Enum.find(deployments, fn deployment ->
      same_deployment? =
        !is_binary(deployment_id) or deployment_id == "" or deployment.id == deployment_id

      same_automata? =
        !is_binary(automata_id) or automata_id == "" or deployment.automata_id == automata_id

      same_deployment? and same_automata?
    end)
  end

  defp infer_placement(device, deployment) do
    cond do
      deployment && deployment.target_profile == "local_runtime" ->
        "host"

      device && normalize_text(device.connector_type) in ["local", "loopback"] ->
        "host"

      device && normalize_text(device.device_type) == "desktop" ->
        "host"

      device ->
        "device"

      true ->
        nil
    end
  end

  defp gateway_link_snapshot(%{gateway_link: gateway_link})
       when is_map(gateway_link) and map_size(gateway_link) > 0,
       do: gateway_link

  defp gateway_link_snapshot(_state), do: %{}

  defp existing_metadata(payload, [section, inner]) do
    case payload["deployment_metadata"] do
      %{} = metadata ->
        get_in(metadata, [section, inner])

      _ ->
        nil
    end
  end

  defp existing_metadata(payload, [section]) do
    case payload["deployment_metadata"] do
      %{} = metadata -> Map.get(metadata, section)
      _ -> nil
    end
  end

  defp maybe_put_map(map, _key, value) when value in [%{}, nil], do: map
  defp maybe_put_map(map, key, value), do: Map.put(map, key, value)

  defp maybe_put_int(map, _key, value) when not is_integer(value), do: map
  defp maybe_put_int(map, key, value), do: Map.put(map, key, value)

  defp compact_map(map) when is_map(map) do
    map
    |> Enum.reject(fn
      {_key, nil} -> true
      {_key, ""} -> true
      {_key, value} when is_map(value) -> map_size(value) == 0
      _ -> false
    end)
    |> Enum.into(%{})
  end

  defp normalize_text(value) when is_atom(value), do: Atom.to_string(value)
  defp normalize_text(value) when is_binary(value), do: value
  defp normalize_text(_value), do: nil

  defp push_to_gateway(%{channel: nil}, _event, _payload), do: :ok

  defp push_to_gateway(%{channel: channel} = state, event, payload) do
    PhoenixClient.Channel.push_async(
      channel,
      event,
      decorate_gateway_payload(state, event, payload)
    )
  end

  defp find_deployments_by_automata(automata_id) do
    AetheriumServer.DeviceManager.list_devices()
    |> Enum.flat_map(fn device ->
      AetheriumServer.DeviceManager.get_device_deployments(device.id)
    end)
    |> Enum.filter(&active_deployment?/1)
    |> Enum.filter(&(&1.automata_id == automata_id))
  end

  defp active_deployment?(deployment) do
    deployment.status in [:running, :paused, :loading]
  end

  defp normalize_automata(automata) when is_map(automata), do: automata
  defp normalize_automata(_), do: %{}

  defp push_current_devices(%{channel: channel} = state) do
    devices =
      AetheriumServer.DeviceManager.list_devices()
      |> Enum.map(fn d ->
        %{
          id: d.id,
          device_type: d.device_type,
          status: normalize_device_status(d.status),
          connected_at: d.connected_at,
          last_heartbeat: d.last_heartbeat,
          capabilities: d.capabilities,
          connector_id: d.connector_id,
          connector_type: d.connector_type && Atom.to_string(d.connector_type),
          transport: d.transport,
          link: d.link,
          supported_commands: [
            "deploy",
            "start_execution",
            "stop_execution",
            "pause_execution",
            "resume_execution",
            "reset_execution",
            "set_variable",
            "request_state",
            "time_travel_query",
            "rewind_deployment"
          ]
        }
      end)

    PhoenixClient.Channel.push_async(
      channel,
      "device_update",
      decorate_gateway_payload(state, "device_update", %{"devices" => devices})
    )
  end

  defp push_live_deployments(%{channel: channel} = state) do
    deployments =
      AetheriumServer.DeviceManager.list_devices()
      |> Enum.flat_map(fn device ->
        AetheriumServer.DeviceManager.get_device_deployments(device.id)
        |> Enum.map(&{device, &1})
      end)
      |> Enum.filter(fn {_device, deployment} -> active_deployment?(deployment) end)
      |> Enum.map(fn {device, deployment} ->
        %{
          "deployment_id" => deployment.id,
          "automata_id" => deployment.automata_id,
          "device_id" => deployment.device_id,
          "status" => Atom.to_string(deployment.status),
          "deployed_at" => deployment.deployed_at,
          "current_state" => deployment.current_state,
          "variables" => deployment.variables,
          "error" => deployment.error,
          "deployment_metadata" => build_deployment_metadata(state, %{}, device, deployment)
        }
      end)

    PhoenixClient.Channel.push_async(
      channel,
      "deployment_inventory",
      decorate_gateway_payload(state, "deployment_inventory", %{"deployments" => deployments})
    )
  end

  defp push_connector_statuses(%{channel: channel} = state) do
    connectors = AetheriumServer.DeviceConnectorSupervisor.connector_statuses()

    PhoenixClient.Channel.push_async(
      channel,
      "connector_status",
      decorate_gateway_payload(state, "connector_status", %{"connectors" => connectors})
    )
  end

  defp deployment_error_payload(
         automata_id,
         device_id,
         {:deploy_validation_failed, profile_id, diagnostics}
       ) do
    %{
      automata_id: automata_id,
      device_id: device_id,
      error: "deploy_validation_failed",
      target_profile: profile_id,
      diagnostics: diagnostics
    }
  end

  defp deployment_error_payload(
         automata_id,
         device_id,
         {:target_compiler_not_implemented, profile_id, diagnostics}
       ) do
    %{
      automata_id: automata_id,
      device_id: device_id,
      error: "target_compiler_not_implemented",
      target_profile: profile_id,
      diagnostics: diagnostics
    }
  end

  defp deployment_error_payload(automata_id, device_id, reason) do
    %{
      automata_id: automata_id,
      device_id: device_id,
      error: inspect(reason)
    }
  end

  defp normalize_device_status(status) when is_atom(status), do: Atom.to_string(status)
  defp normalize_device_status(status) when is_binary(status), do: status
  defp normalize_device_status(_), do: "unknown"

  defp stringify_keys(%_{} = struct), do: struct

  defp stringify_keys(map) when is_map(map) do
    map
    |> Enum.map(fn
      {k, v} when is_atom(k) -> {Atom.to_string(k), stringify_keys(v)}
      {k, v} when is_binary(k) -> {k, stringify_keys(v)}
      {k, v} -> {to_string(k), stringify_keys(v)}
    end)
    |> Enum.into(%{})
  end

  defp stringify_keys(list) when is_list(list), do: Enum.map(list, &stringify_keys/1)
  defp stringify_keys(other), do: other
end
