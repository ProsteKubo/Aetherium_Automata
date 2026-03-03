COMPOSE ?= docker compose
DEV_SERVICES ?= gateway server3 device1
GATEWAY_ONLY_SERVICES ?= gateway
ROS2_SERVICES ?= gateway server3 ros2-bridge
ROS2_DEMO_SERVICES ?= gateway server3 ros2-bridge ros2-emulator ros2-sensor
TS_SERVICES ?= gateway server3 device1 influxdb

ARDUINO_CLI ?= arduino-cli
ESP_PORT ?= /dev/cu.usbserial-0001
ESP_FQBN ?= esp32:esp32:esp32
ESP_SKETCH ?= engine/embedded/arduino/examples/AetheriumEsp32Node
ESP_LIBRARY ?= engine/embedded/arduino
ESP_CPP_FLAGS ?= -std=gnu++17 -DAETHERIUM_RUNTIME_CORE_ONLY=1 -DAETHERIUM_DISABLE_LUA_SCRIPT_ENGINE=1 -I$(abspath .)
SERVER_DIR ?= server/aetherium_server
ESP_GATEWAY_WS_URL ?= ws://localhost:8080/socket/websocket
ESP_GATEWAY_AUTH_TOKEN ?= server_secret_token

.PHONY: help up u up-gateway ug down reset nuke restart r restart-gateway rg restart-server3 rs restart-device rd logs l logs0 l0 build-device bd rebuild-device rb-device ps up-ros2 ur2 up-ros2-demo ur2d down-ros2 dr2 logs-ros2 lr2 logs-ros2-demo lr2d restart-ros2 rr2 up-ts uts logs-ts lts down-ts dts test-ts tts esp-boards eb esp-compile ec esp-flash ef esp-server esrv esp-smoke esmoke esp-demo edemo

help:
	@echo "Aetherium src dev shortcuts"
	@echo ""
	@echo "Core:"
	@echo "  make up / make u               - start gateway+server3+device1"
	@echo "  make up-gateway / make ug      - start gateway only (for host server + ESP32)"
	@echo "  make restart / make r          - restart gateway+server3+device1"
	@echo "  make logs / make l             - follow logs (tail=100)"
	@echo "  make logs0 / make l0           - follow only fresh logs (tail=0)"
	@echo "  make ps                        - compose service status"
	@echo ""
	@echo "Targeted:"
	@echo "  make restart-gateway / make rg - restart gateway only"
	@echo "  make restart-server3 / make rs - restart server3 only"
	@echo "  make restart-device / make rd  - restart device1 only"
	@echo "  make build-device / make bd    - build device1 image"
	@echo "  make rebuild-device / make rb-device"
	@echo "                               - build + recreate device1 only"
	@echo ""
	@echo "ROS2 Connector:"
	@echo "  make up-ros2 / make ur2         - start gateway+server3+ros2-bridge (actual ROS2 device mode)"
	@echo "  make up-ros2-demo / make ur2d   - start full ROS2 demo stack (bridge+emulator+sensor)"
	@echo "  make logs-ros2 / make lr2       - follow ROS2 bridge stack logs"
	@echo "  make logs-ros2-demo / make lr2d - follow ROS2 demo logs"
	@echo "  make restart-ros2 / make rr2    - restart ROS2 bridge stack"
	@echo "  make down-ros2 / make dr2       - stop ROS2 stack services"
	@echo ""
	@echo "Time-Series (InfluxDB):"
	@echo "  make up-ts / make uts           - start gateway+server3+device1+influxdb"
	@echo "  make logs-ts / make lts         - follow logs for timeseries stack"
	@echo "  make down-ts / make dts         - stop influxdb (and core dev stack)"
	@echo "  make test-ts / make tts         - run real Influx integration test in server3"
	@echo ""
	@echo "ESP32 (Host Hardware Loop):"
	@echo "  make esp-boards / make eb       - list serial boards (arduino-cli)"
	@echo "  make esp-compile / make ec      - compile ESP32 sketch"
	@echo "  make esp-flash / make ef        - compile + upload to ESP32 (ESP_PORT=...)"
	@echo "  make esp-server / make esrv     - run server on host with serial connector"
	@echo "  make esp-smoke / make esmoke    - host serial deploy/start/stop smoke"
	@echo "  make esp-demo / make edemo      - host serial time-travel demo"
	@echo "    vars: ESP_PORT=... ESP_GATEWAY_WS_URL=ws://localhost:8080/socket/websocket"
	@echo ""
	@echo "Reset:"
	@echo "  make down                      - stop stack (keep volumes)"
	@echo "  make reset                     - down + up"
	@echo "  make nuke                      - down -v (wipe volumes)"

up u:
	$(COMPOSE) up -d $(DEV_SERVICES)

up-gateway ug:
	$(COMPOSE) up -d $(GATEWAY_ONLY_SERVICES)

down:
	$(COMPOSE) down

reset:
	$(COMPOSE) down
	$(COMPOSE) up -d $(DEV_SERVICES)

nuke:
	$(COMPOSE) down -v

restart r:
	$(COMPOSE) restart $(DEV_SERVICES)

restart-gateway rg:
	$(COMPOSE) restart gateway

restart-server3 rs:
	$(COMPOSE) restart server3

restart-device rd:
	$(COMPOSE) restart device1

build-device bd:
	$(COMPOSE) build device1

rebuild-device rb-device:
	$(COMPOSE) build device1
	$(COMPOSE) up -d --no-deps --force-recreate device1

logs l:
	$(COMPOSE) logs -f --tail=100 $(DEV_SERVICES)

logs0 l0:
	$(COMPOSE) logs -f --tail=0 $(DEV_SERVICES)

ps:
	$(COMPOSE) ps

up-ros2 ur2:
	$(COMPOSE) --profile ros2 up -d $(ROS2_SERVICES)

up-ros2-demo ur2d:
	$(COMPOSE) --profile ros2 --profile ros2-demo up -d $(ROS2_DEMO_SERVICES)

down-ros2 dr2:
	$(COMPOSE) stop ros2-bridge ros2-emulator ros2-sensor server3 gateway

logs-ros2 lr2:
	$(COMPOSE) --profile ros2 logs -f --tail=100 $(ROS2_SERVICES)

logs-ros2-demo lr2d:
	$(COMPOSE) --profile ros2 --profile ros2-demo logs -f --tail=100 $(ROS2_DEMO_SERVICES)

restart-ros2 rr2:
	$(COMPOSE) --profile ros2 restart $(ROS2_SERVICES)

up-ts uts:
	ENABLE_TIME_SERIES_INFLUX=1 $(COMPOSE) --profile timeseries up -d $(TS_SERVICES)

logs-ts lts:
	$(COMPOSE) --profile timeseries logs -f --tail=100 $(TS_SERVICES)

down-ts dts:
	$(COMPOSE) --profile timeseries stop $(TS_SERVICES)

test-ts tts:
	$(COMPOSE) --profile timeseries exec -T server3 sh -lc "cd /app && RUN_INFLUX_INTEGRATION_TESTS=1 ENABLE_TIME_SERIES_INFLUX=1 mix test test/time_series_influx_integration_test.exs"

esp-boards eb:
	$(ARDUINO_CLI) board list

esp-compile ec:
	$(ARDUINO_CLI) compile \
		-b $(ESP_FQBN) \
		--library $(ESP_LIBRARY) \
		--build-property compiler.cpp.extra_flags="$(ESP_CPP_FLAGS)" \
		$(ESP_SKETCH)

esp-flash ef:
	$(ARDUINO_CLI) compile -u \
		-p $(ESP_PORT) \
		-b $(ESP_FQBN) \
		--library $(ESP_LIBRARY) \
		--build-property compiler.cpp.extra_flags="$(ESP_CPP_FLAGS)" \
		$(ESP_SKETCH)

esp-server esrv:
	cd $(SERVER_DIR) && SERVER_ID=esp_host ENABLE_SERIAL_DEVICE_TRANSPORT=1 SERIAL_PORTS=$(ESP_PORT) GATEWAY_WS_URL=$(ESP_GATEWAY_WS_URL) GATEWAY_AUTH_TOKEN=$(ESP_GATEWAY_AUTH_TOKEN) mix run --no-halt

esp-smoke esmoke:
	cd $(SERVER_DIR) && SERVER_ID=esp_host DEVICE_PORT=4100 ENABLE_SERIAL_DEVICE_TRANSPORT=1 SERIAL_PORTS=$(ESP_PORT) GATEWAY_WS_URL=$(ESP_GATEWAY_WS_URL) GATEWAY_AUTH_TOKEN=$(ESP_GATEWAY_AUTH_TOKEN) mix aetherium.serial.smoke --wait-ms 30000 --timeout-ms 20000

esp-demo edemo:
	cd $(SERVER_DIR) && SERVER_ID=esp_host DEVICE_PORT=4100 ENABLE_SERIAL_DEVICE_TRANSPORT=1 SERIAL_PORTS=$(ESP_PORT) GATEWAY_WS_URL=$(ESP_GATEWAY_WS_URL) GATEWAY_AUTH_TOKEN=$(ESP_GATEWAY_AUTH_TOKEN) mix aetherium.esp32.timetravel.demo --wait-ms 45000 --run-ms 3000
