defmodule AetheriumServer.AutomataDeployCompilerTest do
  use ExUnit.Case, async: true

  alias AetheriumServer.AutomataDeployCompiler
  alias AetheriumServer.AethIrArtifact

  test "desktop profile compiles to legacy yaml payload" do
    automata = sample_automata()
    device = %{device_type: :desktop}

    assert {:ok, compiled} = AutomataDeployCompiler.prepare(automata, device)
    assert compiled.format == :yaml
    assert is_binary(compiled.yaml)
    assert compiled.profile.id == "desktop_v1"
    assert compiled.diagnostics["errors"] == []
  end

  test "avr uno profile falls back to yaml artifact for unsupported subset features" do
    automata = sample_unsupported_automata()
    device = %{device_type: :arduino}

    assert {:ok, compiled} =
             AutomataDeployCompiler.prepare(automata, device)

    assert compiled.format == :aeth_ir_v1
    assert is_binary(compiled.data)
    assert compiled.yaml == nil
    assert compiled.profile.id == "avr_uno_v1"
    assert "aeth_ir_v1" in compiled.profile.compile_formats
    assert compiled.diagnostics["errors"] == []
    assert Enum.any?(compiled.diagnostics["warnings"], &String.contains?(&1, "aeth_ir_v1"))
    assert Enum.any?(compiled.diagnostics["warnings"], &String.contains?(&1, "fallback"))

    assert {:ok, artifact} = AethIrArtifact.decode(compiled.data)
    assert artifact.format == :aeth_ir_v1
    assert artifact.payload_kind == :yaml_text
    assert is_binary(artifact.payload)
  end

  test "avr uno profile compiles supported subset to engine bytecode artifact" do
    automata = sample_bytecode_subset_automata()
    device = %{device_type: :arduino}

    assert {:ok, compiled} = AutomataDeployCompiler.prepare(automata, device)

    assert compiled.format == :aeth_ir_v1
    assert compiled.profile.id == "avr_uno_v1"
    assert compiled.diagnostics["errors"] == []

    assert Enum.any?(
             compiled.diagnostics["warnings"],
             &String.contains?(&1, "EngineBytecode subset")
           )

    assert {:ok, artifact} = AethIrArtifact.decode(compiled.data)
    assert artifact.payload_kind == :engine_bytecode
    assert artifact.source_label == "avr_uno_v1"
    assert is_binary(artifact.payload)
    assert byte_size(artifact.payload) > 8
  end

  test "avr uno profile compiles compound classic conditions to engine bytecode artifact" do
    automata = sample_compound_condition_automata()

    assert {:ok, compiled} = AutomataDeployCompiler.prepare(automata, %{device_type: :arduino})
    assert {:ok, artifact} = AethIrArtifact.decode(compiled.data)
    assert artifact.payload_kind == :engine_bytecode
    assert compiled.diagnostics["errors"] == []
  end

  test "avr uno profile compiles supported event transition subset to engine bytecode artifact" do
    automata = sample_event_subset_automata()

    assert {:ok, compiled} = AutomataDeployCompiler.prepare(automata, %{device_type: :arduino})
    assert {:ok, artifact} = AethIrArtifact.decode(compiled.data)
    assert artifact.payload_kind == :engine_bytecode
    assert compiled.diagnostics["errors"] == []
  end

  test "avr uno profile compiles on_threshold event transition subset to engine bytecode artifact" do
    automata = sample_event_threshold_subset_automata()

    assert {:ok, compiled} = AutomataDeployCompiler.prepare(automata, %{device_type: :arduino})
    assert {:ok, artifact} = AethIrArtifact.decode(compiled.data)
    assert artifact.payload_kind == :engine_bytecode
  end

  test "avr uno profile compiles on_match event transition subset to engine bytecode artifact" do
    automata = sample_event_match_subset_automata()

    assert {:ok, compiled} = AutomataDeployCompiler.prepare(automata, %{device_type: :arduino})
    assert {:ok, artifact} = AethIrArtifact.decode(compiled.data)
    assert artifact.payload_kind == :engine_bytecode
  end

  test "esp32 rich profile compiles Lua-bearing automata to engine bytecode artifact" do
    automata = sample_lua_esp32_automata()

    assert {:ok, compiled} = AutomataDeployCompiler.prepare(automata, %{device_type: :esp32})
    assert compiled.format == :aeth_ir_v1
    assert compiled.profile.id == "esp32_lua_v1"
    assert compiled.diagnostics["errors"] == []

    assert {:ok, artifact} = AethIrArtifact.decode(compiled.data)
    assert artifact.payload_kind == :engine_bytecode
    assert artifact.source_label == "esp32_lua_v1"
  end

  test "esp32 ir profile compiles supported subset to engine bytecode artifact" do
    automata =
      sample_bytecode_subset_automata()
      |> Map.put(:config, %{target: %{profile: "esp32_ir_v1"}})

    assert {:ok, compiled} = AutomataDeployCompiler.prepare(automata, %{device_type: :esp32})
    assert compiled.format == :aeth_ir_v1
    assert compiled.profile.id == "esp32_ir_v1"
    assert compiled.diagnostics["errors"] == []

    assert {:ok, artifact} = AethIrArtifact.decode(compiled.data)
    assert artifact.payload_kind == :engine_bytecode
    assert artifact.source_label == "esp32_ir_v1"
  end

  test "esp32 ir profile rejects unsupported subset constructs instead of yaml fallback" do
    automata =
      sample_unsupported_automata()
      |> Map.put(:config, %{target: %{profile: "esp32_ir_v1"}})

    assert {:error, {:deploy_validation_failed, profile, diagnostics}} =
             AutomataDeployCompiler.prepare(automata, %{device_type: :esp32})

    assert profile.id == "esp32_ir_v1"
    assert Enum.any?(diagnostics["errors"], &String.contains?(&1, "bytecode-compatible"))
    refute Enum.any?(diagnostics["warnings"], &String.contains?(&1, "fallback"))
  end

  test "avr uno profile compiles classic value() helper conditions to engine bytecode artifact" do
    automata =
      sample_bytecode_subset_automata()
      |> put_in([:transitions, "t_gate", :condition], "value(\"enabled\") == true")

    assert {:ok, compiled} = AutomataDeployCompiler.prepare(automata, %{device_type: :arduino})
    assert {:ok, artifact} = AethIrArtifact.decode(compiled.data)
    assert artifact.payload_kind == :engine_bytecode
  end

  test "esp32 rich profile compiles classic value() helper conditions to engine bytecode artifact" do
    automata =
      sample_lua_esp32_automata()
      |> put_in([:transitions, "t_gate", :condition], "value(\"enabled\") == true")

    assert {:ok, compiled} = AutomataDeployCompiler.prepare(automata, %{device_type: :esp32})
    assert {:ok, artifact} = AethIrArtifact.decode(compiled.data)
    assert artifact.payload_kind == :engine_bytecode
  end

  test "esp32 rich profile accepts timed after values with explicit duration suffixes" do
    automata =
      sample_lua_esp32_automata()
      |> put_in([:transitions, "t_done", :after], "1200ms")

    assert {:ok, compiled} = AutomataDeployCompiler.prepare(automata, %{device_type: :esp32})
    assert compiled.diagnostics["errors"] == []
    assert {:ok, artifact} = AethIrArtifact.decode(compiled.data)
    assert artifact.payload_kind == :engine_bytecode
  end

  test "esp32 rich profile accepts timed after second suffix values" do
    automata =
      sample_lua_esp32_automata()
      |> put_in([:transitions, "t_done", :after], "1.5s")

    assert {:ok, compiled} = AutomataDeployCompiler.prepare(automata, %{device_type: :esp32})
    assert compiled.diagnostics["errors"] == []
    assert {:ok, artifact} = AethIrArtifact.decode(compiled.data)
    assert artifact.payload_kind == :engine_bytecode
  end

  test "esp32 rich profile accepts builtin oled component without manifest" do
    automata =
      sample_lua_esp32_automata()
      |> put_in([:config, :target, :esp32, :components], [%{name: "ssd1306_text", builtin: true}])

    assert {:ok, compiled} = AutomataDeployCompiler.prepare(automata, %{device_type: :esp32})
    assert compiled.diagnostics["errors"] == []
    assert {:ok, artifact} = AethIrArtifact.decode(compiled.data)
    assert artifact.payload_kind == :engine_bytecode
  end

  test "mcxn947 rich profile compiles Lua-bearing automata to engine bytecode artifact" do
    automata = sample_lua_mcxn947_automata()

    assert {:ok, compiled} = AutomataDeployCompiler.prepare(automata, %{device_type: :mcxn947})
    assert compiled.format == :aeth_ir_v1
    assert compiled.profile.id == "mcxn947_lua_v1"
    assert compiled.diagnostics["errors"] == []

    assert {:ok, artifact} = AethIrArtifact.decode(compiled.data)
    assert artifact.payload_kind == :engine_bytecode
    assert artifact.source_label == "mcxn947_lua_v1"
  end

  test "mcxn947 rich profile compiles touch component automata to engine bytecode artifact" do
    automata = sample_lua_mcxn947_touch_automata()

    assert {:ok, compiled} = AutomataDeployCompiler.prepare(automata, %{device_type: :mcxn947})
    assert compiled.profile.id == "mcxn947_lua_v1"
    assert compiled.diagnostics["errors"] == []

    assert {:ok, artifact} = AethIrArtifact.decode(compiled.data)
    assert artifact.payload_kind == :engine_bytecode
    assert artifact.source_label == "mcxn947_lua_v1"
  end

  test "mcxn947 rich profile rejects mismatched requested profile" do
    automata =
      sample_lua_mcxn947_automata()
      |> put_in([:config, :target, :profile], "esp32_lua_v1")

    assert {:error, {:deploy_validation_failed, profile, diagnostics}} =
             AutomataDeployCompiler.prepare(automata, %{device_type: :mcxn947})

    assert profile.id == "mcxn947_lua_v1"
    assert Enum.any?(diagnostics["errors"], &String.contains?(&1, "requested target profile"))
  end

  test "avr uno profile enforces basic count limits" do
    automata =
      sample_automata()
      |> Map.put(
        :states,
        1..20
        |> Enum.map(fn i -> {"s#{i}", %{id: "s#{i}", name: "S#{i}", type: :normal}} end)
        |> Enum.into(%{})
      )

    assert {:error, {:deploy_validation_failed, profile, diagnostics}} =
             AutomataDeployCompiler.prepare(automata, %{device_type: :arduino})

    assert profile.id == "avr_uno_v1"
    assert Enum.any?(diagnostics["errors"], &String.contains?(&1, "states exceed target limit"))
  end

  defp sample_automata do
    %{
      id: "compiler-test",
      name: "Compiler Test",
      version: "1.0.0",
      config: %{target: %{profile: "desktop_v1"}},
      states: %{
        "idle" => %{id: "idle", name: "Idle", type: :initial},
        "running" => %{id: "running", name: "Running", type: :normal}
      },
      transitions: %{
        "t1" => %{
          id: "t1",
          from: "idle",
          to: "running",
          type: :classic,
          condition: "enabled == true"
        }
      },
      variables: [
        %{id: "v1", name: "enabled", type: "bool", direction: :input, default: false}
      ]
    }
  end

  defp sample_unsupported_automata do
    %{
      id: "compiler-unsupported",
      name: "Compiler Unsupported",
      version: "1.0.0",
      states: %{
        "idle" => %{id: "idle", name: "Idle", type: :initial},
        "running" => %{id: "running", name: "Running", type: :normal}
      },
      transitions: %{
        "t1" => %{
          id: "t1",
          from: "idle",
          to: "running",
          type: :event,
          event: %{
            triggers: [
              %{signal: "enabled", trigger: :on_rise},
              %{signal: "enabled", trigger: :on_fall}
            ]
          }
        }
      },
      variables: [
        %{id: "v1", name: "enabled", type: "bool", direction: :input, default: false}
      ]
    }
  end

  defp sample_lua_esp32_automata do
    %{
      id: "compiler-esp32-lua",
      name: "Compiler ESP32 Lua",
      version: "1.0.0",
      config: %{
        target: %{
          profile: "esp32_lua_v1",
          esp32: %{
            resources: [
              %{kind: "gpio", name: "status_led", pin: 2},
              %{kind: "dac", name: "analog_out", pin: 25}
            ],
            components: [
              %{name: "i2c_scanner", manifest: "components/i2c_scanner.json"}
            ]
          }
        }
      },
      states: %{
        "idle" => %{
          id: "idle",
          name: "Idle",
          type: :initial,
          code: ~s|gpio.mode(2, "output")\ngpio.write(2, 1)|
        },
        "running" => %{
          id: "running",
          name: "Running",
          type: :normal,
          hooks: %{onEnter: ~s|dac.write(25, 128)|}
        }
      },
      transitions: %{
        "t_gate" => %{
          id: "t_gate",
          from: "idle",
          to: "running",
          type: :classic,
          condition: "enabled == true",
          body: ~s|log("info", "transition")|
        },
        "t_done" => %{
          id: "t_done",
          from: "running",
          to: "idle",
          type: :timed,
          after: 250
        }
      },
      variables: [
        %{id: "v1", name: "enabled", type: "bool", direction: :input, default: false}
      ]
    }
  end

  defp sample_lua_mcxn947_automata do
    %{
      id: "compiler-mcxn947-lua",
      name: "Compiler MCXN947 Lua",
      version: "1.0.0",
      config: %{
        target: %{
          profile: "mcxn947_lua_v1"
        }
      },
      states: %{
        "idle" => %{
          id: "idle",
          name: "Idle",
          type: :initial,
          code: ~s|gpio.mode(10, "output")\ngpio.write(10, 1)|
        },
        "running" => %{
          id: "running",
          name: "Running",
          type: :normal,
          hooks: %{onEnter: ~s|gpio.mode(23, "input_pullup")|}
        }
      },
      transitions: %{
        "t_gate" => %{
          id: "t_gate",
          from: "idle",
          to: "running",
          type: :classic,
          condition: "enabled == true",
          body: ~s|log("info", "transition")|
        },
        "t_done" => %{
          id: "t_done",
          from: "running",
          to: "idle",
          type: :timed,
          after: 250
        }
      },
      variables: [
        %{id: "v1", name: "enabled", type: "bool", direction: :input, default: false}
      ]
    }
  end

  defp sample_lua_mcxn947_touch_automata do
    %{
      id: "compiler-mcxn947-touch",
      name: "Compiler MCXN947 Touch",
      version: "1.0.0",
      config: %{
        target: %{
          profile: "mcxn947_lua_v1"
        }
      },
      states: %{
        "sense" => %{
          id: "sense",
          name: "Sense",
          type: :initial,
          hooks: %{onEnter: ~s|component("touch_pad"):init()|},
          code: ~s|local touched = component("touch_pad"):pressed()\nif touched then gpio.write(10, 1) else gpio.write(10, 0) end|
        }
      },
      transitions: %{
        "stay_active" => %{
          id: "stay_active",
          from: "sense",
          to: "sense",
          type: :classic,
          condition: "false"
        }
      },
      variables: []
    }
  end

  defp sample_bytecode_subset_automata do
    %{
      id: "compiler-bytecode-subset",
      name: "Compiler Bytecode Subset",
      version: "1.0.0",
      initial_state: "idle",
      states: %{
        "idle" => %{id: "idle", name: "Idle", type: :initial},
        "running" => %{id: "running", name: "Running", type: :normal},
        "done" => %{id: "done", name: "Done", type: :normal}
      },
      transitions: %{
        "t_gate" => %{
          id: "t_gate",
          from: "idle",
          to: "running",
          type: :classic,
          condition: "enabled == true"
        },
        "t_immediate" => %{
          id: "t_immediate",
          from: "running",
          to: "done",
          type: :immediate
        },
        "t_done" => %{
          id: "t_done",
          from: "done",
          to: "idle",
          type: :timed,
          after: 25
        }
      },
      variables: [
        %{id: "v1", name: "enabled", type: "bool", direction: :input, default: false},
        %{id: "v2", name: "count", type: "int", direction: :internal, default: 0}
      ]
    }
  end

  defp sample_compound_condition_automata do
    sample_bytecode_subset_automata()
    |> put_in(
      [:transitions, "t_gate", :condition],
      "(enabled == true and count >= 0) or enabled == false"
    )
  end

  defp sample_event_subset_automata do
    %{
      id: "compiler-event-subset",
      name: "Compiler Event Subset",
      version: "1.0.0",
      initial_state: "idle",
      states: %{
        "idle" => %{id: "idle", name: "Idle", type: :initial},
        "running" => %{id: "running", name: "Running", type: :normal}
      },
      transitions: %{
        "t_evt" => %{
          id: "t_evt",
          from: "idle",
          to: "running",
          type: :event,
          event: %{triggers: [%{signal: "enabled", trigger: :on_rise}]}
        }
      },
      variables: [
        %{id: "v1", name: "enabled", type: "bool", direction: :input, default: false}
      ]
    }
  end

  defp sample_event_threshold_subset_automata do
    %{
      id: "compiler-event-threshold-subset",
      name: "Compiler Event Threshold Subset",
      version: "1.0.0",
      initial_state: "idle",
      states: %{
        "idle" => %{id: "idle", name: "Idle", type: :initial},
        "alert" => %{id: "alert", name: "Alert", type: :normal}
      },
      transitions: %{
        "t_evt" => %{
          id: "t_evt",
          from: "idle",
          to: "alert",
          type: :event,
          event: %{
            triggers: [
              %{signal: "temp", trigger: :on_threshold, threshold: %{op: :gt, value: 10}}
            ]
          }
        }
      },
      variables: [
        %{id: "v1", name: "temp", type: "int", direction: :input, default: 0}
      ]
    }
  end

  defp sample_event_match_subset_automata do
    %{
      id: "compiler-event-match-subset",
      name: "Compiler Event Match Subset",
      version: "1.0.0",
      initial_state: "idle",
      states: %{
        "idle" => %{id: "idle", name: "Idle", type: :initial},
        "matched" => %{id: "matched", name: "Matched", type: :normal}
      },
      transitions: %{
        "t_evt" => %{
          id: "t_evt",
          from: "idle",
          to: "matched",
          type: :event,
          event: %{triggers: [%{signal: "cmd", trigger: :on_match, pattern: "GO"}]}
        }
      },
      variables: [
        %{id: "v1", name: "cmd", type: "string", direction: :input, default: ""}
      ]
    }
  end
end
