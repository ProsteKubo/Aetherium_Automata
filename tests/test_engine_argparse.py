#!/usr/bin/env python3
import argparse
import subprocess
import sys
from pathlib import Path


def run(cmd):
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    return proc.returncode, proc.stdout, proc.stderr


def case_unknown_flag(binary: Path):
    code, out, err = run([str(binary), "--does-not-exist"])
    assert code != 0, f"unknown flag should fail. code={code} stdout={out} stderr={err}"
    assert ("Usage" in out or "Options" in out), "help text not shown for unknown flag"


def case_missing_arg_run(binary: Path):
    code, out, err = run([str(binary), "--run"])  # missing file path
    assert code != 0, f"missing arg for --run should fail. code={code} stdout={out} stderr={err}"
    assert ("Usage" in out or "Options" in out), "help text not shown for missing arg"


def case_mode_network_ok(binary: Path):
    code, out, err = run([str(binary), "--mode", "network"])  # valid mode value
    assert code == 0, f"--mode network should succeed. code={code} stdout={out} stderr={err}"


def case_mode_invalid(binary: Path):
    code, out, err = run([str(binary), "--mode", "badmode"])  # invalid mode value
    assert code != 0, f"invalid --mode value should fail. code={code} stdout={out} stderr={err}"
    assert ("Usage" in out or "Options" in out), "help text not shown for invalid mode"

def case_run_valid_file(binary: Path, file: Path):
    assert file.exists(), f"automata file not found: {file}"
    code, out, err = run([str(binary), "--run", str(file)])
    assert code == 0, f"--run with existing file should succeed. code={code} stdout={out} stderr={err}"


def case_validate_missing_file(binary: Path):
    missing = Path("tests/data/this_file_does_not_exist.yaml")
    code, out, err = run([str(binary), "--validate", str(missing)])
    assert code != 0, f"--validate with missing file should fail. code={code} stdout={out} stderr={err}"
    assert "File not found" in out, f"expected 'File not found' message. stdout={out}"


def case_config_missing_file(binary: Path):
    missing = Path("tests/data/this_config_does_not_exist.yaml")
    code, out, err = run([str(binary), "--config", str(missing)])
    assert code != 0, f"--config with missing file should fail. code={code} stdout={out} stderr={err}"
    assert "File not found" in out, f"expected 'File not found' message. stdout={out}"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", required=True)
    parser.add_argument(
        "--case",
        required=True,
        choices=[
            "unknown_flag",
            "missing_arg_run",
            "mode_network_ok",
            "mode_invalid",
            "mode_noarg_defaults",
            "run_valid_file",
            "validate_missing_file",
            "config_missing_file",
        ],
    )
    parser.add_argument("--file")
    args = parser.parse_args()

    binary = Path(args.binary)
    if args.case == "unknown_flag":
        case_unknown_flag(binary)
    elif args.case == "missing_arg_run":
        case_missing_arg_run(binary)
    elif args.case == "mode_network_ok":
        case_mode_network_ok(binary)
    elif args.case == "mode_invalid":
        case_mode_invalid(binary)
    elif args.case == "run_valid_file":
        assert args.file, "--file is required for run_valid_file"
        case_run_valid_file(binary, Path(args.file))
    elif args.case == "validate_missing_file":
        case_validate_missing_file(binary)
    elif args.case == "config_missing_file":
        case_config_missing_file(binary)
    else:
        raise SystemExit(f"Unknown case {args.case}")


if __name__ == "__main__":
    try:
        main()
    except AssertionError as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)

