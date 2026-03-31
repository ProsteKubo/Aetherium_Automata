defmodule Mix.Tasks.Aetherium.BlackBox.Smoke do
  use Mix.Task

  @shortdoc "Deploy and exercise the docker black-box probe through the gateway API"

  alias AetheriumServer.ShowcaseCatalog

  @default_gateway_ws_url "ws://localhost:8080/socket/websocket"
  @default_ui_token "dev_secret_token"
  @default_showcase "example/automata/showcase/12_black_box/docker_black_box_probe.yaml"
  @default_device_id "black_box_01"
  @default_wait_ms 20_000
  @default_timeout_ms 20_000
  @default_poll_ms 250

  @impl true
  def run(args) do
    Mix.Task.run("app.start", ["--no-start"])
    ensure_deps_started!()

    opts = parse_args(args)

    {:ok, socket} =
      PhoenixClient.Socket.start_link(
        url: Keyword.fetch!(opts, :gateway_url),
        params: %{"token" => Keyword.fetch!(opts, :token)}
      )

    wait_for_socket!(socket, Keyword.fetch!(opts, :timeout_ms))

    gw_chan =
      join_with_retry!(
        socket,
        "gateway:control",
        %{"token" => Keyword.fetch!(opts, :token)},
        Keyword.fetch!(opts, :timeout_ms)
      )

    auto_chan =
      join_with_retry!(
        socket,
        "automata:control",
        %{"token" => Keyword.fetch!(opts, :token)},
        Keyword.fetch!(opts, :timeout_ms)
      )

    {server_id, device_id} =
      resolve_target(
        gw_chan,
        Keyword.get(opts, :server_id),
        Keyword.fetch!(opts, :device_id),
        Keyword.fetch!(opts, :wait_ms)
      )

    Mix.shell().info("Using server_id=#{server_id} device_id=#{device_id} for black-box smoke")

    %{automata: automata} = load_showcase!(Keyword.fetch!(opts, :showcase))
    automata_id = "black-box-smoke-#{System.system_time(:millisecond)}"
    deployment_id = "#{automata_id}:#{device_id}"

    automata =
      automata
      |> Map.put("id", automata_id)
      |> Map.put("name", "#{automata["name"] || "Docker Black Box Probe"} Smoke")

    try do
      {_deploy_reply, deploy_outcome} =
        push_with_outcome!(
          auto_chan,
          "deploy",
          %{
            "automata_id" => automata_id,
            "device_id" => device_id,
            "server_id" => server_id,
            "automata" => automata
          },
          Keyword.fetch!(opts, :timeout_ms)
        )

      assert_outcome_status!(deploy_outcome, "ACK", "deploy")

      deployment =
        wait_for_deployment_status!(
          auto_chan,
          device_id,
          automata_id,
          ["stopped", "running"],
          Keyword.fetch!(opts, :timeout_ms)
        )

      assert_deployment_not_error!(deployment, "deploy")

      {_start_reply, start_outcome} =
        push_with_outcome!(
          auto_chan,
          "start_execution",
          %{
            "device_id" => device_id,
            "automata_id" => automata_id,
            "server_id" => server_id
          },
          Keyword.fetch!(opts, :timeout_ms)
        )

      assert_outcome_status!(start_outcome, "ACK", "start_execution")

      deployment =
        wait_for_deployment_status!(
          auto_chan,
          device_id,
          automata_id,
          ["running"],
          Keyword.fetch!(opts, :timeout_ms)
        )

      assert_deployment_not_error!(deployment, "start_execution")

      black_box =
        wait_until!(
          Keyword.fetch!(opts, :timeout_ms),
          @default_poll_ms,
          fn -> fetch_black_box_description(auto_chan, device_id, automata_id, server_id) end,
          fn description ->
            is_map(description) and is_map(description["deployment_metadata"]) and
              is_map(description["black_box"])
          end,
          "deployment-aware black-box description"
        )

      if get_in(black_box, ["black_box", "observable_states"]) != ["Idle", "Armed", "Faulted"] do
        raise "black_box_describe returned unexpected observable_states: #{inspect(black_box)}"
      end

      if not Enum.any?(get_in(black_box, ["black_box", "ports"]) || [], &(&1["name"] == "arm")) do
        raise "black_box_describe did not expose arm port: #{inspect(black_box)}"
      end

      if get_in(black_box, ["deployment_metadata", "placement"]) != "docker_black_box" do
        raise "black_box_describe returned unexpected placement: #{inspect(black_box)}"
      end

      {_invalid_event_reply, invalid_event_outcome} =
        push_with_outcome!(
          auto_chan,
          "black_box_trigger_event",
          %{
            "device_id" => device_id,
            "automata_id" => automata_id,
            "server_id" => server_id,
            "event" => "missing_event"
          },
          Keyword.fetch!(opts, :timeout_ms)
        )

      assert_outcome_status!(
        invalid_event_outcome,
        "NAK",
        "black_box_trigger_event missing_event"
      )

      assert_outcome_reason!(
        invalid_event_outcome,
        "invalid_black_box_event",
        "black_box_trigger_event missing_event"
      )

      {_invalid_state_reply, invalid_state_outcome} =
        push_with_outcome!(
          auto_chan,
          "black_box_force_state",
          %{
            "device_id" => device_id,
            "automata_id" => automata_id,
            "server_id" => server_id,
            "state" => "MissingState"
          },
          Keyword.fetch!(opts, :timeout_ms)
        )

      assert_outcome_status!(invalid_state_outcome, "NAK", "black_box_force_state MissingState")

      assert_outcome_reason!(
        invalid_state_outcome,
        "invalid_black_box_state",
        "black_box_force_state MissingState"
      )

      {_event_reply, event_outcome} =
        push_with_outcome!(
          auto_chan,
          "black_box_trigger_event",
          %{
            "device_id" => device_id,
            "automata_id" => automata_id,
            "server_id" => server_id,
            "event" => "black_box_fault"
          },
          Keyword.fetch!(opts, :timeout_ms)
        )

      assert_outcome_status!(event_outcome, "NAK", "black_box_trigger_event black_box_fault")

      assert_outcome_reason!(
        event_outcome,
        "unsupported_command",
        "black_box_trigger_event black_box_fault"
      )

      {_force_reply, force_outcome} =
        push_with_outcome!(
          auto_chan,
          "black_box_force_state",
          %{
            "device_id" => device_id,
            "automata_id" => automata_id,
            "server_id" => server_id,
            "state" => "Faulted"
          },
          Keyword.fetch!(opts, :timeout_ms)
        )

      assert_outcome_status!(force_outcome, "NAK", "black_box_force_state Faulted")

      assert_outcome_reason!(
        force_outcome,
        "unsupported_command",
        "black_box_force_state Faulted"
      )

      initial_snapshot =
        wait_for_snapshot!(
          auto_chan,
          device_id,
          automata_id,
          server_id,
          Keyword.fetch!(opts, :timeout_ms),
          fn snapshot ->
            snapshot["current_state"] == "Idle" and
              value_from_snapshot(snapshot, "armed") == false and
              value_from_snapshot(snapshot, "status_code") == 0
          end,
          "initial Idle state"
        )

      Mix.shell().info("Initial snapshot: #{snapshot_summary(initial_snapshot)}")

      {_arm_reply, arm_outcome} =
        push_with_outcome!(
          auto_chan,
          "black_box_set_input",
          %{
            "device_id" => device_id,
            "automata_id" => automata_id,
            "server_id" => server_id,
            "port" => "arm",
            "value" => true
          },
          Keyword.fetch!(opts, :timeout_ms)
        )

      assert_outcome_status!(arm_outcome, "ACK", "black_box_set_input arm=true")

      armed_snapshot =
        wait_for_snapshot!(
          auto_chan,
          device_id,
          automata_id,
          server_id,
          Keyword.fetch!(opts, :timeout_ms),
          fn snapshot ->
            snapshot["current_state"] == "Armed" and
              value_from_snapshot(snapshot, "armed") == true and
              value_from_snapshot(snapshot, "status_code") == 1 and
              get_in(snapshot, ["deployment_metadata", "placement"]) == "docker_black_box"
          end,
          "Armed state"
        )

      Mix.shell().info("Armed snapshot: #{snapshot_summary(armed_snapshot)}")

      {_fault_reply, fault_outcome} =
        push_with_outcome!(
          auto_chan,
          "black_box_set_input",
          %{
            "device_id" => device_id,
            "automata_id" => automata_id,
            "server_id" => server_id,
            "port" => "fault",
            "value" => true
          },
          Keyword.fetch!(opts, :timeout_ms)
        )

      assert_outcome_status!(fault_outcome, "ACK", "black_box_set_input fault=true")

      faulted_snapshot =
        wait_for_snapshot!(
          auto_chan,
          device_id,
          automata_id,
          server_id,
          Keyword.fetch!(opts, :timeout_ms),
          fn snapshot ->
            snapshot["current_state"] == "Faulted" and
              value_from_snapshot(snapshot, "armed") == false and
              value_from_snapshot(snapshot, "status_code") == 2 and
              get_in(snapshot, ["deployment_metadata", "placement"]) == "docker_black_box"
          end,
          "Faulted state"
        )

      Mix.shell().info("Faulted snapshot: #{snapshot_summary(faulted_snapshot)}")

      {_fault_reset_reply, fault_reset_outcome} =
        push_with_outcome!(
          auto_chan,
          "black_box_set_input",
          %{
            "device_id" => device_id,
            "automata_id" => automata_id,
            "server_id" => server_id,
            "port" => "fault",
            "value" => false
          },
          Keyword.fetch!(opts, :timeout_ms)
        )

      assert_outcome_status!(fault_reset_outcome, "ACK", "black_box_set_input fault=false")

      {_disarm_reply, disarm_outcome} =
        push_with_outcome!(
          auto_chan,
          "black_box_set_input",
          %{
            "device_id" => device_id,
            "automata_id" => automata_id,
            "server_id" => server_id,
            "port" => "arm",
            "value" => false
          },
          Keyword.fetch!(opts, :timeout_ms)
        )

      assert_outcome_status!(disarm_outcome, "ACK", "black_box_set_input arm=false")

      final_snapshot =
        wait_for_snapshot!(
          auto_chan,
          device_id,
          automata_id,
          server_id,
          Keyword.fetch!(opts, :timeout_ms),
          fn snapshot ->
            snapshot["current_state"] == "Idle" and
              value_from_snapshot(snapshot, "armed") == false and
              value_from_snapshot(snapshot, "status_code") == 0 and
              get_in(snapshot, ["deployment_metadata", "placement"]) == "docker_black_box"
          end,
          "reset Idle state"
        )

      Mix.shell().info("Final snapshot: #{snapshot_summary(final_snapshot)}")

      trace_path = Path.expand("var/docker_blackbox/#{device_id}.jsonl", File.cwd!())

      trace_events =
        wait_until!(
          Keyword.fetch!(opts, :timeout_ms),
          @default_poll_ms,
          fn -> read_trace_events(trace_path) end,
          &trace_ready?(&1, device_id),
          "deployment trace #{trace_path}"
        )

      Mix.shell().info("Trace snapshot: #{trace_summary(trace_events, device_id)}")

      Mix.shell().info(
        "Black-box smoke PASS (deployment=#{deployment_id}, device_id=#{device_id}, server_id=#{server_id})"
      )
    after
      safe_stop(auto_chan, device_id, automata_id, server_id, Keyword.fetch!(opts, :timeout_ms))
      safe_delete(auto_chan, automata_id, Keyword.fetch!(opts, :timeout_ms))
    end
  end

  defp parse_args(args) do
    {opts, _rest, _invalid} =
      OptionParser.parse(args,
        strict: [
          gateway_url: :string,
          token: :string,
          server_id: :string,
          device_id: :string,
          showcase: :string,
          wait_ms: :integer,
          timeout_ms: :integer
        ]
      )

    [
      gateway_url: Keyword.get(opts, :gateway_url, @default_gateway_ws_url),
      token: Keyword.get(opts, :token, @default_ui_token),
      server_id: Keyword.get(opts, :server_id),
      device_id: Keyword.get(opts, :device_id, @default_device_id),
      showcase: Keyword.get(opts, :showcase, @default_showcase),
      wait_ms: max(Keyword.get(opts, :wait_ms, @default_wait_ms), 1_000),
      timeout_ms: max(Keyword.get(opts, :timeout_ms, @default_timeout_ms), 1_000)
    ]
  end

  defp ensure_deps_started! do
    for app <- [:logger, :crypto, :ssl, :websocket_client, :phoenix_client, :jason] do
      case Application.ensure_all_started(app) do
        {:ok, _} -> :ok
        {:error, {:already_started, _}} -> :ok
        {:error, reason} -> raise "Failed to start #{app}: #{inspect(reason)}"
      end
    end
  end

  defp wait_for_socket!(socket, timeout_ms) do
    deadline = System.monotonic_time(:millisecond) + timeout_ms
    until_connected(socket, deadline)
  end

  defp until_connected(socket, deadline) do
    cond do
      System.monotonic_time(:millisecond) > deadline ->
        raise "Timed out waiting for gateway websocket connection"

      PhoenixClient.Socket.connected?(socket) ->
        :ok

      true ->
        Process.sleep(100)
        until_connected(socket, deadline)
    end
  end

  defp join_with_retry!(socket, topic, payload, timeout_ms) do
    deadline = System.monotonic_time(:millisecond) + timeout_ms
    do_join_with_retry(socket, topic, payload, deadline)
  end

  defp do_join_with_retry(socket, topic, payload, deadline) do
    cond do
      System.monotonic_time(:millisecond) > deadline ->
        raise "Timed out joining #{topic}"

      true ->
        case PhoenixClient.Channel.join(socket, topic, payload) do
          {:ok, _resp, chan} ->
            chan

          {:error, :socket_not_connected} ->
            Process.sleep(100)
            do_join_with_retry(socket, topic, payload, deadline)

          {:error, reason} ->
            raise "Failed to join #{topic}: #{inspect(reason)}"
        end
    end
  end

  defp resolve_target(gw_chan, server_id_opt, device_id, wait_ms) do
    PhoenixClient.Channel.push_async(gw_chan, "list_servers", %{})
    PhoenixClient.Channel.push_async(gw_chan, "list_devices", %{})

    deadline = System.monotonic_time(:millisecond) + wait_ms
    loop_resolve(gw_chan, server_id_opt, device_id, deadline, MapSet.new(), nil)
  end

  defp loop_resolve(gw_chan, server_id_opt, device_id, deadline, online_servers, last_devices) do
    if System.monotonic_time(:millisecond) > deadline do
      raise "Timed out waiting for device #{device_id} on gateway"
    end

    receive do
      %PhoenixClient.Message{event: "server_list", payload: %{"servers" => servers}} ->
        online_servers =
          servers
          |> List.wrap()
          |> Enum.map(fn server ->
            server = Map.new(server)
            server["server_id"] || server[:server_id]
          end)
          |> Enum.reject(&is_nil/1)
          |> MapSet.new()

        maybe_resolve_target(
          gw_chan,
          server_id_opt,
          device_id,
          deadline,
          online_servers,
          last_devices
        )

      %PhoenixClient.Message{event: "device_list", payload: %{"devices" => devices}} ->
        maybe_resolve_target(gw_chan, server_id_opt, device_id, deadline, online_servers, devices)

      _other ->
        loop_resolve(gw_chan, server_id_opt, device_id, deadline, online_servers, last_devices)
    after
      300 ->
        PhoenixClient.Channel.push_async(gw_chan, "list_servers", %{})
        PhoenixClient.Channel.push_async(gw_chan, "list_devices", %{})
        loop_resolve(gw_chan, server_id_opt, device_id, deadline, online_servers, last_devices)
    end
  end

  defp maybe_resolve_target(gw_chan, server_id_opt, device_id, deadline, online_servers, nil) do
    loop_resolve(gw_chan, server_id_opt, device_id, deadline, online_servers, nil)
  end

  defp maybe_resolve_target(gw_chan, server_id_opt, device_id, deadline, online_servers, devices) do
    case pick_device(devices, online_servers, server_id_opt, device_id) do
      {:ok, server_id, found_device_id} ->
        {server_id, found_device_id}

      :no_match ->
        loop_resolve(gw_chan, server_id_opt, device_id, deadline, online_servers, devices)
    end
  end

  defp pick_device(devices, online_servers, server_id_opt, device_id) when is_list(devices) do
    devices = Enum.map(devices, &Map.new/1)

    match =
      Enum.find(devices, fn device ->
        server_id = device["server_id"] || device[:server_id]
        current_device_id = device["id"] || device[:id]
        status = device["status"] || device[:status]

        current_device_id == device_id and status in ["connected", :connected] and
          (is_nil(server_id_opt) or server_id == server_id_opt) and
          (MapSet.size(online_servers) == 0 or MapSet.member?(online_servers, server_id))
      end)

    case match do
      nil -> :no_match
      device -> {:ok, device["server_id"] || device[:server_id], device["id"] || device[:id]}
    end
  end

  defp load_showcase!(target) do
    case ShowcaseCatalog.load_automata(target) do
      {:ok, loaded} ->
        loaded

      {:error, reason} ->
        raise "Failed to load showcase #{target}: #{inspect(reason)}"
    end
  end

  defp push_sync!(channel, event, payload, timeout_ms) do
    case PhoenixClient.Channel.push(channel, event, payload, timeout_ms) do
      {:ok, reply_payload} -> reply_payload
      {:error, reply_payload} -> raise "push #{event} failed: #{inspect(reply_payload)}"
      other -> raise "push #{event} unexpected reply: #{inspect(other)}"
    end
  end

  defp push_with_outcome!(channel, event, payload, timeout_ms) do
    response = push_sync!(channel, event, payload, timeout_ms)
    command_id = get_in(response, ["outcome", "command_id"])

    if get_in(response, ["result", "status"]) == "sent" and is_binary(command_id) do
      {response, wait_for_command_outcome!(command_id, timeout_ms)}
    else
      {response, normalize_outcome(response["outcome"] || %{})}
    end
  end

  defp wait_for_command_outcome!(command_id, timeout_ms) do
    deadline = System.monotonic_time(:millisecond) + timeout_ms
    do_wait_for_command_outcome(command_id, deadline)
  end

  defp do_wait_for_command_outcome(command_id, deadline) do
    if System.monotonic_time(:millisecond) > deadline do
      raise "Timed out waiting for command_outcome #{command_id}"
    end

    receive do
      %PhoenixClient.Message{event: "command_outcome", payload: payload} ->
        if payload["command_id"] == command_id do
          payload
        else
          do_wait_for_command_outcome(command_id, deadline)
        end

      _other ->
        do_wait_for_command_outcome(command_id, deadline)
    after
      100 ->
        do_wait_for_command_outcome(command_id, deadline)
    end
  end

  defp wait_for_deployment_status!(channel, device_id, automata_id, statuses, timeout_ms) do
    wait_until!(
      timeout_ms,
      @default_poll_ms,
      fn -> fetch_deployment(channel, device_id, automata_id) end,
      fn deployment -> not is_nil(deployment) and deployment["status"] in statuses end,
      "deployment statuses #{Enum.join(statuses, ", ")}"
    )
  end

  defp fetch_deployment(channel, device_id, automata_id) do
    reply =
      push_sync!(
        channel,
        "get_deployment",
        %{"device_id" => device_id, "automata_id" => automata_id},
        5_000
      )

    reply["deployment"]
  end

  defp fetch_black_box_description(channel, device_id, automata_id, server_id) do
    reply =
      push_sync!(
        channel,
        "black_box_describe",
        %{"device_id" => device_id, "automata_id" => automata_id, "server_id" => server_id},
        5_000
      )

    reply["black_box"]
  end

  defp fetch_black_box_snapshot!(channel, device_id, automata_id, server_id, timeout_ms) do
    {_response, outcome} =
      push_with_outcome!(
        channel,
        "black_box_snapshot",
        %{"device_id" => device_id, "automata_id" => automata_id, "server_id" => server_id},
        timeout_ms
      )

    assert_outcome_status!(outcome, "ACK", "black_box_snapshot")
    outcome["data"]["state"] || raise "black_box_snapshot did not return state payload"
  end

  defp wait_for_snapshot!(
         channel,
         device_id,
         automata_id,
         server_id,
         timeout_ms,
         predicate,
         label
       ) do
    wait_until!(
      timeout_ms,
      @default_poll_ms,
      fn -> fetch_black_box_snapshot!(channel, device_id, automata_id, server_id, timeout_ms) end,
      predicate,
      label
    )
  end

  defp wait_until!(timeout_ms, poll_ms, fetch_fun, predicate, label)
       when is_function(fetch_fun, 0) and is_function(predicate, 1) do
    deadline = System.monotonic_time(:millisecond) + timeout_ms
    do_wait_until(deadline, poll_ms, fetch_fun, predicate, label, nil)
  end

  defp do_wait_until(deadline, poll_ms, fetch_fun, predicate, label, last_value) do
    value = fetch_fun.()

    cond do
      predicate.(value) ->
        value

      System.monotonic_time(:millisecond) >= deadline ->
        raise "Timed out waiting for #{label}; last=#{inspect(value || last_value)}"

      true ->
        Process.sleep(poll_ms)
        do_wait_until(deadline, poll_ms, fetch_fun, predicate, label, value || last_value)
    end
  end

  defp value_from_snapshot(snapshot, name) when is_map(snapshot) do
    variables = snapshot["variables"] || %{}
    outputs = snapshot["outputs"] || %{}

    cond do
      is_map(variables) and Map.has_key?(variables, name) ->
        variables[name]

      is_map(outputs) and Map.has_key?(outputs, name) ->
        outputs[name]

      true ->
        nil
    end
  end

  defp snapshot_summary(snapshot) do
    state = snapshot["current_state"] || "unknown"
    armed = inspect(value_from_snapshot(snapshot, "armed"))
    status_code = inspect(value_from_snapshot(snapshot, "status_code"))
    "state=#{state} armed=#{armed} status_code=#{status_code}"
  end

  defp read_trace_events(path) do
    with true <- File.exists?(path),
         {:ok, body} <- File.read(path) do
      body
      |> String.split("\n", trim: true)
      |> Enum.map(&Jason.decode!/1)
    else
      _ -> []
    end
  end

  defp trace_ready?(events, device_id) when is_list(events) do
    has_state_change =
      Enum.any?(events, fn event ->
        event["kind"] == "runtime_state_change" and
          event["source_instance"] == device_id and
          event["placement"] == "docker_black_box"
      end)

    required_ports = MapSet.new(["armed", "status_code"])

    seen_ports =
      events
      |> Enum.filter(fn event ->
        event["kind"] == "runtime_output_change" and
          event["source_instance"] == device_id and
          event["placement"] == "docker_black_box" and
          event["port_direction"] == "output"
      end)
      |> Enum.map(& &1["port_name"])
      |> MapSet.new()

    has_state_change and MapSet.subset?(required_ports, seen_ports)
  end

  defp trace_ready?(_events, _device_id), do: false

  defp trace_summary(events, device_id) do
    matches =
      Enum.filter(events, fn event ->
        event["source_instance"] == device_id and
          event["placement"] == "docker_black_box" and
          event["kind"] in ["runtime_state_change", "runtime_output_change"]
      end)

    state_changes = Enum.count(matches, &(&1["kind"] == "runtime_state_change"))

    output_ports =
      matches
      |> Enum.filter(&(&1["kind"] == "runtime_output_change"))
      |> Enum.map(& &1["port_name"])
      |> Enum.uniq()
      |> Enum.sort()

    "state_changes=#{state_changes} output_ports=#{Enum.join(output_ports, ",")}"
  end

  defp assert_outcome_status!(outcome, expected_status, label) do
    outcome = normalize_outcome(outcome)
    status = outcome["status"] || "UNKNOWN"

    if status != expected_status do
      raise "#{label} returned #{status}: #{inspect(outcome)}"
    end

    :ok
  end

  defp assert_outcome_reason!(outcome, expected_reason, label) do
    outcome = normalize_outcome(outcome)
    reason = outcome["reason"] || get_in(outcome, ["data", "reason"]) || "UNKNOWN"

    if reason != expected_reason do
      raise "#{label} returned unexpected reason #{inspect(reason)}: #{inspect(outcome)}"
    end

    :ok
  end

  defp normalize_outcome(outcome) when is_map(outcome) do
    outcome
    |> maybe_put("status", outcome["status"] || outcome["outcome"])
    |> maybe_put("data", outcome["data"])
  end

  defp normalize_outcome(_outcome), do: %{}

  defp maybe_put(map, _key, nil), do: map
  defp maybe_put(map, key, value), do: Map.put(map, key, value)

  defp assert_deployment_not_error!(deployment, label) do
    if deployment["status"] == "error" do
      raise "#{label} failed: #{inspect(deployment["error"] || deployment)}"
    end

    :ok
  end

  defp safe_stop(nil, _device_id, _automata_id, _server_id, _timeout_ms), do: :ok

  defp safe_stop(channel, device_id, automata_id, server_id, timeout_ms) do
    _ =
      try do
        push_with_outcome!(
          channel,
          "stop_execution",
          %{"device_id" => device_id, "automata_id" => automata_id, "server_id" => server_id},
          timeout_ms
        )
      rescue
        _ -> :ok
      end

    :ok
  end

  defp safe_delete(nil, _automata_id, _timeout_ms), do: :ok

  defp safe_delete(channel, automata_id, timeout_ms) do
    _ =
      try do
        push_sync!(channel, "delete_automata", %{"id" => automata_id}, timeout_ms)
      rescue
        _ -> :ok
      end

    :ok
  end
end
