import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const wallet = vi.hoisted(() => ({ account: null, connect: vi.fn(), signAndSubmit: vi.fn() }));
const chain = vi.hoisted(() => ({ posts: [] }));

// The same client objects on every render, like the real hook: a new object each time would make the component reload forever.
const clients = vi.hoisted(() => ({
  algodClient: { getTransactionParams: () => ({ do: async () => ({ fee: 0n, minFee: 1000n, firstValid: 10n, lastValid: 1010n, genesisHash: new Uint8Array(32), genesisID: "mainnet-v1.0" }) }) },
  indexerClient: {},
}));
vi.mock("../hooks/useAlgorand", () => ({
  explorerAddrUrl: (address) => `https://explorer.example/address/${address}`,
  useAlgorand: () => clients,
}));
vi.mock("../hooks/usePeraWallet", () => ({
  usePeraWallet: () => ({ account: wallet.account, connect: wallet.connect, isConnecting: false, signAndSubmit: wallet.signAndSubmit }),
}));
vi.mock("../launchpad/simulation", () => ({ simulateSignerGroup: vi.fn(async () => ({})) }));
// The transaction itself is built and checked against MainNet in test/social.test.js; under jsdom algosdk rejects byte arrays made by jsdom's own
// TextEncoder, so here only the transaction builder is replaced, keeping the real note encoding.
vi.mock("../launchpad/social", async (importActual) => {
  const actual = await importActual();
  return {
    ...actual,
    loadThread: vi.fn(async () => ({ posts: chain.posts, complete: true })),
    buildPostGroup: vi.fn(async ({ wallet: sender, assetId, body, parent }) => [{ txn: { note: actual.encodePost({ assetId, body, parent }) }, signers: [sender] }]),
  };
});
import TokenThread from "./TokenThread";

const now = Math.floor(Date.now() / 1000);
const WALLET = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ"; // a valid address (the all-zero one)

describe("TokenThread", () => {
  beforeEach(() => {
    wallet.account = null;
    wallet.connect.mockReset();
    wallet.signAndSubmit.mockReset();
    chain.posts = [
      { txId: "A".repeat(52), sender: "CREATORADDRESSXXXX", time: now - 600, body: "Welcome <b>everyone</b> https://evil.example", parent: null },
      { txId: "B".repeat(52), sender: "SOMEONEELSEXXXXXX", time: now - 300, body: "gm", parent: "A".repeat(52) },
    ];
  });

  it("shows posts with replies nested, as plain text with no links made from the text", async () => {
    render(<TokenThread assetId={5n} launcher="CREATORADDRESSXXXX" />);
    expect(await screen.findByText(/Welcome <b>everyone<\/b> https:\/\/evil\.example/)).toBeInTheDocument();
    expect(screen.getByText("gm")).toBeInTheDocument();
    expect(screen.getByText("Creator")).toBeInTheDocument();
    expect(document.querySelector(".thread-body a")).toBeNull();
    expect(document.querySelector(".thread-body b")).toBeNull();
    expect(document.querySelectorAll(".thread-post--reply")).toHaveLength(1);
  });

  it("asks a visitor to connect instead of posting", async () => {
    render(<TokenThread assetId={5n} launcher="X" />);
    await screen.findByText("gm");
    fireEvent.click(screen.getByRole("button", { name: /connect pera/i }));
    expect(wallet.connect).toHaveBeenCalled();
    expect(wallet.signAndSubmit).not.toHaveBeenCalled();
  });

  it("posts a reply from a connected wallet and shows it at once", async () => {
    wallet.account = WALLET;
    wallet.signAndSubmit.mockResolvedValue({ txId: "C".repeat(52) });
    render(<TokenThread assetId={5n} launcher="X" />);
    await screen.findByText("gm");
    fireEvent.click(screen.getAllByRole("button", { name: "Reply" })[0]);
    expect(screen.getByText(/Replying to/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Write a post"), { target: { value: "my reply" } });
    fireEvent.click(screen.getByRole("button", { name: "Post reply" }));
    await waitFor(() => expect(wallet.signAndSubmit).toHaveBeenCalledTimes(1));
    const [, group] = wallet.signAndSubmit.mock.calls[0];
    expect(new TextDecoder().decode(group[0].txn.note)).toContain('"body":"my reply"');
    expect(new TextDecoder().decode(group[0].txn.note)).toContain(`"parent":"${"A".repeat(52)}"`);
    expect(await screen.findByText("my reply")).toBeInTheDocument();
    expect(screen.getByText("Posted on Algorand.")).toBeInTheDocument();
  });

  it("disables posting when the note would be too long", async () => {
    wallet.account = WALLET;
    render(<TokenThread assetId={5n} launcher="X" />);
    await screen.findByText("gm");
    fireEvent.change(screen.getByLabelText("Write a post"), { target: { value: "x".repeat(1000) } });
    expect(screen.getByRole("button", { name: "Post" })).toBeDisabled();
  });
});
