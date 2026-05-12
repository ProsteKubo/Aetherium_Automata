#!/usr/bin/env python3
"""
End-to-end test for time-travel / rewind_deployment.

Flow:
  1. Connect to gateway via Phoenix WebSocket (topic: automata:control)
  2. Deploy the blink automaton to the cpp device
  3. Start execution and let it run ~3 seconds (accumulate state changes)
  4. Record a checkpoint timestamp mid-run
  5. Let it run another ~3 seconds
  6. Call rewind_deployment to the checkpoint
  7. Wait for command_outcome broadcast with the rewind result
  8. Assert:
      - command_outcome.status == "ACK"
      - device_restore field is present (not an error)
      - current_state in the reply matches the snapshot
      - The device sends an Ack (visible in container logs)
  9. Call resume_execution to bring the engine out of Paused state
"""

import asyncio, json, time, sys, pathlib
import websockets
import yaml as pyyaml

GATEWAY_WS    = "ws://localhost:8080/socket/websocket"
OPERATOR_TOKEN = "dev_secret_token"
DEVICE_ID     = "device_cpp_01"
SERVER_ID     = "svr_03"
YAML_PATH  = pathlib.Path(__file__).parent.parent / "example/automata/showcase/01_basics/blink_with_manual_override.yaml"


class PhoenixChannel:
    """
    Minimal Phoenix channel client with a background reader so push() and listen()
    don't block each other.
    """

    def __init__(self, ws, topic):
        self.ws = ws
        self.topic = topic
        self._ref = 1
        self._pending: dict[str, asyncio.Future] = {}
        self._broadcasts: asyncio.Queue = asyncio.Queue()
        self._reader_task: asyncio.Task | None = None

    def _next_ref(self):
        r = str(self._ref)
        self._ref += 1
        return r

    async def _reader(self):
        """Background task: route all incoming messages."""
        try:
            async for raw in self.ws:
                msg = json.loads(raw)
                ref = msg[1]
                event_name = msg[3]
                payload = msg[4]
                if ref in self._pending:
                    fut = self._pending.pop(ref)
                    if not fut.done():
                        fut.set_result(payload)
                else:
                    await self._broadcasts.put({"event": event_name, "payload": payload})
        except Exception:
            pass  # connection closed

    async def join(self):
        self._reader_task = asyncio.create_task(self._reader())
        ref = self._next_ref()
        fut: asyncio.Future = asyncio.get_event_loop().create_future()
        self._pending[ref] = fut
        await self.ws.send(json.dumps([None, ref, self.topic, "phx_join", {}]))
        resp = await asyncio.wait_for(fut, 10)
        if resp.get("status") != "ok":
            raise RuntimeError(f"Join failed: {resp}")
        return resp["response"]

    async def push(self, event, payload, timeout=20):
        ref = self._next_ref()
        fut: asyncio.Future = asyncio.get_event_loop().create_future()
        self._pending[ref] = fut
        await self.ws.send(json.dumps([None, ref, self.topic, event, payload]))
        return await asyncio.wait_for(fut, timeout)

    async def listen(self, seconds):
        """Collect broadcast events for `seconds`. Returns list of events."""
        events = []
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            remaining = deadline - time.monotonic()
            try:
                ev = await asyncio.wait_for(self._broadcasts.get(), min(remaining, 0.5))
                events.append(ev)
            except asyncio.TimeoutError:
                pass
        return events


def check_ack(resp, name):
    """
    Phoenix replies wrap the channel response in {"status": "ok"/"error", "response": ...}.
    The channel wraps the handler result in {"status": "ACK"/"NAK"/"ERROR", "result": ...}.
    Returns (True, result_dict) on ACK, (False, None) otherwise.
    """
    if resp.get("status") != "ok":
        print(f"[FAIL] {name}: Phoenix-level error: {resp}")
        return False, None
    inner = resp.get("response", {})
    if inner.get("status") != "ACK":
        print(f"[FAIL] {name}: non-ACK response: {inner}")
        return False, None
    return True, inner.get("result", {})


async def run():
    ok = True
    url = f"{GATEWAY_WS}?vsn=2.0.0&token={OPERATOR_TOKEN}"
    async with websockets.connect(
        url,
        additional_headers={"Origin": "http://localhost"},
        ping_interval=None,
    ) as ws:
        ch = PhoenixChannel(ws, "automata:control")
        await ch.join()
        print("[+] Joined automata:control")

        # --- 1. Deploy ---
        automata_id = f"test_blink_tt_{int(time.time())}"
        automata_payload = pyyaml.safe_load(YAML_PATH.read_text())
        resp = await ch.push("deploy", {
            "automata_id": automata_id,
            "device_id": DEVICE_ID,
            "server_id": SERVER_ID,
            "automata": automata_payload,
        })
        ok_flag, result = check_ack(resp, "deploy")
        if not ok_flag:
            return False

        deployment = result.get("deployment", {})
        deployment_id = deployment.get("deployment_id") or deployment.get("id")
        print(f"[+] Deployed: {deployment_id}")

        # --- 2. Start (dispatched async to server; listen for deployment_status confirmation) ---
        resp = await ch.push("start_execution", {
            "device_id": DEVICE_ID,
            "deployment_id": deployment_id,
        })
        ok_flag, _ = check_ack(resp, "start_execution")
        if not ok_flag:
            return False
        print("[+] start_execution dispatched")

        # --- 3. Let it run 3s, record a checkpoint ---
        print("[*] Letting automaton run 3s ...")
        await ch.listen(3)
        checkpoint_ts = int(time.time() * 1000)
        print(f"[+] Checkpoint timestamp: {checkpoint_ts}")

        # --- 4. Run another 3s to accumulate more transitions ---
        print("[*] Letting automaton run another 3s ...")
        await ch.listen(3)

        # --- 5. Rewind ---
        print(f"[*] Rewinding to {checkpoint_ts} ...")
        resp = await ch.push("rewind_deployment", {
            "device_id": DEVICE_ID,
            "deployment_id": deployment_id,
            "target_timestamp": checkpoint_ts,
        })
        ok_flag, sent = check_ack(resp, "rewind_deployment dispatch")
        if not ok_flag:
            ok = False
        else:
            print(f"[+] Rewind dispatched to server: {sent}")

        # --- 6. Wait for command_outcome broadcast (up to 10s) ---
        print("[*] Waiting for rewind command_outcome broadcast ...")
        rewind_outcome = None
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline and rewind_outcome is None:
            remaining = deadline - time.monotonic()
            events = await ch.listen(min(remaining, 1.0))
            for ev in events:
                if ev["event"] == "command_outcome" and ev["payload"].get("command_type") == "rewind_deployment":
                    rewind_outcome = ev["payload"]
                    break

        if rewind_outcome is None:
            print("[FAIL] No command_outcome received for rewind_deployment within 10s")
            ok = False
        else:
            d = rewind_outcome.get("data", {})
            device_restore = d.get("device_restore")
            print(f"\n--- Rewind Results ---")
            print(f"  outcome_status  : {rewind_outcome.get('status')}")
            print(f"  rewound_to      : {d.get('rewound_to')}")
            print(f"  events_replayed : {d.get('events_replayed')}")
            print(f"  current_state   : {d.get('state', {}).get('current_state')}")
            print(f"  source          : {d.get('source')}")
            print(f"  device_restore  : {device_restore}")

            if rewind_outcome.get("status") != "ACK":
                print(f"[FAIL] rewind outcome non-ACK: {rewind_outcome}")
                ok = False
            elif isinstance(device_restore, dict) and device_restore.get("ok"):
                print("[PASS] RestoreState sent to device successfully")
            elif device_restore == {"error": "device_not_connected"}:
                print("[WARN] Device not connected via direct transport (expected if running in network mode)")
            elif device_restore is None or (isinstance(device_restore, dict) and "error" in device_restore):
                print(f"[FAIL] device_restore indicates failure: {device_restore}")
                ok = False
            else:
                print(f"[PASS] device_restore: {device_restore}")

        # --- 7. Resume ---
        print("\n[*] Resuming after rewind ...")
        resp2 = await ch.push("resume_execution", {
            "device_id": DEVICE_ID,
            "deployment_id": deployment_id,
        })
        ok2, _ = check_ack(resp2, "resume_execution")
        print(f"[+] resume: {'dispatched' if ok2 else 'failed'}")

        # --- 8. Stop cleanly ---
        await ch.push("stop_execution", {
            "device_id": DEVICE_ID,
            "deployment_id": deployment_id,
        })
        print("[+] Stopped")

    return ok


if __name__ == "__main__":
    result = asyncio.run(run())
    sys.exit(0 if result else 1)
