defmodule AetheriumServer.AethIrArtifact do
  @moduledoc """
  Minimal AETHIRV1 artifact serializer for transitional server-side compile output.

  Current payload kind support:
  - `:yaml_text` (wrap YAML as an artifact container)
  - `:engine_bytecode` (compact binary IR/bytecode payload)
  """

  @magic "AETHIRV1"
  @format_aeth_ir_v1 0x01
  @payload_yaml_text 0x01
  @payload_engine_bytecode 0x02

  @type payload_kind :: :yaml_text | :engine_bytecode

  @spec encode_yaml(binary(), binary()) :: {:ok, binary()} | {:error, term()}
  def encode_yaml(yaml, source_label \\ ".") when is_binary(yaml) and is_binary(source_label) do
    encode(%{
      format: :aeth_ir_v1,
      version_major: 0,
      version_minor: 1,
      payload_kind: :yaml_text,
      source_label: source_label,
      payload: yaml
    })
  end

  @spec encode_engine_bytecode(binary(), binary()) :: {:ok, binary()} | {:error, term()}
  def encode_engine_bytecode(payload, source_label \\ ".")
      when is_binary(payload) and is_binary(source_label) do
    encode(%{
      format: :aeth_ir_v1,
      version_major: 0,
      version_minor: 1,
      payload_kind: :engine_bytecode,
      source_label: source_label,
      payload: payload
    })
  end

  @spec encode(map()) :: {:ok, binary()} | {:error, term()}
  def encode(%{
        format: :aeth_ir_v1,
        version_major: maj,
        version_minor: min,
        payload_kind: kind,
        source_label: source_label,
        payload: payload
      })
      when is_integer(maj) and is_integer(min) and is_binary(source_label) and is_binary(payload) do
    with {:ok, payload_kind_byte} <- encode_payload_kind(kind),
         :ok <- ensure_u16(byte_size(source_label), :source_label_too_large),
         :ok <- ensure_u32(byte_size(payload), :payload_too_large) do
      bin =
        <<
          @magic::binary,
          @format_aeth_ir_v1::8,
          maj::16-big,
          min::16-big,
          payload_kind_byte::8,
          byte_size(source_label)::16-big,
          byte_size(payload)::32-big,
          source_label::binary,
          payload::binary
        >>

      {:ok, bin}
    end
  end

  def encode(_), do: {:error, :invalid_artifact}

  @spec decode(binary()) :: {:ok, map()} | {:error, term()}
  def decode(<<
        @magic::binary,
        @format_aeth_ir_v1::8,
        maj::16-big,
        min::16-big,
        payload_kind::8,
        label_len::16-big,
        payload_len::32-big,
        rest::binary
      >>) do
    with true <- byte_size(rest) == label_len + payload_len or {:error, :artifact_size_mismatch},
         <<label::binary-size(label_len), payload::binary-size(payload_len)>> <- rest,
         {:ok, kind} <- decode_payload_kind(payload_kind) do
      {:ok,
       %{
         format: :aeth_ir_v1,
         version_major: maj,
         version_minor: min,
         payload_kind: kind,
         source_label: label,
         payload: payload
       }}
    else
      {:error, reason} -> {:error, reason}
      _ -> {:error, :invalid_artifact}
    end
  end

  def decode(_), do: {:error, :invalid_artifact}

  defp encode_payload_kind(:yaml_text), do: {:ok, @payload_yaml_text}
  defp encode_payload_kind(:engine_bytecode), do: {:ok, @payload_engine_bytecode}
  defp encode_payload_kind(other), do: {:error, {:unsupported_payload_kind, other}}

  defp decode_payload_kind(@payload_yaml_text), do: {:ok, :yaml_text}
  defp decode_payload_kind(@payload_engine_bytecode), do: {:ok, :engine_bytecode}
  defp decode_payload_kind(other), do: {:error, {:unsupported_payload_kind, other}}

  defp ensure_u16(n, _reason) when is_integer(n) and n >= 0 and n <= 0xFFFF, do: :ok
  defp ensure_u16(_n, reason), do: {:error, reason}

  defp ensure_u32(n, _reason) when is_integer(n) and n >= 0 and n <= 0xFFFF_FFFF, do: :ok
  defp ensure_u32(_n, reason), do: {:error, reason}
end
