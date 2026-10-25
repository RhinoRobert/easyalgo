import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../hooks/useAlgorand", () => ({
  IS_MAINNET: true,
  explorerAssetUrl: (id) => `https://explorer.example/asset/${id}`,
  explorerAddrUrl: (address) => `https://explorer.example/address/${address}`,
  explorerTxUrl: (id) => `https://explorer.example/tx/${id}`,
  explorerAppUrl: (id) => `https://explorer.example/application/${id}`,
}));
import LaunchCard from "./LaunchCard";
import TokenView from "./TokenView";
import { buildSafetyChecks } from "../launchpad/tokenView";

const APP = "APPADDRESS";
const launch = {
  launcher: "CREATORADDRESS", status: 2n, poolAddress: "POOL", lpAssetId: 9n, burnedLp: 800n, creatorLp: 100n, platformLp: 100n,
  creatorLpClaimed: 0n, vestigeGranted: 1n, terminalTxId: "FINISHTX", terminalRound: 90n, createdRound: 80n,
};
const asset = { name: "Example", unit: "EXM", url: "", total: 1000n, decimals: 6, creator: APP };
const detail = (overrides = {}) => ({
  found: true, assetId: 3753721447n, launch, asset, round: 100, appAddress: APP, burnAddress: "BURN",
  stats: { tvlMicroAlgo: 2_000_000n, priceAlgo: 0.001, marketCapAlgo: 1000 },
  holders: { rows: [{ address: "POOLADDRESSXXXXXXXX", amount: 1000n, percent: 100, label: "Tinyman pool" }], complete: true },
  checks: buildSafetyChecks({ asset, launch, appAddress: APP, appTokenHolding: 0n, poolIsCanonical: true, burnHolding: 800n }),
  ...overrides,
});

describe("TokenView", () => {
  it("shows the checklist, holders and links for a live launch", () => {
    render(<TokenView detail={detail()} account={null} pageUrl="https://easyalgo.org/" />);
    expect(screen.getByText("80.0% of the liquidity is burned")).toBeInTheDocument();
    expect(screen.getByText("Tinyman pool")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /trade now/i })).toHaveAttribute("href", "https://vestige.fi/asset/3753721447");
    const share = screen.getByRole("link", { name: /share on x/i });
    expect(share.getAttribute("href")).toContain("https://x.com/intent/post?");
    expect(share.getAttribute("rel")).toMatch(/noopener/);
    expect(screen.queryByRole("link", { name: /edit on vestige/i })).toBeNull();
  });

  it("shows Edit on Vestige only to the creator", () => {
    render(<TokenView detail={detail()} account="CREATORADDRESS" pageUrl="https://easyalgo.org/" />);
    expect(screen.getByRole("link", { name: /edit on vestige/i })).toHaveAttribute("href", "https://vestige.fi/asset-manager/3753721447");
  });

  it("flags a failed check and never shows a token's own URL as a link", () => {
    const failing = buildSafetyChecks({ asset: { ...asset, freeze: "SOMEONE", url: "https://evil.example" }, launch, appAddress: APP, appTokenHolding: 0n, poolIsCanonical: true, burnHolding: 800n });
    render(<TokenView detail={detail({ asset: { ...asset, url: "https://evil.example" }, checks: failing })} account={null} pageUrl="https://easyalgo.org/" />);
    expect(screen.getByText("The token can be changed")).toBeInTheDocument();
    expect(screen.getByText("1 check did not pass.")).toBeInTheDocument();
    expect(screen.getByText("https://evil.example").closest("a")).toBeNull();
  });

  it("offers no trading or sharing for a cancelled launch", () => {
    render(<TokenView detail={detail({ launch: { ...launch, status: 3n, poolAddress: null }, stats: null, checks: [] })} account={null} pageUrl="https://easyalgo.org/" />);
    expect(screen.queryByRole("link", { name: /trade now|share on x/i })).toBeNull();
  });
});

describe("LaunchCard", () => {
  it("opens the token page and links to Vestige for live launches", () => {
    render(<ul><LaunchCard item={{ ...launch, assetId: 3753721447n, name: "Example", unit: "EXM", tvlMicroAlgo: 2_000_000n }} round={100} rank={1} /></ul>);
    const card = screen.getByRole("link", { name: /example: open token page/i });
    expect(card).toHaveAttribute("href", "#token/3753721447");
    expect(within(card).getByText("80% burned")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /trade example on vestige/i })).toHaveAttribute("target", "_blank");
  });

  it("has no Trade now for a cancelled launch", () => {
    render(<ul><LaunchCard item={{ ...launch, status: 3n, assetId: 5n, name: "Gone", unit: "GON", tvlMicroAlgo: 0n }} round={100} /></ul>);
    expect(screen.queryByRole("link", { name: /trade/i })).toBeNull();
  });
});
