defmodule AetheriumServer.AnalyzerProjection do
  @moduledoc """
  Projects a normalized analyzer bundle into findings, graph elements, and summary metrics.
  """

  @spec project(map()) :: map()
  def project(bundle) when is_map(bundle) do
    findings =
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
        output_count = count_named_events(source_events, ["output_changed", "variable_updated"], connection["source_output"], "output")
        input_count = count_named_events(target_events, ["set_input"], connection["target_input"], nil)
        target_progress = count_progress_events(target_events)
        target_errors = count_kind_events(target_events, ["deployment_error"])

        findings = []

        findings =
          if output_count >= 2 and input_count < output_count do
            [
              %{
                "id" => "queue:#{connection["id"]}",
                "kind" => "queue_backlog",
                "severity" => if(output_count - input_count >= 3, do: "critical", else: "warning"),
                "confidence" => if(input_count > 0, do: "observed", else: "inferred"),
                "title" => "#{connection["source_output"]} backlog",
                "summary" =>
                  "#{output_count} upstream emissions reached #{connection["source_output"]}, but only #{input_count} matching downstream inputs were observed.",
                "connection" => connection,
                "source_refs" => %{
                  "automata_ids" => [source["automata_id"], target["automata_id"]],
                  "deployment_ids" => [source["deployment_id"], target["deployment_id"]],
                  "connection_ids" => [connection["id"]],
                  "resource_names" => []
                },
                "metrics" => %{
                  "output_count" => output_count,
                  "input_count" => input_count,
                  "target_progress_count" => target_progress
                },
                "evidence" => [
                  %{"type" => "timeline", "deployment_id" => source["deployment_id"], "event_count" => output_count},
                  %{"type" => "timeline", "deployment_id" => target["deployment_id"], "event_count" => input_count}
                ]
              }
              | findings
            ]
          else
            findings
          end

        findings =
          if output_count >= 2 and input_count == 0 and (target_progress == 0 or target_errors > 0) do
            [
              %{
                "id" => "blocked:#{connection["id"]}",
                "kind" => "blocked_handoff",
                "severity" => if(target_errors > 0, do: "critical", else: "warning"),
                "confidence" => "observed",
                "title" => "#{connection["source_output"]} handoff blocked",
                "summary" =>
                  "Upstream output #{connection["source_output"]} repeated, but downstream #{connection["target_input"]} never advanced.",
                "connection" => connection,
                "source_refs" => %{
                  "automata_ids" => [source["automata_id"], target["automata_id"]],
                  "deployment_ids" => [source["deployment_id"], target["deployment_id"]],
                  "connection_ids" => [connection["id"]],
                  "resource_names" => []
                },
                "metrics" => %{
                  "output_count" => output_count,
                  "input_count" => input_count,
                  "target_progress_count" => target_progress,
                  "target_error_count" => target_errors
                },
                "evidence" => [
                  %{"type" => "timeline", "deployment_id" => source["deployment_id"], "event_count" => output_count},
                  %{"type" => "timeline", "deployment_id" => target["deployment_id"], "event_count" => target_progress}
                ]
              }
              | findings
            ]
          else
            findings
          end

        if findings == [] and output_count == 0 and input_count == 0 do
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
          Enum.reverse(findings)
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
          {deployment_id, count_progress_events(get_in(timelines, [deployment_id, "events"]) || [])}
        end)

      active = Enum.filter(progress, fn {_id, count} -> count > 0 end)
      stalled = Enum.filter(progress, fn {_id, count} -> count == 0 end)

      case {active, stalled} do
        {[{leader_id, leader_count} | _], stalled_list} when leader_count >= 3 and stalled_list != [] ->
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
                  %{"type" => "timeline", "deployment_id" => deployment_id, "event_count" => count}
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
      "shared_resource_count" =>
        Enum.count(bundle["resources"] || [], &(&1["shared"] == true)),
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
          if finding_rank(%{"severity" => finding["severity"]}) > finding_rank(%{"severity" => existing}) do
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
end
