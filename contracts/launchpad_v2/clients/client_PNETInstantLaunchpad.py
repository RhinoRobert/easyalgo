# This file is auto-generated, do not modify
# flake8: noqa
# fmt: off
import typing

import algopy

class PendingLaunch(algopy.arc4.Struct):
    asset_id: algopy.arc4.UIntN[typing.Literal[64]]
    total_raw: algopy.arc4.UIntN[typing.Literal[64]]
    status: algopy.arc4.UIntN[typing.Literal[64]]
    created_round: algopy.arc4.UIntN[typing.Literal[64]]
    swap_round: algopy.arc4.UIntN[typing.Literal[64]]
    pnet_output: algopy.arc4.UIntN[typing.Literal[64]]
    quote_minimum: algopy.arc4.UIntN[typing.Literal[64]]
    create_tx_id: algopy.arc4.DynamicBytes
    swap_tx_id: algopy.arc4.DynamicBytes

class LaunchRecord(algopy.arc4.Struct):
    launcher: algopy.arc4.Address
    asset_id: algopy.arc4.UIntN[typing.Literal[64]]
    total_raw: algopy.arc4.UIntN[typing.Literal[64]]
    status: algopy.arc4.UIntN[typing.Literal[64]]
    created_round: algopy.arc4.UIntN[typing.Literal[64]]
    swap_round: algopy.arc4.UIntN[typing.Literal[64]]
    terminal_round: algopy.arc4.UIntN[typing.Literal[64]]
    pool_address: algopy.arc4.Address
    pool_token_id: algopy.arc4.UIntN[typing.Literal[64]]
    pnet_seed: algopy.arc4.UIntN[typing.Literal[64]]
    burned_lp: algopy.arc4.UIntN[typing.Literal[64]]
    creator_lp: algopy.arc4.UIntN[typing.Literal[64]]
    platform_lp: algopy.arc4.UIntN[typing.Literal[64]]
    cancel_creator_token: algopy.arc4.UIntN[typing.Literal[64]]
    cancel_platform_token: algopy.arc4.UIntN[typing.Literal[64]]
    cancel_creator_pnet: algopy.arc4.UIntN[typing.Literal[64]]
    cancel_platform_pnet: algopy.arc4.UIntN[typing.Literal[64]]
    cancel_platform_pnet_remaining: algopy.arc4.UIntN[typing.Literal[64]]
    vestige_granted: algopy.arc4.UIntN[typing.Literal[64]]
    vestige_funding: algopy.arc4.UIntN[typing.Literal[64]]
    create_tx_id: algopy.arc4.DynamicBytes
    swap_tx_id: algopy.arc4.DynamicBytes
    terminal_tx_id: algopy.arc4.DynamicBytes
    vestige_tx_id: algopy.arc4.DynamicBytes
    release_tx_id: algopy.arc4.DynamicBytes

class PlatformAllocation(algopy.arc4.Struct):
    launch_asset_id: algopy.arc4.UIntN[typing.Literal[64]]
    holding_asset_id: algopy.arc4.UIntN[typing.Literal[64]]
    remaining: algopy.arc4.UIntN[typing.Literal[64]]
    kind: algopy.arc4.UIntN[typing.Literal[64]]

class PNETInstantLaunchpad(algopy.arc4.ARC4Client, typing.Protocol):
    """
    Immutable Tinyman-backed PNET launch escrow and public directory.
    """
    @algopy.arc4.abimethod(create='require')
    def create(
        self,
        burn_account: algopy.arc4.Address,
        source_pool: algopy.arc4.Address,
        pnet_asset_id: algopy.arc4.UIntN[typing.Literal[64]],
        tinyman_app_id: algopy.arc4.UIntN[typing.Literal[64]],
        vestige_app_id: algopy.arc4.UIntN[typing.Literal[64]],
        arc54_app_id: algopy.arc4.UIntN[typing.Literal[64]],
    ) -> None: ...

    @algopy.arc4.abimethod
    def initialize(
        self,
        reserve_payment: algopy.gtxn.PaymentTransaction,
    ) -> None:
        """
        Fund base/PNET MBR and a one-ALGO safety reserve once.
        """

    @algopy.arc4.abimethod
    def create_asset(
        self,
        funding: algopy.gtxn.PaymentTransaction,
        name: algopy.arc4.String,
        unit_name: algopy.arc4.String,
        total_raw: algopy.arc4.UIntN[typing.Literal[64]],
        url: algopy.arc4.String,
    ) -> algopy.arc4.UIntN[typing.Literal[64]]:
        """
        Create an immutable six-decimal ASA and retain its entire supply.
        """

    @algopy.arc4.abimethod
    def swap_pnet(
        self,
        payment: algopy.gtxn.PaymentTransaction,
        asset_id: algopy.arc4.UIntN[typing.Literal[64]],
        quote_round: algopy.arc4.UIntN[typing.Literal[64]],
        minimum_pnet: algopy.arc4.UIntN[typing.Literal[64]],
    ) -> algopy.arc4.UIntN[typing.Literal[64]]:
        """
        Atomically swap exactly one ALGO and escrow measured PNET output.
        """

    @algopy.arc4.abimethod
    def provide_finalize_resources(
        self,
        asset_id: algopy.arc4.UIntN[typing.Literal[64]],
        pool_token_id: algopy.arc4.UIntN[typing.Literal[64]],
    ) -> None:
        """
        Carry shared AVM resources for the following finalization call.
        AVM v11 limits the traditional account/application/asset/box arrays to eight entries per application call.  A separate, side-effect-free call in the same atomic group carries ARC-54, the LP asset, and two record boxes so the final call remains within that limit.
        """

    @algopy.arc4.abimethod
    def finalize_launch(
        self,
        creator_lp_opt_in: algopy.gtxn.AssetTransferTransaction,
        launch_funding: algopy.gtxn.PaymentTransaction,
        asset_id: algopy.arc4.UIntN[typing.Literal[64]],
        pool_address: algopy.arc4.Address,
        pool_token_id: algopy.arc4.UIntN[typing.Literal[64]],
    ) -> None:
        """
        Atomically seed Tinyman, burn 80%, and split remaining LP 50/50.
        ARC-54 may already be opted into the LP ASA because its public method accepts donated MBR.  The launch therefore never depends on a duplicate outer opt-in call: the creator funds the app with 100k for its own LP holding plus 100k only when ARC-54 still needs an LP holding, and this method performs the ARC-54 funding/call as a nested atomic group.
        """

    @algopy.arc4.abimethod
    def cancel_created(
        self,
        asset_id: algopy.arc4.UIntN[typing.Literal[64]],
    ) -> None:
        """
        Return an un-swapped ASA after the recovery delay and free the wallet slot.
        """

    @algopy.arc4.abimethod
    def cancel_launch(
        self,
        asset_id: algopy.arc4.UIntN[typing.Literal[64]],
    ) -> None:
        """
        Resolve an escrowed launch after the immutable 20,000-round delay.
        """

    @algopy.arc4.abimethod
    def release_cancelled_pnet(
        self,
        asset_id: algopy.arc4.UIntN[typing.Literal[64]],
    ) -> algopy.arc4.UIntN[typing.Literal[64]]:
        """
        Release deferred cancellation PNET only to the hardcoded platform wallet.
        """

    @algopy.arc4.abimethod
    def grant_vestige_access(
        self,
        vestige_funding: algopy.gtxn.PaymentTransaction,
        asset_id: algopy.arc4.UIntN[typing.Literal[64]],
    ) -> None:
        """
        Grant creator metadata access after completion; safe to retry if unconfirmed.
        """

    @algopy.arc4.abimethod
    def release_platform_allocation(
        self,
        holding_asset_id: algopy.arc4.UIntN[typing.Literal[64]],
        receiver: algopy.arc4.Address,
        amount: algopy.arc4.UIntN[typing.Literal[64]],
    ) -> algopy.arc4.UIntN[typing.Literal[64]]:
        """
        Release only a recorded platform allocation under hardcoded authority.
        """

    @algopy.arc4.abimethod(readonly=True)
    def get_pending(
        self,
        launcher: algopy.arc4.Address,
    ) -> PendingLaunch: ...

    @algopy.arc4.abimethod(readonly=True)
    def get_launch(
        self,
        asset_id: algopy.arc4.UIntN[typing.Literal[64]],
    ) -> LaunchRecord: ...

    @algopy.arc4.abimethod(readonly=True)
    def get_asset_at(
        self,
        index: algopy.arc4.UIntN[typing.Literal[64]],
    ) -> algopy.arc4.UIntN[typing.Literal[64]]: ...

    @algopy.arc4.abimethod(readonly=True)
    def get_platform_allocation(
        self,
        holding_asset_id: algopy.arc4.UIntN[typing.Literal[64]],
    ) -> PlatformAllocation: ...

    @algopy.arc4.abimethod(readonly=True)
    def get_config(
        self,
    ) -> algopy.arc4.Tuple[algopy.arc4.Address, algopy.arc4.Address, algopy.arc4.Address, algopy.arc4.UIntN[typing.Literal[64]], algopy.arc4.UIntN[typing.Literal[64]], algopy.arc4.UIntN[typing.Literal[64]], algopy.arc4.UIntN[typing.Literal[64]], algopy.arc4.UIntN[typing.Literal[64]], algopy.arc4.UIntN[typing.Literal[64]], algopy.arc4.UIntN[typing.Literal[64]]]: ...
