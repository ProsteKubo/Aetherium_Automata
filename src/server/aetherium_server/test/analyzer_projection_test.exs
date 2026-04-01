defmodule AetheriumServer.AnalyzerProjectionTest do
  use ExUnit.Case, async: false

  alias AetheriumServer.AnalyzerBundle
  alias AetheriumServer.AnalyzerProjection
  alias AetheriumServer.TimeSeriesStore

  test "builds bundle with local timeline evidence" do
    deployment_id = "analyzer-dep-#{System.unique_integer([:positive])}"

    assert {:ok, _} =
             TimeSeriesStore.append_event(%{
               deployment_id: deployment_id,
               event: "state_changed",
               timestamp: 1_000,
               payload: %{
                 "automata_id" => "aut_a",
                 "device_id" => "dev_a",
                 "from_state" => "idle",
                 "to_state" => "busy",
                 "transition_id" => "t1"
               }
             })

    state = %{
      deployments: %{
        deployment_id => %{
          id: deployment_id,
          automata_id: "aut_a",
          device_id: "dev_a",
          status: :running,
          current_state: "busy",
          variables: %{},
          deployment_metadata: %{}
        }
      },
      devices: %{},
      automata_cache: %{}
    }

    query = %{
      "scope" => "project",
      "topology" => %{
        "automata" => [
          %{
            "id" => "aut_a",
            "name" => "A",
            "black_box" => %{
              "resources" => [%{"name" => "field_bus", "kind" => "network", "shared" => true}]
            }
          }
        ],
        "deployments" => [
          %{
            "deployment_id" => deployment_id,
            "automata_id" => "aut_a",
            "device_id" => "dev_a",
            "server_id" => "srv_01",
            "status" => "running"
          }
        ],
        "connections" => []
      }
    }

    assert {:ok, bundle} = AnalyzerBundle.build(query, state)
    assert bundle["evidence_mode"] == "hybrid"
    assert get_in(bundle, ["timelines", deployment_id, "events"]) |> length() == 1
    assert Enum.any?(bundle["resources"], &(&1["name"] == "field_bus"))
  end

  test "projects shared resource contention and unknown evidence without timelines" do
    bundle = %{
      "automata" => [],
      "deployments" => [],
      "connections" => [],
      "timelines" => %{},
      "resources" => [
        %{
          "name" => "field_bus",
          "kind" => "network",
          "shared" => true,
          "participants" => %{
            "automata_ids" => ["aut_a", "aut_b"],
            "deployment_ids" => []
          }
        }
      ]
    }

    projected = AnalyzerProjection.project(bundle)
    assert Enum.any?(projected["findings"], &(&1["kind"] == "shared_resource_contention"))
    assert Enum.any?(projected["findings"], &(&1["kind"] == "unknown_evidence"))
  end

  test "projects queue backlog and blocked handoff from observed timelines" do
    bundle = %{
      "automata" => [],
      "resources" => [],
      "deployments" => [
        %{"deployment_id" => "dep_a", "automata_id" => "aut_a", "device_id" => "dev_a"},
        %{"deployment_id" => "dep_b", "automata_id" => "aut_b", "device_id" => "dev_b"}
      ],
      "connections" => [
        %{
          "id" => "conn_1",
          "source_automata" => "aut_a",
          "source_output" => "status",
          "target_automata" => "aut_b",
          "target_input" => "status"
        }
      ],
      "timelines" => %{
        "dep_a" => %{
          "events" => [
            %{"kind" => "output_changed", "name" => "status", "direction" => "output"},
            %{"kind" => "output_changed", "name" => "status", "direction" => "output"},
            %{"kind" => "output_changed", "name" => "status", "direction" => "output"}
          ]
        },
        "dep_b" => %{
          "events" => [
            %{"kind" => "deployment_error", "name" => "status"}
          ]
        }
      }
    }

    projected = AnalyzerProjection.project(bundle)
    assert Enum.any?(projected["findings"], &(&1["kind"] == "queue_backlog"))
    assert Enum.any?(projected["findings"], &(&1["kind"] == "blocked_handoff"))
  end

  test "projects deployment latency and fault findings from deployment-aware evidence" do
    bundle = %{
      "automata" => [],
      "resources" => [],
      "connections" => [],
      "deployments" => [
        %{
          "deployment_id" => "dep_faulty",
          "automata_id" => "aut_faulty",
          "device_id" => "dev_faulty",
          "status" => "running",
          "deployment_metadata" => %{
            "latency" => %{
              "budget_ms" => 40,
              "warning_ms" => 25,
              "observed_ms" => 62
            },
            "trace" => %{
              "fault_profile" => "lab_profile",
              "trace_event_count" => 14,
              "recent_fault_actions" => ["delay", "drop"]
            }
          }
        },
        %{
          "deployment_id" => "dep_fault_enabled",
          "automata_id" => "aut_fault_enabled",
          "device_id" => "dev_fault_enabled",
          "status" => "running",
          "deployment_metadata" => %{
            "trace" => %{
              "fault_profile" => "staging_profile",
              "trace_event_count" => 7,
              "recent_fault_actions" => ["duplicate"]
            }
          }
        }
      ],
      "timelines" => %{
        "dep_faulty" => %{
          "events" => [
            %{
              "kind" => "deployment_status",
              "timestamp" => 1_100,
              "deployment_metadata" => %{
                "latency" => %{
                  "budget_ms" => 40,
                  "warning_ms" => 25,
                  "observed_ms" => 62
                },
                "trace" => %{
                  "fault_profile" => "lab_profile",
                  "trace_event_count" => 14,
                  "recent_fault_actions" => ["delay", "drop"]
                }
              },
              "latency_budget_ms" => 40,
              "latency_warning_ms" => 25,
              "observed_latency_ms" => 62,
              "fault_profile" => "lab_profile",
              "trace_event_count" => 14,
              "fault_actions" => ["delay", "drop"]
            },
            %{"kind" => "deployment_error", "timestamp" => 1_200}
          ]
        },
        "dep_fault_enabled" => %{
          "events" => [
            %{
              "kind" => "deployment_status",
              "timestamp" => 1_300,
              "deployment_metadata" => %{
                "trace" => %{
                  "fault_profile" => "staging_profile",
                  "trace_event_count" => 7,
                  "recent_fault_actions" => ["duplicate", "disconnect_window"]
                }
              },
              "fault_profile" => "staging_profile",
              "trace_event_count" => 7,
              "fault_actions" => ["duplicate", "disconnect_window"]
            }
          ]
        }
      }
    }

    projected = AnalyzerProjection.project(bundle)

    assert Enum.any?(projected["findings"], &(&1["kind"] == "latency_budget_exceeded"))
    assert Enum.any?(projected["findings"], &(&1["kind"] == "fault_profile_instability"))
    assert Enum.any?(projected["findings"], &(&1["kind"] == "fault_injection_active"))
    assert Enum.any?(projected["findings"], &(&1["kind"] == "fault_delivery_loss"))
    assert Enum.any?(projected["findings"], &(&1["kind"] == "fault_duplicate_delivery"))
    assert Enum.any?(projected["findings"], &(&1["kind"] == "fault_disconnect_window"))
    assert Enum.any?(projected["findings"], &(&1["kind"] == "fault_latency_injection"))
    assert projected["summary"]["fault_in_loop_count"] == 6
    assert projected["summary"]["latency_related_count"] == 1
  end

  test "correlates connection backlog and blockage with injected fault actions" do
    bundle = %{
      "automata" => [],
      "resources" => [],
      "deployments" => [
        %{
          "deployment_id" => "dep_src",
          "automata_id" => "aut_src",
          "device_id" => "dev_src",
          "deployment_metadata" => %{
            "trace" => %{"recent_fault_actions" => ["duplicate", "delay"]}
          }
        },
        %{
          "deployment_id" => "dep_dst",
          "automata_id" => "aut_dst",
          "device_id" => "dev_dst",
          "deployment_metadata" => %{
            "trace" => %{"recent_fault_actions" => ["disconnect_window", "drop"]}
          }
        }
      ],
      "connections" => [
        %{
          "id" => "conn_fault",
          "source_automata" => "aut_src",
          "source_output" => "status",
          "target_automata" => "aut_dst",
          "target_input" => "status"
        }
      ],
      "timelines" => %{
        "dep_src" => %{
          "events" => [
            %{
              "kind" => "output_changed",
              "name" => "status",
              "direction" => "output",
              "fault_actions" => ["duplicate"]
            },
            %{
              "kind" => "output_changed",
              "name" => "status",
              "direction" => "output",
              "fault_actions" => ["delay"]
            },
            %{"kind" => "output_changed", "name" => "status", "direction" => "output"}
          ]
        },
        "dep_dst" => %{
          "events" => [
            %{"kind" => "deployment_error", "fault_actions" => ["disconnect_window", "drop"]}
          ]
        }
      }
    }

    projected = AnalyzerProjection.project(bundle)

    assert Enum.any?(projected["findings"], &(&1["kind"] == "queue_backlog"))
    assert Enum.any?(projected["findings"], &(&1["kind"] == "blocked_handoff"))
    assert Enum.any?(projected["findings"], &(&1["kind"] == "fault_correlated_backlog"))
    assert Enum.any?(projected["findings"], &(&1["kind"] == "fault_correlated_handoff_blockage"))
  end
end
