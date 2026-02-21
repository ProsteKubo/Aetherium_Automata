defmodule AetheriumServer.AutomataYamlTest do
  use ExUnit.Case, async: true

  alias AetheriumServer.AutomataYaml

  test "preserves timed shorthand fields when rendering deploy yaml" do
    automata = %{
      "id" => "aut_timed_1",
      "name" => "timed-shorthand",
      "version" => "1.0.0",
      "initial_state" => "A",
      "states" => %{
        "A" => %{"id" => "A", "name" => "A"},
        "B" => %{"id" => "B", "name" => "B"}
      },
      "transitions" => %{
        "t1" => %{
          "id" => "t1",
          "from" => "A",
          "to" => "B",
          "type" => "timed",
          "after" => "1s"
        }
      },
      "variables" => []
    }

    %{yaml: yaml} = AutomataYaml.from_gateway_automata(automata)

    assert yaml =~ "timed:"
    assert yaml =~ "delay_ms: \"1s\""
  end
end
