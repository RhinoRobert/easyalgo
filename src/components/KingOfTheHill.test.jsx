import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loader = vi.hoisted(() => ({ result: null, fail: false, client: {} }));
vi.mock("../hooks/useAlgorand", () => ({
  IS_MAINNET: true,
  useAlgorand: () => ({ algodClient: loader.client }), // one stable client, like the real hook's memoised one
  explorerAssetUrl: (id) => `https://explorer.example/asset/${id}`,
  explorerAddrUrl: (a) => `https://explorer.example/address/${a}`,
  explorerTxUrl: (id) => `https://explorer.example/tx/${id}`,
}));
vi.mock("../launchpad/config", () => ({ launchNetwork: { launchpadAppId: 999n } }));
vi.mock("../launchpad/directory", () => ({
  loadHillStats: async () => { if (loader.fail) throw new Error("offline"); return loader.result; },
}));

import KingOfTheHill from "./KingOfTheHill";

const king = {
  assetId: 3753721447n, name: "Moon Cat", unit: "MCAT", launcher: "ABCDEFGHIJKLMNOPQRSTUVWXYZ", poolAddress: "POOLADDR",
  tvlMicroAlgo: 12_345_678n, terminalTxId: "FINISHTX",
};

describe("KingOfTheHill", () => {
  beforeEach(() => { loader.fail = false; loader.result = null; });

  it("shows how many tokens exist, the reigning token, what to beat, and where to trade it", async () => {
    loader.result = { tokensLaunched: 7n, king, runnerUp: null, round: 1 };
    const challenge = vi.fn();
    render(<KingOfTheHill onChallenge={challenge} />);
    await waitFor(() => expect(screen.getByText("Moon Cat")).toBeInTheDocument());
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("tokens launched")).toBeInTheDocument();
    expect(screen.getByText("King of the hill")).toBeInTheDocument();
    expect(screen.getAllByText(/12\.35 ALGO/).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /trade moon cat on vestige/i })).toHaveAttribute("href", "https://vestige.fi/asset/3753721447");
    expect(screen.getByRole("link", { name: /burn lp/i })).toHaveAttribute("href", "https://explorer.example/tx/FINISHTX");
    fireEvent.click(screen.getByRole("button", { name: /launch your challenger/i }));
    expect(challenge).toHaveBeenCalledOnce();
  });

  it("invites the first launch when the crown is empty", async () => {
    loader.result = { tokensLaunched: 0n, king: null, runnerUp: null, round: 1 };
    render(<KingOfTheHill />);
    await waitFor(() => expect(screen.getByText("The crown is empty.")).toBeInTheDocument());
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("renders nothing, instead of an error, when the chain cannot be read", async () => {
    loader.fail = true;
    const { container } = render(<KingOfTheHill />);
    await waitFor(() => expect(container.querySelector(".king")).toBeNull());
  });
});