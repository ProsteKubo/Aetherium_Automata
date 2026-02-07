defmodule AetheriumServer.DeviceManager do
  @moduledoc """
  Manages device connections and automata deployments for the server.
  
  Handles:
  - Device registration and tracking
  - Automata deployment to devices
  - Device heartbeat monitoring
  - Protocol message routing
  """

  use GenServer
  require Logger

  alias AetheriumServer.AutomataYaml
  alias AetheriumServer.EngineProtocol

  # ============================================================================
  # Types
  # ============================================================================

  @type device_id :: String.t()
  @type automata_id :: String.t()

  @type device :: %{
    id: device_id(),
    protocol_id: non_neg_integer(),
    device_type: atom(),
    capabilities: integer(),
    protocol_version: integer(),
    session_id: String.t(),
    connected_at: integer(),
    last_heartbeat: integer(),
    status: :connected | :disconnected | :error,
    deployed_automata: [automata_id()],
    transport_pid: pid() | nil
  }

  @type deployment :: %{
    id: String.t(),
    automata_id: automata_id(),
    device_id: device_id(),
    run_id: non_neg_integer(),
    status: :pending | :loading | :running | :stopped | :error,
    current_state: String.t() | nil,
    variables: map(),
    state_id_map: %{non_neg_integer() => String.t()},
    transition_id_map: %{non_neg_integer() => String.t()},
    deployed_at: integer(),
    error: String.t() | nil
  }

  @type state :: %{
    devices: %{device_id() => device()},
    deployments: %{String.t() => deployment()},
    automata_cache: %{automata_id() => map()},
    device_by_transport: %{pid() => device_id()},
    heartbeat_timeout: integer()
  }

  @default_heartbeat_timeout 30_000

  # ============================================================================
  # Public API
  # ============================================================================

  @doc "Start the device manager"
  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @doc "Register a new device (called when device sends HELLO)"
  @spec register_device(map(), pid()) :: {:ok, device()} | {:error, term()}
  def register_device(hello_payload, transport_pid) do
    GenServer.call(__MODULE__, {:register_device, hello_payload, transport_pid})
  end

  @doc "Handle device disconnect"
  @spec device_disconnected(device_id()) :: :ok
  def device_disconnected(device_id) do
    GenServer.cast(__MODULE__, {:device_disconnected, device_id})
  end

  @doc "Handle heartbeat from device"
  @spec heartbeat(device_id()) :: :ok
  def heartbeat(device_id) do
    GenServer.cast(__MODULE__, {:heartbeat, device_id})
  end

  @doc "Deploy automata to a device"
  @spec deploy_automata(automata_id(), device_id(), map()) :: {:ok, deployment()} | {:error, term()}
  def deploy_automata(automata_id, device_id, automata) do
    GenServer.call(__MODULE__, {:deploy_automata, automata_id, device_id, automata})
  end

  @doc "Stop automata on a device"
  @spec stop_automata(String.t()) :: :ok | {:error, term()}
  def stop_automata(deployment_id) do
    GenServer.call(__MODULE__, {:stop_automata, deployment_id})
  end

  @doc "Send command to device"
  @spec send_to_device(device_id(), atom(), map()) :: :ok | {:error, term()}
  def send_to_device(device_id, message_type, payload) do
    GenServer.call(__MODULE__, {:send_to_device, device_id, message_type, payload})
  end

  @doc "Handle incoming message from device"
  @spec handle_device_message(device_id(), atom(), map()) :: :ok
  def handle_device_message(device_id, message_type, payload) do
    GenServer.cast(__MODULE__, {:device_message, device_id, message_type, payload})
  end

  @doc "Get list of connected devices"
  @spec list_devices() :: [device()]
  def list_devices do
    GenServer.call(__MODULE__, :list_devices)
  end

  @doc "Get device by ID"
  @spec get_device(device_id()) :: {:ok, device()} | {:error, :not_found}
  def get_device(device_id) do
    GenServer.call(__MODULE__, {:get_device, device_id})
  end

  @doc "Get deployments for a device"
  @spec get_device_deployments(device_id()) :: [deployment()]
  def get_device_deployments(device_id) do
    GenServer.call(__MODULE__, {:get_device_deployments, device_id})
  end

  @doc "Update deployment state (from automata runtime)"
  @spec update_deployment_state(String.t(), String.t(), map()) :: :ok
  def update_deployment_state(deployment_id, current_state, variables) do
    GenServer.cast(__MODULE__, {:update_deployment_state, deployment_id, current_state, variables})
  end

  @doc "Set input value for deployment"
  @spec set_input(String.t(), String.t(), any()) :: :ok | {:error, term()}
  def set_input(deployment_id, input_name, value) do
    GenServer.call(__MODULE__, {:set_input, deployment_id, input_name, value})
  end

  @doc "Trigger event on deployment"
  @spec trigger_event(String.t(), String.t(), any()) :: :ok | {:error, term()}
  def trigger_event(deployment_id, event_name, data) do
    GenServer.call(__MODULE__, {:trigger_event, deployment_id, event_name, data})
  end

  # ============================================================================
  # GenServer Implementation
  # ============================================================================

  @impl true
  def init(opts) do
    heartbeat_timeout = opts[:heartbeat_timeout] || @default_heartbeat_timeout

    state = %{
      devices: %{},
      deployments: %{},
      automata_cache: %{},
      device_by_transport: %{},
      heartbeat_timeout: heartbeat_timeout
    }

    # Start heartbeat checker
    Process.send_after(self(), :check_heartbeats, heartbeat_timeout)

    Logger.info("DeviceManager started")
    {:ok, state}
  end

  @impl true
  def handle_call({:register_device, hello_payload, transport_pid}, _from, state) do
    device_id = hello_payload[:device_id] || generate_id()
    protocol_id = protocol_id_for_device(device_id)
    session_id = generate_id()

    device = %{
      id: device_id,
      protocol_id: protocol_id,
      device_type: hello_payload[:device_type] || :unknown,
      capabilities: hello_payload[:capabilities] || 0,
      protocol_version: hello_payload[:protocol_version] || 1,
      session_id: session_id,
      connected_at: System.system_time(:millisecond),
      last_heartbeat: System.system_time(:millisecond),
      status: :connected,
      deployed_automata: [],
      transport_pid: transport_pid
    }

    # Monitor the transport process
    if transport_pid, do: Process.monitor(transport_pid)

    new_state =
      state
      |> put_in([:devices, device_id], device)
      |> put_in([:device_by_transport, transport_pid], device_id)

    # Send HELLO_ACK back
    send_message(transport_pid, :hello_ack, %{
      target_id: 0,
      assigned_id: protocol_id,
      server_time: System.system_time(:millisecond)
    })

    # Notify gateway and refresh device list
    push_device_list(new_state)

    Logger.info("Device registered: #{device_id} (#{device.device_type})")
    {:reply, {:ok, device}, new_state}
  end

  @impl true
  def handle_call({:deploy_automata, automata_id, device_id, automata}, _from, state) do
    case Map.get(state.devices, device_id) do
      nil ->
        {:reply, {:error, :device_not_found}, state}

      device ->
        deployment_id = deployment_id_for(automata_id, device_id)
        run_id = run_id_for_deployment(deployment_id)

        %{yaml: yaml, state_id_map: state_id_map, transition_id_map: transition_id_map} =
          AutomataYaml.from_gateway_automata(automata)

        maybe_dump_deploy_yaml(deployment_id, yaml)

        deployment = %{
          id: deployment_id,
          automata_id: automata_id,
          device_id: device_id,
          run_id: run_id,
          status: :pending,
          current_state: nil,
          variables: extract_default_variables(automata),
          state_id_map: state_id_map,
          transition_id_map: transition_id_map,
          deployed_at: System.system_time(:millisecond),
          error: nil
        }

        # Cache automata
        new_state =
          state
          |> put_in([:automata_cache, automata_id], automata)
          |> put_in([:deployments, deployment_id], deployment)
          |> update_in([:devices, device_id, :deployed_automata], &[automata_id | &1])

        # Send LOAD_AUTOMATA to device
        send_message(device.transport_pid, :load_automata, %{
          target_id: device.protocol_id,
          run_id: run_id,
          yaml: yaml
        })

        # Update deployment status
        new_state = put_in(new_state, [:deployments, deployment_id, :status], :loading)

        # Notify gateway
        push_to_gateway("deployment_status", %{
          "deployment_id" => deployment_id,
          "automata_id" => automata_id,
          "device_id" => device_id,
          "status" => "loading"
        })

        Logger.info("Deploying automata #{automata_id} to device #{device_id}")
        {:reply, {:ok, Map.get(new_state.deployments, deployment_id)}, new_state}
    end
  end

  defp maybe_dump_deploy_yaml(deployment_id, yaml) when is_binary(deployment_id) and is_binary(yaml) do
    case System.get_env("AETHERIUM_DUMP_DEPLOY_YAML") do
      "1" ->
        safe_id = String.replace(deployment_id, ~r/[^A-Za-z0-9_.-]/, "_")
        path = Path.join(System.tmp_dir!(), "aetherium_deploy_#{safe_id}.yaml")

        _ = File.write(path, yaml)

        preview =
          yaml
          |> String.split("\n")
          |> Enum.take(40)
          |> Enum.join("\n")

        Logger.info("Dumped deploy YAML to #{path}\n#{preview}")
        :ok

      _ ->
        :ok
    end
  end

  @impl true
  def handle_call({:stop_automata, deployment_id}, _from, state) do
    case Map.get(state.deployments, deployment_id) do
      nil ->
        {:reply, {:error, :deployment_not_found}, state}

      deployment ->
        device = Map.get(state.devices, deployment.device_id)

        if device && device.transport_pid do
          send_message(device.transport_pid, :stop, %{target_id: device.protocol_id, run_id: deployment.run_id})
        end

        new_state = put_in(state, [:deployments, deployment_id, :status], :stopped)

        push_to_gateway("deployment_status", %{
          "deployment_id" => deployment_id,
          "automata_id" => deployment.automata_id,
          "device_id" => deployment.device_id,
          "status" => "stopped"
        })

        Logger.info("Stopped automata deployment #{deployment_id}")
        {:reply, :ok, new_state}
    end
  end

  @impl true
  def handle_call({:send_to_device, device_id, message_type, payload}, _from, state) do
    case Map.get(state.devices, device_id) do
      nil ->
        {:reply, {:error, :device_not_found}, state}

      %{transport_pid: nil} ->
        {:reply, {:error, :device_not_connected}, state}

      device ->
        send_message(device.transport_pid, message_type, payload)
        {:reply, :ok, state}
    end
  end

  @impl true
  def handle_call(:list_devices, _from, state) do
    {:reply, Map.values(state.devices), state}
  end

  @impl true
  def handle_call({:get_device, device_id}, _from, state) do
    case Map.get(state.devices, device_id) do
      nil -> {:reply, {:error, :not_found}, state}
      device -> {:reply, {:ok, device}, state}
    end
  end

  @impl true
  def handle_call({:get_device_deployments, device_id}, _from, state) do
    deployments =
      state.deployments
      |> Map.values()
      |> Enum.filter(&(&1.device_id == device_id))

    {:reply, deployments, state}
  end

  @impl true
  def handle_call({:set_input, deployment_id, input_name, value}, _from, state) do
    case Map.get(state.deployments, deployment_id) do
      nil ->
        {:reply, {:error, :deployment_not_found}, state}

      deployment ->
        device = Map.get(state.devices, deployment.device_id)

        if device && device.transport_pid do
          send_message(device.transport_pid, :set_input, %{
            target_id: device.protocol_id,
            run_id: deployment.run_id,
            name: input_name,
            value: value
          })
        end

        {:reply, :ok, state}
    end
  end

  @impl true
  def handle_call({:trigger_event, deployment_id, event_name, data}, _from, state) do
    case Map.get(state.deployments, deployment_id) do
      nil ->
        {:reply, {:error, :deployment_not_found}, state}

      deployment ->
        device = Map.get(state.devices, deployment.device_id)

        # Not yet supported by engine protocol (event triggers)
        Logger.warn("trigger_event not supported for device #{deployment.device_id}: #{event_name} #{inspect(data)}")

        {:reply, :ok, state}
    end
  end

  @impl true
  def handle_cast({:device_disconnected, device_id}, state) do
    case Map.get(state.devices, device_id) do
      nil ->
        {:noreply, state}

      device ->
        new_state =
          state
          |> put_in([:devices, device_id, :status], :disconnected)
          |> put_in([:devices, device_id, :transport_pid], nil)
          |> update_in([:device_by_transport], &Map.delete(&1, device.transport_pid))

        push_device_list(new_state)

        Logger.info("Device disconnected: #{device_id}")
        {:noreply, new_state}
    end
  end

  @impl true
  def handle_cast({:heartbeat, device_id}, state) do
    case Map.get(state.devices, device_id) do
      nil ->
        {:noreply, state}

      device ->
        new_state = put_in(state, [:devices, device_id, :last_heartbeat], System.system_time(:millisecond))

        {:noreply, new_state}
    end
  end

  @impl true
  def handle_cast({:device_message, device_id, message_type, payload}, state) do
    state = handle_message(device_id, message_type, payload, state)
    {:noreply, state}
  end

  @impl true
  def handle_cast({:update_deployment_state, deployment_id, current_state, variables}, state) do
    case Map.get(state.deployments, deployment_id) do
      nil ->
        {:noreply, state}

      _deployment ->
        new_state =
          state
          |> put_in([:deployments, deployment_id, :current_state], current_state)
          |> put_in([:deployments, deployment_id, :variables], variables)
          |> put_in([:deployments, deployment_id, :status], :running)

        {:noreply, new_state}
    end
  end

  @impl true
  def handle_info(:check_heartbeats, state) do
    now = System.system_time(:millisecond)

    new_state =
      Enum.reduce(state.devices, state, fn {device_id, device}, acc ->
        if device.status == :connected &&
           now - device.last_heartbeat > state.heartbeat_timeout do
          Logger.warn("Device #{device_id} heartbeat timeout")

          acc
          |> put_in([:devices, device_id, :status], :disconnected)
        else
          acc
        end
      end)

    # Refresh device list in gateway after any heartbeat timeouts
    push_device_list(new_state)

    Process.send_after(self(), :check_heartbeats, state.heartbeat_timeout)
    {:noreply, new_state}
  end

  @impl true
  def handle_info({:DOWN, _ref, :process, pid, _reason}, state) do
    case Map.get(state.device_by_transport, pid) do
      nil ->
        {:noreply, state}

      device_id ->
        Logger.info("Transport process down for device #{device_id}")
        handle_cast({:device_disconnected, device_id}, state)
    end
  end

  # ============================================================================
  # Message Handlers
  # ============================================================================

  defp handle_message(device_id, :state_change, payload, state) do
    %{previous_state: prev_id, new_state: new_id, fired_transition: fired_id} = payload

    # Find deployment for this device
    deployment = find_active_deployment(device_id, state)

    if deployment do
      from = Map.get(deployment.state_id_map, prev_id, Integer.to_string(prev_id))
      to = Map.get(deployment.state_id_map, new_id, Integer.to_string(new_id))
      transition_id = Map.get(deployment.transition_id_map, fired_id, Integer.to_string(fired_id))

      new_state = put_in(state, [:deployments, deployment.id, :current_state], to)

      # Notify gateway of state change
      push_to_gateway("state_changed", %{
        "deployment_id" => deployment.id,
        "automata_id" => deployment.automata_id,
        "device_id" => device_id,
        "from_state" => from,
        "to_state" => to,
        "transition_id" => transition_id,
        "weight_used" => nil
      })

      new_state
    else
      state
    end
  end

  defp handle_message(device_id, :output, payload, state) do
    %{name: name, value: value} = payload

    deployment = find_active_deployment(device_id, state)

    if deployment do
      new_state = put_in(state, [:deployments, deployment.id, :variables, name], value)

      push_to_gateway("variable_updated", %{
        "deployment_id" => deployment.id,
        "automata_id" => deployment.automata_id,
        "device_id" => device_id,
        "direction" => "output",
        "name" => name,
        "value" => value
      })

      new_state
    else
      state
    end
  end

  defp handle_message(device_id, :telemetry, payload, state) do
    device = Map.get(state.devices, device_id)

    if device do
      push_to_gateway("device_alert", %{
        "device_id" => device_id,
        "type" => "metrics",
        "telemetry" => payload,
        "timestamp" => System.system_time(:millisecond)
      })
    end

    state
  end

  defp handle_message(device_id, :transition_fired, payload, state) do
    %{from: from, to: to, transition_id: tid, weight_used: weight} = payload

    deployment = find_active_deployment(device_id, state)

    if deployment do
      push_to_gateway("transition_fired", %{
        "deployment_id" => deployment.id,
        "automata_id" => deployment.automata_id,
        "device_id" => device_id,
        "from" => from,
        "to" => to,
        "transition_id" => tid,
        "weight_used" => weight
      })
    end

    state
  end

  defp handle_message(device_id, :load_ack, _payload, state) do
    deployment = find_active_deployment(device_id, state)

    if deployment do
      Logger.info("Automata loaded on device #{device_id}")

      new_state = put_in(state, [:deployments, deployment.id, :status], :running)

      # Send START command
      device = Map.get(state.devices, device_id)
      if device && device.transport_pid do
        send_message(device.transport_pid, :start, %{target_id: device.protocol_id, run_id: deployment.run_id})
      end

      push_to_gateway("deployment_status", %{
        "deployment_id" => deployment.id,
        "automata_id" => deployment.automata_id,
        "device_id" => deployment.device_id,
        "status" => "running"
      })

      new_state
    else
      state
    end
  end

  defp handle_message(device_id, :error, payload, state) do
    %{code: code, message: message} = payload

    Logger.error("Device #{device_id} error [#{code}]: #{message}")

    deployment = find_active_deployment(device_id, state)

    if deployment do
      new_state =
        state
        |> put_in([:deployments, deployment.id, :status], :error)
        |> put_in([:deployments, deployment.id, :error], message)

      push_to_gateway("deployment_error", %{
        "deployment_id" => deployment.id,
        "automata_id" => deployment.automata_id,
        "device_id" => device_id,
        "code" => code,
        "message" => message
      })

      new_state
    else
      state
    end
  end

  defp handle_message(device_id, :log, payload, state) do
    level = normalize_log_level(payload[:level] || payload["level"])
    message = payload[:message] || payload["message"] || inspect(payload)

    Logger.log(level, "Device #{device_id}: #{message}")

    push_to_gateway("device_log", %{
      "device_id" => device_id,
      "level" => Atom.to_string(level),
      "message" => message
    })

    state
  end

  defp handle_message(_device_id, _type, _payload, state), do: state

  # ============================================================================
  # Private Functions
  # ============================================================================

  defp find_active_deployment(device_id, state) do
    state.deployments
    |> Map.values()
    |> Enum.find(&(&1.device_id == device_id && &1.status in [:loading, :running]))
  end

  defp extract_default_variables(automata) do
    variables = automata[:variables] || []

    variables
    |> Enum.map(fn var -> {var[:name], var[:default]} end)
    |> Enum.into(%{})
  end

  defp send_message(nil, _type, _payload), do: :ok

  defp send_message(transport_pid, message_type, payload) do
    message_id = next_message_id()

    bin_result =
      case message_type do
        :hello_ack ->
          EngineProtocol.encode(:hello_ack, Map.merge(payload, %{message_id: message_id}))

        :load_automata ->
          EngineProtocol.encode(:load_automata, Map.merge(payload, %{message_id: message_id}))

        :start ->
          EngineProtocol.encode(:start, Map.merge(payload, %{message_id: message_id}))

        :stop ->
          EngineProtocol.encode(:stop, Map.merge(payload, %{message_id: message_id}))

        :set_input ->
          EngineProtocol.encode(:input, Map.merge(payload, %{message_id: message_id}))

        _ ->
          {:error, {:unsupported_message_type, message_type}}
      end

    case bin_result do
      {:ok, binary} -> send(transport_pid, {:send_binary, binary})
      {:error, reason} -> Logger.error("Failed to encode #{inspect(message_type)}: #{inspect(reason)}")
    end
  end

  defp push_to_gateway(event, payload) when is_binary(event) and is_map(payload) do
    AetheriumServer.GatewayConnection.push(event, payload)
  end

  defp push_device_list(state) do
    devices =
      state.devices
      |> Map.values()
      |> Enum.map(fn d ->
        %{
          id: d.id,
          device_type: d.device_type,
          status: d.status,
          connected_at: d.connected_at,
          last_heartbeat: d.last_heartbeat,
          capabilities: d.capabilities
        }
      end)

    AetheriumServer.GatewayConnection.report_devices(devices)
  end

  defp generate_id do
    :crypto.strong_rand_bytes(16)
    |> Base.encode16(case: :lower)
  end

  defp deployment_id_for(automata_id, device_id), do: "#{automata_id}:#{device_id}"

  defp run_id_for_deployment(deployment_id) do
    # Stable, non-zero uint32-ish run id
    :erlang.phash2(deployment_id, 4_294_967_295) + 1
  end

  defp protocol_id_for_device(device_id) do
    :erlang.phash2(device_id, 4_294_967_295) + 1
  end

  defp next_message_id do
    # uint32-ish monotonic id
    rem(System.unique_integer([:positive]), 4_294_967_295)
  end

  defp normalize_log_level(level) when is_integer(level) do
    # C++ levels: 0..4
    case level do
      0 -> :debug
      1 -> :debug
      2 -> :info
      3 -> :warn
      4 -> :error
      _ -> :info
    end
  end

  defp normalize_log_level(level) when is_binary(level) do
    case String.downcase(level) do
      "debug" -> :debug
      "info" -> :info
      "warn" -> :warn
      "warning" -> :warn
      "error" -> :error
      _ -> :info
    end
  end

  defp normalize_log_level(_), do: :info
end
