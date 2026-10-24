"""Deploy the protocol and a launchpad on the private devnet and write the details the Node end-to-end test needs.

Run from contracts/:  .venv-v2\\Scripts\\python.exe tests\\js_fixture.py
The output (tests/js-fixture.local.json) holds throwaway devnet keys only and is git-ignored.
"""

import json
import sys
from pathlib import Path

from algosdk import mnemonic

sys.path.insert(0, str(Path(__file__).parent))
from devkit import Dev  # noqa: E402
from lp import Launchpad, Protocol  # noqa: E402

OUT = Path(__file__).parent / "js-fixture.local.json"


def main() -> None:
    dev = Dev.connect()
    proto = Protocol.deploy(dev)
    platform = dev.new_account()
    lp = Launchpad.deploy(proto, cancel_delay=40, platform=platform)
    users = []
    for _ in range(4):
        sk, addr = dev.new_account()
        proto.fund_user_pnet(addr, sk)
        users.append({"address": addr, "mnemonic": mnemonic.from_private_key(sk)})
    algod_url = json.loads((Path(__file__).parent / "devnet.local.json").read_text("utf-8"))
    OUT.write_text(json.dumps({
        "algod": algod_url["algod"], "token": algod_url["token"],
        "launchpadAppId": lp.app_id, "tinymanAppId": proto.tm.app_id, "vestigeAppId": proto.vestige,
        "arc54AppId": proto.arc54, "pnetAssetId": proto.pnet, "sourcePool": proto.source_pool, "arc54Address": proto.burn,
        "cancelDelay": lp.cancel_delay,
        "platform": {"address": platform[1], "mnemonic": mnemonic.from_private_key(platform[0])},
        "users": users,
    }, indent=1) + "\n", encoding="utf-8")
    print("wrote", OUT)


if __name__ == "__main__":
    main()
