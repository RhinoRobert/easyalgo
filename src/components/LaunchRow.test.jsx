import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The component is tested as it runs on MainNet (the test environment itself defaults to TestNet).
vi.mock("../hooks/useAlgorand", () => ({
  IS_MAINNET: true,
  explorerAssetUrl: (id) => `https://explorer.example/asset/${id}`,
  explorerAddrUrl: (address) => `https://explorer.example/address/${address}`,
  explorerTxUrl: (id) => `https://explorer.example/tx/${id}`,
}));
import LaunchRow from "./LaunchRow";

const base = { assetId: 3753721447n, name: "Example", unit: "EXM", launcher: "ABCDEFGHIJKLMNOP", tvlMicroAlgo: 2_000_000n, url: "", burnedLp: 114_184_414_080n, creatorLp: 14_273_051_760n, platformLp: 14_273_051_760n, terminalTxId: "FINISHTXID" };

describe("LaunchRow trade button", () => {
  it("links live launches to the token's page on Vestige", () => {
    render(<ul><LaunchRow item={{ ...base, status: 2n, poolAddress: "POOL", terminalRound: 10n }} round={20} /></ul>);
    const link = screen.getByRole("link", { name: /trade example on vestige/i });
    expect(link).toHaveAttribute("href", "https://vestige.fi/asset/3753721447");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toMatch(/noopener/);
  });

  it("offers no trading for launches that have no pool (in progress or cancelled)", () => {
    render(<ul>
      <LaunchRow item={{ ...base, assetId: 1n, name: "Pending", status: 1n }} round={20} />
      <LaunchRow item={{ ...base, assetId: 2n, name: "Cancelled", status: 3n }} round={20} />
    </ul>);
    expect(screen.queryByRole("link", { name: /trade/i })).toBeNull();
  });

  it("links live launches to the transaction that burned 80% of the liquidity tokens", () => {
    render(<ul><LaunchRow item={{ ...base, status: 2n, poolAddress: "POOL", terminalRound: 10n }} round={20} /></ul>);
    const link = screen.getByRole("link", { name: /burn lp/i });
    expect(link).toHaveAttribute("href", "https://explorer.example/tx/FINISHTXID");
    expect(link.getAttribute("title")).toMatch(/114184\.41408 liquidity tokens/);
  });

  it("shows no burn link where nothing was burned (cancelled or unfinished launches)", () => {
    render(<ul>
      <LaunchRow item={{ ...base, assetId: 2n, name: "Cancelled", status: 3n }} round={20} />
      <LaunchRow item={{ ...base, assetId: 1n, name: "Pending", status: 1n }} round={20} />
    </ul>);
    expect(screen.queryByRole("link", { name: /burn lp/i })).toBeNull();
  });

  it("states the burned share of the liquidity on live launches only", () => {
    render(<ul>
      <LaunchRow item={{ ...base, status: 2n, poolAddress: "POOL", terminalRound: 10n }} round={20} />
      <LaunchRow item={{ ...base, assetId: 2n, name: "Cancelled", status: 3n, burnedLp: 0n, creatorLp: 0n, platformLp: 0n }} round={20} />
    </ul>);
    expect(screen.getAllByText(/of liquidity burned/)).toHaveLength(1);
    expect(screen.getByText("80.0% of liquidity burned")).toBeInTheDocument();
  });
});