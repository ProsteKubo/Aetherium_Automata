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
end
