import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The component is tested as it runs on MainNet (the test environment itself defaults to TestNet).
vi.mock("../hooks/useAlgorand", () => ({
  IS_MAINNET: true,
  explorerAssetUrl: (id) => `https://explorer.example/asset/${id}`,
  explorerAddrUrl: (address) => `https://explorer.example/address/${address}`,
}));
import LaunchRow from "./LaunchRow";

const base = { assetId: 3753721447n, name: "Example", unit: "EXM", launcher: "ABCDEFGHIJKLMNOP", tvlMicroAlgo: 2_000_000n, url: "" };

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
});