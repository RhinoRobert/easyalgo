"""Copy the real MainNet Tinyman v2, ARC-54 and Vestige programs into tests/fixtures (read-only HTTP GETs).

The end-to-end tests deploy these unchanged programs on the private devnet, so the launchpad is exercised against the
real protocol code, not a hand-written mock.
"""

import json
import urllib.request
from pathlib import Path

ALGOD = "https://mainnet-api.4160.nodely.dev"
APPS = {"tinyman_v2": 1002541853, "arc54": 1257620981, "vestige": 3129810607}
OUT = Path(__file__).parent / "fixtures"


def main() -> None:
    OUT.mkdir(exist_ok=True)
    for name, app_id in APPS.items():
        params = json.load(urllib.request.urlopen(f"{ALGOD}/v2/applications/{app_id}"))["params"]
        keep = {
            "mainnet_app_id": app_id,
            "approval-program": params["approval-program"],
            "clear-state-program": params["clear-state-program"],
            "extra-program-pages": params.get("extra-program-pages", 0),
            "global-state-schema": params["global-state-schema"],
            "local-state-schema": params["local-state-schema"],
        }
        (OUT / f"{name}.json").write_text(json.dumps(keep, indent=1) + "\n", encoding="utf-8")
        print(name, app_id, "saved")


if __name__ == "__main__":
    main()
