#!/usr/bin/env python3
import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path


def run(cmd):
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    return proc.returncode, proc.stdout, proc.stderr


def case_help(binary: Path):
    code, out, err = run([str(binary), "--help"])
    # Expected: exit 0, usage text on stdout
    assert code == 0, f"--help exit code {code} != 0; stderr: {err} stdout: {out}"
    assert ("Usage" in out or "usage" in out) and ("Options" in out or "--validate" in out), (
        f"--help did not include expected usage/options text. stdout: {out}\n"
    )


def case_version(binary: Path):
    code, out, err = run([str(binary), "--version"])
    assert code == 0, f"--version exit code {code} != 0; stderr: {err} stdout: {out}"
    assert any(ch.isdigit() for ch in out), f"--version did not print a version: {out}"


def case_validate_valid(binary: Path, file: Path):
    assert file.exists(), f"valid YAML not found: {file}"
    code, out, err = run([str(binary), "--validate", str(file)])
    assert code == 0, f"Expected valid YAML to pass validation. code={code} stderr={err} stdout={out}"


def case_validate_invalid(binary: Path, file: Path):
    assert file.exists(), f"invalid YAML not found: {file}"
    code, out, err = run([str(binary), "--validate", str(file)])
    assert code != 0, f"Expected invalid YAML to fail validation. code={code} stdout={out}"
    # Helpful error message expected on stderr or stdout
    assert ("error" in err.lower() or "invalid" in err.lower() or "error" in out.lower()), (
        f"Expected an error message for invalid YAML. stderr: {err} stdout: {out}"
    )


def case_trace_export(binary: Path, file: Path):
    assert file.exists(), f"trace YAML not found: {file}"
    with tempfile.TemporaryDirectory() as tmpdir:
        trace_path = Path(tmpdir) / "engine-trace.jsonl"
        code, out, err = run([
            str(binary),
            "--run", str(file),
            "--trace-file", str(trace_path),
            "--instance-id", "cli-trace-smoke",
            "--placement", "host-lab",
            "--transport", "local",
            "--fault-profile", "validation",
            "--fault-duplicate-probability", "1",
            "--battery-percent", "63.5",
            "--battery-low-threshold-percent", "30",
            "--battery-drain-per-message-percent", "0.5",
            "--latency-budget-ms", "5",
            "--latency-warning-ms", "2",
            "--seed", "7",
            "--max-ticks", "16",
        ])
        assert code == 0, f"Expected trace export run to succeed. code={code} stderr={err} stdout={out}"
        assert trace_path.exists(), f"trace file was not created: {trace_path}"

        records = [
            json.loads(line)
            for line in trace_path.read_text().splitlines()
            if line.strip()
        ]
        assert records, "trace file is empty"
        assert any(record.get("kind") == "lifecycle" for record in records), "expected lifecycle records in trace"
        assert any(record.get("kind") == "egress_message" for record in records), "expected egress records in trace"
        assert any("duplicate" in record.get("fault_actions", []) for record in records), (
            "expected duplicate fault action in trace"
        )
        assert any(record.get("source_instance") == "cli-trace-smoke" for record in records), (
            "expected deployment instance id in trace"
        )
        assert any(record.get("kind") == "black_box_contract" for record in records), (
            "expected black-box contract record in trace"
        )
        assert any(record.get("port_name") == "flag" for record in records), (
            "expected black-box port annotation in trace"
        )
        assert any(record.get("observable_state") == "Done" for record in records), (
            "expected observable state annotation in trace"
        )
        assert any(record.get("battery_percent") is not None for record in records), (
            "expected battery metadata in trace"
        )
        assert any(record.get("latency_budget_ms") == 5 for record in records), (
            "expected latency budget metadata in trace"
        )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", required=True)
    parser.add_argument("--case", required=True, choices=[
        "help", "version", "validate_valid", "validate_invalid", "trace_export"
    ])
    parser.add_argument("--file")
    args = parser.parse_args()

    binary = Path(args.binary)
    if args.case == "help":
        case_help(binary)
    elif args.case == "version":
        case_version(binary)
    elif args.case == "validate_valid":
        assert args.file, "--file is required for validate_valid"
        case_validate_valid(binary, Path(args.file))
    elif args.case == "validate_invalid":
        assert args.file, "--file is required for validate_invalid"
        case_validate_invalid(binary, Path(args.file))
    elif args.case == "trace_export":
        assert args.file, "--file is required for trace_export"
        case_trace_export(binary, Path(args.file))
    else:
        raise SystemExit(f"Unknown case {args.case}")


if __name__ == "__main__":
    try:
        main()
    except AssertionError as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)
