defmodule AetheriumServer.AnalyzerProjection do
  @moduledoc """
  Projects a normalized analyzer bundle into findings, graph elements, and summary metrics.
  """

  @spec project(map()) :: map()
  def project(bundle) when is_map(bundle) do
    findings =
      build_deployment_findings(bundle) ++
        build_shared_resource_findings(bundle) ++
        build_connection_findings(bundle) ++ build_starvation_findings(bundle)

    findings =
      findings
      |> Enum.uniq_by(& &1["id"])
      |> Enum.sort_by(&finding_rank/1, :desc)

    graph = build_graph(bundle, findings)

    Map.merge(bundle, %{
      "findings" => findings,
      "graph" => graph,
      "summary" => build_summary(bundle, findings)
    })
  end

  def project(bundle), do: bundle

  defp build_deployment_findings(bundle) do
    timelines = bundle["timelines"] || %{}

    bundle
    |> Map.get("deployments", [])
    |> Enum.flat_map(fn deployment ->
      timeline = timelines[deployment["deployment_id"]] || %{}
      events = timeline["events"] || []
      latency_samples = collect_latency_samples(deployment, events)
      deployment_errors = count_kind_events(events, ["deployment_error"])
      budget_exceeded_count = Enum.count(latency_samples, &budget_exceeded?/1)
      warning_exceeded_count = Enum.count(latency_samples, &warning_exceeded?/1)
      trace_event_count = trace_event_count(deployment, events)
      fault_profile = fault_profile(deployment, events)
      fault_action_samples = collect_fault_action_samples(deployment, events)

      fault_action_findings =
        build_fault_action_findings(
          deployment,
          fault_action_samples,
          deployment_errors,
          budget_exceeded_count
        )

      latency_findings =
        cond do
          budget_exceeded_count > 0 ->
            [build_latency_budget_finding(deployment, latency_samples, budget_exceeded_count)]

          warning_exceeded_count > 0 ->
            [build_latency_warning_finding(deployment, latency_samples, warning_exceeded_count)]

          true ->
            []
        end

      fault_findings =
        cond do
          fault_action_findings != [] and
              (deployment_errors > 0 or budget_exceeded_count > 0) ->
            fault_action_findings ++
              [
                build_fault_instability_finding(
                  deployment,
                  fault_profile || "trace_fault_actions",
                  deployment_errors,
                  budget_exceeded_count,
                  trace_event_count,
                  timeline
                )
              ]

          fault_action_findings != [] and not blank?(fault_profile) ->
            fault_action_findings ++
              [
                build_fault_profile_active_finding(
                  deployment,
                  fault_profile,
                  trace_event_count,
                  timeline
                )
              ]

          fault_action_findings != [] ->
            fault_action_findings

          blank?(fault_profile) ->
            []

          deployment_errors > 0 or budget_exceeded_count > 0 ->
            [
              build_fault_instability_finding(
                deployment,
                fault_profile,
                deployment_errors,
                budget_exceeded_count,
                trace_event_count,
                timeline
              )
            ]

          true ->
            [
              build_fault_profile_active_finding(
                deployment,
                fault_profile,
                trace_event_count,
                timeline
              )
            ]
        end

      latency_findings ++ fault_findings
    end)
  end

  defp build_shared_resource_findings(bundle) do
    timelines = bundle["timelines"] || %{}

    bundle
    |> Map.get("resources", [])
    |> Enum.flat_map(fn resource ->
      participants = resource["participants"] || %{}
      deployment_ids = List.wrap(participants["deployment_ids"])
      automata_ids = List.wrap(participants["automata_ids"])
      contender_count = max(length(deployment_ids), length(automata_ids))
      shared = resource["shared"] == true

      if shared and contender_count > 1 do
        observed_count =
          deployment_ids
          |> Enum.count(fn deployment_id ->
            timeline = timelines[deployment_id] || %{}
            count_progress_events(timeline["events"] || []) > 0
          end)

        base =
          %{
            "id" => "resource:#{resource["name"]}",
            "kind" => "shared_resource_contention",
            "severity" => severity_for_shared_resource(contender_count, observed_count),
            "confidence" => if(observed_count > 1, do: "mixed", else: "declared"),
            "title" => "#{resource["name"]} contention",
            "summary" =>
              "#{contender_count} automata/deployments reference shared resource #{resource["name"]}.",
            "resource" => resource,
            "source_refs" => %{
              "automata_ids" => automata_ids,
              "deployment_ids" => deployment_ids,
              "connection_ids" => [],
              "resource_names" => [resource["name"]]
            },
            "metrics" => %{
              "contender_count" => contender_count,
              "observed_overlap_count" => observed_count
            },
            "evidence" =>
              Enum.map(deployment_ids, fn deployment_id ->
                timeline = timelines[deployment_id] || %{}

                %{
                  "type" => if(map_size(timeline) > 0, do: "timeline", else: "structural"),
                  "deployment_id" => deployment_id,
                  "event_count" => length(timeline["events"] || [])
                }
              end)
          }

        if observed_count == 0 do
          [
            base,
            %{
              "id" => "unknown:resource:#{resource["name"]}",
              "kind" => "unknown_evidence",
              "severity" => "info",
              "confidence" => "declared",
              "title" => "Unobserved shared resource",
              "summary" =>
                "Shared resource #{resource["name"]} is declared, but no timeline evidence exists for its contenders.",
              "resource" => resource,
              "source_refs" => base["source_refs"],
              "metrics" => %{"contender_count" => contender_count},
              "evidence" => base["evidence"]
            }
          ]
        else
          [base]
        end
      else
        []
      end
    end)
  end

  defp build_connection_findings(bundle) do
    timelines = bundle["timelines"] || %{}
    deployments = bundle["deployments"] || []
    actor_index = Map.new(deployments, &{&1["automata_id"], &1})

    bundle
    |> Map.get("connections", [])
    |> Enum.flat_map(fn connection ->
      source = actor_index[connection["source_automata"]]
      target = actor_index[connection["target_automata"]]

      if is_map(source) and is_map(target) do
        source_events = get_in(timelines, [source["deployment_id"], "events"]) || []
        target_events = get_in(timelines, [target["deployment_id"], "events"]) || []

        output_count =
          count_named_events(
            source_events,
            ["output_changed", "variable_updated"],
            connection["source_output"],
            "output"
          )

        input_count =
          count_named_events(target_events, ["set_input"], connection["target_input"], nil)

        target_progress = count_progress_events(target_events)
        target_errors = count_kind_events(target_events, ["deployment_error"])

        findings =
          []
          |> maybe_add_connection_finding(
            queue_backlog_finding(
              connection,
              source,
              target,
              output_count,
              input_count,
              target_progress
            )
          )
          |> maybe_add_connection_finding(
            blocked_handoff_finding(
              connection,
              source,
              target,
              output_count,
              input_count,
              target_progress,
              target_errors
            )
          )

        correlation_findings =
          build_fault_correlated_connection_findings(
            connection,
            source,
            target,
            source_events,
            target_events,
            output_count,
            input_count,
            target_progress,
            target_errors
          )

        if findings == [] and correlation_findings == [] and output_count == 0 and
             input_count == 0 do
          [
            %{
              "id" => "unknown:connection:#{connection["id"]}",
              "kind" => "unknown_evidence",
              "severity" => "info",
              "confidence" => "inferred",
              "title" => "#{connection["source_output"]} link lacks observations",
              "summary" =>
                "The connection from #{connection["source_automata"]}.#{connection["source_output"]} to #{connection["target_automata"]}.#{connection["target_input"]} is structural only in the selected window.",
              "connection" => connection,
              "source_refs" => %{
                "automata_ids" => [source["automata_id"], target["automata_id"]],
                "deployment_ids" => [source["deployment_id"], target["deployment_id"]],
                "connection_ids" => [connection["id"]],
                "resource_names" => []
              },
              "metrics" => %{},
              "evidence" => []
            }
          ]
        else
          findings ++ correlation_findings
        end
      else
        []
      end
    end)
  end

  defp build_starvation_findings(bundle) do
    timelines = bundle["timelines"] || %{}

    bundle
    |> Map.get("resources", [])
    |> Enum.flat_map(fn resource ->
      deployment_ids = get_in(resource, ["participants", "deployment_ids"]) |> List.wrap()

      progress =
        Enum.map(deployment_ids, fn deployment_id ->
          {deployment_id,
           count_progress_events(get_in(timelines, [deployment_id, "events"]) || [])}
        end)

      active = Enum.filter(progress, fn {_id, count} -> count > 0 end)
      stalled = Enum.filter(progress, fn {_id, count} -> count == 0 end)

      case {active, stalled} do
        {[{leader_id, leader_count} | _], stalled_list}
        when leader_count >= 3 and stalled_list != [] ->
          [
            %{
              "id" => "starvation:#{resource["name"]}",
              "kind" => "starvation_risk",
              "severity" => "warning",
              "confidence" => "observed",
              "title" => "#{resource["name"]} starvation risk",
              "summary" =>
                "#{leader_id} progressed repeatedly while #{length(stalled_list)} contender(s) made no observed progress on #{resource["name"]}.",
              "resource" => resource,
              "source_refs" => %{
                "automata_ids" => List.wrap(get_in(resource, ["participants", "automata_ids"])),
                "deployment_ids" => deployment_ids,
                "connection_ids" => [],
                "resource_names" => [resource["name"]]
              },
              "metrics" => %{
                "leader_progress_count" => leader_count,
                "stalled_count" => length(stalled_list)
              },
              "evidence" =>
                Enum.map(progress, fn {deployment_id, count} ->
                  %{
                    "type" => "timeline",
                    "deployment_id" => deployment_id,
                    "event_count" => count
                  }
                end)
            }
          ]

        _ ->
          []
      end
    end)
  end

  defp build_graph(bundle, findings) do
    deployments = bundle["deployments"] || []
    resources = bundle["resources"] || []
    connections = bundle["connections"] || []

    deployment_nodes =
      Enum.map(deployments, fn deployment ->
        %{
          "id" => "deployment:#{deployment["deployment_id"]}",
          "kind" => "deployment",
          "label" => deployment["automata_id"],
          "subtitle" => deployment["device_id"],
          "source_ref" => %{
            "deployment_id" => deployment["deployment_id"],
            "automata_id" => deployment["automata_id"]
          },
          "metadata" => %{
            "status" => deployment["status"],
            "placement" => get_in(deployment, ["deployment_metadata", "placement"])
          }
        }
      end)

    undeployed_nodes =
      bundle["automata"]
      |> Enum.reject(fn automata ->
        Enum.any?(deployments, &(&1["automata_id"] == automata["id"]))
      end)
      |> Enum.map(fn automata ->
        %{
          "id" => "automata:#{automata["id"]}",
          "kind" => "automata",
          "label" => automata["name"] || automata["id"],
          "subtitle" => "undeployed",
          "source_ref" => %{"automata_id" => automata["id"]},
          "metadata" => %{}
        }
      end)

    resource_nodes =
      Enum.map(resources, fn resource ->
        %{
          "id" => "resource:#{resource["name"]}",
          "kind" => "resource",
          "label" => resource["name"],
          "subtitle" => resource["kind"] || "resource",
          "source_ref" => %{"resource_name" => resource["name"]},
          "metadata" => %{
            "shared" => resource["shared"],
            "capacity" => resource["capacity"],
            "latency_sensitive" => resource["latency_sensitive"]
          }
        }
      end)

    binding_nodes =
      Enum.map(connections, fn connection ->
        %{
          "id" => "binding:#{connection["id"]}",
          "kind" => "binding",
          "label" => connection["source_output"] <> " -> " <> connection["target_input"],
          "subtitle" => connection["binding_type"] || "direct",
          "source_ref" => %{"connection_id" => connection["id"]},
          "metadata" => %{}
        }
      end)

    severity_by_resource = finding_severity_map(findings, "resource_names")
    severity_by_connection = finding_severity_map(findings, "connection_ids")

    resource_edges =
      Enum.flat_map(resources, fn resource ->
        deployment_ids = get_in(resource, ["participants", "deployment_ids"]) |> List.wrap()
        automata_ids = get_in(resource, ["participants", "automata_ids"]) |> List.wrap()

        actors =
          if deployment_ids != [] do
            Enum.map(deployment_ids, &"deployment:#{&1}")
          else
            Enum.map(automata_ids, &"automata:#{&1}")
          end

        Enum.map(actors, fn actor_id ->
          %{
            "id" => "#{actor_id}->resource:#{resource["name"]}",
            "source" => actor_id,
            "target" => "resource:#{resource["name"]}",
            "kind" => "resource_link",
            "severity" => Map.get(severity_by_resource, resource["name"], "info"),
            "metadata" => %{}
          }
        end)
      end)

    binding_edges =
      Enum.flat_map(connections, fn connection ->
        source_ids = actor_ids_for_automata(connection["source_automata"], deployments)
        target_ids = actor_ids_for_automata(connection["target_automata"], deployments)
        binding_id = "binding:#{connection["id"]}"
        severity = Map.get(severity_by_connection, connection["id"], "info")

        Enum.map(source_ids, fn source_id ->
          %{
            "id" => "#{source_id}->#{binding_id}",
            "source" => source_id,
            "target" => binding_id,
            "kind" => "binding_out",
            "severity" => severity,
            "metadata" => %{}
          }
        end) ++
          Enum.map(target_ids, fn target_id ->
            %{
              "id" => "#{binding_id}->#{target_id}",
              "source" => binding_id,
              "target" => target_id,
              "kind" => "binding_in",
              "severity" => severity,
              "metadata" => %{}
            }
          end)
      end)

    %{
      "nodes" => deployment_nodes ++ undeployed_nodes ++ resource_nodes ++ binding_nodes,
      "edges" => resource_edges ++ binding_edges
    }
  end

  defp build_summary(bundle, findings) do
    severities = Enum.group_by(findings, & &1["severity"])
    observed_findings = Enum.count(findings, &(&1["confidence"] in ["observed", "mixed"]))

    %{
      "finding_count" => length(findings),
      "critical_count" => length(Map.get(severities, "critical", [])),
      "shared_resource_count" => Enum.count(bundle["resources"] || [], &(&1["shared"] == true)),
      "deployment_runtime_count" => length(bundle["deployments"] || []),
      "fault_in_loop_count" =>
        Enum.count(
          findings,
          &(&1["kind"] in [
              "fault_injection_active",
              "fault_profile_instability",
              "fault_disconnect_window",
              "fault_delivery_loss",
              "fault_duplicate_delivery",
              "fault_latency_injection",
              "fault_correlated_backlog",
              "fault_correlated_handoff_blockage"
            ])
        ),
      "latency_related_count" =>
        Enum.count(
          findings,
          &(&1["kind"] in ["latency_budget_exceeded", "latency_warning_exceeded"])
        ),
      "observed_finding_count" => observed_findings,
      "structural_finding_count" => length(findings) - observed_findings,
      "unknown_evidence_count" => Enum.count(findings, &(&1["kind"] == "unknown_evidence"))
    }
  end

  defp finding_rank(finding) do
    case finding["severity"] do
      "critical" -> 3
      "warning" -> 2
      _ -> 1
    end
  end

  defp severity_for_shared_resource(contender_count, observed_count) do
    cond do
      observed_count > 1 and contender_count >= 3 -> "critical"
      contender_count >= 2 -> "warning"
      true -> "info"
    end
  end

  defp actor_ids_for_automata(automata_id, deployments) do
    ids =
      deployments
      |> Enum.filter(&(&1["automata_id"] == automata_id))
      |> Enum.map(&"deployment:#{&1["deployment_id"]}")

    if ids == [], do: ["automata:#{automata_id}"], else: ids
  end

  defp finding_severity_map(findings, ref_key) do
    Enum.reduce(findings, %{}, fn finding, acc ->
      refs = get_in(finding, ["source_refs", ref_key]) |> List.wrap()

      Enum.reduce(refs, acc, fn ref, inner ->
        Map.update(inner, ref, finding["severity"], fn existing ->
          if finding_rank(%{"severity" => finding["severity"]}) >
               finding_rank(%{"severity" => existing}) do
            finding["severity"]
          else
            existing
          end
        end)
      end)
    end)
  end

  defp count_progress_events(events) do
    Enum.count(events, &(&1["kind"] == "state_changed"))
  end

  defp count_kind_events(events, kinds) do
    Enum.count(events, &(&1["kind"] in kinds))
  end

  defp count_named_events(events, kinds, name, direction) do
    Enum.count(events, fn event ->
      event["kind"] in kinds and event["name"] == name and
        (is_nil(direction) or event["direction"] == direction)
    end)
  end

  defp queue_backlog_finding(
         connection,
         source,
         target,
         output_count,
         input_count,
         target_progress
       ) do
    if output_count >= 2 and input_count < output_count do
      %{
        "id" => "queue:#{connection["id"]}",
        "kind" => "queue_backlog",
        "severity" => if(output_count - input_count >= 3, do: "critical", else: "warning"),
        "confidence" => if(input_count > 0, do: "observed", else: "inferred"),
        "title" => "#{connection["source_output"]} backlog",
        "summary" =>
          "#{output_count} upstream emissions reached #{connection["source_output"]}, but only #{input_count} matching downstream inputs were observed.",
        "connection" => connection,
        "source_refs" => connection_source_refs(connection, source, target),
        "metrics" => %{
          "output_count" => output_count,
          "input_count" => input_count,
          "target_progress_count" => target_progress
        },
        "evidence" => [
          %{
            "type" => "timeline",
            "deployment_id" => source["deployment_id"],
            "event_count" => output_count
          },
          %{
            "type" => "timeline",
            "deployment_id" => target["deployment_id"],
            "event_count" => input_count
          }
        ]
      }
    end
  end

  defp blocked_handoff_finding(
         connection,
         source,
         target,
         output_count,
         input_count,
         target_progress,
         target_errors
       ) do
    if output_count >= 2 and input_count == 0 and (target_progress == 0 or target_errors > 0) do
      %{
        "id" => "blocked:#{connection["id"]}",
        "kind" => "blocked_handoff",
        "severity" => if(target_errors > 0, do: "critical", else: "warning"),
        "confidence" => "observed",
        "title" => "#{connection["source_output"]} handoff blocked",
        "summary" =>
          "Upstream output #{connection["source_output"]} repeated, but downstream #{connection["target_input"]} never advanced.",
        "connection" => connection,
        "source_refs" => connection_source_refs(connection, source, target),
        "metrics" => %{
          "output_count" => output_count,
          "input_count" => input_count,
          "target_progress_count" => target_progress,
          "target_error_count" => target_errors
        },
        "evidence" => [
          %{
            "type" => "timeline",
            "deployment_id" => source["deployment_id"],
            "event_count" => output_count
          },
          %{
            "type" => "timeline",
            "deployment_id" => target["deployment_id"],
            "event_count" => target_progress
          }
        ]
      }
    end
  end

  defp build_fault_correlated_connection_findings(
         connection,
         source,
         target,
         source_events,
         target_events,
         output_count,
         input_count,
         target_progress,
         target_errors
       ) do
    source_fault_actions = collect_fault_action_samples(source, source_events)
    target_fault_actions = collect_fault_action_samples(target, target_events)
    source_counts = count_fault_actions(source_fault_actions)
    target_counts = count_fault_actions(target_fault_actions)

    []
    |> maybe_add_connection_finding(
      fault_correlated_backlog_finding(
        connection,
        source,
        target,
        source_fault_actions,
        target_fault_actions,
        source_counts,
        target_counts,
        output_count,
        input_count
      )
    )
    |> maybe_add_connection_finding(
      fault_correlated_handoff_finding(
        connection,
        source,
        target,
        source_fault_actions,
        target_fault_actions,
        source_counts,
        target_counts,
        output_count,
        input_count,
        target_progress,
        target_errors
      )
    )
  end

  defp fault_correlated_backlog_finding(
         connection,
         source,
         target,
         source_fault_actions,
         target_fault_actions,
         source_counts,
         target_counts,
         output_count,
         input_count
       ) do
    backlog = output_count >= 2 and input_count < output_count

    source_reasons =
      correlated_fault_reasons(source_counts, [
        {"duplicate", "upstream duplicate delivery"},
        {"delay", "upstream delay injection"}
      ])

    target_reasons =
      correlated_fault_reasons(target_counts, [
        {"disconnect_window", "downstream disconnect window"},
        {"drop", "downstream dropped delivery"},
        {"degraded_success", "downstream degraded success loss"}
      ])

    reasons = source_reasons ++ target_reasons

    if backlog and reasons != [] do
      %{
        "id" => "fault-backlog:#{connection["id"]}",
        "kind" => "fault_correlated_backlog",
        "severity" => if(output_count - input_count >= 3, do: "critical", else: "warning"),
        "confidence" => "observed",
        "title" => "#{connection["source_output"]} backlog is fault-correlated",
        "summary" =>
          "Observed backlog on #{connection["id"]} lines up with #{Enum.join(reasons, " and ")}.",
        "connection" => connection,
        "source_refs" => connection_source_refs(connection, source, target),
        "metrics" => %{
          "output_count" => output_count,
          "input_count" => input_count,
          "source_fault_action_count" => total_fault_action_count(source_counts),
          "target_fault_action_count" => total_fault_action_count(target_counts)
        },
        "evidence" =>
          fault_action_evidence(source_fault_actions, ["duplicate", "delay"]) ++
            fault_action_evidence(target_fault_actions, [
              "disconnect_window",
              "drop",
              "degraded_success"
            ])
      }
    end
  end

  defp fault_correlated_handoff_finding(
         connection,
         source,
         target,
         source_fault_actions,
         target_fault_actions,
         source_counts,
         target_counts,
         output_count,
         input_count,
         target_progress,
         target_errors
       ) do
    blocked =
      output_count >= 2 and input_count == 0 and (target_progress == 0 or target_errors > 0)

    reasons =
      correlated_fault_reasons(target_counts, [
        {"disconnect_window", "downstream disconnect window"},
        {"drop", "downstream dropped delivery"},
        {"degraded_success", "downstream degraded success loss"}
      ]) ++
        correlated_fault_reasons(source_counts, [
          {"drop", "upstream dropped delivery"},
          {"degraded_success", "upstream degraded success loss"}
        ])

    if blocked and reasons != [] do
      %{
        "id" => "fault-blocked:#{connection["id"]}",
        "kind" => "fault_correlated_handoff_blockage",
        "severity" => if(target_errors > 0, do: "critical", else: "warning"),
        "confidence" => "observed",
        "title" => "#{connection["source_output"]} blockage is fault-correlated",
        "summary" =>
          "Observed handoff blockage on #{connection["id"]} lines up with #{Enum.join(reasons, " and ")}.",
        "connection" => connection,
        "source_refs" => connection_source_refs(connection, source, target),
        "metrics" => %{
          "output_count" => output_count,
          "input_count" => input_count,
          "target_progress_count" => target_progress,
          "target_error_count" => target_errors
        },
        "evidence" =>
          fault_action_evidence(target_fault_actions, [
            "disconnect_window",
            "drop",
            "degraded_success"
          ]) ++
            fault_action_evidence(source_fault_actions, ["drop", "degraded_success"])
      }
    end
  end

  defp connection_source_refs(connection, source, target) do
    %{
      "automata_ids" => [source["automata_id"], target["automata_id"]],
      "deployment_ids" => [source["deployment_id"], target["deployment_id"]],
      "connection_ids" => [connection["id"]],
      "resource_names" => []
    }
  end

  defp correlated_fault_reasons(action_counts, descriptors) when is_map(action_counts) do
    Enum.flat_map(descriptors, fn {action, reason} ->
      if Map.get(action_counts, action, 0) > 0, do: [reason], else: []
    end)
  end

  defp total_fault_action_count(action_counts) when is_map(action_counts) do
    action_counts
    |> Map.values()
    |> Enum.sum()
  end

  defp maybe_add_connection_finding(findings, nil), do: findings
  defp maybe_add_connection_finding(findings, finding), do: findings ++ [finding]

  defp collect_latency_samples(deployment, events) do
    ([latency_sample_from_deployment(deployment)] ++
       Enum.map(events, &latency_sample_from_event/1))
    |> Enum.reject(&is_nil/1)
  end

  defp collect_fault_action_samples(deployment, events) do
    ([fault_action_sample_from_deployment(deployment)] ++
       Enum.map(events, &fault_action_sample_from_event/1))
    |> Enum.reject(&is_nil/1)
  end

  defp latency_sample_from_deployment(deployment) when is_map(deployment) do
    metadata = deployment["deployment_metadata"] || %{}
    latency = metadata["latency"] || %{}

    if Enum.any?(
         [latency["budget_ms"], latency["warning_ms"], latency["observed_ms"]],
         &is_integer/1
       ) do
      %{
        "source" => "deployment_metadata",
        "timestamp" => nil,
        "budget_ms" => latency["budget_ms"],
        "warning_ms" => latency["warning_ms"],
        "observed_ms" => latency["observed_ms"]
      }
    end
  end

  defp latency_sample_from_deployment(_deployment), do: nil

  defp latency_sample_from_event(event) when is_map(event) do
    budget_ms =
      event["latency_budget_ms"] || get_in(event, ["deployment_metadata", "latency", "budget_ms"])

    warning_ms =
      event["latency_warning_ms"] ||
        get_in(event, ["deployment_metadata", "latency", "warning_ms"])

    observed_ms =
      event["observed_latency_ms"] ||
        get_in(event, ["deployment_metadata", "latency", "observed_ms"])

    if Enum.any?([budget_ms, warning_ms, observed_ms], &is_integer/1) do
      %{
        "source" => event["kind"] || "timeline",
        "timestamp" => event["timestamp"],
        "budget_ms" => budget_ms,
        "warning_ms" => warning_ms,
        "observed_ms" => observed_ms
      }
    end
  end

  defp latency_sample_from_event(_event), do: nil

  defp fault_action_sample_from_deployment(deployment) when is_map(deployment) do
    actions =
      deployment
      |> get_in(["deployment_metadata", "trace", "recent_fault_actions"])
      |> List.wrap()
      |> Enum.reject(&blank?/1)

    if actions != [] do
      %{
        "source" => "deployment_metadata",
        "timestamp" => nil,
        "actions" => actions
      }
    end
  end

  defp fault_action_sample_from_deployment(_deployment), do: nil

  defp fault_action_sample_from_event(event) when is_map(event) do
    actions =
      event
      |> Map.get("fault_actions", [])
      |> List.wrap()
      |> Enum.reject(&blank?/1)

    if actions != [] do
      %{
        "source" => event["kind"] || "timeline",
        "timestamp" => event["timestamp"],
        "actions" => actions
      }
    end
  end

  defp fault_action_sample_from_event(_event), do: nil

  defp build_latency_budget_finding(deployment, latency_samples, breach_count) do
    worst_sample =
      latency_samples
      |> Enum.filter(&budget_exceeded?/1)
      |> Enum.max_by(&latency_rank/1, fn -> %{} end)

    %{
      "id" => "latency-budget:#{deployment["deployment_id"]}",
      "kind" => "latency_budget_exceeded",
      "severity" => if(breach_count >= 2, do: "critical", else: "warning"),
      "confidence" => "observed",
      "title" => "#{deployment["automata_id"]} exceeded latency budget",
      "summary" =>
        "Observed latency exceeded the configured budget #{breach_count} time(s) for deployment #{deployment["deployment_id"]}.",
      "deployment" => deployment,
      "source_refs" => source_refs_for_deployment(deployment),
      "metrics" => %{
        "breach_count" => breach_count,
        "max_observed_latency_ms" => worst_sample["observed_ms"],
        "latency_budget_ms" => worst_sample["budget_ms"]
      },
      "evidence" => latency_evidence(latency_samples, &budget_exceeded?/1)
    }
  end

  defp build_latency_warning_finding(deployment, latency_samples, breach_count) do
    worst_sample =
      latency_samples
      |> Enum.filter(&warning_exceeded?/1)
      |> Enum.max_by(&latency_rank/1, fn -> %{} end)

    %{
      "id" => "latency-warning:#{deployment["deployment_id"]}",
      "kind" => "latency_warning_exceeded",
      "severity" => "warning",
      "confidence" => "observed",
      "title" => "#{deployment["automata_id"]} approached latency budget",
      "summary" =>
        "Observed latency crossed the warning threshold #{breach_count} time(s) for deployment #{deployment["deployment_id"]}.",
      "deployment" => deployment,
      "source_refs" => source_refs_for_deployment(deployment),
      "metrics" => %{
        "breach_count" => breach_count,
        "max_observed_latency_ms" => worst_sample["observed_ms"],
        "latency_warning_ms" => worst_sample["warning_ms"]
      },
      "evidence" => latency_evidence(latency_samples, &warning_exceeded?/1)
    }
  end

  defp build_fault_profile_active_finding(deployment, fault_profile, trace_event_count, timeline) do
    confidence =
      if length(timeline["events"] || []) > 0 or is_integer(trace_event_count) do
        "observed"
      else
        "declared"
      end

    %{
      "id" => "fault-profile:#{deployment["deployment_id"]}",
      "kind" => "fault_injection_active",
      "severity" => "info",
      "confidence" => confidence,
      "title" => "#{deployment["automata_id"]} is running with a fault profile",
      "summary" =>
        "Deployment #{deployment["deployment_id"]} is configured with fault profile #{fault_profile}.",
      "deployment" => deployment,
      "source_refs" => source_refs_for_deployment(deployment),
      "metrics" => %{
        "trace_event_count" => trace_event_count,
        "timeline_event_count" => length(timeline["events"] || [])
      },
      "evidence" => [
        %{
          "type" => if(confidence == "observed", do: "timeline", else: "deployment_metadata"),
          "deployment_id" => deployment["deployment_id"],
          "fault_profile" => fault_profile,
          "trace_event_count" => trace_event_count
        }
      ]
    }
  end

  defp build_fault_instability_finding(
         deployment,
         fault_profile,
         deployment_errors,
         budget_exceeded_count,
         trace_event_count,
         timeline
       ) do
    %{
      "id" => "fault-instability:#{deployment["deployment_id"]}",
      "kind" => "fault_profile_instability",
      "severity" =>
        if(deployment_errors >= 2 or budget_exceeded_count >= 2, do: "critical", else: "warning"),
      "confidence" => "observed",
      "title" => "#{deployment["automata_id"]} is unstable under injected faults",
      "summary" =>
        "Deployment #{deployment["deployment_id"]} ran with fault profile #{fault_profile} and showed runtime instability.",
      "deployment" => deployment,
      "source_refs" => source_refs_for_deployment(deployment),
      "metrics" => %{
        "deployment_error_count" => deployment_errors,
        "latency_budget_exceeded_count" => budget_exceeded_count,
        "trace_event_count" => trace_event_count
      },
      "evidence" => [
        %{
          "type" => "timeline",
          "deployment_id" => deployment["deployment_id"],
          "event_count" => length(timeline["events"] || []),
          "fault_profile" => fault_profile
        }
      ]
    }
  end

  defp build_fault_action_findings(
         deployment,
         fault_action_samples,
         deployment_errors,
         budget_exceeded_count
       ) do
    action_counts = count_fault_actions(fault_action_samples)

    []
    |> maybe_add_fault_action_finding(
      disconnect_window_finding(
        deployment,
        action_counts,
        fault_action_samples,
        deployment_errors
      )
    )
    |> maybe_add_fault_action_finding(
      delivery_loss_finding(
        deployment,
        action_counts,
        fault_action_samples,
        deployment_errors
      )
    )
    |> maybe_add_fault_action_finding(
      duplicate_delivery_finding(
        deployment,
        action_counts,
        fault_action_samples,
        deployment_errors
      )
    )
    |> maybe_add_fault_action_finding(
      latency_injection_finding(
        deployment,
        action_counts,
        fault_action_samples,
        budget_exceeded_count
      )
    )
  end

  defp disconnect_window_finding(
         deployment,
         action_counts,
         fault_action_samples,
         deployment_errors
       ) do
    count = Map.get(action_counts, "disconnect_window", 0)

    if count > 0 do
      %{
        "id" => "fault-disconnect:#{deployment["deployment_id"]}",
        "kind" => "fault_disconnect_window",
        "severity" => if(deployment_errors > 0 or count >= 2, do: "critical", else: "warning"),
        "confidence" => "observed",
        "title" => "#{deployment["automata_id"]} hit an injected disconnect window",
        "summary" =>
          "Trace evidence shows #{count} disconnect-window fault action(s) for deployment #{deployment["deployment_id"]}.",
        "deployment" => deployment,
        "source_refs" => source_refs_for_deployment(deployment),
        "metrics" => %{
          "disconnect_window_count" => count,
          "deployment_error_count" => deployment_errors
        },
        "evidence" => fault_action_evidence(fault_action_samples, "disconnect_window")
      }
    end
  end

  defp delivery_loss_finding(deployment, action_counts, fault_action_samples, deployment_errors) do
    drop_count = Map.get(action_counts, "drop", 0)
    degraded_count = Map.get(action_counts, "degraded_success", 0)
    total = drop_count + degraded_count

    if total > 0 do
      %{
        "id" => "fault-loss:#{deployment["deployment_id"]}",
        "kind" => "fault_delivery_loss",
        "severity" => if(deployment_errors > 0 or total >= 2, do: "critical", else: "warning"),
        "confidence" => "observed",
        "title" => "#{deployment["automata_id"]} lost messages under fault injection",
        "summary" =>
          "Trace evidence shows #{total} message-loss fault action(s) for deployment #{deployment["deployment_id"]}.",
        "deployment" => deployment,
        "source_refs" => source_refs_for_deployment(deployment),
        "metrics" => %{
          "drop_count" => drop_count,
          "degraded_success_count" => degraded_count,
          "deployment_error_count" => deployment_errors
        },
        "evidence" => fault_action_evidence(fault_action_samples, ["drop", "degraded_success"])
      }
    end
  end

  defp duplicate_delivery_finding(
         deployment,
         action_counts,
         fault_action_samples,
         deployment_errors
       ) do
    count = Map.get(action_counts, "duplicate", 0)

    if count > 0 do
      %{
        "id" => "fault-duplicate:#{deployment["deployment_id"]}",
        "kind" => "fault_duplicate_delivery",
        "severity" => if(deployment_errors > 0 and count >= 2, do: "warning", else: "info"),
        "confidence" => "observed",
        "title" => "#{deployment["automata_id"]} duplicated messages under fault injection",
        "summary" =>
          "Trace evidence shows #{count} duplicate-delivery fault action(s) for deployment #{deployment["deployment_id"]}.",
        "deployment" => deployment,
        "source_refs" => source_refs_for_deployment(deployment),
        "metrics" => %{
          "duplicate_count" => count
        },
        "evidence" => fault_action_evidence(fault_action_samples, "duplicate")
      }
    end
  end

  defp latency_injection_finding(
         deployment,
         action_counts,
         fault_action_samples,
         budget_exceeded_count
       ) do
    count = Map.get(action_counts, "delay", 0)

    if count > 0 do
      %{
        "id" => "fault-delay:#{deployment["deployment_id"]}",
        "kind" => "fault_latency_injection",
        "severity" => if(budget_exceeded_count > 0, do: "warning", else: "info"),
        "confidence" => "observed",
        "title" => "#{deployment["automata_id"]} is running with injected latency",
        "summary" =>
          "Trace evidence shows #{count} delay fault action(s) for deployment #{deployment["deployment_id"]}.",
        "deployment" => deployment,
        "source_refs" => source_refs_for_deployment(deployment),
        "metrics" => %{
          "delay_count" => count,
          "latency_budget_exceeded_count" => budget_exceeded_count
        },
        "evidence" => fault_action_evidence(fault_action_samples, "delay")
      }
    end
  end

  defp latency_evidence(latency_samples, predicate) when is_function(predicate, 1) do
    latency_samples
    |> Enum.filter(predicate)
    |> Enum.sort_by(&latency_rank/1, :desc)
    |> Enum.take(3)
    |> Enum.map(fn sample ->
      %{
        "type" => sample["source"],
        "timestamp" => sample["timestamp"],
        "observed_latency_ms" => sample["observed_ms"],
        "latency_budget_ms" => sample["budget_ms"],
        "latency_warning_ms" => sample["warning_ms"]
      }
    end)
  end

  defp source_refs_for_deployment(deployment) do
    %{
      "automata_ids" => List.wrap(deployment["automata_id"]),
      "deployment_ids" => List.wrap(deployment["deployment_id"]),
      "connection_ids" => [],
      "resource_names" => []
    }
  end

  defp budget_exceeded?(sample) when is_map(sample) do
    is_integer(sample["observed_ms"]) and is_integer(sample["budget_ms"]) and
      sample["budget_ms"] > 0 and sample["observed_ms"] > sample["budget_ms"]
  end

  defp budget_exceeded?(_sample), do: false

  defp warning_exceeded?(sample) when is_map(sample) do
    is_integer(sample["observed_ms"]) and is_integer(sample["warning_ms"]) and
      sample["warning_ms"] > 0 and sample["observed_ms"] > sample["warning_ms"] and
      not budget_exceeded?(sample)
  end

  defp warning_exceeded?(_sample), do: false

  defp latency_rank(sample) when is_map(sample) do
    {sample["observed_ms"] || 0, sample["timestamp"] || -1}
  end

  defp count_fault_actions(fault_action_samples) when is_list(fault_action_samples) do
    Enum.reduce(fault_action_samples, %{}, fn sample, acc ->
      sample
      |> Map.get("actions", [])
      |> Enum.reduce(acc, fn action, inner ->
        Map.update(inner, action, 1, &(&1 + 1))
      end)
    end)
  end

  defp fault_action_evidence(fault_action_samples, actions) do
    expected = List.wrap(actions)

    fault_action_samples
    |> Enum.filter(fn sample ->
      sample_actions = Map.get(sample, "actions", [])
      Enum.any?(expected, &(&1 in sample_actions))
    end)
    |> Enum.take(3)
    |> Enum.map(fn sample ->
      %{
        "type" => sample["source"],
        "timestamp" => sample["timestamp"],
        "fault_actions" => sample["actions"]
      }
    end)
  end

  defp maybe_add_fault_action_finding(findings, nil), do: findings
  defp maybe_add_fault_action_finding(findings, finding), do: findings ++ [finding]

  defp trace_event_count(deployment, events) do
    ([get_in(deployment, ["deployment_metadata", "trace", "trace_event_count"])] ++
       Enum.map(events, fn event ->
         event["trace_event_count"] ||
           get_in(event, ["deployment_metadata", "trace", "trace_event_count"])
       end))
    |> Enum.filter(&is_integer/1)
    |> Enum.max(fn -> nil end)
  end

  defp fault_profile(deployment, events) do
    ([get_in(deployment, ["deployment_metadata", "trace", "fault_profile"])] ++
       Enum.map(events, fn event ->
         event["fault_profile"] ||
           get_in(event, ["deployment_metadata", "trace", "fault_profile"])
       end))
    |> Enum.find(&(is_binary(&1) and &1 != ""))
  end

  defp blank?(value), do: value in [nil, ""]
end
