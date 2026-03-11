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
  alias AetheriumServer.DeviceConnector
  alias AetheriumServer.DeviceSessionRef
  alias AetheriumServer.EngineProtocol
  alias AetheriumServer.TargetProfiles
  alias AetheriumServer.TimeSeriesInfluxSink
  alias AetheriumServer.TimeSeriesQuery
  alias AetheriumServer.TimeSeriesStore

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
          link: String.t() | nil
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
          patch_mode: String.t() | nil
        }

  @type state :: %{
          devices: %{device_id() => device()},
          deployments: %{String.t() => deployment()},
          automata_cache: %{automata_id() => map()},
          device_by_transport: %{pid() => device_id()},
          pending_chunk_deploys: %{String.t() => map()},
          heartbeat_timeout: integer()
        }

  @default_heartbeat_timeout 30_000
  @default_chunk_ack_timeout_ms 2_000
  @default_chunk_ack_retries 3
  @default_final_load_ack_timeout_ms 5_000

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

      # Idempotent refresh: same connector/session, do not tear down existing attachment.
      AetheriumServer.ConnectorRegistry.attach_device(session_ref, device_id)

      new_state =
        state
        |> put_in([:devices, device_id], refreshed)
        |> maybe_put_monitor_mapping(monitor_pid, device_id)

      persist_device_status(new_state, device_id)

      send_message(session_ref, :hello_ack, %{
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
        link: hello_payload[:link] || session_ref.metadata[:link]
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

      persist_device_status(new_state, device_id)

      # Send HELLO_ACK back
      send_message(session_ref, :hello_ack, %{
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
            push_to_gateway("deployment_validation", %{
              "automata_id" => automata_id,
              "device_id" => device_id,
              "target_profile" => profile.id,
              "diagnostics" => diagnostics
            })

            {:reply, {:error, {:deploy_validation_failed, profile.id, diagnostics}}, state}

          {:error, {:target_compiler_not_implemented, profile, diagnostics}} ->
            push_to_gateway("deployment_validation", %{
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
          send_message(device.session_ref, :stop, %{
            target_id: device.protocol_id,
            run_id: deployment.run_id
          })
        end

        new_state = put_in(state, [:deployments, deployment_id, :status], :stopped)
        snapshot_deployment(new_state, deployment_id, "stop_automata")

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
  def handle_call({:start_automata, deployment_id}, _from, state) do
    case Map.get(state.deployments, deployment_id) do
      nil ->
        {:reply, {:error, :deployment_not_found}, state}

      deployment ->
        if runtime_registered?(deployment_id) do
          AetheriumServer.AutomataRuntime.start_execution(deployment_id)
          {:ok, runtime_state} = AetheriumServer.AutomataRuntime.get_state(deployment_id)

          new_state =
            state
            |> put_in([:deployments, deployment_id, :status], :running)
            |> put_in([:deployments, deployment_id, :current_state], runtime_state.current_state)
            |> put_in([:deployments, deployment_id, :variables], runtime_state.variables)

          push_to_gateway("deployment_status", %{
            "deployment_id" => deployment_id,
            "automata_id" => deployment.automata_id,
            "device_id" => deployment.device_id,
            "status" => "running",
            "current_state" => runtime_state.current_state,
            "variables" => runtime_state.variables
          })

          snapshot_deployment(new_state, deployment_id, "start_automata")
          {:reply, :ok, new_state}
        else
          with {:ok, protocol_id, session_ref} <-
                 resolve_device_transport(state, deployment.device_id) do
            send_message(session_ref, :start, %{target_id: protocol_id, run_id: deployment.run_id})

            new_state = put_in(state, [:deployments, deployment_id, :status], :running)
            snapshot_deployment(new_state, deployment_id, "start_automata")
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

          new_state = put_in(state, [:deployments, deployment_id, :status], :paused)

          push_to_gateway("deployment_status", %{
            "deployment_id" => deployment_id,
            "automata_id" => deployment.automata_id,
            "device_id" => deployment.device_id,
            "status" => "paused"
          })

          snapshot_deployment(new_state, deployment_id, "pause_automata")
          {:reply, :ok, new_state}
        else
          with {:ok, protocol_id, session_ref} <-
                 resolve_device_transport(state, deployment.device_id) do
            send_message(session_ref, :pause, %{target_id: protocol_id, run_id: deployment.run_id})

            new_state = put_in(state, [:deployments, deployment_id, :status], :paused)
            snapshot_deployment(new_state, deployment_id, "pause_automata")
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
            state
            |> put_in([:deployments, deployment_id, :status], :running)
            |> put_in([:deployments, deployment_id, :current_state], runtime_state.current_state)
            |> put_in([:deployments, deployment_id, :variables], runtime_state.variables)

          push_to_gateway("deployment_status", %{
            "deployment_id" => deployment_id,
            "automata_id" => deployment.automata_id,
            "device_id" => deployment.device_id,
            "status" => "running",
            "current_state" => runtime_state.current_state,
            "variables" => runtime_state.variables
          })

          snapshot_deployment(new_state, deployment_id, "resume_automata")
          {:reply, :ok, new_state}
        else
          with {:ok, protocol_id, session_ref} <-
                 resolve_device_transport(state, deployment.device_id) do
            send_message(session_ref, :resume, %{
              target_id: protocol_id,
              run_id: deployment.run_id
            })

            new_state = put_in(state, [:deployments, deployment_id, :status], :running)
            snapshot_deployment(new_state, deployment_id, "resume_automata")
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

          new_state =
            state
            |> put_in([:deployments, deployment_id, :status], :stopped)
            |> put_in([:deployments, deployment_id, :current_state], runtime_state.current_state)
            |> put_in([:deployments, deployment_id, :variables], runtime_state.variables)

          append_time_series_event(deployment_id, "reset_automata", %{
            "automata_id" => deployment.automata_id,
            "device_id" => deployment.device_id,
            "run_id" => deployment.run_id
          })

          push_to_gateway("deployment_status", %{
            "deployment_id" => deployment_id,
            "automata_id" => deployment.automata_id,
            "device_id" => deployment.device_id,
            "status" => "stopped",
            "current_state" => runtime_state.current_state,
            "variables" => runtime_state.variables
          })

          {:reply, :ok, new_state}
        else
          with {:ok, protocol_id, session_ref} <-
                 resolve_device_transport(state, deployment.device_id) do
            send_message(session_ref, :reset, %{target_id: protocol_id, run_id: deployment.run_id})

            append_time_series_event(deployment_id, "reset_automata", %{
              "automata_id" => deployment.automata_id,
              "device_id" => deployment.device_id,
              "run_id" => deployment.run_id
            })

            {:reply, :ok, state}
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
        send_message(device.session_ref, message_type, payload)
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

        cond do
          runtime_registered?(deployment_id) ->
            AetheriumServer.AutomataRuntime.set_input(deployment_id, input_name, value)

            append_time_series_event(deployment_id, "set_input", %{
              "automata_id" => deployment.automata_id,
              "device_id" => deployment.device_id,
              "name" => input_name,
              "value" => value
            })

            {:reply, :ok, state}

          match?(%{session_ref: %DeviceSessionRef{}, protocol_id: _}, device) ->
            %{session_ref: session_ref, protocol_id: protocol_id} = device

            send_message(session_ref, :set_input, %{
              target_id: protocol_id,
              run_id: deployment.run_id,
              name: input_name,
              value: value
            })

            append_time_series_event(deployment_id, "set_input", %{
              "automata_id" => deployment.automata_id,
              "device_id" => deployment.device_id,
              "name" => input_name,
              "value" => value
            })

            {:reply, :ok, state}

          true ->
            {:reply, {:error, :device_not_connected}, state}
        end
    end
  end

  @impl true
  def handle_call({:trigger_event, deployment_id, event_name, data}, _from, state) do
    case Map.get(state.deployments, deployment_id) do
      nil ->
        {:reply, {:error, :deployment_not_found}, state}

      deployment ->
        Logger.warning(
          "trigger_event unsupported for device #{deployment.device_id}: #{event_name} #{inspect(data)}"
        )

        {:reply, {:error, :unsupported_command}, state}
    end
  end

  @impl true
  def handle_call({:force_state, deployment_id, state_id}, _from, state) do
    case Map.get(state.deployments, deployment_id) do
      nil ->
        {:reply, {:error, :deployment_not_found}, state}

      _deployment ->
        if runtime_registered?(deployment_id) do
          {:reply, AetheriumServer.AutomataRuntime.force_state(deployment_id, state_id), state}
        else
          Logger.warning(
            "force_state unsupported for deployment #{deployment_id}: runtime unavailable"
          )

          {:reply, {:error, :unsupported_command}, state}
        end
    end
  end

  @impl true
  def handle_call({:request_state, deployment_id}, _from, state) do
    case Map.get(state.deployments, deployment_id) do
      nil ->
        {:reply, {:error, :deployment_not_found}, state}

      deployment ->
        if deployment.status in [:running, :paused] do
          case resolve_device_transport(state, deployment.device_id) do
            {:ok, protocol_id, session_ref} ->
              send_message(session_ref, :status, %{
                target_id: protocol_id,
                run_id: deployment.run_id
              })

            _ ->
              :ok
          end
        end

        if runtime_registered?(deployment_id) do
          {:reply, AetheriumServer.AutomataRuntime.get_state(deployment_id), state}
        else
          snapshot = %{
            deployment_id: deployment.id,
            automata_id: deployment.automata_id,
            device_id: deployment.device_id,
            running: deployment.status == :running,
            current_state: deployment.current_state,
            variables: deployment.variables,
            source: "device_manager_snapshot"
          }

          {:reply, {:ok, snapshot}, state}
        end
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

            append_time_series_event(
              deployment_id,
              "time_travel_rewind_marker",
              %{
                "automata_id" => deployment.automata_id,
                "device_id" => deployment.device_id,
                "rewound_to" => timestamp_ms,
                "state" => replay_state
              }
            )

            snapshot_deployment(new_state, deployment_id, "time_travel_rewind")

            push_to_gateway("deployment_status", %{
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

  defp do_deploy_compiled_automata(compiled, automata_id, device_id, automata, device, state) do
    if local_runtime_device?(device) do
      do_deploy_local_runtime(compiled, automata_id, device_id, automata, state)
    else
      try do
        deployment_id = deployment_id_for(automata_id, device_id)
        run_id = run_id_for_deployment(deployment_id)

        yaml = compiled[:yaml]
        data = compiled[:data]
        state_id_map = compiled[:state_id_map] || %{}
        transition_id_map = compiled[:transition_id_map] || %{}
        profile_id = get_in(compiled, [:profile, :id]) || compiled.profile.id
        diagnostics = compiled[:diagnostics] || %{"warnings" => [], "errors" => []}

        if is_binary(yaml), do: maybe_dump_deploy_yaml(deployment_id, yaml)

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
          error: nil,
          target_profile: profile_id,
          artifact_version_id: nil,
          snapshot_id: nil,
          migration_plan_ref: nil,
          patch_mode: "replace_restart"
        }

        new_state =
          state
          |> retire_device_deployments(device_id, deployment_id)
          |> put_in([:automata_cache, automata_id], automata)
          |> put_in([:deployments, deployment_id], deployment)
          |> put_in([:devices, device_id, :deployed_automata], [automata_id])

        new_state =
          case compiled[:format] do
            :yaml ->
              if is_binary(yaml) do
                case send_chunked_load_automata(
                       new_state,
                       deployment,
                       device,
                       run_id,
                       :yaml,
                       yaml
                     ) do
                  {:ok, sent_state} ->
                    sent_state

                  {:error, reason, failed_state} ->
                    throw({:deploy_abort, {:error, reason}, failed_state})
                end
              else
                throw({:deploy_abort, {:error, :missing_compiled_yaml}, state})
              end

            :aeth_ir_v1 ->
              if is_binary(data) do
                case send_chunked_load_automata(
                       new_state,
                       deployment,
                       device,
                       run_id,
                       :aeth_ir_v1,
                       data
                     ) do
                  {:ok, sent_state} ->
                    sent_state

                  {:error, reason, failed_state} ->
                    throw({:deploy_abort, {:error, reason}, failed_state})
                end
              else
                throw({:deploy_abort, {:error, :missing_compiled_artifact}, state})
              end

            _other ->
              Logger.error(
                "Unsupported compiled deploy format #{inspect(compiled[:format])} for #{device_id}"
              )

              return_error = {:error, {:unsupported_compiled_format, compiled[:format]}}
              throw({:deploy_abort, return_error, state})
          end

        new_state = put_in(new_state, [:deployments, deployment_id, :status], :loading)
        snapshot_deployment(new_state, deployment_id, "deploy_loading")

        if diagnostics["warnings"] != [] do
          push_to_gateway("deployment_validation", %{
            "automata_id" => automata_id,
            "device_id" => device_id,
            "target_profile" => profile_id,
            "diagnostics" => diagnostics
          })
        end

        push_to_gateway("deployment_status", %{
          "deployment_id" => deployment_id,
          "automata_id" => automata_id,
          "device_id" => device_id,
          "status" => "loading",
          "target_profile" => profile_id
        })

        Logger.info("Deploying automata #{automata_id} to device #{device_id} (#{profile_id})")
        {:reply, {:ok, Map.get(new_state.deployments, deployment_id)}, new_state}
      catch
        {:deploy_abort, return_error, return_state} ->
          {:reply, return_error, return_state}
      end
    end
  end

  defp do_deploy_local_runtime(compiled, automata_id, device_id, automata, state) do
    deployment_id = deployment_id_for(automata_id, device_id)
    run_id = run_id_for_deployment(deployment_id)
    state_id_map = compiled[:state_id_map] || %{}
    transition_id_map = compiled[:transition_id_map] || %{}
    profile_id = get_in(compiled, [:profile, :id]) || compiled.profile.id
    diagnostics = compiled[:diagnostics] || %{"warnings" => [], "errors" => []}

    stop_runtime_if_running(deployment_id)

    deployment = %{
      id: deployment_id,
      automata_id: automata_id,
      device_id: device_id,
      run_id: run_id,
      status: :stopped,
      current_state: initial_state_name(automata),
      variables: extract_default_variables(automata),
      state_id_map: state_id_map,
      transition_id_map: transition_id_map,
      deployed_at: System.system_time(:millisecond),
      error: nil,
      target_profile: profile_id,
      artifact_version_id: nil,
      snapshot_id: nil,
      migration_plan_ref: nil,
      patch_mode: "replace_restart"
    }

    with :ok <- start_runtime_process(deployment_id, automata) do
      new_state =
        state
        |> put_in([:automata_cache, automata_id], automata)
        |> put_in([:deployments, deployment_id], deployment)
        |> update_in([:devices, device_id, :deployed_automata], &[automata_id | &1])

      if diagnostics["warnings"] != [] do
        push_to_gateway("deployment_validation", %{
          "automata_id" => automata_id,
          "device_id" => device_id,
          "target_profile" => profile_id,
          "diagnostics" => diagnostics
        })
      end

      push_to_gateway("deployment_status", %{
        "deployment_id" => deployment_id,
        "automata_id" => automata_id,
        "device_id" => device_id,
        "status" => "stopped",
        "current_state" => deployment.current_state,
        "variables" => deployment.variables,
        "target_profile" => profile_id
      })

      snapshot_deployment(new_state, deployment_id, "deploy_local_runtime")

      Logger.info(
        "Deploying automata #{automata_id} to local runtime device #{device_id} (#{profile_id})"
      )

      {:reply, {:ok, deployment}, new_state}
    else
      {:error, reason} ->
        {:reply, {:error, reason}, state}
    end
  end

  defp maybe_dump_deploy_yaml(deployment_id, yaml)
       when is_binary(deployment_id) and is_binary(yaml) do
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
          |> clear_pending_chunk_deploy_for_device(device_id)

        AetheriumServer.ConnectorRegistry.detach_device(device_id)
        persist_device_status(new_state, device_id)
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

        persist_device_status(new_state, device_id)

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
    persist_device_status(state, device_id)
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
          push_to_gateway("state_changed", %{
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

        push_to_gateway("deployment_status", %{
          "deployment_id" => deployment_id,
          "automata_id" => deployment.automata_id,
          "device_id" => deployment.device_id,
          "status" => "running",
          "current_state" => current_state,
          "variables" => variables
        })

        snapshot_deployment(new_state, deployment_id, "runtime_state_update")

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
                |> clear_pending_chunk_deploy_for_device(device_id),
                [device_id | changed_ids]
              }
          end
        else
          {acc, changed_ids}
        end
      end)

    Enum.each(changed_device_ids, &persist_device_status(new_state, &1))

    # Refresh device list in gateway after any heartbeat timeouts
    push_device_list(new_state)

    Process.send_after(self(), :check_heartbeats, state.heartbeat_timeout)
    {:noreply, new_state}
  end

  @impl true
  def handle_info({:chunk_ack_timeout, deployment_id, message_id}, state) do
    case Map.get(state.pending_chunk_deploys, deployment_id) do
      nil ->
        {:noreply, state}

      pending ->
        if pending.phase != :chunk_ack || pending.awaiting_message_id != message_id do
          {:noreply, state}
        else
          if pending.retry_count >= pending.max_retries do
            reason = "chunk_ack_timeout at chunk #{pending.awaiting_chunk_index}"
            new_state = fail_pending_chunk_deploy(state, pending, reason)
            {:noreply, new_state}
          else
            with {:ok, protocol_id, session_ref} <-
                   resolve_device_transport(state, pending.device_id),
                 {:ok, chunk} <- fetch_pending_chunk(pending, pending.awaiting_chunk_index),
                 {:ok, resent_message_id} <-
                   send_message(
                     session_ref,
                     :load_automata,
                     load_chunk_payload(
                       protocol_id,
                       pending.run_id,
                       pending.format,
                       chunk,
                       pending.awaiting_chunk_index,
                       pending.total_chunks
                     )
                   ) do
              timer_ref =
                schedule_chunk_ack_timeout(
                  deployment_id,
                  resent_message_id,
                  pending.chunk_timeout_ms
                )

              updated =
                pending
                |> Map.put(:retry_count, pending.retry_count + 1)
                |> Map.put(:awaiting_message_id, resent_message_id)
                |> Map.put(:timer_ref, timer_ref)

              new_state = put_in(state, [:pending_chunk_deploys, deployment_id], updated)

              emit_transfer_event(updated, "chunk_retry_sent", %{
                "chunk_index" => updated.awaiting_chunk_index,
                "message_id" => resent_message_id
              })

              {:noreply, new_state}
            else
              {:error, reason} ->
                new_state =
                  fail_pending_chunk_deploy(
                    state,
                    pending,
                    "chunk_resend_failed: #{inspect(reason)}"
                  )

                {:noreply, new_state}
            end
          end
        end
    end
  end

  @impl true
  def handle_info({:final_load_ack_timeout, deployment_id, message_id}, state) do
    case Map.get(state.pending_chunk_deploys, deployment_id) do
      nil ->
        {:noreply, state}

      pending ->
        if pending.phase != :load_ack || pending.awaiting_message_id != message_id do
          {:noreply, state}
        else
          if pending.retry_count >= pending.max_retries do
            reason = "final_load_ack_timeout at chunk #{pending.awaiting_chunk_index}"
            new_state = fail_pending_chunk_deploy(state, pending, reason)
            {:noreply, new_state}
          else
            with {:ok, protocol_id, session_ref} <-
                   resolve_device_transport(state, pending.device_id),
                 {:ok, chunk} <- fetch_pending_chunk(pending, pending.awaiting_chunk_index),
                 {:ok, resent_message_id} <-
                   send_message(
                     session_ref,
                     :load_automata,
                     load_chunk_payload(
                       protocol_id,
                       pending.run_id,
                       pending.format,
                       chunk,
                       pending.awaiting_chunk_index,
                       pending.total_chunks
                     )
                   ) do
              timer_ref =
                schedule_final_load_ack_timeout(
                  deployment_id,
                  resent_message_id,
                  pending.final_timeout_ms
                )

              updated =
                pending
                |> Map.put(:retry_count, pending.retry_count + 1)
                |> Map.put(:awaiting_message_id, resent_message_id)
                |> Map.put(:timer_ref, timer_ref)

              new_state = put_in(state, [:pending_chunk_deploys, deployment_id], updated)

              emit_transfer_event(updated, "final_chunk_retry_sent", %{
                "chunk_index" => updated.awaiting_chunk_index,
                "message_id" => resent_message_id
              })

              {:noreply, new_state}
            else
              {:error, reason} ->
                new_state =
                  fail_pending_chunk_deploy(
                    state,
                    pending,
                    "final_chunk_resend_failed: #{inspect(reason)}"
                  )

                {:noreply, new_state}
            end
          end
        end
    end
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
    deployment = find_active_deployment(device_id, payload, state)

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

      snapshot_deployment(new_state, deployment.id, "state_changed")
      new_state
    else
      state
    end
  end

  defp handle_message(device_id, :output, payload, state) do
    %{name: name, value: value} = payload

    deployment = find_active_deployment(device_id, payload, state)

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

      snapshot_deployment(new_state, deployment.id, "variable_updated")
      new_state
    else
      state
    end
  end

  defp handle_message(device_id, :telemetry, payload, state) do
    device = Map.get(state.devices, device_id)
    deployment = find_active_deployment(device_id, payload, state)

    if device do
      persist_device_metrics(device, deployment, payload)

      push_to_gateway("device_alert", %{
        "device_id" => device_id,
        "type" => "metrics",
        "telemetry" => payload,
        "timestamp" => System.system_time(:millisecond)
      })
    end

    state
  end

  defp handle_message(device_id, :status, payload, state) do
    deployment = find_active_deployment(device_id, payload, state)

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

      new_state =
        state
        |> put_in([:deployments, deployment.id, :status], status)
        |> put_in([:deployments, deployment.id, :current_state], current_state)

      push_to_gateway("deployment_status", %{
        "deployment_id" => deployment.id,
        "automata_id" => deployment.automata_id,
        "device_id" => device_id,
        "status" => Atom.to_string(status),
        "current_state" => current_state,
        "variables" => get_in(new_state, [:deployments, deployment.id, :variables]) || %{}
      })

      snapshot_deployment(new_state, deployment.id, "device_status")
      new_state
    else
      state
    end
  end

  defp handle_message(device_id, :transition_fired, payload, state) do
    deployment = find_active_deployment(device_id, payload, state)

    if deployment do
      tid = payload[:transition_id] || payload["transition_id"]
      from = payload[:from] || payload["from"] || deployment.current_state
      to = payload[:to] || payload["to"] || deployment.current_state
      weight = payload[:weight_used] || payload["weight_used"]

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

  defp handle_message(device_id, :ack, payload, state) do
    related_message_id = payload[:related_message_id] || payload["related_message_id"]

    case find_pending_chunk_deploy_by_device_and_message(state, device_id, related_message_id) do
      nil ->
        state

      pending ->
        if pending.phase != :chunk_ack do
          state
        else
          emit_transfer_event(pending, "chunk_acked", %{
            "chunk_index" => pending.awaiting_chunk_index,
            "message_id" => related_message_id
          })

          advance_pending_chunk_deploy(state, pending)
        end
    end
  end

  defp handle_message(device_id, :nak, payload, state) do
    related_message_id = payload[:related_message_id] || payload["related_message_id"]
    reason = payload[:reason] || payload["reason"] || "chunk_nak"

    case find_pending_chunk_deploy_by_device_and_message(state, device_id, related_message_id) do
      nil ->
        state

      pending ->
        fail_pending_chunk_deploy(state, pending, "chunk_nak: #{reason}")
    end
  end

  defp handle_message(device_id, :load_ack, payload, state) do
    run_id = payload[:run_id] || payload["run_id"]
    pending = find_pending_chunk_deploy_by_device_and_run_id(state, device_id, run_id)

    state =
      case pending do
        nil -> state
        pending -> clear_pending_chunk_deploy(state, pending.deployment_id)
      end

    deployment =
      find_deployment_by_device_and_run_id(device_id, run_id, state) ||
        find_active_deployment(device_id, state)

    if deployment do
      success = payload[:success] || payload["success"]
      error_message = payload[:error] || payload["error"] || "load_failed"

      if success do
        Logger.info("Automata loaded on device #{device_id}")

        if pending do
          emit_transfer_event(pending, "completed", %{"success" => true})
        end

        new_state = put_in(state, [:deployments, deployment.id, :status], :stopped)

        push_to_gateway("deployment_status", %{
          "deployment_id" => deployment.id,
          "automata_id" => deployment.automata_id,
          "device_id" => deployment.device_id,
          "status" => "stopped"
        })

        snapshot_deployment(new_state, deployment.id, "load_ack_success")
        new_state
      else
        Logger.error("Automata load failed on device #{device_id}: #{inspect(error_message)}")

        if pending do
          emit_transfer_event(pending, "completed", %{
            "success" => false,
            "error" => error_message
          })
        end

        new_state =
          state
          |> put_in([:deployments, deployment.id, :status], :error)
          |> put_in([:deployments, deployment.id, :error], error_message)

        push_to_gateway("deployment_error", %{
          "deployment_id" => deployment.id,
          "automata_id" => deployment.automata_id,
          "device_id" => deployment.device_id,
          "code" => 13,
          "message" => error_message
        })

        push_to_gateway("deployment_status", %{
          "deployment_id" => deployment.id,
          "automata_id" => deployment.automata_id,
          "device_id" => deployment.device_id,
          "status" => "error",
          "error" => error_message
        })

        snapshot_deployment(new_state, deployment.id, "load_ack_error")
        new_state
      end
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

      snapshot_deployment(new_state, deployment.id, "device_error")
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

  defp find_active_deployment(device_id, payload, state) when is_map(payload) do
    run_id = payload[:run_id] || payload["run_id"]

    case find_deployment_by_device_and_run_id(device_id, run_id, state) do
      nil -> find_active_deployment(device_id, state)
      deployment -> deployment
    end
  end

  defp find_active_deployment(device_id, state) do
    state.deployments
    |> Map.values()
    |> Enum.filter(&(&1.device_id == device_id && &1.status in [:loading, :running, :paused]))
    |> Enum.sort_by(
      fn deployment -> {deployment_priority(deployment.status), deployment.deployed_at || 0} end,
      :desc
    )
    |> List.first()
  end

  defp find_deployment_by_device_and_run_id(device_id, run_id, state) when is_integer(run_id) do
    state.deployments
    |> Map.values()
    |> Enum.find(&(&1.device_id == device_id && &1.run_id == run_id))
  end

  defp find_deployment_by_device_and_run_id(_device_id, _run_id, _state), do: nil

  defp extract_default_variables(automata) do
    variables = automata_variables(automata)

    variables
    |> Enum.map(fn var ->
      name = field(var, :name)
      default = field(var, :default)
      {name, default}
    end)
    |> Enum.reject(fn {name, _default} -> is_nil(name) end)
    |> Enum.into(%{})
  end

  defp automata_variables(automata) when is_map(automata) do
    field(automata, :variables, [])
  end

  defp automata_variables(_), do: []

  defp initial_state_name(automata) do
    states = automata[:states] || automata["states"] || %{}
    explicit =
      automata[:initial_state] ||
        automata["initial_state"] ||
        get_in(automata, [:automata, :initial_state]) ||
        get_in(automata, ["automata", "initial_state"])

    resolve_initial_state_ref(explicit, states) ||
      Enum.find_value(states, fn {key, state} ->
        type = state[:type] || state["type"]
        id = state[:id] || state["id"] || key

        if type in [:initial, "initial"], do: to_string(id), else: nil
      end) ||
      Enum.find_value(states, fn {key, state} ->
        id = state[:id] || state["id"] || key
        if is_nil(id), do: nil, else: to_string(id)
      end)
  end

  defp resolve_initial_state_ref(nil, _states), do: nil

  defp resolve_initial_state_ref(ref, states) do
    states
    |> Enum.find_value(fn {key, state} ->
      id = state[:id] || state["id"] || key
      if to_string(id) == to_string(ref), do: to_string(id), else: nil
    end)
  end

  defp local_runtime_device?(device) when is_map(device) do
    device[:connector_type] == :host_runtime or device[:transport] == "host_runtime"
  end

  defp local_runtime_device?(_), do: false

  defp retire_device_deployments(state, device_id, keep_deployment_id)
       when is_map(state) and is_binary(device_id) and is_binary(keep_deployment_id) do
    state.deployments
    |> Enum.reduce(state, fn
      {deployment_id, deployment}, acc when deployment_id != keep_deployment_id and deployment.device_id == device_id ->
        put_in(acc, [:deployments, deployment_id, :status], :stopped)

      _entry, acc ->
        acc
    end)
  end

  defp field(data, key, default \\ nil) when is_map(data) and is_atom(key) do
    Map.get(data, key, Map.get(data, Atom.to_string(key), default))
  end

  defp start_runtime_process(deployment_id, automata) do
    case DynamicSupervisor.start_child(
           AetheriumServer.RuntimeSupervisor,
           {AetheriumServer.AutomataRuntime, deployment_id: deployment_id, automata: automata}
         ) do
      {:ok, _pid} ->
        :ok

      {:error, {:already_started, _pid}} ->
        :ok

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp stop_runtime_if_running(deployment_id) do
    case Registry.lookup(AetheriumServer.RuntimeRegistry, deployment_id) do
      [{pid, _value}] ->
        DynamicSupervisor.terminate_child(AetheriumServer.RuntimeSupervisor, pid)

      _ ->
        :ok
    end
  end

  defp runtime_registered?(deployment_id) do
    match?([{_pid, _value}], Registry.lookup(AetheriumServer.RuntimeRegistry, deployment_id))
  end

  defp send_message(nil, _type, _payload), do: {:error, :device_not_connected}

  defp send_message(%DeviceSessionRef{} = session_ref, message_type, payload) do
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

        :pause ->
          EngineProtocol.encode(:pause, Map.merge(payload, %{message_id: message_id}))

        :resume ->
          EngineProtocol.encode(:resume, Map.merge(payload, %{message_id: message_id}))

        :reset ->
          EngineProtocol.encode(:reset, Map.merge(payload, %{message_id: message_id}))

        :status ->
          EngineProtocol.encode(:status, Map.merge(payload, %{message_id: message_id}))

        _ ->
          {:error, {:unsupported_message_type, message_type}}
      end

    case bin_result do
      {:ok, binary} ->
        case DeviceConnector.send_frame(session_ref, binary) do
          :ok -> {:ok, message_id}
          {:error, reason} -> {:error, reason}
        end

      {:error, reason} ->
        Logger.error("Failed to encode #{inspect(message_type)}: #{inspect(reason)}")
        {:error, reason}
    end
  end

  defp send_chunked_load_automata(state, deployment, device, run_id, format, data)
       when is_map(state) and is_map(deployment) and is_map(device) and is_binary(data) do
    chunk_size = deploy_chunk_size(device)
    chunks = chunk_binary(data, chunk_size)
    total_chunks = length(chunks)

    cond do
      total_chunks == 0 ->
        {:error, :empty_deploy_payload, state}

      total_chunks > 65_535 ->
        {:error, :deploy_payload_too_large, state}

      true ->
        first_chunk = hd(chunks)

        payload =
          load_chunk_payload(device.protocol_id, run_id, format, first_chunk, 0, total_chunks)

        case send_message(device.session_ref, :load_automata, payload) do
          {:ok, message_id} ->
            chunk_timeout_ms = chunk_ack_timeout_ms()
            final_timeout_ms = final_load_ack_timeout_ms()
            max_retries = chunk_ack_max_retries()

            {phase, next_chunk_index, timer_ref} =
              if total_chunks == 1 do
                {:load_ack, 1,
                 schedule_final_load_ack_timeout(deployment.id, message_id, final_timeout_ms)}
              else
                {:chunk_ack, 1,
                 schedule_chunk_ack_timeout(deployment.id, message_id, chunk_timeout_ms)}
              end

            pending = %{
              deployment_id: deployment.id,
              device_id: deployment.device_id,
              run_id: run_id,
              format: format,
              chunks: chunks,
              total_chunks: total_chunks,
              phase: phase,
              awaiting_chunk_index: 0,
              next_chunk_index: next_chunk_index,
              awaiting_message_id: message_id,
              retry_count: 0,
              max_retries: max_retries,
              chunk_timeout_ms: chunk_timeout_ms,
              final_timeout_ms: final_timeout_ms,
              timer_ref: timer_ref
            }

            new_state = put_in(state, [:pending_chunk_deploys, deployment.id], pending)

            initial_stage =
              if phase == :load_ack do
                "awaiting_load_ack"
              else
                "chunk_sent"
              end

            emit_transfer_event(pending, initial_stage, %{
              "chunk_index" => 0,
              "message_id" => message_id
            })

            {:ok, new_state}

          {:error, reason} ->
            {:error, reason, state}
        end
    end
  end

  defp load_chunk_payload(protocol_id, run_id, format, chunk, chunk_index, total_chunks)
       when is_binary(chunk) do
    %{
      target_id: protocol_id,
      run_id: run_id,
      format: format,
      data: chunk,
      is_chunked: total_chunks > 1,
      chunk_index: chunk_index,
      total_chunks: total_chunks,
      start_after_load: false,
      replace_existing: true
    }
  end

  defp schedule_chunk_ack_timeout(deployment_id, message_id, timeout_ms)
       when is_binary(deployment_id) and is_integer(message_id) and is_integer(timeout_ms) do
    Process.send_after(self(), {:chunk_ack_timeout, deployment_id, message_id}, timeout_ms)
  end

  defp schedule_final_load_ack_timeout(deployment_id, message_id, timeout_ms)
       when is_binary(deployment_id) and is_integer(message_id) and is_integer(timeout_ms) do
    Process.send_after(self(), {:final_load_ack_timeout, deployment_id, message_id}, timeout_ms)
  end

  defp chunk_ack_timeout_ms do
    env_positive_int("AETHERIUM_DEPLOY_CHUNK_ACK_TIMEOUT_MS", @default_chunk_ack_timeout_ms)
  end

  defp final_load_ack_timeout_ms do
    env_positive_int(
      "AETHERIUM_DEPLOY_FINAL_LOAD_ACK_TIMEOUT_MS",
      @default_final_load_ack_timeout_ms
    )
  end

  defp chunk_ack_max_retries do
    env_positive_int("AETHERIUM_DEPLOY_CHUNK_ACK_RETRIES", @default_chunk_ack_retries)
  end

  defp env_positive_int(env_name, default) when is_binary(env_name) and is_integer(default) do
    case System.get_env(env_name) do
      nil ->
        default

      value ->
        case Integer.parse(value) do
          {parsed, _} when parsed > 0 -> parsed
          _ -> default
        end
    end
  end

  defp fetch_pending_chunk(pending, index) when is_map(pending) and is_integer(index) do
    case Enum.at(pending.chunks, index) do
      nil -> {:error, :pending_chunk_not_found}
      chunk -> {:ok, chunk}
    end
  end

  defp find_pending_chunk_deploy_by_device_and_message(state, device_id, message_id)
       when is_integer(message_id) do
    state.pending_chunk_deploys
    |> Map.values()
    |> Enum.find(&(&1.device_id == device_id && &1.awaiting_message_id == message_id))
  end

  defp find_pending_chunk_deploy_by_device_and_message(_state, _device_id, _message_id), do: nil

  defp find_pending_chunk_deploy_by_device_and_run_id(state, device_id, run_id)
       when is_integer(run_id) do
    state.pending_chunk_deploys
    |> Map.values()
    |> Enum.find(&(&1.device_id == device_id && &1.run_id == run_id))
  end

  defp find_pending_chunk_deploy_by_device_and_run_id(_state, _device_id, _run_id), do: nil

  defp clear_pending_chunk_deploy(state, deployment_id) when is_binary(deployment_id) do
    case Map.get(state.pending_chunk_deploys, deployment_id) do
      nil ->
        state

      pending ->
        if pending.timer_ref, do: Process.cancel_timer(pending.timer_ref)
        update_in(state, [:pending_chunk_deploys], &Map.delete(&1, deployment_id))
    end
  end

  defp clear_pending_chunk_deploy_for_device(state, device_id) when is_binary(device_id) do
    state.pending_chunk_deploys
    |> Map.values()
    |> Enum.filter(&(&1.device_id == device_id))
    |> Enum.reduce(state, fn pending, acc ->
      clear_pending_chunk_deploy(acc, pending.deployment_id)
    end)
  end

  defp emit_transfer_event(pending, stage, extra_fields)
       when is_map(pending) and is_binary(stage) and is_map(extra_fields) do
    payload =
      %{
        "deployment_id" => pending.deployment_id,
        "device_id" => pending.device_id,
        "run_id" => pending.run_id,
        "format" => to_string(pending.format),
        "phase" => to_string(pending.phase),
        "stage" => stage,
        "total_chunks" => pending.total_chunks,
        "awaiting_chunk_index" => pending.awaiting_chunk_index,
        "next_chunk_index" => pending.next_chunk_index,
        "retry_count" => pending.retry_count,
        "max_retries" => pending.max_retries
      }
      |> Map.merge(extra_fields)

    push_to_gateway("deployment_transfer", payload)
  end

  defp fail_pending_chunk_deploy(state, pending, error_message)
       when is_map(state) and is_map(pending) do
    emit_transfer_event(pending, "failed", %{"error" => error_message})

    state = clear_pending_chunk_deploy(state, pending.deployment_id)

    deployment = Map.get(state.deployments, pending.deployment_id)

    if deployment do
      Logger.error(
        "Chunked deploy failed for #{deployment.id} on #{deployment.device_id}: #{inspect(error_message)}"
      )

      state
      |> put_in([:deployments, deployment.id, :status], :error)
      |> put_in([:deployments, deployment.id, :error], error_message)
      |> tap(fn updated_state ->
        snapshot_deployment(updated_state, deployment.id, "deploy_transfer_failed")

        push_to_gateway("deployment_error", %{
          "deployment_id" => deployment.id,
          "automata_id" => deployment.automata_id,
          "device_id" => deployment.device_id,
          "code" => 13,
          "message" => error_message
        })

        push_to_gateway("deployment_status", %{
          "deployment_id" => deployment.id,
          "automata_id" => deployment.automata_id,
          "device_id" => deployment.device_id,
          "status" => "error",
          "error" => error_message
        })
      end)
    else
      state
    end
  end

  defp advance_pending_chunk_deploy(state, pending) do
    if pending.timer_ref, do: Process.cancel_timer(pending.timer_ref)

    with {:ok, protocol_id, session_ref} <- resolve_device_transport(state, pending.device_id),
         {:ok, chunk} <- fetch_pending_chunk(pending, pending.next_chunk_index),
         {:ok, message_id} <-
           send_message(
             session_ref,
             :load_automata,
             load_chunk_payload(
               protocol_id,
               pending.run_id,
               pending.format,
               chunk,
               pending.next_chunk_index,
               pending.total_chunks
             )
           ) do
      {phase, timer_ref} =
        if pending.next_chunk_index + 1 < pending.total_chunks do
          {:chunk_ack,
           schedule_chunk_ack_timeout(
             pending.deployment_id,
             message_id,
             pending.chunk_timeout_ms
           )}
        else
          {:load_ack,
           schedule_final_load_ack_timeout(
             pending.deployment_id,
             message_id,
             pending.final_timeout_ms
           )}
        end

      updated =
        pending
        |> Map.put(:phase, phase)
        |> Map.put(:awaiting_chunk_index, pending.next_chunk_index)
        |> Map.put(:next_chunk_index, pending.next_chunk_index + 1)
        |> Map.put(:awaiting_message_id, message_id)
        |> Map.put(:retry_count, 0)
        |> Map.put(:timer_ref, timer_ref)

      new_state = put_in(state, [:pending_chunk_deploys, pending.deployment_id], updated)

      stage =
        if phase == :load_ack do
          "awaiting_load_ack"
        else
          "chunk_sent"
        end

      emit_transfer_event(updated, stage, %{
        "chunk_index" => pending.next_chunk_index,
        "message_id" => message_id
      })

      new_state
    else
      {:error, reason} ->
        fail_pending_chunk_deploy(state, pending, "chunk_send_failed: #{inspect(reason)}")
    end
  end

  defp deploy_chunk_size(device) do
    from_env =
      case System.get_env("AETHERIUM_DEPLOY_CHUNK_SIZE") do
        nil ->
          nil

        value ->
          case Integer.parse(value) do
            {parsed, _} when parsed > 0 -> parsed
            _ -> nil
          end
      end

    default_size =
      case device[:connector_type] do
        :serial -> 1024
        _ -> 16_384
      end

    (from_env || default_size)
    |> min(65_509)
    |> max(1)
  end

  defp chunk_binary(data, chunk_size) when is_binary(data) and chunk_size > 0 do
    do_chunk_binary(data, chunk_size, [])
  end

  defp do_chunk_binary(<<>>, _chunk_size, acc), do: Enum.reverse(acc)

  defp do_chunk_binary(data, chunk_size, acc) when byte_size(data) <= chunk_size do
    Enum.reverse([data | acc])
  end

  defp do_chunk_binary(data, chunk_size, acc) do
    <<chunk::binary-size(chunk_size), rest::binary>> = data
    do_chunk_binary(rest, chunk_size, [chunk | acc])
  end

  defp push_to_gateway(event, payload) when is_binary(event) and is_map(payload) do
    maybe_record_time_series_event(event, payload)
    AetheriumServer.GatewayConnection.push(event, payload)
  end

  defp maybe_record_time_series_event(event, payload) when is_binary(event) and is_map(payload) do
    case payload["deployment_id"] || payload[:deployment_id] do
      deployment_id when is_binary(deployment_id) and deployment_id != "" ->
        append_time_series_event(deployment_id, event, payload)

      _ ->
        :ok
    end
  end

  defp append_time_series_event(deployment_id, event_name, payload)
       when is_binary(deployment_id) and is_binary(event_name) and is_map(payload) do
    _ =
      TimeSeriesStore.append_event(%{
        "deployment_id" => deployment_id,
        "event" => event_name,
        "payload" => stringify_keys(payload),
        "timestamp" => System.system_time(:millisecond)
      })

    :ok
  end

  defp snapshot_deployment(state, deployment_id, reason)
       when is_map(state) and is_binary(deployment_id) and is_binary(reason) do
    case Map.get(state.deployments, deployment_id) do
      nil ->
        :ok

      deployment ->
        state_payload = %{
          "deployment_id" => deployment.id,
          "automata_id" => deployment.automata_id,
          "device_id" => deployment.device_id,
          "status" => Atom.to_string(deployment.status),
          "current_state" => deployment.current_state,
          "variables" => deployment.variables || %{},
          "error" => deployment.error
        }

        _ =
          TimeSeriesStore.append_snapshot(%{
            "deployment_id" => deployment.id,
            "reason" => reason,
            "state" => state_payload,
            "timestamp" => System.system_time(:millisecond)
          })

        :ok
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

  defp persist_device_status(state, device_id)
       when is_map(state) and is_binary(device_id) do
    case Map.get(state.devices, device_id) do
      nil ->
        :ok

      device ->
        deployment = latest_device_deployment(device_id, state)

        TimeSeriesInfluxSink.append_device_status(%{
          "device_id" => device.id,
          "server_id" => configured_server_id(),
          "connector_type" => normalize_dimension(device.connector_type),
          "transport" => normalize_dimension(device.transport),
          "status" => normalize_dimension(device.status),
          "last_seen_at" => device.last_heartbeat,
          "connected_at" => device.connected_at,
          "has_session" => match?(%DeviceSessionRef{}, device.session_ref),
          "deployment_id" => deployment && deployment.id,
          "automata_id" => deployment && deployment.automata_id,
          "deployment_status" => deployment && Atom.to_string(deployment.status),
          "current_state" => deployment && deployment.current_state,
          "error" => deployment && deployment.error,
          "link" => device.link,
          "timestamp" => System.system_time(:millisecond)
        })
    end
  end

  defp persist_device_metrics(device, deployment, payload)
       when is_map(device) and is_map(payload) do
    telemetry_timestamp =
      payload[:timestamp] || payload["timestamp"] || System.system_time(:millisecond)

    TimeSeriesInfluxSink.append_device_metrics(%{
      "device_id" => device.id,
      "deployment_id" => deployment && deployment.id,
      "automata_id" => deployment && deployment.automata_id,
      "server_id" => configured_server_id(),
      "connector_type" => normalize_dimension(device.connector_type),
      "transport" => normalize_dimension(device.transport),
      "cpu_usage" => payload[:cpu_usage] || payload["cpu_usage"] || 0.0,
      "heap_free" => payload[:heap_free] || payload["heap_free"] || 0,
      "heap_total" => payload[:heap_total] || payload["heap_total"] || 0,
      "tick_rate" => payload[:tick_rate] || payload["tick_rate"] || 0,
      "run_id" => payload[:run_id] || payload["run_id"] || 0,
      "source_id" => payload[:source_id] || payload["source_id"] || 0,
      "message_id" => payload[:message_id] || payload["message_id"] || 0,
      "telemetry_timestamp_ms" => telemetry_timestamp,
      "received_at_ms" => System.system_time(:millisecond),
      "variable_count" => telemetry_variable_count(payload),
      "timestamp" => telemetry_timestamp
    })
  end

  defp latest_device_deployment(device_id, state) do
    state.deployments
    |> Map.values()
    |> Enum.filter(&(&1.device_id == device_id))
    |> Enum.sort_by(
      fn deployment -> {deployment_priority(deployment.status), deployment.deployed_at} end,
      :desc
    )
    |> List.first()
  end

  defp deployment_priority(status) when status in [:running, :paused, :loading], do: 2
  defp deployment_priority(status) when status in [:stopped, :pending], do: 1
  defp deployment_priority(:error), do: 0
  defp deployment_priority(_status), do: 0

  defp telemetry_variable_count(payload) when is_map(payload) do
    case payload[:variables] || payload["variables"] do
      variables when is_list(variables) -> length(variables)
      _ -> 0
    end
  end

  defp configured_server_id do
    :aetherium_server
    |> Application.get_env(:gateway, [])
    |> Keyword.get(:server_id, "srv_01")
  end

  defp normalize_dimension(value) when is_atom(value), do: Atom.to_string(value)
  defp normalize_dimension(value) when is_binary(value) and value != "", do: value
  defp normalize_dimension(_value), do: "unknown"

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
          supported_commands: supported_commands_for_device(d)
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

  defp resolve_device_transport(state, device_id) do
    case Map.get(state.devices, device_id) do
      %{session_ref: %DeviceSessionRef{} = session_ref, protocol_id: protocol_id} ->
        {:ok, protocol_id, session_ref}

      nil ->
        {:error, :device_not_found}

      _ ->
        {:error, :device_not_connected}
    end
  end

  defp supported_commands_for_device(_device) do
    [
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
  end

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
