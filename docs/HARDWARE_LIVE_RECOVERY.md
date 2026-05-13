# Hardware Live Recovery

Real ESP32 and FRDM-MCXN947 demos use USB serial and debug probes. During a live session the OS can keep the serial device node visible while the board firmware is no longer announcing itself to the Aetherium server, or while the debug probe temporarily disappears from `pyocd`/`arduino-cli`. Treat this as an expected hardware-loop recovery case, not as an application-level deployment failure.

## Symptoms

- The IDE or server shows only desktop/C++ devices, not ESP32 or `mcxn947-core0`.
- The serial host opens `/dev/ttyUSB*`, `/dev/ttyACM*`, or `/dev/cu.*`, but no device registers.
- FRDM-MCXN947 deploy fails with `chunk_ack_timeout at chunk 0` or `final_load_ack_timeout at chunk 0`.
- `pyocd list` reports no available probes even though `lsusb` still shows NXP MCU-LINK.
- `arduino-cli board list` shows `Unknown` or no ESP board even though the USB cable is connected.

## First Recovery Pass

Stop any host serial server that may still own the port, then reset or replug the board.

```bash
cd src
make ports
lsof -nP /dev/ttyACM0 /dev/ttyUSB0 2>/dev/null || true
```

For FRDM-MCXN947:

```bash
pyocd list -p -vv
make mcxn947-flash MCXN947_PROBE_UID=23G2JL343RO3G MCXN947_TARGET=mcxn947vdf
make mcxn947-demo MCXN947_DEVICE_ID=mcxn947-core0
```

For ESP32:

```bash
arduino-cli board list
make esp-flash ESP_PORT=/dev/ttyUSB0
make esp-server ESP_PORT=/dev/ttyUSB0
make esp-smoke
```

On macOS, use `/dev/cu.usbserial-*` or `/dev/cu.usbmodem*` instead of Linux paths.

## Linux Access Checks

If ports or probes are missing after reconnecting:

```bash
ls -l /dev/serial/by-id /dev/ttyUSB* /dev/ttyACM* 2>/dev/null
lsusb | grep -Ei 'nxp|mcu|cmsis|silicon|cp210|1a86|ch34|esp'
groups
```

The user should normally be in the serial-device groups used by the distribution, commonly `uucp` and `lock` on Arch-like systems. After changing groups, log out/in or reboot.

If kernel modules are available on the host:

```bash
sudo modprobe cp210x ch341 cdc_acm usbserial
```

Some custom kernels may not ship every USB serial module. In that case, rely on the device nodes that already appear under `/dev/serial/by-id`.

## Serial Deploy Diagnostics

When a device registers but deploy still fails, run with serial tracing:

```bash
cd src
AETHERIUM_SERIAL_TRACE=1 make mcxn947-demo MCXN947_DEPLOY_CHUNK_SIZE=16
```

Useful interpretations:

- `Serial frame ... hello` means the board firmware is announcing correctly.
- `Serial write ... bytes=48` during deploy means the host is sending a chunk.
- `Serial frame ... ack` means the board received and acknowledged that chunk.
- `Serial frame ... load_ack` means the complete artifact loaded.
- Repeated host writes with no `ack` normally mean the board needs reset/reflash or the serial path is congested.

For live demos, start with `MCXN947_DEPLOY_CHUNK_SIZE=16` or `128`. Larger chunks are faster but less forgiving on freshly reset serial links.

## Expected Demo Command

The minimal FRDM built-in hardware showcase is:

```bash
cd src
make mcxn947-demo
```

It deploys `example/automata/showcase/09_mcxn947/mcxn947_gpio_buttons_leds.yaml`:

- SW2 drives the red LED.
- SW3 drives the green LED.
- The blue LED remains firmware status/heartbeat.

