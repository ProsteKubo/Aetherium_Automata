# Aetherium Automata — Knowledge / Status (k 2026‑01‑17)

Tento soubor shrnuje, co je v repozitáři **reálně implementováno** vs. co je zatím jen **navrženo / plánováno** vůči cílům:
- distribuované řídicí systémy (DEVS)
- IEC‑61499 inspirované komunikující časované automaty
- IDE (web) pro modelování, generování, transport, monitoring, time‑travel debugging, dynamickou rekonfiguraci
- běh na MCU (ESP, RP2040/Pico) i Linux/ROS2
- komunikace (MQTT, UDP, DDE) + HW přístup (GPIO/I2C…)

Repozitář dnes obsahuje 3 hlavní vrstvy:
- **UI (IDE)**: prototyp Electron+React aplikace s vizuálním editorem automatu a velkým množstvím “mock” funkcí.
- **Servers**: Elixir/Phoenix “gateway” + Elixir “server” (agent), které spolu umí komunikovat přes Phoenix Channels a posílat device list/alerty.
- **IoT / Runtime (RTE)**: C++ engine, který umí načíst YAML do struktur a má minimální CLI/validaci; vlastní deterministický běh, skriptování, HW HAL a síťové transporty jsou zatím kostra.

---

## 1) Stav vůči cílům (rychlá mapa)

Legenda: **✅ hotovo** / **🟡 částečně** / **⚪ pouze návrh** / **❌ chybí**

### 1.1 Teorie a porovnání nástrojů
- DEVS formalismus: 🟡 (rozsáhlé teoretické podklady v dokumentaci, ale bez implementace exekučních DEVS sémantik)
- IEC‑61499: 🟡 (teorie + inspirace v návrhu; chybí skutečná FB runtime s IEC‑61499 modely)
- Node‑RED: 🟡 (zmínky a srovnání v dokumentaci; bez integrace)
- Eclipse 4diac/FORTE: 🟡 (zmínky a srovnání v dokumentaci; bez integrace)
- ROS2 + MicroROS: ⚪/❌ (v plánech, bez kódu integrace)

Hlavní zdroj: [RESEARCH.md](RESEARCH.md), [GOALS_STRATEGY_ARCH.md](GOALS_STRATEGY_ARCH.md)

### 1.2 Runtime Environment (RTE)
- Interpretované automaty inspirované IEC‑61499: 🟡 (datové struktury + YAML parser; exekuce zatím ne)
- Časování / timed automata: ❌ (není scheduler, tick, timers, time advance)
- Komunikující automaty (distribuce): ❌ (transporty jen jako stuby, chybí protokol na úrovni device)
- Přístup k HW (GPIO/I2C…): ❌ (HAL není implementovaná)
- Multi‑platform: 🟡 (C++ host build funguje; MCU port zatím není)

### 1.3 IDE + infrastruktura
- Vizuální modelování (hierarchie, DEVS styl): 🟡 (ReactFlow editor pro stavy/transition; hierarchie/DEVS model jen vizualizačně)
- Generování kódu pro běh (RTE): ❌ (export do YAML/“deployable blob” není hotový jako end‑to‑end pipeline)
- Transport do zařízení dle distribučního modelu: ⚪/❌ (UI má API návrh, backend neumí)
- Monitoring běhu: 🟡 (UI umí zobrazit device list; zbytek je mock)
- Time‑travel debugging: 🟡 (UI panel existuje, ale používá mock data; backend/RTE recording ne)
- Dynamická rekonfigurace běžícího systému: ❌
- Interoperabilita (WiFi relé, Zigbee, ROS2 subsystémy): ❌

### 1.4 Komunikace (MQTT, UDP, DDE)
- MQTT: ⚪/❌ (v dokumentaci a plánu; v C++ je jen prázdný `mqtt_transport`)
- UDP: ❌ (není implementováno)
- DDE: ❌ (není implementováno)

---

## 2) UI (IDE) — co je hotovo a co je mock

### 2.1 Co UI skutečně umí dnes
✅ Vizuální editor automatu (stavy + přechody) přes ReactFlow:
- [src/ide/src/renderer/src/components/editor/AutomataEditor.tsx](src/ide/src/renderer/src/components/editor/AutomataEditor.tsx)
- custom node/edge komponenty: [src/ide/src/renderer/src/components/editor/StateNode.tsx](src/ide/src/renderer/src/components/editor/StateNode.tsx), [src/ide/src/renderer/src/components/editor/TransitionEdge.tsx](src/ide/src/renderer/src/components/editor/TransitionEdge.tsx)

✅ Editor kódu (Monaco) pro Lua‑like skripty (z pohledu UI):
- [src/ide/src/renderer/src/components/editor/CodeEditor.tsx](src/ide/src/renderer/src/components/editor/CodeEditor.tsx)

✅ Základní “gateway” panel: connect + ping + list devices + restart device (přes Phoenix Channels):
- [src/ide/src/renderer/src/components/panels/GatewayPanel.tsx](src/ide/src/renderer/src/components/panels/GatewayPanel.tsx)
- integrace popsaná v [src/ide/GATEWAY_INTEGRATION.md](src/ide/GATEWAY_INTEGRATION.md)

🟡 Vizualizační panely (Network/Devices/Automata overview) existují a renderují data ze store, ale hodně detailů je demo/mock:
- [src/ide/src/renderer/src/components/panels/NetworkPanel.tsx](src/ide/src/renderer/src/components/panels/NetworkPanel.tsx)
- [src/ide/src/renderer/src/components/panels/DevicesPanel.tsx](src/ide/src/renderer/src/components/panels/DevicesPanel.tsx)
- [src/ide/src/renderer/src/components/panels/AutomataOverviewPanel.tsx](src/ide/src/renderer/src/components/panels/AutomataOverviewPanel.tsx)

### 2.2 Co je v UI jen navrženo / simulováno
🟡 Time‑travel debugging panel je zatím čistě mock (generuje snapshoty lokálně):
- [src/ide/src/renderer/src/components/panels/TimeTravelPanel.tsx](src/ide/src/renderer/src/components/panels/TimeTravelPanel.tsx)

🟡 Store + service rozhraní obsahují velký rozsah funkcí (deploy, step, snapshot, OTA…), ale backend je neumí:
- rozhraní: [src/ide/src/renderer/src/services/gateway/IGatewayService.ts](src/ide/src/renderer/src/services/gateway/IGatewayService.ts)
- mock implementace (většina automata/execution/time‑travel/OTA): [src/ide/src/renderer/src/services/gateway/MockGatewayService.ts](src/ide/src/renderer/src/services/gateway/MockGatewayService.ts)
- Phoenix implementace má jen část (ping/list/restart + eventy): [src/ide/src/renderer/src/services/gateway/PhoenixGatewayService.ts](src/ide/src/renderer/src/services/gateway/PhoenixGatewayService.ts)

Poznámka k požadavku “IDE jako webová aplikace”:
- aktuálně je IDE **Electron desktop app** (renderer je web‑tech). Viz [src/ide/package.json](src/ide/package.json).

---

## 3) Servers — gateway + server

### 3.1 Gateway (Elixir/Phoenix) — co umí
✅ WebSocket/Channels endpoint pro UI:
- topic `gateway:control`
- implementované příkazy: `ping`, `list_devices`, `list_servers`, `restart_device`
- soubor: [src/gateway/aetherium_gateway/lib/aetherium_gateway_web/channels/gateway_channel.ex](src/gateway/aetherium_gateway/lib/aetherium_gateway_web/channels/gateway_channel.ex)

✅ Příjem “server” připojení:
- topic `server:gateway` + heartbeat
- server posílá `device_update` a `device_alert`, gateway to agreguje a broadcastuje do UI
- soubor: [src/gateway/aetherium_gateway/lib/aetherium_gateway_web/channels/server_channel.ex](src/gateway/aetherium_gateway/lib/aetherium_gateway_web/channels/server_channel.ex)

✅ Jednoduchý registry/aggregator připojených serverů a jejich device listů:
- [src/gateway/aetherium_gateway/lib/aetherium_gateway/server_tracker.ex](src/gateway/aetherium_gateway/lib/aetherium_gateway/server_tracker.ex)

❌ Co chybí oproti “Controller/Gateway” z architektury:
- discovery/provisioning/flash/OTA pipeline pro reálná zařízení
- autentizace mimo “dev_secret_token/server_secret_token”
- protokol směrem k embedded runtimům (Engine Protocol z docs zatím není implementován)

### 3.2 Server (Elixir agent) — co umí
✅ Připojí se jako “server” do gateway přes PhoenixClient a periodicky posílá heartbeat:
- [src/server/aetherium_server/lib/aetherium_server/gateway_connection.ex](src/server/aetherium_server/lib/aetherium_server/gateway_connection.ex)

🟡 Umí poslat gateway seznam zařízení a alerty, pokud mu je někdo dodá (`report_devices/1`, `report_alert/1`).

❌ Co chybí:
- reálná discovery zařízení, sběr telemetrie, routing příkazů k device runtime
- integrace MQTT/UDP/DDS‑XRCE

---

## 4) IoT / Runtime (RTE) — C++ engine

### 4.1 Co je implementováno
✅ CMake target `aetherium_engine` jde zbuildit na hostu (macOS) a vytvoří binárku:
- [CMakeLists.txt](CMakeLists.txt)

✅ CLI (help/version/validate/run flagy) + argument parsing:
- [src/engine/argparser.cpp](src/engine/argparser.cpp)
- [tests/spec/engine_cli.md](tests/spec/engine_cli.md)

✅ Načtení YAML do interních struktur (states/transitions/variables), pro **canonical mapping form** YAML:
- parser + model: [src/engine/automata_parser.cpp](src/engine/automata_parser.cpp), [src/engine/automata.hpp](src/engine/automata.hpp)

✅ Základní validace přítomnosti top‑level klíčů (`version/config/automata`) a syntaktické validace YAML přes RapidYAML:
- [src/engine/automata_validator.cpp](src/engine/automata_validator.cpp)

Pozor: `--validate` u syntakticky špatného YAML v praxi končí abortem (exit 134) z knihovny parseru; není to “graceful error handling”, ale testům to může stačit.

### 4.2 Co zatím neexistuje (největší gapy)
❌ Vlastní exekuce automatu:
- `Engine::run()` je zatím nekonečná smyčka s TODO a bez scheduleru/transition logic.
- [src/engine/engine.cpp](src/engine/engine.cpp)

❌ Lua interpreter / script runtime:
- ačkoliv spec existuje (viz níže), v C++ není žádná integrace Lua.
- [docs/Lua_Runtime_API.md](docs/Lua_Runtime_API.md)

❌ Timed automata (timeouty, tick rate, time advance) + determinismus/TTD recording:
- jen návrh v docs, žádná implementace snapshot/trace.

❌ HAL pro HW (GPIO/I2C/SPI/ADC/PWM…):
- není žádný kód pro ESP32/Pico ani abstrakce periferií.

❌ Transporty (MQTT/UDP/…):
- existuje rozhraní `ITransport`, ale žádná funkční implementace.
- [src/transport/itransport.hpp](src/transport/itransport.hpp)
- `mqtt_transport` je prázdná třída: [src/transport/mqtt_transport.hpp](src/transport/mqtt_transport.hpp)

### 4.3 Nesoulad YAML spec vs. aktuální implementace
- Dokumentace tvrdí podporu “list‑of‑singletons” i “canonical mapping”, včetně folder layoutu: [docs/Automata_YAML_Spec.md](docs/Automata_YAML_Spec.md)
- Implementace parseru/validatoru dnes pracuje s `root.is_map()` → folder příklad z `example/.../one-state-automata-folder/one-state-automata.yaml` neprojde validací.
  - příklad folder YAML: [example/automata/automata-yaml-examples/one-state-automata-folder/one-state-automata.yaml](example/automata/automata-yaml-examples/one-state-automata-folder/one-state-automata.yaml)

---

## 5) Protokol a architektura — dokumentace vs. kód

✅ Dokumentace architektury a protokolu existuje:
- high‑level komponenty: [docs/architecture/overview.md](docs/architecture/overview.md)
- engine scope: [docs/engine/README.md](docs/engine/README.md), [docs/engine/usage.md](docs/engine/usage.md)
- návrh protokolu: [docs/protocol/overview.md](docs/protocol/overview.md)

❌ Kód implementuje jen malý subset (Phoenix Channels mezi UI↔Gateway a Server↔Gateway).
Engine protocol envelope/typy (hello/load/start/telemetry/state_snapshot/…) zatím nikde nejsou implementované.

---

## 6) Demonstrátor / příklady

✅ Příklady YAML automatů:
- inline (odpovídá současnému C++ parseru): [example/automata/automata-yaml-examples/one-state-automata-inline.yaml](example/automata/automata-yaml-examples/one-state-automata-inline.yaml)
- folder (dnes neprojde validací v C++ engine): [example/automata/automata-yaml-examples/one-state-automata-folder/one-state-automata.yaml](example/automata/automata-yaml-examples/one-state-automata-folder/one-state-automata.yaml)
- komplexnější folder příklad (thermostat): [example/automata/automata-yaml-examples/thermostat-folder/thermostat.yaml](example/automata/automata-yaml-examples/thermostat-folder/thermostat.yaml)

🟡 IDE demonstrace:
- editor + vizualizace fungují lokálně (UI), ale execution/time‑travel jsou zatím simulované.

---

## 7) Co je “nejvíc missing” proti zadání (stručný seznam)

### UI
- reálné napojení automata CRUD + deploy/execution/time‑travel na backend (dnes mock)
- export/generování artefaktů pro RTE (YAML → deployable model/blob)

### Servers
- controller funkce: provisioning, flashing, OTA, RBAC
- persistent telemetry storage + monitoring pipeline
- dynamická rekonfigurace (runtime graph rewiring)

### IoT/RTE
- deterministický scheduler + timed semantics
- Lua runtime + sandbox
- HW HAL (GPIO/I2C…)
- reálné transporty (MQTT/UDP, případně DDS‑XRCE pro ROS2/MicroROS)
- trace recording + replay (TTD)

---

## 8) Nejbližší logický “MVP” krok (pokud chcete)

Pokud cílem je rychlá end‑to‑end demo smyčka, nejmenší vertikální řez by byl:
1) Zafixovat YAML kompatibilitu (inline i folder) + robustní validace.
2) Implementovat minimální execution loop (single automaton, bez distribuce): guards → transition → on_enter/on_exit.
3) Přidat Lua (jen `condition()` a `body()`), bez fuzzy/TTD.
4) Přidat jednoduchý transport (např. UDP JSON) pro `state_snapshot` do gateway.
5) V UI přepnout snapshot/transition vizualizaci z mock na reálné eventy.
