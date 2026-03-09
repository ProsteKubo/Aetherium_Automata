defmodule AetheriumServer.TargetProfiles do
  @moduledoc """
  Target profile registry used for deploy validation/compilation and FE metadata.
  """

  @type profile :: %{
          id: String.t(),
          compile_formats: [String.t()],
          feature_flags: [String.t()],
          limits: map(),
          runtime_mode: :legacy_yaml | :compiled_ir
        }

  @avr_limits %{
    "max_states" => 16,
    "max_transitions" => 32,
    "max_variables" => 16,
    "max_string_literal_bytes" => 256,
    "max_script_bytecode_bytes" => 1024,
    "max_telemetry_queue_depth" => 16,
    "max_deploy_artifact_bytes" => 4096
  }

  @spec for_device(map(), map() | nil) :: profile()
  def for_device(device, automata \\ nil)

  def for_device(%{device_type: :arduino}, _automata), do: avr_uno_v1()
  def for_device(%{"device_type" => "arduino"}, _automata), do: avr_uno_v1()

  def for_device(%{device_type: :esp32}, automata), do: esp32_for_automata(automata)
  def for_device(%{"device_type" => "esp32"}, automata), do: esp32_for_automata(automata)

  def for_device(%{device_type: :mcxn947}, automata), do: mcxn947_for_automata(automata)
  def for_device(%{"device_type" => "mcxn947"}, automata), do: mcxn947_for_automata(automata)

  def for_device(_device, _automata), do: desktop_v1()

  def desktop_v1 do
    %{
      id: "desktop_v1",
      compile_formats: ["yaml_v1"],
      feature_flags: ["lua_full", "timed", "telemetry_full"],
      limits: %{},
      runtime_mode: :legacy_yaml
    }
  end

  def esp32_lua_v1 do
    %{
      id: "esp32_lua_v1",
      compile_formats: ["aeth_ir_v1"],
      feature_flags: [
        "lua_full",
        "timed",
        "telemetry_basic",
        "esp32_gpio",
        "esp32_pwm",
        "esp32_adc",
        "esp32_dac",
        "esp32_i2c",
        "esp32_components"
      ],
      limits: %{
        "max_states" => 256,
        "max_transitions" => 512,
        "max_variables" => 128,
        "max_string_literal_bytes" => 4096,
        "max_script_bytecode_bytes" => 65_536,
        "max_telemetry_queue_depth" => 128,
        "max_deploy_artifact_bytes" => 256_000,
        "min_heap_free_bytes" => 81_920
      },
      runtime_mode: :compiled_ir
    }
  end

  def esp32_ir_v1 do
    %{
      id: "esp32_ir_v1",
      compile_formats: ["aeth_ir_v1"],
      feature_flags: ["lua_subset", "timed", "telemetry_basic"],
      limits: %{
        "max_states" => 256,
        "max_transitions" => 512,
        "max_variables" => 128,
        "max_string_literal_bytes" => 4096,
        "max_script_bytecode_bytes" => 32_768,
        "max_telemetry_queue_depth" => 128,
        "max_deploy_artifact_bytes" => 256_000
      },
      runtime_mode: :compiled_ir
    }
  end

  def avr_uno_v1 do
    %{
      id: "avr_uno_v1",
      compile_formats: ["aeth_ir_v1"],
      feature_flags: ["lua_subset", "timed", "telemetry_basic"],
      limits: @avr_limits,
      runtime_mode: :compiled_ir
    }
  end

  def mcxn947_lua_v1 do
    %{
      id: "mcxn947_lua_v1",
      compile_formats: ["aeth_ir_v1"],
      feature_flags: ["lua_full", "timed", "telemetry_basic", "mcxn947_gpio"],
      limits: %{
        "max_states" => 256,
        "max_transitions" => 512,
        "max_variables" => 128,
        "max_string_literal_bytes" => 4096,
        "max_script_bytecode_bytes" => 65_536,
        "max_telemetry_queue_depth" => 128,
        "max_deploy_artifact_bytes" => 256_000,
        "min_heap_free_bytes" => 65_536
      },
      runtime_mode: :compiled_ir
    }
  end

  defp esp32_for_automata(automata) do
    case requested_profile_id(automata) do
      "esp32_ir_v1" -> esp32_ir_v1()
      "esp32_lua_v1" -> esp32_lua_v1()
      _ -> esp32_lua_v1()
    end
  end

  defp mcxn947_for_automata(automata) do
    case requested_profile_id(automata) do
      "mcxn947_lua_v1" -> mcxn947_lua_v1()
      _ -> mcxn947_lua_v1()
    end
  end

  defp requested_profile_id(nil), do: nil

  defp requested_profile_id(automata) when is_map(automata) do
    config = automata[:config] || automata["config"] || %{}
    target = config[:target] || config["target"] || %{}
    target[:profile] || target["profile"]
  end
end
