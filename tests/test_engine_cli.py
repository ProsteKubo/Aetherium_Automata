#!/usr/bin/env python3
import argparse
import subprocess
import sys
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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", required=True)
    parser.add_argument("--case", required=True, choices=[
        "help", "version", "validate_valid", "validate_invalid"
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
    else:
        raise SystemExit(f"Unknown case {args.case}")


if __name__ == "__main__":
    try:
        main()
    except AssertionError as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)

