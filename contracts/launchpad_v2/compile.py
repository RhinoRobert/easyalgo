"""Compile PNET Instant Launchpad v2 with the pinned local Puya environment."""

import hashlib
import json
import subprocess
import sys
from pathlib import Path


HERE = Path(__file__).resolve().parent
CONTRACTS = HERE.parent
PUYAPY = CONTRACTS / ".venv-v2" / "Scripts" / "puyapy.exe"
CLIENTGEN = CONTRACTS / ".venv-v2" / "Scripts" / "puyapy-clientgen.exe"
OUT = HERE / "artifacts" / "launchpad_v2"
CLIENTS = HERE / "clients"
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
        raise SystemExit("Missing contracts/.venv-v2; install dependencies before compiling")
    OUT.mkdir(parents=True, exist_ok=True)
    if not CLIENTGEN.exists():
        raise SystemExit("Missing puyapy-clientgen in contracts/.venv-v2")
    # Puya includes source locations in TEAL comments and ARC-56 source text.
    # Always compile from the same root with the same relative source name so
    # artifact hashes do not depend on the caller's current working directory.
    contract_source = Path("launchpad_v2") / "contract.py"
    result = subprocess.call(
        [str(PUYAPY), str(contract_source), "--out-dir", str(OUT)],
        cwd=CONTRACTS,
    )
    if result != 0:
        return result
    CLIENTS.mkdir(parents=True, exist_ok=True)
    result = subprocess.call(
        [
            str(CLIENTGEN),
            str(OUT / "PNETInstantLaunchpad.arc56.json"),
            "--out-dir",
            str(CLIENTS),
        ],
        cwd=CONTRACTS,
    )
    if result != 0:
        return result

    generated_text = [
        *OUT.glob("*.json"),
        *OUT.glob("*.teal"),
        *OUT.glob("*.map"),
        CLIENTS / "client_PNETInstantLaunchpad.py",
    ]
    for path in generated_text:
        _normalize_lf(path)

    files = {
        "contract": HERE / "contract.py",
        "arc56": OUT / "PNETInstantLaunchpad.arc56.json",
        "approvalTeal": OUT / "PNETInstantLaunchpad.approval.teal",
        "clearTeal": OUT / "PNETInstantLaunchpad.clear.teal",
        "typedClient": CLIENTS / "client_PNETInstantLaunchpad.py",
    }
    manifest = {
        "schemaVersion": 1,
        "compiler": subprocess.check_output([str(PUYAPY), "--version"], text=True).strip(),
        "clientGenerator": subprocess.check_output(
            [str(CLIENTGEN), "--version"], text=True
        ).strip(),
        "sha256": {name: _sha256(path) for name, path in files.items()},
    }
    BUILD_MANIFEST.write_text(
        json.dumps(manifest, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
