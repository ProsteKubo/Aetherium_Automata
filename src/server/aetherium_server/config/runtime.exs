import Config

existing_gateway = Application.get_env(:aetherium_server, :gateway, [])

enable_serial_transport? =
  (System.get_env("ENABLE_SERIAL_DEVICE_TRANSPORT") || "0") in ["1", "true", "TRUE", "yes", "YES"]

enable_ros2_transport? =
  (System.get_env("ENABLE_ROS2_DEVICE_TRANSPORT") || "0") in ["1", "true", "TRUE", "yes", "YES"]

serial_ports_env = System.get_env("SERIAL_PORTS")

serial_ports =
  cond do
    is_nil(serial_ports_env) or serial_ports_env == "" -> :auto
    true -> serial_ports_env |> String.split(",", trim: true) |> Enum.map(&String.trim/1)
  end

device_connectors =
  [
    [
      id: "ws_default",
      type: :websocket,
      enabled: true,
      options: [
        bind_ip: System.get_env("BIND_IP") || "0.0.0.0",
        port: String.to_integer(System.get_env("DEVICE_PORT") || "4000"),
        path: System.get_env("DEVICE_WS_PATH") || "/socket/device/websocket"
      ]
    ]
  ] ++
    if(enable_serial_transport?,
      do: [
        [
          id: "serial_default",
          type: :serial,
          enabled: true,
          options: [
            ports: serial_ports,
            baud_rate: String.to_integer(System.get_env("SERIAL_BAUD_RATE") || "115200"),
            retry_interval: String.to_integer(System.get_env("SERIAL_RETRY_MS") || "3000")
          ]
        ]
      ],
      else: []
    ) ++
    if(enable_ros2_transport?,
      do: [
        [
          id: "ros2_default",
          type: :ros2,
          enabled: true,
          options: [
            bind_ip: System.get_env("ROS2_BIND_IP") || "0.0.0.0",
            port: String.to_integer(System.get_env("ROS2_PORT") || "5501")
          ]
        ]
      ],
      else: []
    )

config :aetherium_server, :gateway,
  url:
    System.get_env("GATEWAY_WS_URL") || existing_gateway[:url] ||
      "ws://localhost:4000/socket/websocket",
  auth_token:
    System.get_env("GATEWAY_AUTH_TOKEN") ||
      existing_gateway[:auth_token] ||
      "server_secret_token",
  server_id: System.get_env("SERVER_ID") || existing_gateway[:server_id] || "srv_01",
  heartbeat_interval:
    String.to_integer(
      System.get_env("HEARTBEAT_INTERVAL") || "#{existing_gateway[:heartbeat_interval] || 30_000}"
    )

config :aetherium_server, :device_listener,
  bind_ip: System.get_env("BIND_IP") || "0.0.0.0",
  port: String.to_integer(System.get_env("DEVICE_PORT") || "4000")

config :aetherium_server, :device_connectors, device_connectors

config :aetherium_server, :serial_transport,
  enabled: enable_serial_transport?,
  ports: serial_ports,
  baud_rate: String.to_integer(System.get_env("SERIAL_BAUD_RATE") || "115200"),
  retry_interval: String.to_integer(System.get_env("SERIAL_RETRY_MS") || "3000")

config :aetherium_server, :ros2_transport,
  enabled: enable_ros2_transport?,
  bind_ip: System.get_env("ROS2_BIND_IP") || "0.0.0.0",
  port: String.to_integer(System.get_env("ROS2_PORT") || "5501")

config :aetherium_server, AetheriumServer.TimeSeriesStore,
  enabled:
    (System.get_env("ENABLE_TIME_SERIES_STORE") || "1") in ["1", "true", "TRUE", "yes", "YES"],
  data_dir: System.get_env("TIME_SERIES_DATA_DIR") || "var/server_time_series",
  event_capacity_per_deployment:
    String.to_integer(System.get_env("TIME_SERIES_EVENT_CAPACITY") || "20000"),
  snapshot_capacity_per_deployment:
    String.to_integer(System.get_env("TIME_SERIES_SNAPSHOT_CAPACITY") || "2000")

config :aetherium_server, AetheriumServer.TimeSeriesInfluxSink,
  enabled:
    (System.get_env("ENABLE_TIME_SERIES_INFLUX") || "0") in ["1", "true", "TRUE", "yes", "YES"],
  url: System.get_env("INFLUXDB_URL") || "http://localhost:8086",
  org: System.get_env("INFLUXDB_ORG") || "aetherium",
  bucket: System.get_env("INFLUXDB_BUCKET") || "aetherium_ts",
  token: System.get_env("INFLUXDB_TOKEN") || "",
  precision: System.get_env("INFLUXDB_PRECISION") || "ns",
  batch_size: String.to_integer(System.get_env("INFLUXDB_BATCH_SIZE") || "200"),
  flush_interval_ms: String.to_integer(System.get_env("INFLUXDB_FLUSH_MS") || "1000"),
  timeout_ms: String.to_integer(System.get_env("INFLUXDB_TIMEOUT_MS") || "5000")

config :aetherium_server, AetheriumServer.TimeSeriesQuery,
  backend: System.get_env("TIME_SERIES_QUERY_BACKEND") || "auto",
  replay_limit: String.to_integer(System.get_env("TIME_SERIES_REPLAY_LIMIT") || "50000"),
  fallback_to_local:
    (System.get_env("TIME_SERIES_QUERY_FALLBACK_TO_LOCAL") || "1") in [
      "1",
      "true",
      "TRUE",
      "yes",
      "YES"
    ]
