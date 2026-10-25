import { render, screen, waitFor, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const wallet = vi.hoisted(() => ({ account: null, mounts: { ops: 0 } }));
const AUTHORITY = "CIVTUU6KLTYO26SPVEBDFBKP3UMZM2DPEO5RINODUVCI5NVIFC6HVNWS7E";

vi.mock("./hooks/usePeraWallet", () => ({
  usePeraWallet: () => ({ account: wallet.account, connect: vi.fn(), disconnect: vi.fn(), isConnecting: false, connectionError: "", signAndSubmit: vi.fn() }),
}));
vi.mock("./components/WalletButton", () => ({ default: () => <div>wallet</div> }));
vi.mock("./pages/LaunchLabPage", () => ({ default: () => <h1>launch page</h1> }));
vi.mock("./pages/MyLaunchesPage", () => ({ default: () => <h1>my launches page</h1> }));
vi.mock("./pages/DirectoryPage", () => ({ default: () => <h1>directory page</h1> }));
vi.mock("./pages/OperationsPage", () => ({ default: () => { wallet.mounts.ops += 1; return <h1>SECRET OPERATIONS CONTENT</h1>; } }));

import App from "./App";

describe("Operations is only for the platform authority wallet", () => {
  beforeEach(() => { wallet.account = null; wallet.mounts.ops = 0; window.location.hash = ""; });
  afterEach(() => { window.location.hash = ""; });

  it("is not listed and not loaded for visitors, even when the address asks for it", async () => {
    window.location.hash = "#ops";
    render(<App />);
    expect(screen.queryByRole("link", { name: "Operations" })).toBeNull();
    expect(screen.queryByText(/SECRET OPERATIONS CONTENT/)).toBeNull();
    expect(screen.getByText("launch page")).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(wallet.mounts.ops).toBe(0);
    expect(document.body.textContent).not.toMatch(/SECRET OPERATIONS/);
  });

  it("is not shown to a different connected wallet either", async () => {
    wallet.account = "SOMEONEELSEXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
    window.location.hash = "#ops";
    render(<App />);
    expect(screen.queryByRole("link", { name: "Operations" })).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(wallet.mounts.ops).toBe(0);
  });

  it("appears for the platform authority wallet, at #ops too", async () => {
    wallet.account = AUTHORITY;
    window.location.hash = "#ops";
    render(<App />);
    expect(screen.getByRole("link", { name: "Operations" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("SECRET OPERATIONS CONTENT")).toBeVisible());
  });

  it("vanishes again when the authority wallet disconnects", async () => {
    wallet.account = AUTHORITY;
    window.location.hash = "#ops";
    const view = render(<App />);
    await waitFor(() => expect(screen.getByText("SECRET OPERATIONS CONTENT")).toBeVisible());
    wallet.account = null;
    await act(async () => { view.rerender(<App />); });
    expect(screen.queryByText("SECRET OPERATIONS CONTENT")).toBeNull();
    expect(screen.queryByRole("link", { name: "Operations" })).toBeNull();
    expect(screen.getByText("launch page")).toBeVisible();
  });
});
