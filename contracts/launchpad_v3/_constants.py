"""Contract constants for tooling and tests, read from ``contract.py`` WITHOUT importing it.

``contract.py`` starts with ``import algopy``, and the ``algopy`` package refuses to run under an ordinary Python interpreter: it exists only for the
Puya compiler. Tooling only needs plain values, so they are read from the source text itself. The source stays the single place they are defined, and
``build-manifest.json`` pins that source's SHA-256.
"""

from __future__ import annotations

import ast
import operator
from pathlib import Path

_SOURCE = Path(__file__).with_name("contract.py")
_OPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.FloorDiv: operator.floordiv}


def _read_constants() -> dict[str, int | str]:
    env: dict[str, int | str] = {}

    def value(node: ast.AST) -> int | str:
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, str)):
            return node.value
        if isinstance(node, ast.Name) and node.id in env:
            return env[node.id]
        if isinstance(node, ast.BinOp) and type(node.op) in _OPS:
            left, right = value(node.left), value(node.right)
            if isinstance(left, int) and isinstance(right, int):
                return _OPS[type(node.op)](left, right)
        raise ValueError("not a plain constant")

    for statement in ast.parse(_SOURCE.read_text(encoding="utf-8")).body:
        if isinstance(statement, ast.Assign) and len(statement.targets) == 1 and isinstance(statement.targets[0], ast.Name):
            try:
                env[statement.targets[0].id] = value(statement.value)
            except ValueError:
                continue
    return env


CONSTANTS = _read_constants()
INITIALIZE_FUNDING = int(CONSTANTS["INITIALIZE_FUNDING"])
APP_SAFETY_CUSHION = int(CONSTANTS["APP_SAFETY_CUSHION"])
PLATFORM_WALLET_ADDRESS = str(CONSTANTS["PLATFORM_WALLET_ADDRESS"])
MAINNET_CANCEL_DELAY_ROUNDS = int(CONSTANTS["MAINNET_CANCEL_DELAY_ROUNDS"])
