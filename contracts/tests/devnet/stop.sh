#!/usr/bin/env bash
# Stops only the private dev network that start.sh created.
set -eu
unset ALGORAND_DATA || true
ROOT="${LAUNCHPAD_DEVNET_ROOT:-$HOME/launchpad-devnet}"
goal network stop -r "$ROOT/net"