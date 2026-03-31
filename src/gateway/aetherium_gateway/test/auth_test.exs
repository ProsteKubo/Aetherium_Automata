defmodule AetheriumGateway.AuthTest do
  use ExUnit.Case, async: true

  alias AetheriumGateway.Auth

  test "authorizes static operator token from config" do
    assert {:ok, claims} = Auth.authorize(:operator, "dev_secret_token")
    assert claims[:role] == "operator"
    assert claims[:mode] == "static"
  end

  test "rejects invalid static token" do
    assert {:error, :invalid_token} = Auth.authorize(:operator, "wrong-token")
  end

  test "returns expired for signed tokens with past exp" do
    secret = "test_hmac_secret_123"
    now = DateTime.utc_now() |> DateTime.to_unix()

    payload =
      %{"role" => "operator", "exp" => now - 10}
      |> Jason.encode!()

    payload_b64 = Base.url_encode64(payload, padding: false)
    sig = :crypto.mac(:hmac, :sha256, secret, payload_b64) |> Base.encode16(case: :lower)
    token = "v1.#{payload_b64}.#{sig}"

    prior = Application.get_env(:aetherium_gateway, Auth, [])

    Application.put_env(
      :aetherium_gateway,
      Auth,
      Keyword.merge(prior,
        hmac_secret: secret,
        tokens: %{
          operator: "dev_secret_token",
          server: "server_secret_token",
          device: "device_secret_token"
        }
      )
    )

    on_exit(fn -> Application.put_env(:aetherium_gateway, Auth, prior) end)

    assert {:error, :expired} = Auth.authorize(:operator, token)
  end
end
