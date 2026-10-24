"""Network constants for PNET Instant Launchpad v2."""

from dataclasses import dataclass


PRODUCTION_LAUNCHPAD_APP_ID = 3_609_729_732


@dataclass(frozen=True)
class NetworkConfig:
    algod_url: str
    genesis_id: str
    genesis_hash: str
    pnet_asset_id: int
    tinyman_app_id: int
    vestige_app_id: int
    arc54_app_id: int
    arc54_address: str
    source_pool_address: str
    source_pool_lp_asset_id: int


NETWORKS = {
    "testnet": NetworkConfig(
        algod_url="https://testnet-api.algonode.cloud",
        genesis_id="testnet-v1.0",
        genesis_hash="SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=",
        pnet_asset_id=0,  # supplied through LAUNCHPAD_V2_PNET_ASSET_ID
        tinyman_app_id=148_607_000,
        vestige_app_id=743_122_411,
        arc54_app_id=497_806_551,
        arc54_address="3TKF2GMZJ5VZ4BQVQGC72BJ63WFN4QBPU2EUD4NQYHFLC3NE5D7GXHXYOQ",
        source_pool_address="",  # supplied through LAUNCHPAD_V2_SOURCE_POOL
        source_pool_lp_asset_id=0,
    ),
    "mainnet": NetworkConfig(
        algod_url="https://mainnet-api.algonode.cloud",
        genesis_id="mainnet-v1.0",
        genesis_hash="wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=",
        pnet_asset_id=3_169_177_585,
        tinyman_app_id=1_002_541_853,
        vestige_app_id=3_129_810_607,
        arc54_app_id=1_257_620_981,
        arc54_address="BNFIREKGRXEHCFOEQLTX3PU5SUCMRKDU7WHNBGZA4SXPW42OAHZBP7BPHY",
        source_pool_address="ANESQRCMZ5KWZFKDGESLJEWQLRCVUZU725FJL7NO3BMKJEYMAB3TR56R3E",
        source_pool_lp_asset_id=3_169_269_012,
    ),
}
