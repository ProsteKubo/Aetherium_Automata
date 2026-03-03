defmodule AetheriumServer.EngineProtocolStream do
  @moduledoc false

  @magic <<0xAE, 0x01>>
  @header_size 6

  @spec extract_frames(binary()) :: {[binary()], binary()}
  def extract_frames(buffer) when is_binary(buffer) do
    do_extract(buffer, [])
  end

  defp do_extract(buffer, acc) when byte_size(buffer) < @header_size do
    {Enum.reverse(acc), buffer}
  end

  defp do_extract(<<@magic, _version::8, _type::8, len::16, _rest::binary>> = buffer, acc) do
    frame_size = @header_size + len

    if byte_size(buffer) >= frame_size do
      <<frame::binary-size(frame_size), rest::binary>> = buffer
      do_extract(rest, [frame | acc])
    else
      {Enum.reverse(acc), buffer}
    end
  end

  defp do_extract(buffer, acc) do
    case :binary.match(buffer, @magic) do
      {0, _len} ->
        <<_drop::8, rest::binary>> = buffer
        do_extract(rest, acc)

      {idx, _len} ->
        <<_drop::binary-size(idx), rest::binary>> = buffer
        do_extract(rest, acc)

      :nomatch ->
        {Enum.reverse(acc), <<>>}
    end
  end
end
