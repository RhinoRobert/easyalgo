import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const clients = vi.hoisted(() => ({ algodClient: {}, indexerClient: {} }));
const wallet = vi.hoisted(() => ({ account: null }));
const A = "CIVTUU6KLTYO26SPVEBDFBKP3UMZM2DPEO5RINODUVCI5NVIFC6HVNWS7E";
const B = "NNPQCOMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA".slice(0, 58);

vi.mock("../hooks/useAlgorand", () => ({
  IS_MAINNET: true,
  useAlgorand: () => clients,
  explorerAddrUrl: (a) => `https://explorer.example/address/${a}`,
  explorerAssetUrl: (a) => `https://explorer.example/asset/${a}`,
  explorerTxUrl: (a) => `https://explorer.example/tx/${a}`,
}));
vi.mock("../hooks/usePeraWallet", () => ({ usePeraWallet: () => ({ account: wallet.account }) }));
vi.mock("../launchpad/config", () => ({ launchNetwork: { launchpadAppId: 9n } }));
vi.mock("../launchpad/vestigeApi", () => ({ fetchVestigeAssets: async () => new Map() }));

const ROUND = 5_000_000;
const launch = (assetId, name, launcher, tvl, { status = 2n, ago = 100 } = {}) => ({
  assetId: BigInt(assetId), name, unit: name.slice(0, 3).toUpperCase(), launcher, status, tvlMicroAlgo: BigInt(tvl), pool: status === 2n ? {} : null,
  burnedLp: 800n, creatorLp: 100n, platformLp: 100n, terminalRound: BigInt(ROUND - ago), poolAddress: "POOL",
});
const items = [
  launch(1, "Alpha", A, 3_000_000), launch(2, "Bravo", A, 5_000_000, { ago: 40 * 30857 }), launch(3, "Charlie", B, 9_000_000),
  launch(4, "Delta", B, 0, { status: 3n }),
];
vi.mock("../launchpad/directory", () => ({
  clearDirectoryCache: () => {},
  loadRecentLaunches: async () => ({ items, round: 5_000_000, total: 4n }),
}));

import CreatorPage from "./CreatorPage";
import DirectoryPage from "./DirectoryPage";

describe("Popular tab views", () => {
  it("ranks biggest pools by default, narrows to this week, and lists top creators with links to their pages", async () => {
    render(<DirectoryPage mode="popular" active />);
    await waitFor(() => expect(screen.getByText("Charlie")).toBeInTheDocument());
    const names = () => [...document.querySelectorAll(".launch-card-title strong")].map((el) => el.textContent);
    expect(names()).toEqual(["Charlie", "Bravo", "Alpha"]);

    fireEvent.click(screen.getByRole("button", { name: "This week" }));
    expect(names()).toEqual(["Charlie", "Alpha"]); // Bravo went live 40 days ago
    expect(screen.getByRole("button", { name: "This week" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Top creators" }));
    const list = screen.getByRole("list", { name: "Top creators" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("2 launched");
    expect(rows[0]).toHaveTextContent("8.00 ALGO in pools");
    expect(within(rows[0]).getAllByRole("link")[0]).toHaveAttribute("href", `#creator/${A}`);
    expect(rows[1]).toHaveTextContent("Best: Charlie");
    expect(screen.queryByRole("searchbox")).toBeNull(); // searching tokens makes no sense in the creators view
  });
});

describe("Creator page", () => {
  beforeEach(() => { wallet.account = null; });

  it("shows a wallet's live tokens and totals, and tells the wallet's owner it is theirs", async () => {
    wallet.account = A;
    render(<CreatorPage address={A} />);
    await waitFor(() => expect(screen.getByText("Alpha")).toBeInTheDocument());
    expect(screen.getByText("Bravo")).toBeInTheDocument();
    expect(screen.queryByText("Charlie")).toBeNull();
    const stats = document.querySelector(".token-stats");
    expect(stats).toHaveTextContent("Tokens launched2");
    expect(stats).toHaveTextContent("Pools together8.00 ALGO");
    expect(stats).toHaveTextContent("Biggest pool5.00 ALGO");
    expect(screen.getByText(/this is your wallet/i)).toBeInTheDocument();
    expect(document.title).toMatch(/Algorand token creator CIVTU/);
  });

  it("says so for a wallet with no live launches, and for text that is not an address", async () => {
    const { unmount } = render(<CreatorPage address={"Z".repeat(58)} />);
    expect(screen.getByText(/not a valid algorand address/i)).toBeInTheDocument();
    unmount();
    render(<CreatorPage address={A.replace("CIVTUU", "CIVTUU").slice(0, 57) + "A"} />);
    expect(screen.queryByText("Alpha")).toBeNull();
  });
});
