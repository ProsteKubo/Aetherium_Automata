defmodule AetheriumGateway.CommandEnvelopeTest do
  use ExUnit.Case, async: true

  alias AetheriumGateway.CommandEnvelope

  test "builds envelope with nested struct payload values" do
    payload = %{
      "device_id" => "device-1",
      "meta" => %{"created_at" => DateTime.utc_now()}
    }

    actor = %{"role" => "operator"}

    assert {:ok, envelope} = CommandEnvelope.from_payload("set_variable", payload, actor)
    assert envelope.command_type == "set_variable"
    assert envelope.actor["role"] == "operator"
    assert envelope.payload["device_id"] == "device-1"
    assert match?(%DateTime{}, envelope.payload["meta"]["created_at"])
  end

  test "rejects oversized payloads" do
    payload = %{"blob" => String.duplicate("a", 2048)}
    actor = %{"role" => "operator"}

    assert {:error, :payload_too_large} =
             CommandEnvelope.from_payload("set_variable", payload, actor, max_payload_bytes: 256)
  end

  test "creates deterministic outcome fields" do
    payload = %{"device_id" => "d1"}
    actor = %{"role" => "operator"}

    assert {:ok, envelope} =
             CommandEnvelope.from_payload("trigger_event", payload, actor, deadline_ms: 10_000)

    outcome = CommandEnvelope.outcome(envelope, "ACK", %{"status" => "sent"})

    assert outcome["command_id"] == envelope.command_id
    assert outcome["correlation_id"] == envelope.correlation_id
    assert outcome["idempotency_key"] == envelope.idempotency_key
    assert outcome["outcome"] == "ACK"
    assert outcome["data"]["status"] == "sent"
  end
end
