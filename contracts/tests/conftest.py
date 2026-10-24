import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))

from devkit import Dev  # noqa: E402
from lp import Launchpad, Protocol  # noqa: E402


@pytest.fixture(scope="session")
def dev() -> Dev:
    return Dev.connect()


@pytest.fixture(scope="session")
def proto(dev: Dev) -> Protocol:
    return Protocol.deploy(dev)


@pytest.fixture()
def platform(dev: Dev) -> tuple[str, str]:
    return dev.new_account()


@pytest.fixture()
def lp(proto: Protocol, platform: tuple[str, str]) -> Launchpad:
    """A fresh launchpad per test (own app, own cancel delay) on the shared protocol deployment."""
    return Launchpad.deploy(proto, cancel_delay=40, platform=platform)


@pytest.fixture()
def user(dev: Dev, proto: Protocol) -> tuple[str, str]:
    sk, addr = dev.new_account()
    proto.fund_user_pnet(addr, sk)
    return sk, addr
