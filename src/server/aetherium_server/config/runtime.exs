import Config

existing_gateway = Application.get_env(:aetherium_server, :gateway, [])

config :aetherium_server, :gateway,
  url: System.get_env("GATEWAY_WS_URL") || existing_gateway[:url] || "ws://localhost:4000/socket/websocket",
  auth_token:
    System.get_env("GATEWAY_AUTH_TOKEN") ||
      existing_gateway[:auth_token] ||
      "server_secret_token",
  server_id: System.get_env("SERVER_ID") || existing_gateway[:server_id] || "srv_01",
  heartbeat_interval: String.to_integer(System.get_env("HEARTBEAT_INTERVAL") || "#{existing_gateway[:heartbeat_interval] || 30_000}")

config :aetherium_server, :device_listener,
  bind_ip: System.get_env("BIND_IP") || "0.0.0.0",
  port: String.to_integer(System.get_env("DEVICE_PORT") || "4000")
