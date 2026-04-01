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

  alias AetheriumServer.AutomataDeployCompiler
  alias AetheriumServer.AnalyzerBundle
  alias AetheriumServer.AnalyzerProjection
  alias AetheriumServer.DeploymentCommands
  alias AetheriumServer.DeploymentLifecycle
  alias AetheriumServer.DeploymentObservability
  alias AetheriumServer.DeploymentOrchestrator
  alias AetheriumServer.DeploymentState
  alias AetheriumServer.DeploymentTransfer
  alias AetheriumServer.DeviceTransport
  alias AetheriumServer.DeviceSessionRef
  alias AetheriumServer.LiveStateRequests
  alias AetheriumServer.TargetProfiles
  alias AetheriumServer.TimeSeriesQuery

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
          session_ref: DeviceSessionRef.t() | nil,
          connector_id: String.t() | nil,
          connector_type: atom() | nil,
          transport: String.t() | nil,
          link: String.t() | nil,
          deployment_metadata: map()
        }

  @type deployment :: %{
          id: String.t(),
          automata_id: automata_id(),
          device_id: device_id(),
          run_id: non_neg_integer(),
          status: :pending | :loading | :running | :paused | :stopped | :error,
          current_state: String.t() | nil,
          variables: map(),
          state_id_map: %{non_neg_integer() => String.t()},
          transition_id_map: %{non_neg_integer() => String.t()},
          deployed_at: integer(),
          error: String.t() | nil,
          target_profile: String.t() | nil,
          artifact_version_id: String.t() | nil,
          snapshot_id: String.t() | nil,
          migration_plan_ref: String.t() | nil,
          patch_mode: String.t() | nil,
          deployment_metadata: map()
        }

  @type state :: %{
          devices: %{device_id() => device()},
          deployments: %{String.t() => deployment()},
          automata_cache: %{automata_id() => map()},
          device_by_transport: %{pid() => device_id()},
          pending_chunk_deploys: %{String.t() => map()},
          pending_state_requests: %{String.t() => %{callers: [term()], timer_ref: reference()}},
          delivered_topic_versions: %{{String.t(), String.t()} => non_neg_integer()},
          heartbeat_timeout: integer()
        }

  @default_heartbeat_timeout 30_000
  @default_request_state_timeout_ms 750

  # ============================================================================
  # Public API
  # ============================================================================

  @doc "Start the device manager"
  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @doc "Register a new device (called when device sends HELLO)"
  @spec register_device(map(), DeviceSessionRef.t() | pid()) :: {:ok, device()} | {:error, term()}
  def register_device(hello_payload, %DeviceSessionRef{} = session_ref) do
    GenServer.call(__MODULE__, {:register_device, hello_payload, session_ref})
  end

  def register_device(hello_payload, transport_pid) when is_pid(transport_pid) do
    register_device(hello_payload, legacy_session_ref(transport_pid))
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
  @spec deploy_automata(automata_id(), device_id(), map()) ::
          {:ok, deployment()} | {:error, term()}
  def deploy_automata(automata_id, device_id, automata) do
    GenServer.call(__MODULE__, {:deploy_automata, automata_id, device_id, automata})
  end

  @doc "Stop automata on a device"
  @spec stop_automata(String.t()) :: :ok | {:error, term()}
  def stop_automata(deployment_id) do
    GenServer.call(__MODULE__, {:stop_automata, deployment_id})
  end

  @doc "Start automata on a device"
  @spec start_automata(String.t()) :: :ok | {:error, term()}
  def start_automata(deployment_id) do
    GenServer.call(__MODULE__, {:start_automata, deployment_id})
  end

  @doc "Pause automata on a device"
  @spec pause_automata(String.t()) :: :ok | {:error, term()}
  def pause_automata(deployment_id) do
    GenServer.call(__MODULE__, {:pause_automata, deployment_id})
  end

  @doc "Resume automata on a device"
  @spec resume_automata(String.t()) :: :ok | {:error, term()}
  def resume_automata(deployment_id) do
    GenServer.call(__MODULE__, {:resume_automata, deployment_id})
  end

  @doc "Reset automata on a device"
  @spec reset_automata(String.t()) :: :ok | {:error, term()}
  def reset_automata(deployment_id) do
    GenServer.call(__MODULE__, {:reset_automata, deployment_id})
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
    GenServer.cast(
      __MODULE__,
      {:update_deployment_state, deployment_id, current_state, variables}
    )
  end

  @doc "Record a host-runtime event through the standard observability pipeline"
  @spec runtime_event(String.t(), String.t(), map()) :: :ok
  def runtime_event(deployment_id, event, payload \\ %{})
      when is_binary(deployment_id) and is_binary(event) and is_map(payload) do
    GenServer.cast(__MODULE__, {:runtime_event, deployment_id, event, payload})
  end

  @doc "Set input value for deployment"
  @spec set_input(String.t(), String.t(), any(), map()) :: :ok | {:error, term()}
  def set_input(deployment_id, input_name, value, opts \\ %{}) do
    GenServer.call(
      __MODULE__,
      {:set_input, deployment_id, input_name, value, normalize_set_input_opts(opts)}
    )
  end

  @doc "Trigger event on deployment"
  @spec trigger_event(String.t(), String.t(), any()) :: :ok | {:error, term()}
  def trigger_event(deployment_id, event_name, data) do
    GenServer.call(__MODULE__, {:trigger_event, deployment_id, event_name, data})
  end

  @doc "Force deployment state (if supported by runtime/device capabilities)"
  @spec force_state(String.t(), String.t()) :: :ok | {:error, term()}
  def force_state(deployment_id, state_id) do
    GenServer.call(__MODULE__, {:force_state, deployment_id, state_id})
  end

  @doc "Request deployment runtime snapshot"
  @spec request_state(String.t()) :: {:ok, map()} | {:error, term()}
  def request_state(deployment_id) do
    GenServer.call(__MODULE__, {:request_state, deployment_id})
  end

  @doc "Describe the black-box interface for a deployment"
  @spec describe_black_box(String.t()) :: {:ok, map()} | {:error, term()}
  def describe_black_box(deployment_id) do
    GenServer.call(__MODULE__, {:describe_black_box, deployment_id})
  end

  @doc "List deployment timeline events/snapshots from the time-series store"
  @spec list_time_series(String.t(), keyword()) :: map()
  def list_time_series(deployment_id, opts \\ []) do
    GenServer.call(__MODULE__, {:list_time_series, deployment_id, opts})
  end

  @doc "Rewind a deployment to a previously recorded timestamp"
  @spec rewind_deployment(String.t(), non_neg_integer()) :: {:ok, map()} | {:error, term()}
  def rewind_deployment(deployment_id, timestamp_ms) do
    GenServer.call(__MODULE__, {:rewind_deployment, deployment_id, timestamp_ms})
  end

  @doc "Query a deployment-aware analyzer bundle"
  @spec query_analyzer(map()) :: {:ok, map()} | {:error, term()}
  def query_analyzer(query) when is_map(query) do
    GenServer.call(__MODULE__, {:query_analyzer, query}, 30_000)
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
      pending_chunk_deploys: %{},
      pending_state_requests: %{},
      delivered_topic_versions: %{},
      heartbeat_timeout: heartbeat_timeout
    }

    # Start heartbeat checker
    Process.send_after(self(), :check_heartbeats, heartbeat_timeout)

    Logger.info("DeviceManager started")
    {:ok, state}
  end

  @impl true
  def handle_call(
        {:register_device, hello_payload, %DeviceSessionRef{} = session_ref},
        _from,
        state
      ) do
    device_id = hello_payload[:device_id] || generate_id()
    protocol_id = protocol_id_for_device(device_id)
    session_id = generate_id()
    monitor_pid = session_ref.monitor_pid
    now = System.system_time(:millisecond)

    existing = Map.get(state.devices, device_id)

    if existing && same_session_ref?(existing.session_ref, session_ref) do
      refreshed =
        existing
        |> Map.put(:device_type, hello_payload[:device_type] || existing.device_type)
        |> Map.put(:capabilities, hello_payload[:capabilities] || existing.capabilities)
        |> Map.put(
          :protocol_version,
          hello_payload[:protocol_version] || existing.protocol_version
        )
        |> Map.put(:last_heartbeat, now)
        |> Map.put(:status, :connected)
        |> Map.put(:session_ref, session_ref)
        |> Map.put(:connector_id, hello_payload[:connector_id] || session_ref.connector_id)
        |> Map.put(:connector_type, hello_payload[:connector_type] || session_ref.connector_type)
        |> Map.put(
          :transport,
          hello_payload[:transport] || session_ref.metadata[:transport] || existing.transport
        )
        |> Map.put(:link, hello_payload[:link] || session_ref.metadata[:link] || existing.link)
        |> Map.put(
          :deployment_metadata,
          DeploymentState.merge_deployment_metadata(
            existing[:deployment_metadata] || %{},
            hello_payload[:deployment_metadata] || %{}
          )
        )

      # Idempotent refresh: same connector/session, do not tear down existing attachment.
      AetheriumServer.ConnectorRegistry.attach_device(session_ref, device_id)

      new_state =
        state
        |> put_in([:devices, device_id], refreshed)
        |> maybe_put_monitor_mapping(monitor_pid, device_id)

      DeploymentObservability.persist_device_status(new_state, device_id)

      DeviceTransport.send_message(session_ref, :hello_ack, %{
        target_id: 0,
        assigned_id: protocol_id,
        server_time: now
      })

      Logger.debug("Device hello refresh: #{device_id} (#{refreshed.device_type})")
      {:reply, {:ok, refreshed}, new_state}
    else
      if existing do
        Logger.warning(
          "Device #{device_id} re-registered on connector #{session_ref.connector_id}; replacing previous session"
        )

        if existing.session_ref, do: AetheriumServer.ConnectorRegistry.detach_device(device_id)
      end

      device = %{
        id: device_id,
        protocol_id: protocol_id,
        device_type: hello_payload[:device_type] || :unknown,
        capabilities: hello_payload[:capabilities] || 0,
        protocol_version: hello_payload[:protocol_version] || 1,
        session_id: session_id,
        connected_at: now,
        last_heartbeat: now,
        status: :connected,
        deployed_automata: [],
        session_ref: session_ref,
        connector_id: hello_payload[:connector_id] || session_ref.connector_id,
        connector_type: hello_payload[:connector_type] || session_ref.connector_type,
        transport: hello_payload[:transport] || session_ref.metadata[:transport] || "unknown",
        link: hello_payload[:link] || session_ref.metadata[:link],
        deployment_metadata: hello_payload[:deployment_metadata] || %{}
      }

      # Monitor the transport process
      if is_pid(monitor_pid), do: Process.monitor(monitor_pid)

      AetheriumServer.ConnectorRegistry.attach_device(session_ref, device_id)

      new_state =
        state
        |> update_in(
          [:device_by_transport],
          &delete_monitor_mapping(&1, Map.get(state.devices, device_id))
        )
        |> put_in([:devices, device_id], device)
        |> maybe_put_monitor_mapping(monitor_pid, device_id)

      DeploymentObservability.persist_device_status(new_state, device_id)

      # Send HELLO_ACK back
      DeviceTransport.send_message(session_ref, :hello_ack, %{
        target_id: 0,
        assigned_id: protocol_id,
        server_time: now
      })

      # Notify gateway and refresh device list
      push_device_list(new_state)

      Logger.info("Device registered: #{device_id} (#{device.device_type})")
      {:reply, {:ok, device}, new_state}
    end
  end

  @impl true
  def handle_call({:deploy_automata, automata_id, device_id, automata}, _from, state) do
    case Map.get(state.devices, device_id) do
      nil ->
        {:reply, {:error, :device_not_found}, state}

      device ->
        case AutomataDeployCompiler.prepare(automata, device) do
          {:error, {:deploy_validation_failed, profile, diagnostics}} ->
            DeploymentObservability.push_to_gateway("deployment_validation", %{
              "automata_id" => automata_id,
              "device_id" => device_id,
              "target_profile" => profile.id,
              "diagnostics" => diagnostics
            })

            {:reply, {:error, {:deploy_validation_failed, profile.id, diagnostics}}, state}

          {:error, {:target_compiler_not_implemented, profile, diagnostics}} ->
            DeploymentObservability.push_to_gateway("deployment_validation", %{
              "automata_id" => automata_id,
              "device_id" => device_id,
              "target_profile" => profile.id,
              "diagnostics" => diagnostics
            })

            {:reply, {:error, {:target_compiler_not_implemented, profile.id, diagnostics}}, state}

          {:ok, compiled} ->
            do_deploy_compiled_automata(compiled, automata_id, device_id, automata, device, state)
        end
    end
  end

  @impl true
  def handle_call({:stop_automata, deployment_id}, _from, state) do
    case Map.get(state.deployments, deployment_id) do
      nil ->
        {:reply, {:error, :deployment_not_found}, state}

      deployment ->
        device = Map.get(state.devices, deployment.device_id)

        if device && device.session_ref do
          DeviceTransport.send_message(device.session_ref, :stop, %{
            target_id: device.protocol_id,
            run_id: deployment.run_id
          })
        end

        new_state = DeploymentLifecycle.stop_command_applied(state, deployment)

        Logger.info("Stopped automata deployment #{deployment_id}")
        {:reply, :ok, new_state}
    end
  end

  @impl true
  def handle_call({:start_automata, deployment_id}, _from, state) do
    case Map.get(state.deployments, deployment_id) do
      nil ->
        {:reply, {:error, :deployment_not_found}, state}

      deployment ->
        if runtime_registered?(deployment_id) do
          AetheriumServer.AutomataRuntime.start_execution(deployment_id)
          {:ok, runtime_state} = AetheriumServer.AutomataRuntime.get_state(deployment_id)

          new_state =
            DeploymentLifecycle.running_command_applied(
              state,
              deployment,
              runtime_state,
              "start_automata"
            )

          {:reply, :ok, new_state}
        else
          with {:ok, protocol_id, session_ref} <-
                 DeviceTransport.resolve_device_transport(state, deployment.device_id) do
            DeviceTransport.send_message(session_ref, :start, %{
              target_id: protocol_id,
              run_id: deployment.run_id
            })

            new_state =
              DeploymentLifecycle.running_command_applied(
                state,
                deployment,
                nil,
                "start_automata"
              )

            {:reply, :ok, new_state}
          else
            {:error, reason} -> {:reply, {:error, reason}, state}
          end
        end
    end
  end

  @impl true
  def handle_call({:pause_automata, deployment_id}, _from, state) do
    case Map.get(state.deployments, deployment_id) do
      nil ->
        {:reply, {:error, :deployment_not_found}, state}

      deployment ->
        if runtime_registered?(deployment_id) do
          AetheriumServer.AutomataRuntime.stop_execution(deployment_id)

          new_state =
            DeploymentLifecycle.paused_command_applied(state, deployment, "pause_automata")

          {:reply, :ok, new_state}
        else
          with {:ok, protocol_id, session_ref} <-
                 DeviceTransport.resolve_device_transport(state, deployment.device_id) do
            DeviceTransport.send_message(session_ref, :pause, %{
              target_id: protocol_id,
              run_id: deployment.run_id
            })

            new_state =
              DeploymentLifecycle.paused_command_applied(state, deployment, "pause_automata")

            {:reply, :ok, new_state}
          else
            {:error, reason} -> {:reply, {:error, reason}, state}
          end
        end
    end
  end

  @impl true
  def handle_call({:resume_automata, deployment_id}, _from, state) do
    case Map.get(state.deployments, deployment_id) do
      nil ->
        {:reply, {:error, :deployment_not_found}, state}

      deployment ->
        if runtime_registered?(deployment_id) do
          AetheriumServer.AutomataRuntime.start_execution(deployment_id)
          {:ok, runtime_state} = AetheriumServer.AutomataRuntime.get_state(deployment_id)

          new_state =
            DeploymentLifecycle.running_command_applied(
              state,
              deployment,
              runtime_state,
              "resume_automata"
            )

          {:reply, :ok, new_state}
        else
          with {:ok, protocol_id, session_ref} <-
                 DeviceTransport.resolve_device_transport(state, deployment.device_id) do
            DeviceTransport.send_message(session_ref, :resume, %{
              target_id: protocol_id,
              run_id: deployment.run_id
            })

            new_state =
              DeploymentLifecycle.running_command_applied(
                state,
                deployment,
                nil,
                "resume_automata"
              )

            {:reply, :ok, new_state}
          else
            {:error, reason} -> {:reply, {:error, reason}, state}
          end
        end
    end
  end

  @impl true
  def handle_call({:reset_automata, deployment_id}, _from, state) do
    case Map.get(state.deployments, deployment_id) do
      nil ->
        {:reply, {:error, :deployment_not_found}, state}

      deployment ->
        if runtime_registered?(deployment_id) do
          AetheriumServer.AutomataRuntime.reset(deployment_id)
          {:ok, runtime_state} = AetheriumServer.AutomataRuntime.get_state(deployment_id)

          new_state = DeploymentLifecycle.reset_command_applied(state, deployment, runtime_state)

          {:reply, :ok, new_state}
        else
          with {:ok, protocol_id, session_ref} <-
                 DeviceTransport.resolve_device_transport(state, deployment.device_id) do
            DeviceTransport.send_message(session_ref, :reset, %{
              target_id: protocol_id,
              run_id: deployment.run_id
            })

            {:reply, :ok, DeploymentLifecycle.reset_command_applied(state, deployment, nil)}
          else
            {:error, reason} -> {:reply, {:error, reason}, state}
          end
        end
    end
  end

  @impl true
  def handle_call({:send_to_device, device_id, message_type, payload}, _from, state) do
    case Map.get(state.devices, device_id) do
      nil ->
        {:reply, {:error, :device_not_found}, state}

      %{session_ref: nil} ->
        {:reply, {:error, :device_not_connected}, state}

      device ->
        DeviceTransport.send_message(device.session_ref, message_type, payload)
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
  def handle_call({:set_input, deployment_id, input_name, value}, from, state) do
    handle_call({:set_input, deployment_id, input_name, value, %{}}, from, state)
  end

  @impl true
  def handle_call({:set_input, deployment_id, input_name, value, opts}, _from, state) do
    case Map.get(state.deployments, deployment_id) do
      nil ->
        {:reply, {:error, :deployment_not_found}, state}

      deployment ->
        case DeploymentCommands.set_input(state, deployment, input_name, value, opts) do
          {:ok, next_state} ->
            {:reply, :ok, next_state}

          {:error, reason} ->
            {:reply, {:error, reason}, state}
        end
    end
  end

  @impl true
  def handle_call({:trigger_event, deployment_id, event_name, data}, _from, state) do
    case Map.get(state.deployments, deployment_id) do
      nil ->
        {:reply, {:error, :deployment_not_found}, state}

      deployment ->
        case DeploymentCommands.trigger_event(state, deployment, event_name, data) do
          :ok -> {:reply, :ok, state}
          {:error, reason} -> {:reply, {:error, reason}, state}
        end
    end
  end

  @impl true
  def handle_call({:force_state, deployment_id, state_id}, _from, state) do
    case Map.get(state.deployments, deployment_id) do
      nil ->
        {:reply, {:error, :deployment_not_found}, state}

      deployment ->
        {:reply, DeploymentCommands.force_state(state, deployment, state_id), state}
    end
  end

  @impl true
  def handle_call({:request_state, deployment_id}, from, state) do
    case Map.get(state.deployments, deployment_id) do
      nil ->
        {:reply, {:error, :deployment_not_found}, state}

      deployment ->
        if runtime_registered?(deployment_id) do
          reply =
            case AetheriumServer.AutomataRuntime.get_state(deployment_id) do
              {:ok, runtime_state} ->
                {:ok,
                 DeploymentObservability.enrich_black_box_snapshot(
                   runtime_state,
                   deployment,
                   state
                 )}

              error ->
                error
            end

          {:reply, reply, state}
        else
          case LiveStateRequests.request_snapshot(
                 state,
                 deployment,
                 from,
                 timeout_ms: @default_request_state_timeout_ms,
                 request_status: fn ->
                   with {:ok, protocol_id, session_ref} <-
                          DeviceTransport.resolve_device_transport(state, deployment.device_id) do
                     DeviceTransport.send_message(session_ref, :status, %{
                       target_id: protocol_id,
                       run_id: deployment.run_id
                     })
                   end
                 end
               ) do
            {:pending, next_state} ->
              {:noreply, next_state}

            {:reply, reply, next_state} ->
              {:reply, reply, next_state}
          end
        end
    end
  end

  @impl true
  def handle_call({:describe_black_box, deployment_id}, _from, state) do
    case Map.get(state.deployments, deployment_id) do
      nil ->
        {:reply, {:error, :deployment_not_found}, state}

      deployment ->
        {:reply, {:ok, DeploymentObservability.black_box_description(deployment, state)}, state}
    end
  end

  @impl true
  def handle_call({:list_time_series, deployment_id, opts}, _from, state) do
    case Map.get(state.deployments, deployment_id) do
      nil ->
        {:reply, %{events: [], snapshots: [], error: :deployment_not_found}, state}

      _deployment ->
        after_ts = keyword_time_filter(opts, :after_ts)
        before_ts = keyword_time_filter(opts, :before_ts)
        limit = keyword_limit(opts, :limit, 500)

        timeline =
          TimeSeriesQuery.list_timeline(
            deployment_id,
            after_ts: after_ts,
            before_ts: before_ts,
            limit: limit
          )

        {:reply, timeline, state}
    end
  end

  @impl true
  def handle_call({:rewind_deployment, deployment_id, timestamp_ms}, _from, state) do
    case Map.get(state.deployments, deployment_id) do
      nil ->
        {:reply, {:error, :deployment_not_found}, state}

      _deployment when not is_integer(timestamp_ms) or timestamp_ms < 0 ->
        {:reply, {:error, :invalid_timestamp}, state}

      deployment ->
        case TimeSeriesQuery.replay_state_at(deployment_id, timestamp_ms) do
          {:ok, replay} ->
            replay_state = replay["state"] || %{}

            new_state =
              state
              |> put_in(
                [:deployments, deployment_id, :status],
                replay_status_atom(replay_state["status"] || deployment.status)
              )
              |> put_in(
                [:deployments, deployment_id, :current_state],
                replay_state["current_state"]
              )
              |> put_in(
                [:deployments, deployment_id, :variables],
                replay_state["variables"] || %{}
              )
              |> put_in([:deployments, deployment_id, :error], replay_state["error"])

            DeploymentObservability.append_time_series_event(
              deployment_id,
              "time_travel_rewind_marker",
              %{
                "automata_id" => deployment.automata_id,
                "device_id" => deployment.device_id,
                "rewound_to" => timestamp_ms,
                "state" => replay_state
              }
            )

            DeploymentObservability.snapshot_deployment(
              new_state,
              deployment_id,
              "time_travel_rewind"
            )

            DeploymentObservability.push_to_gateway(new_state, "deployment_status", %{
              "deployment_id" => deployment_id,
              "automata_id" => deployment.automata_id,
              "device_id" => deployment.device_id,
              "status" =>
                Atom.to_string(replay_status_atom(replay_state["status"] || deployment.status)),
              "current_state" => replay_state["current_state"],
              "variables" => replay_state["variables"] || %{},
              "error" => replay_state["error"],
              "source" => "time_travel_rewind",
              "rewound_to" => timestamp_ms
            })

            {:reply,
             {:ok,
              %{
                deployment_id: deployment_id,
                rewound_to: timestamp_ms,
                state: replay_state,
                events_replayed: replay["events_replayed"] || 0,
                source: replay["source"],
                backend_error: replay["backend_error"]
              }}, new_state}

          {:error, reason} ->
            {:reply, {:error, reason}, state}
        end
    end
  end

  @impl true
  def handle_call({:query_analyzer, query}, _from, state) do
    reply =
      with {:ok, bundle} <- AnalyzerBundle.build(query, state) do
        {:ok, AnalyzerProjection.project(bundle)}
      end

    {:reply, reply, state}
  end

  defp do_deploy_compiled_automata(compiled, automata_id, device_id, automata, device, state) do
    DeploymentOrchestrator.deploy_compiled(
      compiled,
      automata_id,
      device_id,
      automata,
      device,
      state,
      send_chunk: &send_pending_deployment_chunk/4
    )
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
          |> put_in([:devices, device_id, :session_ref], nil)
          |> update_in([:device_by_transport], &delete_monitor_mapping(&1, device))
          |> DeploymentTransfer.clear_for_device(device_id)

        AetheriumServer.ConnectorRegistry.detach_device(device_id)
        DeploymentObservability.persist_device_status(new_state, device_id)
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

      _device ->
        new_state =
          state
          |> put_in([:devices, device_id, :last_heartbeat], System.system_time(:millisecond))
          |> put_in([:devices, device_id, :status], :connected)

        DeploymentObservability.persist_device_status(new_state, device_id)

        {:noreply, new_state}
    end
  end

  @impl true
  def handle_cast({:device_message, device_id, message_type, payload}, state) do
    now = System.system_time(:millisecond)

    state =
      case Map.get(state.devices, device_id) do
        nil ->
          state

        _device ->
          state
          |> put_in([:devices, device_id, :last_heartbeat], now)
          |> put_in([:devices, device_id, :status], :connected)
      end

    state = handle_message(device_id, message_type, payload, state)
    DeploymentObservability.persist_device_status(state, device_id)
    {:noreply, state}
  end

  @impl true
  def handle_cast({:update_deployment_state, deployment_id, current_state, variables}, state) do
    case Map.get(state.deployments, deployment_id) do
      nil ->
        {:noreply, state}

      deployment ->
        previous_state = deployment.current_state

        new_state =
          state
          |> put_in([:deployments, deployment_id, :current_state], current_state)
          |> put_in([:deployments, deployment_id, :variables], variables)
          |> put_in([:deployments, deployment_id, :status], :running)

        if previous_state != current_state do
          DeploymentObservability.push_to_gateway(new_state, "state_changed", %{
            "deployment_id" => deployment_id,
            "automata_id" => deployment.automata_id,
            "device_id" => deployment.device_id,
            "from_state" => previous_state,
            "to_state" => current_state,
            "transition_id" => nil,
            "variables" => variables,
            "weight_used" => nil
          })
        end

        DeploymentObservability.push_to_gateway(new_state, "deployment_status", %{
          "deployment_id" => deployment_id,
          "automata_id" => deployment.automata_id,
          "device_id" => deployment.device_id,
          "status" => "running",
          "current_state" => current_state,
          "variables" => variables
        })

        DeploymentObservability.snapshot_deployment(
          new_state,
          deployment_id,
          "runtime_state_update"
        )

        {:noreply, new_state}
    end
  end

  @impl true
  def handle_cast({:runtime_event, deployment_id, event, payload}, state) do
    case Map.get(state.deployments, deployment_id) do
      nil ->
        {:noreply, state}

      deployment ->
        base_payload =
          payload
          |> Map.put_new("deployment_id", deployment_id)
          |> Map.put_new("automata_id", deployment.automata_id)
          |> Map.put_new("device_id", deployment.device_id)
          |> Map.put_new("timestamp", System.system_time(:millisecond))

        new_state =
          case event do
            "variable_updated" ->
              DeploymentState.update_runtime_variable(state, deployment_id, base_payload)

            _ ->
              state
          end

        DeploymentObservability.push_to_gateway(new_state, event, base_payload)

        if event == "variable_updated" do
          DeploymentObservability.snapshot_deployment(
            new_state,
            deployment_id,
            "runtime_#{event}"
          )
        end

        {:noreply, new_state}
    end
  end

  @impl true
  def handle_info(:check_heartbeats, state) do
    now = System.system_time(:millisecond)

    {new_state, changed_device_ids} =
      Enum.reduce(state.devices, {state, []}, fn {device_id, device}, {acc, changed_ids} ->
        if device.status == :connected &&
             now - device.last_heartbeat > state.heartbeat_timeout do
          cond do
            session_alive?(device.session_ref) ->
              # Treat active websocket transport as liveness to avoid false offline flaps.
              {
                acc
                |> put_in([:devices, device_id, :last_heartbeat], now)
                |> put_in([:devices, device_id, :status], :connected),
                changed_ids
              }

            true ->
              Logger.warning("Device #{device_id} heartbeat timeout")
              AetheriumServer.ConnectorRegistry.detach_device(device_id)

              {
                acc
                |> put_in([:devices, device_id, :status], :disconnected)
                |> put_in([:devices, device_id, :session_ref], nil)
                |> DeploymentTransfer.clear_for_device(device_id),
                [device_id | changed_ids]
              }
          end
        else
          {acc, changed_ids}
        end
      end)

    Enum.each(changed_device_ids, &DeploymentObservability.persist_device_status(new_state, &1))

    # Refresh device list in gateway after any heartbeat timeouts
    push_device_list(new_state)

    Process.send_after(self(), :check_heartbeats, state.heartbeat_timeout)
    {:noreply, new_state}
  end

  @impl true
  def handle_info({:chunk_ack_timeout, deployment_id, message_id}, state) do
    {:noreply,
     DeploymentTransfer.handle_chunk_ack_timeout(
       state,
       deployment_id,
       message_id,
       send_chunk: &send_pending_deployment_chunk/4
     )}
  end

  @impl true
  def handle_info({:final_load_ack_timeout, deployment_id, message_id}, state) do
    {:noreply,
     DeploymentTransfer.handle_final_load_ack_timeout(
       state,
       deployment_id,
       message_id,
       send_chunk: &send_pending_deployment_chunk/4
     )}
  end

  @impl true
  def handle_info({:request_state_timeout, deployment_id}, state) do
    {:noreply, LiveStateRequests.handle_timeout(state, deployment_id)}
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
    deployment = DeploymentState.find_active_deployment(device_id, payload, state)

    if deployment do
      from = Map.get(deployment.state_id_map, prev_id, Integer.to_string(prev_id))
      to = Map.get(deployment.state_id_map, new_id, Integer.to_string(new_id))
      transition_id = Map.get(deployment.transition_id_map, fired_id, Integer.to_string(fired_id))

      new_state = put_in(state, [:deployments, deployment.id, :current_state], to)

      # Notify gateway of state change
      DeploymentObservability.push_to_gateway(new_state, "state_changed", %{
        "deployment_id" => deployment.id,
        "automata_id" => deployment.automata_id,
        "device_id" => device_id,
        "from_state" => from,
        "to_state" => to,
        "transition_id" => transition_id,
        "weight_used" => nil
      })

      DeploymentObservability.snapshot_deployment(new_state, deployment.id, "state_changed")
      new_state
    else
      state
    end
  end

  defp handle_message(device_id, :output, payload, state) do
    %{name: name, value: value} = payload

    deployment = DeploymentState.find_active_deployment(device_id, payload, state)

    if deployment do
      new_state = put_in(state, [:deployments, deployment.id, :variables, name], value)

      DeploymentObservability.push_to_gateway(new_state, "variable_updated", %{
        "deployment_id" => deployment.id,
        "automata_id" => deployment.automata_id,
        "device_id" => device_id,
        "direction" => "output",
        "name" => name,
        "value" => value
      })

      DeploymentObservability.snapshot_deployment(new_state, deployment.id, "variable_updated")
      new_state
    else
      state
    end
  end

  defp handle_message(device_id, :telemetry, payload, state) do
    device = Map.get(state.devices, device_id)
    deployment = DeploymentState.find_active_deployment(device_id, payload, state)

    deployment_metadata =
      DeploymentObservability.build_deployment_metadata(device, deployment, payload)

    telemetry_variables = telemetry_variables_map(payload)

    state =
      case deployment do
        %{id: deployment_id} ->
          state
          |> DeploymentState.maybe_put_device_metadata(device_id, deployment_metadata)
          |> DeploymentState.maybe_merge_deployment_snapshot(
            deployment_id,
            telemetry_variables,
            deployment_metadata
          )

        _ ->
          state
      end

    if device do
      deployment = deployment && Map.get(state.deployments, deployment.id, deployment)
      DeploymentObservability.persist_device_metrics(device, deployment, payload)

      DeploymentObservability.push_to_gateway(state, "device_alert", %{
        "device_id" => device_id,
        "deployment_id" => deployment && deployment.id,
        "automata_id" => deployment && deployment.automata_id,
        "type" => "metrics",
        "telemetry" => payload,
        "deployment_metadata" => deployment_metadata,
        "timestamp" => System.system_time(:millisecond)
      })
    end

    state
  end

  defp handle_message(device_id, :status, payload, state) do
    deployment = DeploymentState.find_active_deployment(device_id, payload, state)
    device = Map.get(state.devices, device_id)

    if deployment do
      status =
        case payload[:execution_state] || payload["execution_state"] do
          2 -> :running
          3 -> :paused
          4 -> :stopped
          _ -> deployment.status
        end

      current_state_id = payload[:current_state] || payload["current_state"]

      current_state =
        if is_integer(current_state_id) do
          Map.get(deployment.state_id_map, current_state_id, Integer.to_string(current_state_id))
        else
          deployment.current_state
        end

      variables = named_snapshot_map(payload)

      deployment_metadata =
        DeploymentObservability.build_deployment_metadata(device, deployment, payload)

      new_state =
        state
        |> put_in([:deployments, deployment.id, :status], status)
        |> put_in([:deployments, deployment.id, :current_state], current_state)
        |> DeploymentState.maybe_put_device_metadata(device_id, deployment_metadata)
        |> DeploymentState.maybe_merge_deployment_snapshot(
          deployment.id,
          variables,
          deployment_metadata
        )

      DeploymentObservability.push_to_gateway(new_state, "deployment_status", %{
        "deployment_id" => deployment.id,
        "automata_id" => deployment.automata_id,
        "device_id" => device_id,
        "status" => Atom.to_string(status),
        "current_state" => current_state,
        "variables" => get_in(new_state, [:deployments, deployment.id, :variables]) || %{},
        "deployment_metadata" =>
          get_in(new_state, [:deployments, deployment.id, :deployment_metadata]) || %{}
      })

      new_state = LiveStateRequests.fulfill_request(new_state, deployment.id)
      DeploymentObservability.snapshot_deployment(new_state, deployment.id, "device_status")
      new_state
    else
      state
    end
  end

  defp handle_message(device_id, :transition_fired, payload, state) do
    deployment = DeploymentState.find_active_deployment(device_id, payload, state)

    if deployment do
      tid = payload[:transition_id] || payload["transition_id"]
      from = payload[:from] || payload["from"] || deployment.current_state
      to = payload[:to] || payload["to"] || deployment.current_state
      weight = payload[:weight_used] || payload["weight_used"]

      DeploymentObservability.push_to_gateway(state, "transition_fired", %{
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

  defp handle_message(device_id, :ack, payload, state) do
    related_message_id = payload[:related_message_id] || payload["related_message_id"]

    DeploymentTransfer.handle_ack(state, device_id, related_message_id,
      send_chunk: &send_pending_deployment_chunk/4
    )
  end

  defp handle_message(device_id, :nak, payload, state) do
    related_message_id = payload[:related_message_id] || payload["related_message_id"]
    reason = payload[:reason] || payload["reason"] || "chunk_nak"
    DeploymentTransfer.handle_nak(state, device_id, related_message_id, to_string(reason))
  end

  defp handle_message(device_id, :load_ack, payload, state) do
    run_id = payload[:run_id] || payload["run_id"]

    {state, pending} =
      DeploymentTransfer.take_pending_by_device_and_run_id(state, device_id, run_id)

    deployment =
      DeploymentState.find_deployment_by_device_and_run_id(device_id, run_id, state) ||
        DeploymentState.find_active_deployment(device_id, state)

    if deployment do
      success = payload[:success] || payload["success"]
      error_message = payload[:error] || payload["error"] || "load_failed"

      if success do
        DeploymentLifecycle.load_ack_succeeded(state, deployment, pending)
      else
        DeploymentLifecycle.load_ack_failed(state, deployment, error_message, pending)
      end
    else
      state
    end
  end

  defp handle_message(device_id, :error, payload, state) do
    %{code: code, message: message} = payload

    Logger.error("Device #{device_id} error [#{code}]: #{message}")

    deployment = DeploymentState.find_active_deployment(device_id, state)

    if deployment do
      new_state =
        state
        |> put_in([:deployments, deployment.id, :status], :error)
        |> put_in([:deployments, deployment.id, :error], message)

      DeploymentObservability.push_to_gateway(new_state, "deployment_error", %{
        "deployment_id" => deployment.id,
        "automata_id" => deployment.automata_id,
        "device_id" => device_id,
        "code" => code,
        "message" => message
      })

      DeploymentObservability.snapshot_deployment(new_state, deployment.id, "device_error")
      new_state
    else
      state
    end
  end

  defp handle_message(device_id, :log, payload, state) do
    level = normalize_log_level(payload[:level] || payload["level"])
    message = payload[:message] || payload["message"] || inspect(payload)

    Logger.log(level, "Device #{device_id}: #{message}")

    DeploymentObservability.push_to_gateway(state, "device_log", %{
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

  defp named_snapshot_map(payload) when is_map(payload) do
    case payload[:variables] || payload["variables"] do
      variables when is_map(variables) -> variables
      _ -> %{}
    end
  end

  defp telemetry_variables_map(payload) when is_map(payload) do
    case payload[:variables] || payload["variables"] do
      variables when is_map(variables) ->
        variables

      variables when is_list(variables) ->
        Enum.reduce(variables, %{}, fn
          %{name: name, value: value}, acc when is_binary(name) ->
            Map.put(acc, name, value)

          %{"name" => name, "value" => value}, acc when is_binary(name) ->
            Map.put(acc, name, value)

          _, acc ->
            acc
        end)

      _ ->
        %{}
    end
  end

  defp runtime_registered?(deployment_id) do
    match?([{_pid, _value}], Registry.lookup(AetheriumServer.RuntimeRegistry, deployment_id))
  end

  defp send_pending_deployment_chunk(state, pending, chunk_index, chunk)
       when is_map(state) and is_map(pending) and is_integer(chunk_index) and is_binary(chunk) do
    with {:ok, protocol_id, session_ref} <-
           DeviceTransport.resolve_device_transport(state, pending.device_id) do
      DeviceTransport.send_message(session_ref, :load_automata, %{
        target_id: protocol_id,
        run_id: pending.run_id,
        format: pending.format,
        data: chunk,
        is_chunked: pending.total_chunks > 1,
        chunk_index: chunk_index,
        total_chunks: pending.total_chunks,
        start_after_load: false,
        replace_existing: true
      })
    end
  end

  defp replay_status_atom(status) when is_atom(status), do: status

  defp replay_status_atom(status) when is_binary(status) do
    case String.downcase(status) do
      "pending" -> :pending
      "loading" -> :loading
      "running" -> :running
      "paused" -> :paused
      "stopped" -> :stopped
      "error" -> :error
      _ -> :stopped
    end
  end

  defp replay_status_atom(_), do: :stopped

  defp keyword_time_filter(opts, key) do
    case Keyword.get(opts, key) do
      value when is_integer(value) and value >= 0 -> value
      _ -> nil
    end
  end

  defp keyword_limit(opts, key, default) do
    case Keyword.get(opts, key, default) do
      value when is_integer(value) and value > 0 -> value
      _ -> default
    end
  end

  defp normalize_set_input_opts(opts) when is_map(opts), do: opts
  defp normalize_set_input_opts(_opts), do: %{}

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
          capabilities: d.capabilities,
          connector_type: d.connector_type,
          connector_id: d.connector_id,
          transport: d.transport,
          link: d.link,
          target_profile: TargetProfiles.for_device(d).id,
          compile_formats: TargetProfiles.for_device(d).compile_formats,
          feature_flags: TargetProfiles.for_device(d).feature_flags,
          limits: TargetProfiles.for_device(d).limits,
          supported_commands: DeviceTransport.supported_commands_for_device(d)
        }
      end)

    AetheriumServer.GatewayConnection.report_devices(devices)
  end

  defp generate_id do
    :crypto.strong_rand_bytes(16)
    |> Base.encode16(case: :lower)
  end

  defp protocol_id_for_device(device_id) do
    :erlang.phash2(device_id, 4_294_967_295) + 1
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

  defp maybe_put_monitor_mapping(state, pid, device_id) when is_pid(pid) do
    put_in(state, [:device_by_transport, pid], device_id)
  end

  defp maybe_put_monitor_mapping(state, _pid, _device_id), do: state

  defp delete_monitor_mapping(map, %{session_ref: %DeviceSessionRef{monitor_pid: pid}})
       when is_pid(pid) do
    Map.delete(map, pid)
  end

  defp delete_monitor_mapping(map, _device), do: map

  defp same_session_ref?(%DeviceSessionRef{} = a, %DeviceSessionRef{} = b) do
    a.connector_id == b.connector_id and a.session_id == b.session_id
  end

  defp same_session_ref?(_, _), do: false

  defp session_alive?(%DeviceSessionRef{monitor_pid: pid}) when is_pid(pid),
    do: Process.alive?(pid)

  defp session_alive?(_), do: false

  defp legacy_session_ref(pid) when is_pid(pid) do
    %DeviceSessionRef{
      connector_id: "legacy_pid",
      connector_type: :unknown,
      connector_module: AetheriumServer.DeviceConnectors.LegacyPidConnector,
      session_id: "pid:" <> Integer.to_string(:erlang.phash2(pid)),
      endpoint: pid,
      monitor_pid: pid,
      metadata: %{transport: "legacy_pid"}
    }
  end
end
