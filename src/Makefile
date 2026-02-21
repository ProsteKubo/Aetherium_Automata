COMPOSE ?= docker compose
DEV_SERVICES ?= gateway server3 device1

.PHONY: help up u down reset nuke restart r restart-gateway rg restart-server3 rs restart-device rd logs l logs0 l0 build-device bd rebuild-device rb-device ps

help:
	@echo "Aetherium src dev shortcuts"
	@echo ""
	@echo "Core:"
	@echo "  make up / make u               - start gateway+server3+device1"
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
	@echo "Reset:"
	@echo "  make down                      - stop stack (keep volumes)"
	@echo "  make reset                     - down + up"
	@echo "  make nuke                      - down -v (wipe volumes)"

up u:
	$(COMPOSE) up -d $(DEV_SERVICES)

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
