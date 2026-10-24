"""Independent integer model used to verify launchpad-v2 invariants.

This module deliberately contains no AVM or SDK types. Tests use it as an
independent oracle for the integer formulas compiled into the contract.
"""

from __future__ import annotations

from dataclasses import dataclass


UINT64_MAX = (1 << 64) - 1
BPS_DENOMINATOR = 10_000


def require_uint64(value: int) -> int:
    if not 0 <= value <= UINT64_MAX:
        raise ValueError("value is outside uint64")
    return value


def box_mbr(key_size: int, value_size: int) -> int:
    if key_size < 0 or value_size < 0:
        raise ValueError("box sizes cannot be negative")
    return 2_500 + 400 * (key_size + value_size)


@dataclass(frozen=True)
class SwapQuote:
    output: int
    minimum: int
    impact_bps_ceiling: int


def fixed_input_quote(
    *,
    input_amount: int,
    input_reserve: int,
    output_reserve: int,
    total_fee_share: int,
    slippage_bps: int = 100,
) -> SwapQuote:
    """Tinyman-v2 fixed-input quote using only exact integer arithmetic."""
    for value in (input_amount, input_reserve, output_reserve, total_fee_share):
        require_uint64(value)
    if input_amount <= 0 or input_reserve <= 0 or output_reserve <= 0:
        raise ValueError("amount and reserves must be positive")
    if not 0 <= total_fee_share < BPS_DENOMINATOR:
        raise ValueError("invalid fee share")
    if not 0 <= slippage_bps < BPS_DENOMINATOR:
        raise ValueError("invalid slippage")

    fee = input_amount * total_fee_share // BPS_DENOMINATOR
    effective_input = input_amount - fee
    remaining_output = input_reserve * output_reserve // (input_reserve + effective_input)
    output = output_reserve - remaining_output - 1
    if output <= 0:
        raise ValueError("no executable output")
    minimum = output * (BPS_DENOMINATOR - slippage_bps) // BPS_DENOMINATOR
    impact_numerator = output_reserve * input_amount - output * input_reserve
    impact_bps_ceiling = max(
        0,
        (impact_numerator * BPS_DENOMINATOR + output_reserve * input_amount - 1)
        // (output_reserve * input_amount),
    )
    return SwapQuote(output=output, minimum=minimum, impact_bps_ceiling=impact_bps_ceiling)


@dataclass(frozen=True)
class LpSplit:
    burned: int
    creator: int
    platform: int


def split_lp(received: int) -> LpSplit:
    require_uint64(received)
    burned = received * 8_000 // BPS_DENOMINATOR
    remainder = received - burned
    creator = remainder // 2
    platform = remainder - creator
    return LpSplit(burned=burned, creator=creator, platform=platform)


def split_cancellation(total_raw: int, pnet_output: int) -> tuple[int, int, int, int]:
    require_uint64(total_raw)
    require_uint64(pnet_output)
    creator_token = total_raw // 2
    creator_pnet = pnet_output // 2
    return (
        creator_token,
        total_raw - creator_token,
        creator_pnet,
        pnet_output - creator_pnet,
    )
