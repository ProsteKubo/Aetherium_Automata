defmodule AetheriumServer.ShowcaseCatalogTest do
  use ExUnit.Case, async: true

  alias AetheriumServer.ShowcaseCatalog

  test "list_entries returns stable showcase ids and relative paths" do
    assert {:ok, entries} = ShowcaseCatalog.list_entries()
    assert length(entries) >= 1

    first = hd(entries)
    assert String.starts_with?(first.id, "showcase_")
    assert String.starts_with?(first.relative_path, "example/automata/showcase/")
    assert File.exists?(first.absolute_path)
  end

  test "load_automata parses flagship showcase YAML into deploy-ready map" do
    assert {:ok, %{automata: automata}} =
             ShowcaseCatalog.load_automata(
               "example/automata/showcase/13_petri_signal_chain/petri_command_router.yaml"
             )

    assert automata["name"] == "Petri Command Router"
    assert automata["initial_state"] == "Standby"
    assert is_map(automata["states"])
    assert map_size(automata["states"]) >= 6
    assert is_map(automata["transitions"])
    assert is_list(automata["variables"])
  end

  test "load_bundle assembles the flagship desktop showcase" do
    assert {:ok, bundle} = ShowcaseCatalog.load_bundle("flagship_desktop")

    assert bundle.id == "flagship_desktop"
    assert length(bundle.members) == 13
    assert Enum.any?(bundle.members, &(&1.network == "Aetherium Gem Cell"))
    assert Enum.any?(bundle.members, &(&1.network == "Signal Chain Backbone"))
    assert Enum.any?(bundle.members, &(&1.device_role == "black_box"))
  end

  test "load_automata parses Aetherium gem showcase contract and state-heavy workflow" do
    assert {:ok, %{automata: automata}} =
             ShowcaseCatalog.load_automata(
               "example/automata/showcase/15_aetherium_gem/aetherium_gem_cell.yaml"
             )

    assert automata["name"] == "Aetherium Gem Cell"
    assert automata["initial_state"] == "Boot"
    assert map_size(automata["states"]) >= 15
    assert is_map(automata["transitions"])
    assert get_in(automata, ["black_box", "resources", Access.at(0), "name"]) ==
             "gem_workcell_bus"
  end

  test "load_automata preserves black-box contracts for docker probes" do
    assert {:ok, %{automata: automata}} =
             ShowcaseCatalog.load_automata(
               "example/automata/showcase/12_black_box/docker_black_box_probe.yaml"
             )

    assert get_in(automata, ["black_box", "ports"]) |> is_list()
    assert get_in(automata, ["black_box", "observable_states"]) == ["Idle", "Armed", "Faulted"]
    assert get_in(automata, ["black_box", "resources"]) == [
             %{
               "name" => "battery_pack",
               "kind" => "energy",
               "capacity" => 1,
               "shared" => false,
               "latency_sensitive" => true
             }
           ]
  end
end
