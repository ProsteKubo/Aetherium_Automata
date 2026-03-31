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

  test "load_automata parses inline showcase YAML into deploy-ready map" do
    assert {:ok, %{automata: automata}} =
             ShowcaseCatalog.load_automata(
               "example/automata/showcase/01_basics/blink_with_manual_override.yaml"
             )

    assert automata["name"] == "Blink With Manual Override"
    assert automata["initial_state"] == "Off"
    assert is_map(automata["states"])
    assert is_map(automata["transitions"])
    assert is_list(automata["variables"])
  end

  test "load_automata supports folderized showcase YAML list/map hybrid form" do
    assert {:ok, %{automata: automata}} =
             ShowcaseCatalog.load_automata(
               "example/automata/showcase/07_folderized/door_safety_controller/door_safety_controller.yaml"
             )

    assert automata["name"] != ""
    assert automata["initial_state"] == "Closed"
    assert Map.has_key?(automata["transitions"], "OpenDoor")
    assert automata["transitions"]["OpenDoor"]["from"] == "Closed"
    assert automata["transitions"]["OpenDoor"]["to"] == "Open"
  end

  test "load_automata preserves esp32 target config and rich lua state content" do
    assert {:ok, %{automata: automata}} =
             ShowcaseCatalog.load_automata(
               "example/automata/showcase/08_esp32/esp32_oled_pot_dashboard.yaml"
             )

    assert get_in(automata, ["config", "target", "profile"]) == "esp32_lua_v1"
    assert get_in(automata, ["config", "target", "esp32", "components"]) |> is_list()

    assert String.contains?(
             automata["states"]["Dashboard"]["code"],
             "component(\"ssd1306_text\")"
           )

    assert String.contains?(automata["states"]["Dashboard"]["hooks"]["onEnter"], "display:init")
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
