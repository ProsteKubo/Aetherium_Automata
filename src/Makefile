COMPOSE ?= docker compose
DEV_SERVICES ?= gateway server3 device1
GATEWAY_ONLY_SERVICES ?= gateway
ROS2_SERVICES ?= gateway server3 ros2-bridge
ROS2_DEMO_SERVICES ?= gateway server3 ros2-bridge ros2-emulator ros2-sensor
TS_SERVICES ?= gateway server3 device1 influxdb grafana
BLACK_BOX_SERVICES ?= gateway server3 blackbox1
BLACK_BOX_GATEWAY_WS_URL ?= ws://172.20.0.10:4000/socket/websocket
BLACK_BOX_OPERATOR_TOKEN ?= dev_secret_token
BLACK_BOX_DEVICE_ID ?= black_box_01
BLACK_BOX_SERVER_ID ?= svr_03
BLACK_BOX_SHOWCASE ?= example/automata/showcase/12_black_box/docker_black_box_probe.yaml
empty :=
space := $(empty) $(empty)
comma := ,
AUTO_ESP_PORT ?= $(or $(firstword $(wildcard /dev/cu.usbserial*)), $(firstword $(wildcard /dev/cu.usbmodem*)), /dev/cu.usbserial-0001)
AUTO_MCXN947_PORT ?= $(or $(firstword $(wildcard /dev/cu.usbmodem*)), /dev/cu.debug-console)
AUTO_SERIAL_PORTS ?= $(if $(wildcard $(ESP_PORT)),$(ESP_PORT),$(if $(wildcard $(MCXN947_PORT)),$(MCXN947_PORT),))$(if $(and $(wildcard $(ESP_PORT)),$(wildcard $(MCXN947_PORT)),$(filter-out $(ESP_PORT),$(MCXN947_PORT))),$(comma),)$(if $(and $(wildcard $(MCXN947_PORT)),$(filter-out $(ESP_PORT),$(MCXN947_PORT))),$(MCXN947_PORT),)

ARDUINO_CLI ?= arduino-cli
ESP_PORT ?= $(AUTO_ESP_PORT)
ESP_BOARD ?= mhetesp32minikit
ESP_UPLOAD_SPEED ?= 460800
ESP_FQBN ?= esp32:esp32:$(ESP_BOARD):UploadSpeed=$(ESP_UPLOAD_SPEED)
ESP_SKETCH ?= engine/embedded/arduino/examples/AetheriumEsp32Node
ESP_LIBRARY ?= engine/embedded/arduino
ESP_CPP_FLAGS ?= -std=gnu++17 -DAETHERIUM_RUNTIME_CORE_ONLY=1 -I$(abspath .)
ESP_LUA_ARDUINO_LIB ?= Lua 5.1 for ESP32
ESP_OLED_ARDUINO_LIB ?= Adafruit SSD1306
ESP_GFX_ARDUINO_LIB ?= Adafruit GFX Library
SERVER_DIR ?= server/aetherium_server
ESP_GATEWAY_WS_URL ?= ws://localhost:8080/socket/websocket
ESP_GATEWAY_AUTH_TOKEN ?= server_secret_token
SERIAL_BAUD_RATE ?= 115200
SERIAL_PORTS ?= $(AUTO_SERIAL_PORTS)
SERIAL_SERVER_ID ?= serial_host
ENABLE_HOST_RUNTIME_DEVICE ?= 0
MCXN947_CMAKE ?= cmake
MCXN947_BUILD_DIR ?= build/mcxn947
MCXN947_FW_DIR ?= engine/embedded/mcxn947
MCXN947_TOOLCHAIN ?= $(abspath $(MCXN947_FW_DIR)/toolchain-arm-none-eabi.cmake)
MCXN947_ELF ?= $(MCXN947_BUILD_DIR)/aetherium_mcxn947_node.elf
MCXN947_BIN ?= $(MCXN947_BUILD_DIR)/aetherium_mcxn947_node.bin
MCXN947_HEX ?= $(MCXN947_BUILD_DIR)/aetherium_mcxn947_node.hex
MCXN947_PORT ?= $(AUTO_MCXN947_PORT)
MCXN947_PYOCD ?= pyocd
MCXN947_TARGET ?= mcxn947vdf
MCXN947_PROBE_UID ?=
MCXN947_PYOCD_UID_ARG := $(if $(MCXN947_PROBE_UID),-u $(MCXN947_PROBE_UID),)

.PHONY: help up u up-gateway ug up-blackbox ubb smoke-blackbox sbb down reset nuke restart r restart-gateway rg restart-server3 rs restart-device rd rebuild-blackbox rbb logs l logs0 l0 logs-blackbox lbb build-device bd rebuild-device rb-device ps up-ros2 ur2 up-ros2-demo ur2d down-ros2 dr2 logs-ros2 lr2 logs-ros2-demo lr2d restart-ros2 rr2 up-ts uts logs-ts lts down-ts dts test-ts tts esp-deps edeps esp-boards eb esp-compile ec esp-flash ef esp-server esrv esp-smoke esmoke esp-demo edemo serial-server ssrv serial-smoke ssmoke ports p host-demo hdemo host-smoke hsmoke mcxn947-configure mcfg mcxn947-build mbuild mcxn947-flash mflash mcxn947-reset mreset mcxn947-server msrv mcxn947-smoke msmoke

help:
	@echo "Aetherium src dev shortcuts"
	@echo ""
	@echo "Core:"
	@echo "  make up / make u               - start gateway+server3+device1"
	@echo "  make up-gateway / make ug      - start gateway only (for host server + ESP32)"
	@echo "  make restart / make r          - restart gateway+server3+device1"
	@echo "  make up-blackbox / make ubb    - start gateway+server3+blackbox1"
	@echo "  make logs-blackbox / make lbb  - follow logs for blackbox stack"
	@echo "  make rebuild-blackbox / make rbb"
	@echo "                               - build + recreate blackbox1 only"
	@echo "  make smoke-blackbox / make sbb - deploy and exercise the docker black-box probe"
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
	@echo "  make esp-deps / make edeps      - install required Arduino Lua + OLED libraries"
	@echo "  make esp-boards / make eb       - list serial boards (arduino-cli)"
	@echo "  make esp-compile / make ec      - compile ESP32 sketch"
	@echo "  make esp-flash / make ef        - compile + upload to ESP32 (ESP_PORT=...)"
	@echo "  make esp-server / make esrv     - run server on host with serial connector"
	@echo "  make esp-smoke / make esmoke    - host serial deploy/start/stop smoke"
	@echo "  make esp-demo / make edemo      - host serial time-travel demo"
	@echo "    vars: ESP_PORT=... ESP_BOARD=mhetesp32minikit ESP_UPLOAD_SPEED=460800"
	@echo ""
	@echo "Generic Serial Host:"
	@echo "  make serial-server / make ssrv  - run one host server over one or more serial ports"
	@echo "  make serial-smoke / make ssmoke - generic serial deploy/start/stop smoke"
	@echo "  make ports / make p             - print resolved ESP/FRDM/serial ports"
	@echo "  make host-demo / make hdemo     - run host+FRDM+ESP server with auto ports and host runtime"
	@echo "  make host-smoke / make hsmoke   - run serial smoke with host runtime and auto ports"
	@echo "    vars: SERIAL_PORTS=/dev/cu.foo,/dev/cu.bar SERIAL_BAUD_RATE=115200 ENABLE_HOST_RUNTIME_DEVICE=1"
	@echo ""
	@echo "FRDM-MCXN947:"
	@echo "  make mcxn947-configure / make mcfg - configure standalone arm-none-eabi firmware build"
	@echo "  make mcxn947-build / make mbuild   - build MCXN947 firmware (.elf/.bin/.hex)"
	@echo "  make mcxn947-flash / make mflash   - flash firmware with pyocd"
	@echo "  make mcxn947-reset / make mreset   - reset target with pyocd"
	@echo "  make mcxn947-server / make msrv    - run host server with FRDM serial connector"
	@echo "  make mcxn947-smoke / make msmoke   - host serial deploy/start/stop smoke for FRDM"
	@echo "    vars: MCXN947_PORT=/dev/cu.usbmodem... MCXN947_PROBE_UID=... MCXN947_TARGET=mcxn947vdf"
	@echo ""
	@echo "Reset:"
	@echo "  make down                      - stop stack (keep volumes)"
	@echo "  make reset                     - down + up"
	@echo "  make nuke                      - down -v (wipe volumes)"

up u:
	$(COMPOSE) up -d $(DEV_SERVICES)

up-gateway ug:
	$(COMPOSE) up -d $(GATEWAY_ONLY_SERVICES)

up-blackbox ubb:
	$(COMPOSE) up -d $(BLACK_BOX_SERVICES)

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

rebuild-blackbox rbb:
	$(COMPOSE) build blackbox1
	$(COMPOSE) up -d --no-deps --force-recreate blackbox1

logs l:
	$(COMPOSE) logs -f --tail=100 $(DEV_SERVICES)

logs0 l0:
	$(COMPOSE) logs -f --tail=0 $(DEV_SERVICES)

logs-blackbox lbb:
	$(COMPOSE) logs -f --tail=100 $(BLACK_BOX_SERVICES)

smoke-blackbox sbb:
	$(COMPOSE) exec -T server3 sh -lc "cd /app && AETHERIUM_REPO_ROOT=/repo mix aetherium.black_box.smoke --gateway-url $(BLACK_BOX_GATEWAY_WS_URL) --token $(BLACK_BOX_OPERATOR_TOKEN) --device-id $(BLACK_BOX_DEVICE_ID) --server-id $(BLACK_BOX_SERVER_ID) --showcase $(BLACK_BOX_SHOWCASE)"

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

esp-deps edeps:
	$(ARDUINO_CLI) lib install "$(ESP_LUA_ARDUINO_LIB)"
	$(ARDUINO_CLI) lib install "$(ESP_OLED_ARDUINO_LIB)"
	$(ARDUINO_CLI) lib install "$(ESP_GFX_ARDUINO_LIB)"

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
	$(MAKE) serial-server SERIAL_SERVER_ID=esp_host SERIAL_PORTS=$(ESP_PORT)

esp-smoke esmoke:
	$(MAKE) serial-smoke SERIAL_SERVER_ID=esp_host SERIAL_PORTS=$(ESP_PORT)

esp-demo edemo:
	cd $(SERVER_DIR) && SERVER_ID=esp_host DEVICE_PORT=4100 ENABLE_SERIAL_DEVICE_TRANSPORT=1 SERIAL_PORTS=$(ESP_PORT) GATEWAY_WS_URL=$(ESP_GATEWAY_WS_URL) GATEWAY_AUTH_TOKEN=$(ESP_GATEWAY_AUTH_TOKEN) mix aetherium.esp32.timetravel.demo --wait-ms 45000 --run-ms 3000

ports p:
	@echo "ESP_PORT=$(ESP_PORT)"
	@echo "MCXN947_PORT=$(MCXN947_PORT)"
	@echo "SERIAL_PORTS=$(SERIAL_PORTS)"

serial-server ssrv:
	cd $(SERVER_DIR) && SERVER_ID=$(SERIAL_SERVER_ID) ENABLE_SERIAL_DEVICE_TRANSPORT=1 ENABLE_HOST_RUNTIME_DEVICE=$(ENABLE_HOST_RUNTIME_DEVICE) SERIAL_PORTS="$(SERIAL_PORTS)" SERIAL_BAUD_RATE=$(SERIAL_BAUD_RATE) GATEWAY_WS_URL=$(ESP_GATEWAY_WS_URL) GATEWAY_AUTH_TOKEN=$(ESP_GATEWAY_AUTH_TOKEN) mix run --no-halt

serial-smoke ssmoke:
	cd $(SERVER_DIR) && SERVER_ID=$(SERIAL_SERVER_ID) DEVICE_PORT=4100 ENABLE_SERIAL_DEVICE_TRANSPORT=1 ENABLE_HOST_RUNTIME_DEVICE=$(ENABLE_HOST_RUNTIME_DEVICE) SERIAL_PORTS="$(SERIAL_PORTS)" SERIAL_BAUD_RATE=$(SERIAL_BAUD_RATE) GATEWAY_WS_URL=$(ESP_GATEWAY_WS_URL) GATEWAY_AUTH_TOKEN=$(ESP_GATEWAY_AUTH_TOKEN) mix aetherium.serial.smoke --wait-ms 30000 --timeout-ms 20000

host-demo hdemo:
	$(MAKE) serial-server SERIAL_SERVER_ID=host_demo ENABLE_HOST_RUNTIME_DEVICE=1 SERIAL_PORTS="$(SERIAL_PORTS)"

host-smoke hsmoke:
	$(MAKE) serial-smoke SERIAL_SERVER_ID=host_demo ENABLE_HOST_RUNTIME_DEVICE=1 SERIAL_PORTS="$(SERIAL_PORTS)"

mcxn947-configure mcfg:
	$(MCXN947_CMAKE) -S $(MCXN947_FW_DIR) -B $(MCXN947_BUILD_DIR) -DCMAKE_TOOLCHAIN_FILE=$(MCXN947_TOOLCHAIN)

mcxn947-build mbuild: mcxn947-configure
	$(MCXN947_CMAKE) --build $(MCXN947_BUILD_DIR)

mcxn947-flash mflash: mcxn947-build
	$(MCXN947_PYOCD) load $(MCXN947_PYOCD_UID_ARG) -t $(MCXN947_TARGET) $(MCXN947_HEX)

mcxn947-reset mreset:
	$(MCXN947_PYOCD) reset $(MCXN947_PYOCD_UID_ARG) -t $(MCXN947_TARGET)

mcxn947-server msrv:
	$(MAKE) serial-server SERIAL_SERVER_ID=mcxn_host SERIAL_PORTS=$(MCXN947_PORT)

mcxn947-smoke msmoke:
	$(MAKE) serial-smoke SERIAL_SERVER_ID=mcxn_host SERIAL_PORTS=$(MCXN947_PORT)
