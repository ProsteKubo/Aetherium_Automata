"""Minimal codec helpers for Aetherium Engine binary protocol."""

from __future__ import annotations

import json
import struct
import time
from typing import Any, Dict, Tuple

MAGIC = 0xAE01
VERSION = 0x01

MT_HELLO = 0x01
MT_HELLO_ACK = 0x02
MT_DISCOVER = 0x03
MT_PING = 0x04
MT_PONG = 0x05
MT_PROVISION = 0x06
MT_GOODBYE = 0x07

MT_LOAD_AUTOMATA = 0x40
MT_LOAD_ACK = 0x41
MT_START = 0x42
MT_STOP = 0x43
MT_RESET = 0x44
MT_STATUS = 0x45
MT_PAUSE = 0x46
MT_RESUME = 0x47

MT_INPUT = 0x80
MT_OUTPUT = 0x81
MT_VARIABLE = 0x82
MT_STATE_CHANGE = 0x83
MT_TELEMETRY = 0x84
MT_TRANSITION_FIRED = 0x85

MT_ERROR = 0xE0
MT_DEBUG = 0xD0
MT_ACK = 0xF0
MT_NAK = 0xF1

VF_VOID = 0
VF_BOOL = 1
VF_I32 = 2
VF_I64 = 3
VF_F32 = 4
VF_F64 = 5
VF_STRING = 6
VF_BINARY = 7


def now_ms() -> int:
    return int(time.time() * 1000)


def frame(message_type: int, payload: bytes) -> bytes:
    return struct.pack(">HBBH", MAGIC, VERSION, message_type, len(payload)) + payload


def parse_frame(binary: bytes) -> Tuple[int, bytes]:
    if len(binary) < 6:
        raise ValueError("frame too short")
    magic, version, msg_type, length = struct.unpack_from(">HBBH", binary, 0)
    if magic != MAGIC:
        raise ValueError("invalid magic")
    if version != VERSION:
        raise ValueError(f"unsupported version {version}")
    if len(binary) < 6 + length:
        raise ValueError("truncated frame")
    payload = binary[6 : 6 + length]
    return msg_type, payload


def encode_value(value: Any) -> bytes:
    if value is None:
        return struct.pack(">B", VF_VOID)
    if isinstance(value, bool):
        return struct.pack(">BB", VF_BOOL, 1 if value else 0)
    if isinstance(value, int):
        if -2_147_483_648 <= value <= 2_147_483_647:
            return struct.pack(">Bi", VF_I32, value)
        return struct.pack(">Bq", VF_I64, value)
    if isinstance(value, float):
        return struct.pack(">Bd", VF_F64, value)
    if isinstance(value, (dict, list)):
        encoded = json.dumps(value, separators=(",", ":")).encode("utf-8")
        return struct.pack(">BH", VF_STRING, len(encoded)) + encoded

    data = str(value).encode("utf-8")
    return struct.pack(">BH", VF_STRING, len(data)) + data


def decode_value(data: bytes, offset: int = 0) -> Tuple[Any, int]:
    if offset >= len(data):
        raise ValueError("missing value type")

    value_type = data[offset]
    offset += 1

    if value_type == VF_VOID:
        return None, offset
    if value_type == VF_BOOL:
        return data[offset] != 0, offset + 1
    if value_type == VF_I32:
        return struct.unpack_from(">i", data, offset)[0], offset + 4
    if value_type == VF_I64:
        return struct.unpack_from(">q", data, offset)[0], offset + 8
    if value_type == VF_F32:
        return struct.unpack_from(">f", data, offset)[0], offset + 4
    if value_type == VF_F64:
        return struct.unpack_from(">d", data, offset)[0], offset + 8
    if value_type in (VF_STRING, VF_BINARY):
        length = struct.unpack_from(">H", data, offset)[0]
        offset += 2
        raw = data[offset : offset + length]
        if value_type == VF_BINARY:
            return raw, offset + length
        decoded = raw.decode("utf-8", errors="replace")
        try:
            return json.loads(decoded), offset + length
        except json.JSONDecodeError:
            return decoded, offset + length

    raise ValueError(f"unsupported value type {value_type}")


def parse_command(frame_bytes: bytes) -> Dict[str, Any]:
    msg_type, payload = parse_frame(frame_bytes)

    if msg_type in (MT_START, MT_STOP, MT_RESET, MT_STATUS, MT_PAUSE, MT_RESUME):
        message_id, source_id, target_id, run_id = struct.unpack_from(">IIII", payload, 0)
        return {
            "type": msg_type,
            "message_id": message_id,
            "source_id": source_id,
            "target_id": target_id,
            "run_id": run_id,
        }

    if msg_type == MT_LOAD_AUTOMATA:
        (
            message_id,
            source_id,
            target_id,
            run_id,
            fmt,
            is_chunked,
            chunk_index,
            total_chunks,
            start_after_load,
            replace_existing,
            data_size,
        ) = struct.unpack_from(">IIIIBBHHBBH", payload, 0)
        header_size = struct.calcsize(">IIIIBBHHBBH")
        data = payload[header_size : header_size + data_size]
        return {
            "type": msg_type,
            "message_id": message_id,
            "source_id": source_id,
            "target_id": target_id,
            "run_id": run_id,
            "format": fmt,
            "is_chunked": is_chunked != 0,
            "chunk_index": chunk_index,
            "total_chunks": total_chunks,
            "start_after_load": start_after_load != 0,
            "replace_existing": replace_existing != 0,
            "data": data,
        }

    if msg_type == MT_INPUT:
        message_id, source_id, target_id, run_id, var_id, name_len = struct.unpack_from(
            ">IIIIHH", payload, 0
        )
        offset = struct.calcsize(">IIIIHH")
        name = payload[offset : offset + name_len].decode("utf-8", errors="replace")
        offset += name_len
        value, _ = decode_value(payload, offset)
        return {
            "type": msg_type,
            "message_id": message_id,
            "source_id": source_id,
            "target_id": target_id,
            "run_id": run_id,
            "variable_id": var_id,
            "name": name,
            "value": value,
        }

    if msg_type == MT_PING:
        message_id, source_id, target_id, timestamp_ms, sequence = struct.unpack_from(
            ">IIIQI", payload, 0
        )
        return {
            "type": msg_type,
            "message_id": message_id,
            "source_id": source_id,
            "target_id": target_id,
            "timestamp": timestamp_ms,
            "sequence": sequence,
        }

    return {"type": msg_type, "payload": payload}


def build_hello(
    *,
    message_id: int,
    source_id: int,
    device_id: str,
    device_type: int = 0x05,
    capabilities: int = 0,
    version: Tuple[int, int, int] = (1, 0, 0),
) -> bytes:
    name_bytes = device_id.encode("utf-8")
    payload = struct.pack(
        ">III4BHH",
        message_id,
        source_id,
        0,
        device_type,
        version[0],
        version[1],
        version[2],
        capabilities,
        len(name_bytes),
    ) + name_bytes
    return frame(MT_HELLO, payload)


def build_ping(*, message_id: int, source_id: int, sequence: int) -> bytes:
    payload = struct.pack(">IIIQI", message_id, source_id, 0, now_ms(), sequence)
    return frame(MT_PING, payload)


def build_pong(
    *,
    message_id: int,
    source_id: int,
    target_id: int,
    original_timestamp: int,
    sequence: int,
) -> bytes:
    payload = struct.pack(
        ">IIIQQI",
        message_id,
        source_id,
        target_id,
        original_timestamp,
        now_ms(),
        sequence,
    )
    return frame(MT_PONG, payload)


def build_ack(
    *,
    message_id: int,
    source_id: int,
    target_id: int,
    related_message_id: int,
    info: str = "ok",
) -> bytes:
    info_bytes = info.encode("utf-8")
    payload = struct.pack(
        ">IIIIH",
        message_id,
        source_id,
        target_id,
        related_message_id,
        len(info_bytes),
    ) + info_bytes
    return frame(MT_ACK, payload)


def build_load_ack(
    *,
    message_id: int,
    source_id: int,
    target_id: int,
    run_id: int,
    success: bool = True,
    error: str = "",
    warnings: Tuple[str, ...] = (),
) -> bytes:
    error_bytes = error.encode("utf-8")
    payload = struct.pack(
        ">IIIIBH",
        message_id,
        source_id,
        target_id,
        run_id,
        1 if success else 0,
        len(error_bytes),
    ) + error_bytes
    payload += struct.pack(">H", len(warnings))
    for warning in warnings:
        w = warning.encode("utf-8")
        payload += struct.pack(">H", len(w)) + w
    return frame(MT_LOAD_ACK, payload)


def build_status(
    *,
    message_id: int,
    source_id: int,
    target_id: int,
    run_id: int,
    execution_state: int,
    current_state: int,
    uptime_ms: int,
    transition_count: int = 0,
    tick_count: int = 0,
    error_count: int = 0,
) -> bytes:
    payload = struct.pack(
        ">IIIIBHQQQI",
        message_id,
        source_id,
        target_id,
        run_id,
        execution_state,
        current_state,
        uptime_ms,
        transition_count,
        tick_count,
        error_count,
    )
    return frame(MT_STATUS, payload)


def build_output(
    *,
    message_id: int,
    source_id: int,
    target_id: int,
    run_id: int,
    name: str,
    value: Any,
) -> bytes:
    name_bytes = name.encode("utf-8")
    payload = struct.pack(
        ">IIIIHH",
        message_id,
        source_id,
        target_id,
        run_id,
        0,
        len(name_bytes),
    ) + name_bytes
    payload += encode_value(value)
    payload += struct.pack(">Q", now_ms())
    return frame(MT_OUTPUT, payload)


def build_state_change(
    *,
    message_id: int,
    source_id: int,
    target_id: int,
    run_id: int,
    previous_state: int,
    new_state: int,
    fired_transition: int,
) -> bytes:
    payload = struct.pack(
        ">IIIIHHHQ",
        message_id,
        source_id,
        target_id,
        run_id,
        previous_state,
        new_state,
        fired_transition,
        now_ms(),
    )
    return frame(MT_STATE_CHANGE, payload)


def build_telemetry(
    *,
    message_id: int,
    source_id: int,
    target_id: int,
    run_id: int,
    heap_free: int,
    heap_total: int,
    cpu_usage_percent: float,
    tick_rate: int,
) -> bytes:
    cpu_fixed = int(max(0.0, min(100.0, cpu_usage_percent)) * 100)
    payload = struct.pack(
        ">IIIIQIIHHH",
        message_id,
        source_id,
        target_id,
        run_id,
        now_ms(),
        heap_free,
        heap_total,
        cpu_fixed,
        tick_rate,
        0,
    )
    return frame(MT_TELEMETRY, payload)
