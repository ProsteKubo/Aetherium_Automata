defmodule AetheriumServer.AutomataDeployCompiler do
  @moduledoc """
  Target-aware deploy preparation entrypoint.

  v1 behavior:
  - Desktop/legacy targets: convert to YAML payload (existing behavior).
  - Compiled targets (AVR/ESP32): validate against target profile and emit `aeth_ir_v1`.
  """

  alias AetheriumServer.AethIrArtifact
  alias AetheriumServer.AethIrBytecode
  alias AetheriumServer.AutomataYaml
  alias AetheriumServer.TargetProfiles

  @type diagnostics :: map()

  @spec prepare(map(), map()) ::
          {:ok,
           %{
             format: atom(),
             yaml: binary() | nil,
             data: binary() | nil,
             state_id_map: map(),
             transition_id_map: map(),
             diagnostics: diagnostics(),
             profile: map()
           }}
          | {:error, {:deploy_validation_failed, map(), diagnostics()}}
  def prepare(automata, device) when is_map(automata) and is_map(device) do
    profile = TargetProfiles.for_device(device)
    diagnostics = validate(automata, profile)

    case {profile.runtime_mode, diagnostics["errors"]} do
      {_mode, [_ | _]} ->
        {:error, {:deploy_validation_failed, profile, diagnostics}}

      {:legacy_yaml, _} ->
        %{yaml: yaml, state_id_map: state_id_map, transition_id_map: transition_id_map} =
          AutomataYaml.from_gateway_automata(automata)

        {:ok,
         %{
           format: :yaml,
           yaml: yaml,
           data: nil,
           state_id_map: state_id_map,
           transition_id_map: transition_id_map,
           diagnostics: diagnostics,
           profile: profile
         }}

      {:compiled_ir, _} ->
        case AethIrBytecode.compile_gateway_automata(automata) do
          {:ok, compiled_bytecode} ->
            with {:ok, artifact} <-
                   AethIrArtifact.encode_engine_bytecode(compiled_bytecode.payload, profile.id) do
              diagnostics =
                put_in(
                  diagnostics["warnings"],
                  diagnostics["warnings"] ++
                    compiled_bytecode.warnings ++
                    ["Compiled to aeth_ir_v1 EngineBytecode subset for #{profile.id}."]
                )

              {:ok,
               %{
                 format: :aeth_ir_v1,
                 yaml: nil,
                 data: artifact,
                 state_id_map: compiled_bytecode.state_id_map,
                 transition_id_map: compiled_bytecode.transition_id_map,
                 diagnostics: diagnostics,
                 profile: profile
               }}
            end

          {:unsupported, reasons} ->
            if allow_yaml_fallback?(profile) do
              %{yaml: yaml, state_id_map: state_id_map, transition_id_map: transition_id_map} =
                AutomataYaml.from_gateway_automata(automata)

              with {:ok, artifact} <- AethIrArtifact.encode_yaml(yaml, ".") do
                diagnostics =
                  put_in(
                    diagnostics["warnings"],
                    diagnostics["warnings"] ++
                      [
                        "Bytecode subset compiler fallback: emitting transitional aeth_ir_v1 YAML payload."
                      ] ++ reasons
                  )

                {:ok,
                 %{
                   format: :aeth_ir_v1,
                   yaml: nil,
                   data: artifact,
                   state_id_map: state_id_map,
                   transition_id_map: transition_id_map,
                   diagnostics: diagnostics,
                   profile: profile
                 }}
              end
            else
              {:error,
               {:deploy_validation_failed, profile,
                %{
                  "warnings" => diagnostics["warnings"],
                  "errors" =>
                    [
                      "#{profile.id} target requires bytecode-compatible automata for aeth_ir_v1 deploy."
                    ] ++ reasons
                }}}
            end

          {:error, reason} ->
            {:error,
             {:deploy_validation_failed, profile,
              %{
                "warnings" => diagnostics["warnings"],
                "errors" => ["Bytecode compiler error: #{inspect(reason)}"]
              }}}
        end
    end
  end

  defp validate(automata, profile) do
    limits = profile.limits || %{}

    state_count = count_map_entries(automata[:states] || automata["states"])
    transition_count = count_map_entries(automata[:transitions] || automata["transitions"])
    variables = automata[:variables] || automata["variables"] || []
    variable_count = if is_list(variables), do: length(variables), else: 0

    errors =
      []
      |> maybe_limit_error("states", state_count, limits["max_states"])
      |> maybe_limit_error("transitions", transition_count, limits["max_transitions"])
      |> maybe_limit_error("variables", variable_count, limits["max_variables"])
      |> maybe_lua_subset_error(automata, profile)

    warnings =
      if profile.runtime_mode == :compiled_ir do
        ["#{profile.id} deploys require server-side compilation to Aetherium IR (aeth_ir_v1)."]
      else
        []
      end

    %{"warnings" => warnings, "errors" => Enum.reverse(errors)}
  end

  defp maybe_limit_error(errors, _label, _count, nil), do: errors

  defp maybe_limit_error(errors, label, count, max) when is_integer(max) and count > max do
    ["#{label} exceed target limit (#{count}/#{max})" | errors]
  end

  defp maybe_limit_error(errors, _label, _count, _max), do: errors

  defp maybe_lua_subset_error(errors, automata, profile) do
    if lua_subset_profile?(profile) and contains_lua?(automata) do
      [
        "#{profile.id} target accepts Aetherium Lua subset only; Lua subset compiler/transpiler is not implemented yet."
        | errors
      ]
    else
      errors
    end
  end

  defp lua_subset_profile?(profile) when is_map(profile) do
    flags = profile[:feature_flags] || profile["feature_flags"] || []
    Enum.any?(flags, &(to_string(&1) == "lua_subset"))
  end

  defp lua_subset_profile?(_), do: false

  defp allow_yaml_fallback?(profile), do: profile.id == "avr_uno_v1"

  defp contains_lua?(value) when is_binary(value) do
    String.contains?(String.downcase(value), "lua")
  end

  defp contains_lua?(value) when is_list(value), do: Enum.any?(value, &contains_lua?/1)

  defp contains_lua?(value) when is_map(value) do
    Enum.any?(value, fn {k, v} ->
      (is_binary(k) and String.contains?(String.downcase(k), "lua")) or
        (is_atom(k) and k |> Atom.to_string() |> String.contains?("lua")) or contains_lua?(v)
    end)
  end

  defp contains_lua?(_), do: false

  defp count_map_entries(map) when is_map(map), do: map_size(map)
  defp count_map_entries(_), do: 0
end
