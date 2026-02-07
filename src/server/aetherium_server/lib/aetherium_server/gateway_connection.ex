defmodule AetheriumServer.GatewayConnection do
  use GenServer
  require Logger

  @default_url "ws://localhost:4000/socket"
  @default_auth_token "server_secret_token"
  @default_server_id "srv_01"
  @default_heartbeat_interval 10_000
  @default_join_retry_interval 2_000

  def start_link(_opts) do
    GenServer.start_link(__MODULE__, nil, name: __MODULE__)
  end

  def init(_opts) do
    config = Application.fetch_env!(:aetherium_server, :gateway)

    url = config[:url] || @default_url
    token = config[:auth_token] || @default_auth_token
    server_id = config[:server_id] || @default_server_id

    heartbeat_interval = config[:heartbeat_interval] || @default_heartbeat_interval
    join_retry_interval = config[:join_retry_interval] || @default_join_retry_interval

    {:ok, socket} = PhoenixClient.Socket.start_link(
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
       join_retry_interval: join_retry_interval
     }}
  end

  def report_devices(devices) do
    GenServer.cast(__MODULE__, {:report_devices, devices})
  end

  def report_alert(alert) do
    GenServer.cast(__MODULE__, {:report_alert, alert})
  end

  def push(event, payload) when is_binary(event) and is_map(payload) do
    GenServer.cast(__MODULE__, {:push, event, payload})
  end

  @impl true
  def handle_cast({:report_devices, devices}, %{channel: channel} = state) when not is_nil(channel) do
    PhoenixClient.Channel.push_async(channel, "device_update", %{"devices" => devices})
    {:noreply, state}
  end

  def handle_cast({:report_devices, _devices}, state) do
    {:noreply, state}
  end

  @impl true
  def handle_cast({:report_alert, alert}, %{channel: channel} = state) when not is_nil(channel) do
    PhoenixClient.Channel.push_async(channel, "device_alert", alert)
    {:noreply, state}
  end

  def handle_cast({:report_alert, _alert}, state) do
    {:noreply, state}
  end

  @impl true
  def handle_cast({:push, event, payload}, %{channel: channel} = state) when not is_nil(channel) do
    PhoenixClient.Channel.push_async(channel, event, payload)
    {:noreply, state}
  end

  def handle_cast({:push, _event, _payload}, state) do
    {:noreply, state}
  end

  @impl true
  def handle_info(:send_heartbeat, %{channel: nil} = state) do
    {:noreply, state}
  end

  def handle_info(:send_heartbeat, %{channel: channel, heartbeat_interval: heartbeat_interval} = state) do
    PhoenixClient.Channel.push(channel, "heartbeat", %{})
    Process.send_after(self(), :send_heartbeat, heartbeat_interval)
    {:noreply, state}
  end

  @impl true
  def handle_info(:try_join, %{socket: socket} = state) do
    join_payload = %{"token" => state.token, "server_id" => state.server_id}

    case PhoenixClient.Channel.join(socket, "server:gateway", join_payload) do
      {:ok, _response, channel} ->
        Logger.info("Connected to gateway and joined server:gateway")
        Process.send_after(self(), :send_heartbeat, state.heartbeat_interval)
        {:noreply, %{state | channel: channel}}

      {:error, :socket_not_connected} ->
        Process.send_after(self(), :try_join, state.join_retry_interval)
        {:noreply, state}

      {:error, reason} ->
        Logger.warn("Failed to join server:gateway: #{inspect(reason)}")
        Process.send_after(self(), :try_join, state.join_retry_interval)
        {:noreply, state}
    end
  end

  def handle_info(%PhoenixClient.Message{event: "device_command", payload: payload}, state) do
    Logger.info("Received command from gateway: #{inspect(payload)}")
    {:noreply, state}
  end

  # ============================================================================
  # Automata Protocol Message Handlers
  # ============================================================================

  def handle_info(%PhoenixClient.Message{event: "deploy_automata", payload: payload}, state) do
    automata_id = payload["automata_id"]
    device_id = payload["device_id"]
    automata = normalize_automata(payload["automata"])

    case AetheriumServer.DeviceManager.deploy_automata(automata_id, device_id, automata) do
      {:ok, deployment} ->
        push_to_gateway(state, "deployment_status", %{
          deployment_id: deployment.id,
          automata_id: automata_id,
          device_id: device_id,
          status: "loading"
        })

      {:error, reason} ->
        Logger.error("Failed to deploy automata: #{inspect(reason)}")
        push_to_gateway(state, "deployment_error", %{
          automata_id: automata_id,
          device_id: device_id,
          error: inspect(reason)
        })
    end

    {:noreply, state}
  end

  def handle_info(%PhoenixClient.Message{event: "stop_automata", payload: payload}, state) do
    deployment_id = payload["deployment_id"]

    deployment_id =
      cond do
        is_binary(deployment_id) and deployment_id != "" ->
          deployment_id

        is_binary(payload["device_id"]) and payload["device_id"] != "" ->
          device_id = payload["device_id"]

          case AetheriumServer.DeviceManager.get_device_deployments(device_id) do
            [d | _] -> d.id
            [] -> nil
          end

        true ->
          nil
      end

    if deployment_id do
      case AetheriumServer.DeviceManager.stop_automata(deployment_id) do
        :ok ->
          push_to_gateway(state, "deployment_status", %{
            deployment_id: deployment_id,
            status: "stopped"
          })

        {:error, reason} ->
          Logger.error("Failed to stop automata: #{inspect(reason)}")
      end
    end

    {:noreply, state}
  end

  def handle_info(%PhoenixClient.Message{event: "set_input", payload: payload}, state) do
    # Route to appropriate deployment
    case payload do
      %{"deployment_id" => deployment_id, "input" => input, "value" => value} ->
        AetheriumServer.DeviceManager.set_input(deployment_id, input, value)

      %{"device_id" => device_id, "input" => input, "value" => value} ->
        deployments = AetheriumServer.DeviceManager.get_device_deployments(device_id)
        Enum.each(deployments, fn d ->
          AetheriumServer.DeviceManager.set_input(d.id, input, value)
        end)

      %{"automata_id" => automata_id, "input" => input, "value" => value} ->
        # Find deployment by automata_id
        deployments = find_deployments_by_automata(automata_id)
        Enum.each(deployments, fn d ->
          AetheriumServer.DeviceManager.set_input(d.id, input, value)
        end)

      _ ->
        :ok
    end

    {:noreply, state}
  end

  def handle_info(%PhoenixClient.Message{event: "trigger_event", payload: payload}, state) do
    deployment_id = payload["deployment_id"]
    event_name = payload["event"]
    data = payload["data"]

    deployment_id =
      cond do
        is_binary(deployment_id) and deployment_id != "" ->
          deployment_id

        is_binary(payload["device_id"]) and payload["device_id"] != "" ->
          device_id = payload["device_id"]

          case AetheriumServer.DeviceManager.get_device_deployments(device_id) do
            [d | _] -> d.id
            [] -> nil
          end

        true ->
          nil
      end

    if deployment_id do
      AetheriumServer.DeviceManager.trigger_event(deployment_id, event_name, data)
    end

    {:noreply, state}
  end

  def handle_info(%PhoenixClient.Message{event: "force_state", payload: payload}, state) do
    deployment_id = payload["deployment_id"]
    state_id = payload["state_id"]

    deployment_id =
      cond do
        is_binary(deployment_id) and deployment_id != "" ->
          deployment_id

        is_binary(payload["device_id"]) and payload["device_id"] != "" ->
          device_id = payload["device_id"]

          case AetheriumServer.DeviceManager.get_device_deployments(device_id) do
            [d | _] -> d.id
            [] -> nil
          end

        true ->
          nil
      end

    if deployment_id do
      AetheriumServer.AutomataRuntime.force_state(deployment_id, state_id)
    end

    {:noreply, state}
  end

  def handle_info(%PhoenixClient.Message{event: "request_state", payload: payload}, state) do
    deployment_id = payload["deployment_id"]

    case AetheriumServer.AutomataRuntime.get_state(deployment_id) do
      {:ok, runtime_state} ->
        push_to_gateway(state, "deployment_status", %{
          deployment_id: deployment_id,
          status: if(runtime_state.running, do: "running", else: "stopped"),
          current_state: runtime_state.current_state,
          variables: runtime_state.variables
        })

      {:error, _} ->
        :ok
    end

    {:noreply, state}
  end

  def handle_info({:disconnected, reason, _transport_pid}, state) do
    Logger.warn("Disconnected from gateway: #{inspect(reason)}")
    Process.send_after(self(), :try_join, state.join_retry_interval)
    {:noreply, %{state | channel: nil}}
  end

  # ============================================================================
  # Private Helpers
  # ============================================================================

  defp push_to_gateway(%{channel: nil}, _event, _payload), do: :ok

  defp push_to_gateway(%{channel: channel}, event, payload) do
    PhoenixClient.Channel.push_async(channel, event, payload)
  end

  defp find_deployments_by_automata(automata_id) do
    AetheriumServer.DeviceManager.list_devices()
    |> Enum.flat_map(fn device ->
      AetheriumServer.DeviceManager.get_device_deployments(device.id)
    end)
    |> Enum.filter(&(&1.automata_id == automata_id))
  end

  defp normalize_automata(automata) when is_map(automata) do
    # Convert string keys to atoms for internal use
    automata
    |> normalize_keys()
    |> normalize_states()
    |> normalize_transitions()
    |> normalize_variables()
  end

  defp normalize_keys(map) when is_map(map) do
    map
    |> Enum.map(fn
      {k, v} when is_binary(k) -> {String.to_atom(k), normalize_keys(v)}
      {k, v} -> {k, normalize_keys(v)}
    end)
    |> Enum.into(%{})
  end

  defp normalize_keys(list) when is_list(list) do
    Enum.map(list, &normalize_keys/1)
  end

  defp normalize_keys(value), do: value

  defp normalize_states(%{states: states} = automata) when is_map(states) do
    normalized =
      states
      |> Enum.map(fn {id, state} ->
        {id, Map.put(state, :type, normalize_state_type(state[:type]))}
      end)
      |> Enum.into(%{})

    %{automata | states: normalized}
  end

  defp normalize_states(automata), do: automata

  defp normalize_state_type("initial"), do: :initial
  defp normalize_state_type("final"), do: :final
  defp normalize_state_type("normal"), do: :normal
  defp normalize_state_type(type) when is_atom(type), do: type
  defp normalize_state_type(_), do: :normal

  defp normalize_transitions(%{transitions: transitions} = automata) when is_map(transitions) do
    normalized =
      transitions
      |> Enum.map(fn {id, trans} ->
        {id, %{trans |
          type: normalize_transition_type(trans[:type]),
          timed: normalize_timed_config(trans[:timed])
        }}
      end)
      |> Enum.into(%{})

    %{automata | transitions: normalized}
  end

  defp normalize_transitions(automata), do: automata

  defp normalize_transition_type("classic"), do: :classic
  defp normalize_transition_type("timed"), do: :timed
  defp normalize_transition_type("event"), do: :event
  defp normalize_transition_type("probabilistic"), do: :probabilistic
  defp normalize_transition_type("immediate"), do: :immediate
  defp normalize_transition_type(type) when is_atom(type), do: type
  defp normalize_transition_type(_), do: :classic

  defp normalize_timed_config(nil), do: nil
  defp normalize_timed_config(config) when is_map(config) do
    %{
      mode: normalize_timed_mode(config[:mode]),
      delay_ms: config[:delay_ms] || 0,
      jitter_ms: config[:jitter_ms] || 0
    }
  end

  defp normalize_timed_mode("after"), do: :after
  defp normalize_timed_mode("at"), do: :at
  defp normalize_timed_mode("every"), do: :every
  defp normalize_timed_mode("timeout"), do: :timeout
  defp normalize_timed_mode("window"), do: :window
  defp normalize_timed_mode(mode) when is_atom(mode), do: mode
  defp normalize_timed_mode(_), do: :after

  defp normalize_variables(%{variables: variables} = automata) when is_list(variables) do
    normalized =
      variables
      |> Enum.map(fn var ->
        %{var | direction: normalize_direction(var[:direction])}
      end)

    %{automata | variables: normalized}
  end

  defp normalize_variables(automata), do: automata

  defp normalize_direction("input"), do: :input
  defp normalize_direction("output"), do: :output
  defp normalize_direction("internal"), do: :internal
  defp normalize_direction(dir) when is_atom(dir), do: dir
  defp normalize_direction(_), do: :internal
end
