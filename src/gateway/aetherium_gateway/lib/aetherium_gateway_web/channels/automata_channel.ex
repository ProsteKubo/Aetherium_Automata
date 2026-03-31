defmodule AetheriumGatewayWeb.AutomataChannel do
  @moduledoc """
  WebSocket channel for automata management operations.
  """
  use AetheriumGatewayWeb, :channel

  alias AetheriumGateway.Auth
  alias AetheriumGateway.AutomataRegistry
  alias AetheriumGateway.CommandDispatcher
  alias AetheriumGateway.CommandEnvelope
  alias AetheriumGateway.ConnectionManager
  alias AetheriumGateway.Persistence

  @impl true
  def join("automata:control", payload, socket) do
    token = payload["token"] || socket.assigns[:token]

    case Auth.authorize(:operator, token) do
      {:ok, claims} ->
        socket =
          socket
          |> assign(:session_id, generate_session_id())
          |> assign(:auth_claims, claims)

        send(self(), :send_initial_state)
        {:ok, %{status: "connected"}, socket}

      {:error, reason} ->
        {:error, %{reason: to_string(reason)}}
    end
  end

  @impl true
  def handle_in("create_automata", payload, socket) do
    with_command("create_automata", payload, socket, fn _envelope ->
      automata = normalize_automata(payload)

      case AutomataRegistry.register_automata(automata) do
        :ok -> {:ok, %{"automata_id" => automata.id, "status" => "created"}}
        {:error, reason} -> {:error, reason, %{}}
      end
    end)
  end

  @impl true
  def handle_in("update_automata", %{"id" => automata_id} = payload, socket) do
    with_command("update_automata", payload, socket, fn _envelope ->
      updates = Map.drop(payload, ["id"]) |> normalize_updates()

      case AutomataRegistry.update_automata(automata_id, updates) do
        :ok -> {:ok, %{"status" => "updated"}}
        {:error, reason} -> {:error, reason, %{}}
      end
    end)
  end

  @impl true
  def handle_in("get_automata", %{"id" => automata_id}, socket) do
    case AutomataRegistry.get_automata(automata_id) do
      {:ok, automata} ->
        {:reply, {:ok, %{automata: serialize_automata(automata)}}, socket}

      {:error, :not_found} ->
        {:reply, {:error, %{reason: "not_found"}}, socket}
    end
  end

  @impl true
  def handle_in("list_automata", _payload, socket) do
    automata = AutomataRegistry.list_automata()
    {:reply, {:ok, %{automata: Enum.map(automata, &serialize_automata/1)}}, socket}
  end

  @impl true
  def handle_in("delete_automata", %{"id" => automata_id} = payload, socket) do
    with_command("delete_automata", payload, socket, fn _envelope ->
      case AutomataRegistry.delete_automata(automata_id) do
        :ok -> {:ok, %{"status" => "deleted"}}
        {:error, reason} -> {:error, reason, %{}}
      end
    end)
  end

  @impl true
  def handle_in(
        "deploy",
        %{"automata_id" => automata_id, "device_id" => device_id, "server_id" => server_id} =
          payload,
        socket
      ) do
    with_command("deploy", payload, socket, fn envelope ->
      case deploy_with_optional_registration(
             automata_id,
             device_id,
             server_id,
             payload["automata"],
             envelope
           ) do
        {:ok, deployment} -> {:ok, %{"deployment" => serialize_deployment(deployment)}}
        {:nak, reason, data} -> {:nak, reason, data}
        {:error, reason} -> {:error, reason, %{}}
      end
    end)
  end

  @impl true
  def handle_in("stop", %{"device_id" => device_id} = payload, socket) do
    handle_in("stop_execution", %{"device_id" => device_id} |> Map.merge(payload), socket)
  end

  @impl true
  def handle_in("stop_execution", %{"device_id" => device_id} = payload, socket) do
    with_command("stop_execution", payload, socket, fn envelope ->
      case resolve_device_deployment(device_id, payload) do
        {:ok, deployment} ->
          AutomataRegistry.update_deployment_status(
            deployment.automata_id,
            device_id,
            :stopped,
            %{}
          )

          command_payload = %{
            "deployment_id" => deployment_id_for(deployment),
            "device_id" => device_id,
            "automata_id" => deployment.automata_id
          }

          dispatch_server_command(
            deployment.server_id,
            "stop_automata",
            command_payload,
            envelope
          )

        {:error, :not_found} ->
          {:nak, :no_deployment_found, %{"device_id" => device_id}}
      end
    end)
  end

  @impl true
  def handle_in("start_execution", %{"device_id" => device_id} = payload, socket) do
    with_command("start_execution", payload, socket, fn envelope ->
      case resolve_device_deployment(device_id, payload) do
        {:ok, deployment} ->
          command_payload = %{
            "deployment_id" => deployment_id_for(deployment),
            "device_id" => device_id,
            "automata_id" => deployment.automata_id
          }

          dispatch_server_command(
            deployment.server_id,
            "start_automata",
            command_payload,
            envelope
          )

        {:error, :not_found} ->
          {:nak, :no_deployment_found, %{"device_id" => device_id}}
      end
    end)
  end

  @impl true
  def handle_in("pause_execution", %{"device_id" => device_id} = payload, socket) do
    with_command("pause_execution", payload, socket, fn envelope ->
      case resolve_device_deployment(device_id, payload) do
        {:ok, deployment} ->
          command_payload = %{
            "deployment_id" => deployment_id_for(deployment),
            "device_id" => device_id,
            "automata_id" => deployment.automata_id
          }

          dispatch_server_command(
            deployment.server_id,
            "pause_automata",
            command_payload,
            envelope
          )

        {:error, :not_found} ->
          {:nak, :no_deployment_found, %{"device_id" => device_id}}
      end
    end)
  end

  @impl true
  def handle_in("resume_execution", %{"device_id" => device_id} = payload, socket) do
    with_command("resume_execution", payload, socket, fn envelope ->
      case resolve_device_deployment(device_id, payload) do
        {:ok, deployment} ->
          command_payload = %{
            "deployment_id" => deployment_id_for(deployment),
            "device_id" => device_id,
            "automata_id" => deployment.automata_id
          }

          dispatch_server_command(
            deployment.server_id,
            "resume_automata",
            command_payload,
            envelope
          )

        {:error, :not_found} ->
          {:nak, :no_deployment_found, %{"device_id" => device_id}}
      end
    end)
  end

  @impl true
  def handle_in("reset_execution", %{"device_id" => device_id} = payload, socket) do
    with_command("reset_execution", payload, socket, fn envelope ->
      case resolve_device_deployment(device_id, payload) do
        {:ok, deployment} ->
          command_payload = %{
            "deployment_id" => deployment_id_for(deployment),
            "device_id" => device_id,
            "automata_id" => deployment.automata_id
          }

          dispatch_server_command(
            deployment.server_id,
            "reset_automata",
            command_payload,
            envelope
          )

        {:error, :not_found} ->
          {:nak, :no_deployment_found, %{"device_id" => device_id}}
      end
    end)
  end

  @impl true
  def handle_in("request_state", %{"device_id" => device_id} = payload, socket) do
    with_command("request_state", payload, socket, fn envelope ->
      case resolve_device_deployment(device_id, payload) do
        {:ok, deployment} ->
          command_payload = %{
            "deployment_id" => deployment_id_for(deployment),
            "device_id" => device_id,
            "automata_id" => deployment.automata_id
          }

          dispatch_server_command(
            deployment.server_id,
            "request_state",
            command_payload,
            envelope
          )

        {:error, :not_found} ->
          {:nak, :no_deployment_found, %{"device_id" => device_id}}
      end
    end)
  end

  @impl true
  def handle_in("time_travel_query", %{"device_id" => device_id} = payload, socket) do
    with_command("time_travel_query", payload, socket, fn envelope ->
      case resolve_device_deployment(device_id, payload) do
        {:ok, deployment} ->
          command_payload =
            %{
              "deployment_id" => deployment_id_for(deployment),
              "device_id" => device_id,
              "automata_id" => deployment.automata_id
            }
            |> maybe_put_payload("after_ts", payload["after_ts"] || payload["from_ts"])
            |> maybe_put_payload("before_ts", payload["before_ts"] || payload["to_ts"])
            |> maybe_put_payload("limit", payload["limit"])

          dispatch_server_command(
            deployment.server_id,
            "time_travel_query",
            command_payload,
            envelope
          )

        {:error, :not_found} ->
          {:nak, :no_deployment_found, %{"device_id" => device_id}}
      end
    end)
  end

  @impl true
  def handle_in("rewind_deployment", %{"device_id" => device_id} = payload, socket) do
    with_command("rewind_deployment", payload, socket, fn envelope ->
      case resolve_device_deployment(device_id, payload) do
        {:ok, deployment} ->
          target_timestamp =
            payload["target_timestamp"] || payload["target_ts"] || payload["timestamp"]

          if is_nil(target_timestamp) do
            {:nak, :invalid_payload, %{"reason" => "missing_target_timestamp"}}
          else
            command_payload = %{
              "deployment_id" => deployment_id_for(deployment),
              "device_id" => device_id,
              "automata_id" => deployment.automata_id,
              "target_timestamp" => target_timestamp
            }

            dispatch_server_command(
              deployment.server_id,
              "rewind_deployment",
              command_payload,
              envelope
            )
          end

        {:error, :not_found} ->
          {:nak, :no_deployment_found, %{"device_id" => device_id}}
      end
    end)
  end

  @impl true
  def handle_in("step_execution", payload, socket) do
    with_command("step_execution", payload, socket, fn _envelope ->
      {:nak, :unsupported_by_engine_protocol, %{}}
    end)
  end

  @impl true
  def handle_in("list_deployments", _payload, socket) do
    deployments = AutomataRegistry.list_deployments()
    {:reply, {:ok, %{deployments: Enum.map(deployments, &serialize_deployment/1)}}, socket}
  end

  @impl true
  def handle_in("get_deployment", %{"device_id" => device_id}, socket) do
    case resolve_device_deployment(device_id, %{}) do
      {:ok, deployment} ->
        {:reply, {:ok, %{deployment: serialize_deployment(deployment)}}, socket}

      {:error, :not_found} ->
        {:reply, {:error, %{reason: "not_found"}}, socket}
    end
  end

  @impl true
  def handle_in("create_connection", payload, socket) do
    with_command("create_connection", payload, socket, fn _envelope ->
      connection = %{
        source_automata: payload["source_automata_id"],
        source_output: payload["source_output"],
        target_automata: payload["target_automata_id"],
        target_input: payload["target_input"],
        transform: payload["transform"],
        enabled: payload["enabled"] != false,
        binding_type: parse_binding_type(payload["binding_type"])
      }

      case ConnectionManager.create_connection(connection) do
        {:ok, created} -> {:ok, %{"connection_id" => created.id, "status" => "created"}}
        {:error, reason} -> {:error, reason, %{}}
      end
    end)
  end

  @impl true
  def handle_in("delete_connection", %{"id" => connection_id} = payload, socket) do
    with_command("delete_connection", payload, socket, fn _envelope ->
      case ConnectionManager.delete_connection(connection_id) do
        :ok -> {:ok, %{"status" => "deleted"}}
        {:error, reason} -> {:error, reason, %{}}
      end
    end)
  end

  @impl true
  def handle_in("list_connections", _payload, socket) do
    connections = ConnectionManager.list_connections()
    {:reply, {:ok, %{connections: connections}}, socket}
  end

  @impl true
  def handle_in("get_automata_connections", %{"automata_id" => automata_id}, socket) do
    incoming = ConnectionManager.get_incoming_connections(automata_id)
    outgoing = ConnectionManager.get_outgoing_connections(automata_id)
    {:reply, {:ok, %{incoming: incoming, outgoing: outgoing}}, socket}
  end

  @impl true
  def handle_in(
        "set_variable",
        %{"device_id" => device_id, "name" => name, "value" => value} = payload,
        socket
      ) do
    with_command("set_variable", payload, socket, fn envelope ->
      case resolve_device_deployment(device_id, payload) do
        {:ok, deployment} ->
          command_payload = %{
            "deployment_id" => deployment_id_for(deployment),
            "device_id" => device_id,
            "automata_id" => deployment.automata_id,
            "input" => name,
            "value" => value
          }

          dispatch_server_command(deployment.server_id, "set_input", command_payload, envelope)

        {:error, :not_found} ->
          {:nak, :no_deployment_found, %{"device_id" => device_id}}
      end
    end)
  end

  @impl true
  def handle_in("get_variables", %{"device_id" => device_id} = payload, socket) do
    case resolve_device_deployment(device_id, payload) do
      {:ok, deployment} ->
        {:reply, {:ok, %{variables: deployment.variables}}, socket}

      {:error, :not_found} ->
        {:reply, {:error, %{reason: "not_found"}}, socket}
    end
  end

  @impl true
  def handle_in("get_transition_history", %{"device_id" => device_id} = payload, socket) do
    limit = payload["limit"] |> to_int(100)
    history = AutomataRegistry.get_transition_history(device_id, limit)
    {:reply, {:ok, %{history: history}}, socket}
  end

  @impl true
  def handle_in(
        "get_transition_stats",
        %{"automata_id" => automata_id, "from_state" => from_state},
        socket
      ) do
    stats = AutomataRegistry.get_transition_stats(automata_id, from_state)
    {:reply, {:ok, %{stats: stats}}, socket}
  end

  @impl true
  def handle_in("trigger_event", %{"device_id" => device_id, "event" => event} = payload, socket) do
    with_command("trigger_event", payload, socket, fn envelope ->
      case resolve_device_deployment(device_id, payload) do
        {:ok, deployment} ->
          command_payload = %{
            "deployment_id" => deployment_id_for(deployment),
            "device_id" => device_id,
            "automata_id" => deployment.automata_id,
            "event" => event,
            "data" => payload["data"]
          }

          dispatch_server_command(
            deployment.server_id,
            "trigger_event",
            command_payload,
            envelope
          )

        {:error, :not_found} ->
          {:nak, :no_deployment_found, %{"device_id" => device_id}}
      end
    end)
  end

  @impl true
  def handle_in(
        "force_transition",
        %{"device_id" => device_id, "to_state" => to_state} = payload,
        socket
      ) do
    with_command("force_transition", payload, socket, fn envelope ->
      case resolve_device_deployment(device_id, payload) do
        {:ok, deployment} ->
          command_payload = %{
            "deployment_id" => deployment_id_for(deployment),
            "device_id" => device_id,
            "automata_id" => deployment.automata_id,
            "state_id" => to_state
          }

          dispatch_server_command(deployment.server_id, "force_state", command_payload, envelope)

        {:error, :not_found} ->
          {:nak, :no_deployment_found, %{"device_id" => device_id}}
      end
    end)
  end

  @impl true
  def handle_info(:send_initial_state, socket) do
    automata = AutomataRegistry.list_automata()
    push(socket, "automata_list", %{automata: Enum.map(automata, &serialize_automata/1)})

    deployments =
      AutomataRegistry.list_deployments()
      |> Enum.filter(&live_deployment?/1)

    push(socket, "deployment_list", %{deployments: Enum.map(deployments, &serialize_deployment/1)})

    connections = ConnectionManager.list_connections()
    push(socket, "connection_list", %{connections: connections})

    {:noreply, socket}
  end

  defp with_command(command_type, payload, socket, fun) do
    actor = actor_for_socket(socket)

    case CommandEnvelope.from_payload(command_type, payload, actor) do
      {:ok, envelope} ->
        dedupe_key = CommandEnvelope.dedupe_key(envelope)

        case Persistence.fetch_command(dedupe_key) do
          {:ok, cached} ->
            replay = cached |> stringify_keys() |> Map.put("replayed", true)
            {:reply, {:ok, replay}, socket}

          :not_found ->
            {reply_kind, response} = execute_command_fun(envelope, fun)
            Persistence.record_command(dedupe_key, response)

            Persistence.append_event(%{
              kind: "gateway_command",
              source: "automata_channel",
              data: response
            })

            case reply_kind do
              :ok -> {:reply, {:ok, response}, socket}
              :error -> {:reply, {:error, response}, socket}
            end
        end

      {:error, reason} ->
        {:reply, {:error, %{status: "ERROR", reason: format_reason(reason)}}, socket}
    end
  end

  defp execute_command_fun(envelope, fun) do
    case fun.(envelope) do
      {:ok, data} ->
        response = %{
          "status" => "ACK",
          "result" => stringify_keys(data),
          "outcome" => CommandEnvelope.outcome(envelope, "ACK", data)
        }

        {:ok, response}

      {:nak, reason, data} ->
        response = %{
          "status" => "NAK",
          "reason" => format_reason(reason),
          "result" => stringify_keys(data),
          "outcome" =>
            CommandEnvelope.outcome(envelope, "NAK", %{"reason" => format_reason(reason)})
        }

        {:ok, response}

      {:error, reason, data} ->
        response = %{
          "status" => "ERROR",
          "reason" => format_reason(reason),
          "result" => stringify_keys(data),
          "outcome" =>
            CommandEnvelope.outcome(envelope, "ERROR", %{"reason" => format_reason(reason)})
        }

        {:error, response}

      {:error, reason} ->
        response = %{
          "status" => "ERROR",
          "reason" => format_reason(reason),
          "result" => %{},
          "outcome" =>
            CommandEnvelope.outcome(envelope, "ERROR", %{"reason" => format_reason(reason)})
        }

        {:error, response}
    end
  end

  defp dispatch_server_command(server_id, event, payload, envelope)
       when is_binary(server_id) and is_binary(event) and is_map(payload) and is_map(envelope) do
    CommandDispatcher.dispatch(server_id, event, payload, envelope)
    {:ok, %{"status" => "sent"}}
  end

  defp dispatch_server_command(_server_id, _event, _payload, _envelope) do
    {:nak, :server_not_found, %{}}
  end

  defp resolve_device_deployment(device_id, payload) do
    opts =
      []
      |> maybe_put_opt(:automata_id, payload["automata_id"])
      |> maybe_put_opt(:server_id, payload["server_id"])

    case AutomataRegistry.get_device_deployment(device_id, opts) do
      {:ok, deployment} ->
        {:ok, deployment}

      {:error, :not_found} when opts != [] ->
        # Frontend metadata can briefly drift (eg reconnect/device list refresh).
        # Fall back to best deployment by device to keep control commands routable.
        AutomataRegistry.get_device_deployment(device_id)

      {:error, :not_found} ->
        {:error, :not_found}
    end
  end

  defp maybe_put_opt(opts, _key, nil), do: opts
  defp maybe_put_opt(opts, _key, ""), do: opts
  defp maybe_put_opt(opts, key, value), do: Keyword.put(opts, key, value)

  defp maybe_put_payload(payload, _key, nil), do: payload
  defp maybe_put_payload(payload, _key, ""), do: payload
  defp maybe_put_payload(payload, key, value), do: Map.put(payload, key, value)

  defp deployment_id_for(deployment) do
    "#{deployment.automata_id}:#{deployment.device_id}"
  end

  defp actor_for_socket(socket) do
    %{
      "role" => "operator",
      "session_id" => socket.assigns[:session_id] || "unknown",
      "source" => "automata_channel",
      "claims" => stringify_keys(socket.assigns[:auth_claims] || %{})
    }
  end

  defp generate_session_id do
    :crypto.strong_rand_bytes(16) |> Base.encode16(case: :lower)
  end

  defp generate_id(prefix) do
    "#{prefix}_#{:crypto.strong_rand_bytes(8) |> Base.encode16(case: :lower)}"
  end

  defp normalize_automata(payload) do
    %{
      id: payload["id"] || generate_id("aut"),
      name: payload["name"],
      description: payload["description"],
      version: payload["version"] || "1.0.0",
      initial_state:
        payload["initial_state"] || payload["initialState"] ||
          get_in(payload, ["automata", "initial_state"]),
      states: normalize_states(payload["states"] || %{}),
      transitions: normalize_transitions(payload["transitions"] || %{}),
      variables: normalize_variables(payload["variables"] || []),
      inputs: payload["inputs"] || [],
      outputs: payload["outputs"] || []
    }
  end

  defp deploy_with_optional_registration(
         automata_id,
         device_id,
         server_id,
         automata_payload,
         envelope
       ) do
    with {:ok, automata} <- ensure_automata_available(automata_id, automata_payload),
         {:ok, deployment} <-
           AutomataRegistry.deploy_automata(automata_id, device_id, server_id, dispatch: false),
         {:ok, _response} <-
           dispatch_server_command(
             server_id,
             "deploy_automata",
             %{
               "automata_id" => automata_id,
               "device_id" => device_id,
               "automata" => automata
             },
             envelope
           ) do
      {:ok, deployment}
    else
      {:nak, reason, data} -> {:nak, reason, data}
      {:error, reason} -> {:error, reason}
    end
  end

  defp ensure_automata_available(automata_id, automata_payload) do
    case AutomataRegistry.get_automata(automata_id) do
      {:ok, automata} -> {:ok, automata}
      {:error, :not_found} -> register_automata_from_payload(automata_id, automata_payload)
      {:error, reason} -> {:error, reason}
    end
  end

  defp register_automata_from_payload(_automata_id, nil), do: {:error, :automata_not_found}

  defp register_automata_from_payload(automata_id, automata_payload)
       when is_map(automata_payload) do
    normalized =
      automata_payload
      |> to_gateway_automata(automata_id)
      |> normalize_automata()

    case AutomataRegistry.register_automata(normalized) do
      :ok ->
        {:ok, normalized}

      {:error, :already_exists} ->
        {:ok, normalized}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp register_automata_from_payload(_automata_id, _payload),
    do: {:error, :invalid_automata_payload}

  defp to_gateway_automata(payload, automata_id) when is_map(payload) do
    cfg = payload["config"] || %{}
    nested = payload["automata"] || %{}

    %{
      "id" => payload["id"] || automata_id,
      "name" => payload["name"] || cfg["name"] || automata_id,
      "description" => payload["description"] || cfg["description"],
      "version" => payload["version"] || cfg["version"] || "1.0.0",
      "initial_state" =>
        payload["initial_state"] || payload["initialState"] || nested["initial_state"],
      "states" => payload["states"] || nested["states"] || %{},
      "transitions" => payload["transitions"] || nested["transitions"] || %{},
      "variables" => payload["variables"] || [],
      "inputs" => payload["inputs"] || [],
      "outputs" => payload["outputs"] || []
    }
  end

  defp normalize_states(states) when is_map(states) do
    states
    |> Enum.map(fn {id, state} ->
      hooks = field(state, :hooks, %{})

      {id,
       %{
         id: id,
         name: field(state, :name, id),
         type: parse_state_type(field(state, :type)),
         on_enter:
           field(state, :on_enter) ||
             field(hooks, :on_enter) ||
             field(hooks, :onEnter),
         on_exit:
           field(state, :on_exit) ||
             field(hooks, :on_exit) ||
             field(hooks, :onExit),
         on_tick:
           field(state, :on_tick) ||
             field(hooks, :on_tick) ||
             field(hooks, :onTick),
         code: field(state, :code)
       }}
    end)
    |> Enum.into(%{})
  end

  defp normalize_transitions(transitions) when is_map(transitions) do
    transitions
    |> Enum.map(fn {id, trans} ->
      {id,
       %{
         id: id,
         from: field(trans, :from),
         to: field(trans, :to),
         type: parse_transition_type(field(trans, :type)),
         condition: field(trans, :condition),
         priority: to_int(field(trans, :priority), 0),
         weight: field(trans, :weight),
         timed: normalize_timed_config(field(trans, :timed), trans),
         event: normalize_event_config(field(trans, :event))
       }}
    end)
    |> Enum.into(%{})
  end

  defp normalize_variables(variables) when is_list(variables) do
    Enum.map(variables, fn var ->
      %{
        id: var["id"] || generate_id("var"),
        name: var["name"],
        type: var["type"] || "int",
        direction: parse_direction(var["direction"]),
        default: var["default"]
      }
    end)
  end

  defp normalize_timed_config(config, transition)

  defp normalize_timed_config(nil, transition) do
    normalize_timed_config(%{}, transition)
  end

  defp normalize_timed_config(config, transition) when is_map(config) and is_map(transition) do
    delay_ms_value =
      first_present(config, [:delay_ms, "delay_ms", :delayMs, "delayMs"]) ||
        first_present(transition, [:delay_ms, "delay_ms", :delayMs, "delayMs"])

    after_value =
      first_present(config, [:after, "after"]) ||
        first_present(transition, [:after, "after"])

    jitter =
      first_present(config, [:jitter_ms, "jitter_ms", :jitterMs, "jitterMs"]) ||
        first_present(transition, [:jitter_ms, "jitter_ms", :jitterMs, "jitterMs"])

    mode =
      first_present(config, [:mode, "mode"]) ||
        first_present(transition, [:mode, "mode"])

    repeat_count =
      first_present(config, [:repeat_count, "repeat_count", :repeatCount, "repeatCount"]) ||
        first_present(transition, [:repeat_count, "repeat_count", :repeatCount, "repeatCount"])

    window_end_ms_value =
      first_present(config, [
        :window_end_ms,
        "window_end_ms",
        :windowEndMs,
        "windowEndMs"
      ]) ||
        first_present(transition, [
          :window_end_ms,
          "window_end_ms",
          :windowEndMs,
          "windowEndMs"
        ])

    window_end_value =
      first_present(config, [
        :window_end,
        "window_end"
      ]) ||
        first_present(transition, [
          :window_end,
          "window_end"
        ])

    absolute_time =
      first_present(config, [
        :absolute_time_ms,
        "absolute_time_ms",
        :absoluteTimeMs,
        "absoluteTimeMs",
        :at_ms,
        "at_ms"
      ]) ||
        first_present(transition, [
          :absolute_time_ms,
          "absolute_time_ms",
          :absoluteTimeMs,
          "absoluteTimeMs",
          :at_ms,
          "at_ms"
        ])

    additional_condition =
      first_present(config, [
        :additional_condition,
        "additional_condition",
        :additionalCondition,
        "additionalCondition",
        :condition,
        "condition"
      ]) ||
        first_present(transition, [
          :additional_condition,
          "additional_condition",
          :additionalCondition,
          "additionalCondition"
        ])

    has_timed_fields =
      not is_nil(delay_ms_value) or
        not is_nil(after_value) or
        not is_nil(jitter) or
        not is_nil(mode) or
        not is_nil(repeat_count) or
        not is_nil(window_end_ms_value) or
        not is_nil(window_end_value) or
        not is_nil(absolute_time) or
        not is_nil(additional_condition)

    if has_timed_fields do
      %{
        mode: parse_timed_mode(mode),
        delay_ms:
          cond do
            not is_nil(delay_ms_value) -> parse_duration_ms(delay_ms_value, 0, :milliseconds)
            true -> parse_duration_ms(after_value, 0, :seconds)
          end,
        jitter_ms: parse_duration_ms(jitter, 0),
        repeat_count: to_int(repeat_count, 0),
        window_end_ms:
          cond do
            not is_nil(window_end_ms_value) ->
              parse_duration_ms(window_end_ms_value, 0, :milliseconds)

            true ->
              parse_duration_ms(window_end_value, 0, :seconds)
          end,
        absolute_time_ms: parse_duration_ms(absolute_time, 0),
        additional_condition: additional_condition
      }
    else
      nil
    end
  end

  defp normalize_timed_config(_config, _transition), do: nil

  defp normalize_event_config(nil), do: nil

  defp normalize_event_config(config) do
    %{
      triggers: config["triggers"] || [],
      require_all: config["require_all"] || config["requireAll"] || false,
      debounce_ms: to_int(config["debounce_ms"] || config["debounceMs"], 0)
    }
  end

  defp normalize_updates(updates) do
    updates
    |> Enum.reduce(%{}, fn
      {"states", states}, acc ->
        Map.put(acc, :states, normalize_states(states))

      {"transitions", transitions}, acc ->
        Map.put(acc, :transitions, normalize_transitions(transitions))

      {"variables", vars}, acc ->
        Map.put(acc, :variables, normalize_variables(vars))

      {"name", value}, acc ->
        Map.put(acc, :name, value)

      {"description", value}, acc ->
        Map.put(acc, :description, value)

      {"version", value}, acc ->
        Map.put(acc, :version, value)

      {"inputs", value}, acc ->
        Map.put(acc, :inputs, value)

      {"outputs", value}, acc ->
        Map.put(acc, :outputs, value)

      {_key, _value}, acc ->
        acc
    end)
  end

  defp serialize_automata(automata) do
    %{
      id: field(automata, :id),
      name: field(automata, :name),
      description: field(automata, :description),
      version: field(automata, :version, "1.0.0"),
      states: field(automata, :states, %{}),
      transitions: field(automata, :transitions, %{}),
      variables: field(automata, :variables, []),
      inputs: field(automata, :inputs, []),
      outputs: field(automata, :outputs, []),
      created_at: field(automata, :created_at),
      updated_at: field(automata, :updated_at)
    }
  end

  defp serialize_deployment(deployment) do
    %{
      deployment_id: field(deployment, :deployment_id, deployment_id_for(deployment)),
      automata_id: field(deployment, :automata_id),
      device_id: field(deployment, :device_id),
      server_id: field(deployment, :server_id),
      status: field(deployment, :status),
      deployed_at: field(deployment, :deployed_at),
      current_state: field(deployment, :current_state),
      variables: field(deployment, :variables, %{}),
      error: field(deployment, :error)
    }
  end

  defp live_deployment?(deployment) when is_map(deployment) do
    status = field(deployment, :status)

    status in [
      :pending,
      :deploying,
      :running,
      :paused,
      "pending",
      "deploying",
      "running",
      "paused"
    ]
  end

  defp live_deployment?(_), do: false

  defp field(data, key, default \\ nil) when is_map(data) and is_atom(key) do
    Map.get(data, key, Map.get(data, Atom.to_string(key), default))
  end

  defp parse_binding_type("direct"), do: :direct
  defp parse_binding_type("transform"), do: :transform
  defp parse_binding_type(:direct), do: :direct
  defp parse_binding_type(:transform), do: :transform
  defp parse_binding_type(_), do: :direct

  defp parse_state_type("initial"), do: :initial
  defp parse_state_type("final"), do: :final
  defp parse_state_type("normal"), do: :normal
  defp parse_state_type(:initial), do: :initial
  defp parse_state_type(:final), do: :final
  defp parse_state_type(:normal), do: :normal
  defp parse_state_type(_), do: :normal

  defp parse_transition_type("classic"), do: :classic
  defp parse_transition_type("timed"), do: :timed
  defp parse_transition_type("event"), do: :event
  defp parse_transition_type("probabilistic"), do: :probabilistic
  defp parse_transition_type("immediate"), do: :immediate
  defp parse_transition_type(:classic), do: :classic
  defp parse_transition_type(:timed), do: :timed
  defp parse_transition_type(:event), do: :event
  defp parse_transition_type(:probabilistic), do: :probabilistic
  defp parse_transition_type(:immediate), do: :immediate
  defp parse_transition_type(_), do: :classic

  defp parse_direction("input"), do: :input
  defp parse_direction("output"), do: :output
  defp parse_direction("internal"), do: :internal
  defp parse_direction(:input), do: :input
  defp parse_direction(:output), do: :output
  defp parse_direction(:internal), do: :internal
  defp parse_direction(_), do: :internal

  defp parse_timed_mode("after"), do: :after
  defp parse_timed_mode("at"), do: :at
  defp parse_timed_mode("every"), do: :every
  defp parse_timed_mode("timeout"), do: :timeout
  defp parse_timed_mode("window"), do: :window
  defp parse_timed_mode(:after), do: :after
  defp parse_timed_mode(:at), do: :at
  defp parse_timed_mode(:every), do: :every
  defp parse_timed_mode(:timeout), do: :timeout
  defp parse_timed_mode(:window), do: :window
  defp parse_timed_mode(_), do: :after

  defp to_int(value, _default) when is_integer(value), do: value

  defp to_int(value, _default) when is_float(value), do: trunc(value)

  defp to_int(value, default) when is_binary(value) do
    case Integer.parse(value) do
      {n, ""} -> n
      _ -> default
    end
  end

  defp to_int(_, default), do: default

  defp parse_duration_ms(value, default, default_unit \\ :milliseconds)
  defp parse_duration_ms(nil, default, _default_unit), do: default

  defp parse_duration_ms(value, _default, default_unit) when is_integer(value) do
    factor = if default_unit == :seconds, do: 1000, else: 1
    value * factor
  end

  defp parse_duration_ms(value, _default, default_unit) when is_float(value) do
    factor = if default_unit == :seconds, do: 1000, else: 1
    trunc(value * factor)
  end

  defp parse_duration_ms(value, default, default_unit) when is_binary(value) do
    raw = value |> String.trim() |> String.downcase()

    with {number, unit} <- parse_duration_token(raw) do
      actual_unit =
        cond do
          unit in ["ms", "s", "m", "h"] -> unit
          default_unit == :seconds -> "s"
          true -> "ms"
        end

      factor =
        case actual_unit do
          "h" -> 3_600_000
          "m" -> 60_000
          "s" -> 1_000
          _ -> 1
        end

      trunc(number * factor)
    else
      :error -> default
    end
  end

  defp parse_duration_ms(_, default, _default_unit), do: default

  defp parse_duration_token(raw) when is_binary(raw) do
    case Regex.run(~r/^(-?\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/, raw) do
      [_, number, unit] ->
        case Float.parse(number) do
          {parsed, ""} when parsed >= 0.0 -> {parsed, unit}
          _ -> :error
        end

      [_, number] ->
        case Float.parse(number) do
          {parsed, ""} when parsed >= 0.0 -> {parsed, nil}
          _ -> :error
        end

      _ ->
        :error
    end
  end

  defp first_present(map, keys) when is_map(map) and is_list(keys) do
    Enum.find_value(keys, fn key ->
      case Map.fetch(map, key) do
        {:ok, value} -> value
        :error -> nil
      end
    end)
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

  defp format_reason(reason) when is_atom(reason), do: Atom.to_string(reason)
  defp format_reason(reason) when is_binary(reason), do: reason
  defp format_reason(reason), do: inspect(reason)
end
