"""The frontend hard-codes a few numbers and the reviewed build's hashes; they must equal the contract's, always."""

import base64
import hashlib
import json
import re
from pathlib import Path

from lp import C

ROOT = Path(__file__).resolve().parents[2]
CONFIG_JS = (ROOT / "src" / "launchpad" / "config.js").read_text("utf-8")
TRUST_JS = (ROOT / "src" / "launchpad" / "deploymentTrust.js").read_text("utf-8")
V3 = ROOT / "contracts" / "launchpad_v3"


def js_number(source: str, name: str) -> int:
    match = re.search(rf"export const {name} = ([0-9_]+)n?;", source)
    assert match, f"{name} not found"
    return int(match.group(1).replace("_", ""))


def test_money_constants_match_the_contract():
    for name in ("INITIALIZE_FUNDING", "PENDING_BOX_MBR", "LAUNCH_START_FUNDING", "LP_HOLDING_MBR", "ARC54_LP_HOLDING_MBR", "VESTIGE_FUNDING"):
        assert js_number(CONFIG_JS, name) == C[name], name
    assert js_number(CONFIG_JS, "CANCEL_DELAY_ROUNDS") == C["MAINNET_CANCEL_DELAY_ROUNDS"]
    # the quote may be at most as old as the contract accepts
    assert js_number(CONFIG_JS, "QUOTE_MAX_ROUNDS") < C["QUOTE_MAX_AGE_ROUNDS"]


def test_pinned_build_hashes_match_the_compiled_artifacts():
    manifest = json.loads((V3 / "build-manifest.json").read_text("utf-8"))["sha256"]
    arc56 = json.loads((V3 / "artifacts" / "launchpad_v3" / "PNETInstantLaunchpad.arc56.json").read_text("utf-8"))
    approval = hashlib.sha256(base64.b64decode(arc56["byteCode"]["approval"])).hexdigest()
    clear = hashlib.sha256(base64.b64decode(arc56["byteCode"]["clear"])).hexdigest()
    expected = {
        "approvalBytecodeSha256": approval, "clearBytecodeSha256": clear,
        "arc56Sha256": manifest["arc56"], "sourceSha256": manifest["contract"],
    }
    for key, value in expected.items():
        assert f'{key}: "{value}"' in TRUST_JS, f"{key} in deploymentTrust.js is stale; update it after reviewing the new build"
    schema = arc56["state"]["schema"]["global"]
    assert f"globalInts: {schema['ints']}" in TRUST_JS and f"globalBytes: {schema['bytes']}" in TRUST_JS


def test_manifest_matches_the_files_on_disk():
    manifest = json.loads((V3 / "build-manifest.json").read_text("utf-8"))["sha256"]
    files = {
        "contract": V3 / "contract.py",
        "arc56": V3 / "artifacts" / "launchpad_v3" / "PNETInstantLaunchpad.arc56.json",
        "approvalTeal": V3 / "artifacts" / "launchpad_v3" / "PNETInstantLaunchpad.approval.teal",
        "clearTeal": V3 / "artifacts" / "launchpad_v3" / "PNETInstantLaunchpad.clear.teal",
    }
    for name, path in files.items():
        assert hashlib.sha256(path.read_bytes()).hexdigest() == manifest[name], f"{name} drifted: compile again"
