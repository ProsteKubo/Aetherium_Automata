defmodule AetheriumGateway.Auth do
  @moduledoc """
  Role-based token authorization for gateway channels.

  Supports two token modes:
  - static role tokens from config (for local/dev)
  - signed tokens (v1.<payload_b64>.<sig_hex>) when hmac_secret is configured
  """

  @type role :: :operator | :server | :device

  @spec authorize(role(), binary() | nil) :: {:ok, map()} | {:error, :invalid_token | :missing_token | :expired}
  def authorize(_role, nil), do: {:error, :missing_token}
  def authorize(_role, ""), do: {:error, :missing_token}

  def authorize(role, token) when is_atom(role) and is_binary(token) do
    case authorize_signed(role, token) do
      {:ok, claims} ->
        {:ok, claims}

      {:error, :expired} ->
        {:error, :expired}

      :error ->
        case authorize_static(role, token) do
          {:ok, claims} -> {:ok, claims}
          :error -> {:error, :invalid_token}
        end
    end
  end

  @spec operator_token() :: binary() | nil
  def operator_token do
    tokens()["operator"]
  end

  @spec server_token() :: binary() | nil
  def server_token do
    tokens()["server"]
  end

  defp authorize_static(role, token) do
    expected = Map.get(tokens(), Atom.to_string(role))

    if is_binary(expected) and expected != "" and secure_compare(expected, token) do
      {:ok, %{role: Atom.to_string(role), mode: "static"}}
    else
      :error
    end
  end

  defp authorize_signed(role, token) do
    case hmac_secret() do
      nil ->
        :error

      secret ->
        with ["v1", payload_b64, sig_hex] <- String.split(token, ".", parts: 3),
             {:ok, payload_json} <- Base.url_decode64(payload_b64, padding: false),
             expected_sig <- sign(secret, payload_b64),
             true <- secure_compare(expected_sig, String.downcase(sig_hex)),
             {:ok, claims} <- Jason.decode(payload_json),
             true <- claims["role"] == Atom.to_string(role),
             :ok <- ensure_not_expired(claims) do
          {:ok, Map.put(claims, "mode", "signed")}
        else
          {:error, :expired} -> {:error, :expired}
          _ -> :error
        end
    end
  end

  defp ensure_not_expired(%{"exp" => exp}) when is_integer(exp) do
    now = DateTime.utc_now() |> DateTime.to_unix()
    if exp >= now, do: :ok, else: {:error, :expired}
  end

  defp ensure_not_expired(_), do: :ok

  defp sign(secret, payload_b64) do
    :crypto.mac(:hmac, :sha256, secret, payload_b64)
    |> Base.encode16(case: :lower)
  end

  defp secure_compare(a, b) when byte_size(a) == byte_size(b) do
    Plug.Crypto.secure_compare(a, b)
  end

  defp secure_compare(_, _), do: false

  defp tokens do
    config = Application.get_env(:aetherium_gateway, __MODULE__, [])

    config
    |> Keyword.get(:tokens, %{})
    |> Enum.into(%{}, fn
      {k, v} when is_atom(k) -> {Atom.to_string(k), v}
      {k, v} -> {to_string(k), v}
    end)
  end

  defp hmac_secret do
    config = Application.get_env(:aetherium_gateway, __MODULE__, [])

    case Keyword.get(config, :hmac_secret) do
      s when is_binary(s) and byte_size(s) > 0 -> s
      _ -> nil
    end
  end
end
