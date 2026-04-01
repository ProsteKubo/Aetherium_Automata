from __future__ import annotations

import os
import subprocess
import tempfile
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parents[1]


def _engine_binary() -> Path | None:
    env_path = os.environ.get("AETHERIUM_ENGINE_BIN")
    candidates = [
        Path(env_path) if env_path else None,
        REPO_ROOT / "build" / "aetherium_engine",
        REPO_ROOT / "build-host" / "aetherium_engine",
        REPO_ROOT / "build-cxx20" / "aetherium_engine",
        Path("/tmp/aetherium_plan_build/aetherium_engine"),
    ]

    for candidate in candidates:
        if candidate and candidate.exists():
            return candidate

    return None


@pytest.fixture(scope="module")
def engine_binary() -> Path:
    binary = _engine_binary()
    if binary is None:
        pytest.skip("aetherium_engine binary not found; set AETHERIUM_ENGINE_BIN to enable CLI checks")
    return binary


def _run(cmd: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, text=True, capture_output=True, check=False)


def test_engine_help(engine_binary: Path) -> None:
    proc = _run([str(engine_binary), "--help"])
    assert proc.returncode == 0, proc.stderr
    assert "Usage" in proc.stdout or "usage" in proc.stdout


def test_engine_validate_invalid(engine_binary: Path) -> None:
    invalid = REPO_ROOT / "tests" / "data" / "invalid_automata.yaml"
    proc = _run([str(engine_binary), "--validate", str(invalid)])
    assert proc.returncode != 0
    assert "error" in (proc.stderr + proc.stdout).lower() or "invalid" in (proc.stderr + proc.stdout).lower()


def test_engine_trace_export(engine_binary: Path) -> None:
    source = REPO_ROOT / "tests" / "data" / "trace_runtime.yaml"

    with tempfile.TemporaryDirectory() as tmpdir:
        trace_path = Path(tmpdir) / "engine-trace.jsonl"
        proc = _run(
            [
                str(engine_binary),
                "--run",
                str(source),
                "--trace-file",
                str(trace_path),
                "--instance-id",
                "pytest-trace-smoke",
                "--placement",
                "host-lab",
                "--transport",
                "local",
                "--fault-profile",
                "validation",
                "--fault-duplicate-probability",
                "1",
                "--seed",
                "7",
                "--max-ticks",
                "16",
            ]
        )

        assert proc.returncode == 0, proc.stderr
        assert trace_path.exists()
        assert trace_path.read_text().strip()
