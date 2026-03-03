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

  @spec for_device(map()) :: profile()
  def for_device(%{device_type: :arduino}), do: avr_uno_v1()
  def for_device(%{device_type: :esp32}), do: esp32_v1()
  def for_device(%{"device_type" => "arduino"}), do: avr_uno_v1()
  def for_device(%{"device_type" => "esp32"}), do: esp32_v1()
  def for_device(_device), do: desktop_v1()

  def desktop_v1 do
    %{
      id: "desktop_v1",
      compile_formats: ["yaml_v1"],
      feature_flags: ["lua_full", "timed", "telemetry_full"],
      limits: %{},
      runtime_mode: :legacy_yaml
    }
  end

  def esp32_v1 do
    %{
      id: "esp32_v1",
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
end
