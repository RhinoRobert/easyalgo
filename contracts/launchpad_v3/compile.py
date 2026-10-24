"""Compile PNET Instant Launchpad v3 with the pinned local Puya environment (contracts/.venv-v2, puyapy 5.10.1)."""

import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path


HERE = Path(__file__).resolve().parent
CONTRACTS = HERE.parent
VENV = CONTRACTS / ".venv-v2"
PUYAPY = VENV / "Scripts" / "puyapy.exe"
OUT = HERE / "artifacts" / "launchpad_v3"
BUILD_MANIFEST = HERE / "build-manifest.json"


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _normalize_lf(path: Path) -> None:
    """Make generated text hashes identical on Windows and CI/Linux."""
    content = path.read_bytes()
    normalized = content.replace(b"\r\n", b"\n").replace(b"\r", b"\n")
    if normalized != content:
        path.write_bytes(normalized)


def main() -> int:
    if not PUYAPY.exists():
        raise SystemExit("Missing contracts/.venv-v2; install puyapy==5.10.1 into it before compiling")
    OUT.mkdir(parents=True, exist_ok=True)
    # Puya includes source locations in TEAL comments and ARC-56 source text, so always compile from the same root
    # with the same relative source name: artifact hashes then never depend on the caller's working directory.
    env = {**os.environ, "VIRTUAL_ENV": str(VENV), "PATH": f"{VENV / 'Scripts'};{os.environ['PATH']}"}
    result = subprocess.call(
        [str(PUYAPY), str(Path("launchpad_v3") / "contract.py"), "--out-dir", str(OUT)], cwd=CONTRACTS, env=env,
    )
    if result != 0:
        return result
    for path in [*OUT.glob("*.json"), *OUT.glob("*.teal"), *OUT.glob("*.map")]:
        _normalize_lf(path)

    files = {
        "contract": HERE / "contract.py",
        "arc56": OUT / "PNETInstantLaunchpad.arc56.json",
        "approvalTeal": OUT / "PNETInstantLaunchpad.approval.teal",
        "clearTeal": OUT / "PNETInstantLaunchpad.clear.teal",
    }
    manifest = {
        "schemaVersion": 1,
        "compiler": subprocess.check_output([str(PUYAPY), "--version"], text=True, env=env).strip(),
        "sha256": {name: _sha256(path) for name, path in files.items()},
    }
    BUILD_MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8", newline="\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
