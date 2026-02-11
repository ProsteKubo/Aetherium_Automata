defmodule AetheriumGateway.CommandEnvelope do
  @moduledoc """
  Normalizes control-plane commands into a versioned envelope.
  """

  @envelope_keys ~w(
    version
    command_id
    correlation_id
    idempotency_key
    issued_at
    deadline_ms
    actor
    target
    command_type
    payload
    tenant_id
  )

  @default_deadline_ms 30_000
  @default_max_payload_bytes 64_000

  @type t :: %{
          version: integer(),
          command_id: String.t(),
          correlation_id: String.t(),
          idempotency_key: String.t(),
          issued_at: integer(),
          deadline_ms: integer(),
          actor: map(),
          target: map(),
          command_type: String.t(),
          payload: map(),
          tenant_id: String.t()
        }

  @spec from_payload(String.t(), map(), map(), keyword()) :: {:ok, t()} | {:error, term()}
  def from_payload(command_type, payload, actor, opts \\ [])
      when is_binary(command_type) and is_map(payload) and is_map(actor) do
    now_ms = now_ms()
    payload = stringify_keys(payload)

    envelope_payload =
      case Map.get(payload, "payload") do
        p when is_map(p) -> stringify_keys(p)
        _ -> Map.drop(payload, @envelope_keys)
      end

    deadline_ms =
      payload
      |> Map.get("deadline_ms", Keyword.get(opts, :deadline_ms, @default_deadline_ms))
      |> to_int(@default_deadline_ms)

    envelope = %{
      version: Map.get(payload, "version", 1) |> to_int(1),
      command_id: Map.get(payload, "command_id") || make_id("cmd"),
      correlation_id: Map.get(payload, "correlation_id") || make_id("corr"),
      idempotency_key: Map.get(payload, "idempotency_key") || make_id("idem"),
      issued_at: Map.get(payload, "issued_at", now_ms) |> to_int(now_ms),
      deadline_ms: deadline_ms,
      actor: actor,
      target: Map.get(payload, "target", %{}) |> stringify_keys(),
      command_type: Map.get(payload, "command_type", command_type),
      payload: envelope_payload,
      tenant_id: Map.get(payload, "tenant_id", "default")
    }

    with :ok <- validate_envelope(envelope, opts) do
      {:ok, envelope}
    end
  end

  @spec outcome(t(), String.t(), map()) :: map()
  def outcome(envelope, outcome, extras \\ %{}) when is_map(envelope) and is_binary(outcome) do
    %{
      "version" => envelope.version,
      "command_id" => envelope.command_id,
      "correlation_id" => envelope.correlation_id,
      "idempotency_key" => envelope.idempotency_key,
      "command_type" => envelope.command_type,
      "tenant_id" => envelope.tenant_id,
      "outcome" => outcome,
      "timestamp" => now_ms(),
      "data" => stringify_keys(extras)
    }
  end

  @spec dedupe_key(t()) :: String.t()
  def dedupe_key(envelope), do: envelope.idempotency_key

  @spec validate_envelope(t(), keyword()) :: :ok | {:error, term()}
  def validate_envelope(envelope, opts \\ []) do
    max_payload = Keyword.get(opts, :max_payload_bytes, max_payload_bytes())

    cond do
      envelope.command_type in [nil, ""] ->
        {:error, :missing_command_type}

      envelope.idempotency_key in [nil, ""] ->
        {:error, :missing_idempotency_key}

      envelope.deadline_ms <= 0 ->
        {:error, :invalid_deadline}

      :erlang.external_size(envelope.payload) > max_payload ->
        {:error, :payload_too_large}

      true ->
        :ok
    end
  end

  defp max_payload_bytes do
    config = Application.get_env(:aetherium_gateway, __MODULE__, [])
    Keyword.get(config, :max_payload_bytes, @default_max_payload_bytes)
  end

  defp make_id(prefix) do
    "#{prefix}_#{:crypto.strong_rand_bytes(10) |> Base.url_encode64(padding: false)}"
  end

  defp stringify_keys(%_{} = struct) do
    struct
  end

  defp stringify_keys(map) when is_map(map) do
    map
    |> Enum.map(fn
      {k, v} when is_atom(k) -> {Atom.to_string(k), stringify_keys(v)}
      {k, v} when is_binary(k) -> {k, stringify_keys(v)}
      {k, v} -> {to_string(k), stringify_keys(v)}
    end)
    |> Enum.into(%{})
  end

  defp stringify_keys(list) when is_list(list), do: Enum.map(list, &stringify_keys/1)
  defp stringify_keys(other), do: other

  defp to_int(value, _default) when is_integer(value), do: value

  defp to_int(value, default) when is_binary(value) do
    case Integer.parse(value) do
      {n, ""} -> n
      _ -> default
    end
  end

  defp to_int(_, default), do: default

  defp now_ms do
    System.system_time(:millisecond)
  end
end
