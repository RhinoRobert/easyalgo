import { render, screen, waitFor, within } from "@testing-library/react";
import algosdk from "algosdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A connected wallet whose launch has finished on chain: the real Launch page must load it back and show the success panel.
const WALLET = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ";
const chain = vi.hoisted(() => ({ finished: true }));
const clients = vi.hoisted(() => ({ algodClient: { status: () => ({ do: async () => ({ lastRound: 100 }) }) }, indexerClient: {} }));

vi.mock("../hooks/usePeraWallet", () => ({
  usePeraWallet: () => ({ account: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ", connect: vi.fn(), connectionError: "", disconnect: vi.fn(), isConnecting: false, signAndSubmit: vi.fn() }),
}));
vi.mock("../hooks/useAlgorand", () => ({
  IS_MAINNET: true,
  useAlgorand: () => clients,
  explorerAddrUrl: (a) => `https://explorer.example/address/${a}`,
  explorerAppUrl: (a) => `https://explorer.example/application/${a}`,
  explorerAssetUrl: (a) => `https://explorer.example/asset/${a}`,
  explorerTxUrl: (a) => `https://explorer.example/tx/${a}`,
}));
vi.mock("../launchpad/config", async (importActual) => {
  const actual = await importActual();
  return { ...actual, configurationIssues: () => [], launchNetwork: { ...actual.launchNetwork, launchpadAppId: 5n, label: "MainNet" } };
});
vi.mock("../launchpad/attestation", () => ({ attestLaunchpadApplication: async () => ({}) }));
vi.mock("../launchpad/directory", () => ({ loadHillStats: async () => ({ tokensLaunched: 1n, king: null, runnerUp: null, round: 100 }) }));
vi.mock("../launchpad/tinymanAdapter", async (importActual) => ({
  ...(await importActual()),
  readPool: async () => ({ exists: true }),
  readTinymanPoolState: async () => ({}),
  readTinymanSourcePool: async () => ({}),
}));
vi.mock("../launchpad/launchpadClient", async (importActual) => {
  const actual = await importActual();
  return {
    ...actual,
    verifyCompletedLaunch: async () => ({ immutableAsset: true, reserves: true }),
    readLaunchSnapshot: async ({ assetId }) => ({
      pending: null,
      launch: chain.finished
        ? { assetId, status: 2n, pnetSeed: 9n, poolAddress: "POOLADDRESS", lpAssetId: 6n, burnedLp: 800n, creatorLp: 100n, creatorLpClaimed: 0n, platformLp: 100n, vestigeGranted: 1n, createTxId: "S", createdRound: 3n, terminalTxId: "FINISHTX", terminalRound: 4n, launcher: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ" }
        : null,
      asset: { immutable: true, creator: algosdk.getApplicationAddress(5).toString(), name: "Moon Cat", unitName: "MCAT", total: 1_000_000_000_000n, url: "" },
    }),
  };
});

import LaunchLabPage from "./LaunchLabPage";
import { LAUNCH_STEPS, createLaunchSession, saveSession } from "../launchpad/session";
import { launchNetworkName } from "../launchpad/config";

const seedSession = () => saveSession({
  ...createLaunchSession({ network: launchNetworkName, wallet: WALLET, form: { name: "Moon Cat", unitName: "MCAT", displaySupply: "1000000", url: "" }, quote: null }),
  assetId: 7n,
});

describe("LaunchLabPage when the wallet's launch has finished", () => {
  beforeEach(() => { window.localStorage.clear(); chain.finished = true; });

  it("shows the launch-complete panel with the next steps, read back from the chain", async () => {
    seedSession();
    const { container } = render(<LaunchLabPage />);
    const panel = await screen.findByRole("status", { name: /launch complete/i }, { timeout: 4000 });
    expect(panel).toHaveTextContent("Moon Cat is live");
    expect(panel).toHaveTextContent("80% of the liquidity is burned");
    expect(within(panel).getByRole("link", { name: "Open token page" })).toHaveAttribute("href", "#token/7");
    expect(within(panel).getByRole("link", { name: /trade on vestige/i })).toHaveAttribute("href", "https://vestige.fi/asset/7");
    expect(within(panel).getByRole("link", { name: /share on x/i }).getAttribute("href")).toContain("x.com/intent/post");
    // the progress card shows both approvals done and the main button reports the launch complete
    expect(container.querySelectorAll(".instant-step--confirmed").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Done").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole("button", { name: /launch complete/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /prepare another launch/i })).toBeEnabled();
  });

  it("shows no success panel while the launch is still in progress", async () => {
    chain.finished = false;
    seedSession();
    render(<LaunchLabPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: /continue launch|launch token|working/i })).toBeInTheDocument(), { timeout: 4000 });
    expect(screen.queryByRole("status", { name: /launch complete/i })).toBeNull();
  });
});
