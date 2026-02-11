import Config

# We don't run a server during test. If one is required,
# you can enable the server option below.
config :aetherium_gateway, AetheriumGatewayWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: 4002],
  secret_key_base: "TWYbaXXTShnFRAOoH5QcfeoaladKjOyvCKpCVYua3ojWX6YGKKyLr9u9pCv+kN6t",
  server: false

# Print only warnings and errors during test
config :logger, level: :warning

# Initialize plugs at runtime for faster test compilation
config :phoenix, :plug_init_mode, :runtime

# Enable helpful, but potentially expensive runtime checks
config :phoenix_live_view,
  enable_expensive_runtime_checks: true

# Sort query params output of verified routes for robust url comparisons
config :phoenix,
  sort_verified_routes_query_params: true

config :aetherium_gateway, AetheriumGateway.Auth,
  tokens: %{
    operator: "dev_secret_token",
    server: "server_secret_token",
    device: "device_secret_token"
  },
  hmac_secret: nil

config :aetherium_gateway, AetheriumGateway.Persistence,
  enabled: true,
  data_dir: "tmp/test_gateway",
  event_capacity: 2000
