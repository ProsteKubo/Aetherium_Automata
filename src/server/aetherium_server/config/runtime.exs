import Config

config :aetherium_server, :gateway,
  url: System.get_env("GATEWAY_WS_URL") || "ws://localhost:4000/socket/websocket",
  auth_token: System.get_env("GATEWAY_AUTH_TOKEN") || "server_secret_token",
  server_id: System.get_env("SERVER_ID") || "srv_01",
  heartbeat_interval: String.to_integer(System.get_env("HEARTBEAT_INTERVAL") || "30000")
EOF
