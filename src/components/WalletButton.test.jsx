import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const wallet = vi.hoisted(() => ({
  account: null,
  connect: vi.fn(),
  disconnect: vi.fn(),
  isConnecting: false,
  connectionError: "",
}));

vi.mock("../hooks/usePeraWallet", () => ({ usePeraWallet: () => wallet }));

import WalletButton from "./WalletButton";
import { PLATFORM_WALLET } from "../launchpad/config";

describe("WalletButton (header)", () => {
  beforeEach(() => {
    Object.assign(wallet, { account: null, isConnecting: false, connectionError: "" });
    wallet.connect.mockReset();
    wallet.disconnect.mockReset();
  });

  it("offers Connect Pera and shows the network when no wallet is connected", () => {
    render(<WalletButton />);
    fireEvent.click(screen.getByRole("button", { name: /connect pera/i }));
    expect(wallet.connect).toHaveBeenCalledOnce();
    expect(screen.getByText(/testnet|mainnet/i)).toBeInTheDocument();
  });

  it("shows a connecting state and a connection error", () => {
    Object.assign(wallet, { isConnecting: true, connectionError: "Pera connection was canceled." });
    render(<WalletButton />);
    expect(screen.getByRole("button", { name: /connecting/i })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("canceled");
  });

  it("keeps the connected account visible and offers Disconnect in a menu", () => {
    wallet.account = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZ2345";
    render(<WalletButton />);
    const account = screen.getByRole("button", { name: /pera · abcde…z2345/i });
    expect(account).toBeInTheDocument();
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(account);
    expect(screen.getByRole("menu")).toHaveTextContent(wallet.account);
    fireEvent.click(screen.getByRole("menuitem", { name: /disconnect/i }));
    expect(wallet.disconnect).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes the menu on Escape and marks the platform authority account", () => {
    wallet.account = PLATFORM_WALLET;
    render(<WalletButton />);
    expect(screen.getByText(/platform authority/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /pera ·/i }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
