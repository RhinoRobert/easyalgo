#!/usr/bin/env bash
# Starts (creating it once) a PRIVATE single-node Algorand dev network and writes tests/devnet.local.json for the test suite.
# Needs the Algorand node tools (`goal`, `algod`) on Linux or WSL. It is isolated: its own data directory (default
# $HOME/launchpad-devnet), its own random local ports, no connection to any real network. It never touches an existing
# /var/lib/algorand node. The account it prints is a throwaway funded by the dev network's genesis.
set -eu
unset ALGORAND_DATA || true
ROOT="${LAUNCHPAD_DEVNET_ROOT:-$HOME/launchpad-devnet}"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/../devnet.local.json"
mkdir -p "$ROOT"
cp "$HERE/template.json" "$ROOT/template.json"
if [ ! -d "$ROOT/net" ]; then
  goal network create -r "$ROOT/net" -n launchpaddev -t "$ROOT/template.json"
fi
goal network start -r "$ROOT/net"
sleep 3
NODE="$ROOT/net/Primary"
ADDR=$(goal account list -d "$NODE" | head -1 | awk '{print $2}')
MN=$(goal account export -a "$ADDR" -d "$NODE" | sed -e 's/^Exported key for account [A-Z0-9]*: "//' -e 's/"$//')
printf '{"algod":"http://127.0.0.1:%s","token":"%s","address":"%s","mnemonic":"%s"}\n' \
  "$(cut -d: -f2 "$NODE/algod.net")" "$(cat "$NODE/algod.token")" "$ADDR" "$MN" > "$OUT"
echo "devnet running; connection details written to $OUT (git-ignored; throwaway keys only)"