import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const connectPera = vi.hoisted(() => vi.fn());

vi.mock("../hooks/usePeraWallet", () => ({
  usePeraWallet: () => ({
    account: null,
    connect: connectPera,
    connectionError: "",
    disconnect: vi.fn(),
    isConnecting: false,
    signAndSend: vi.fn(),
    signAndSubmit: vi.fn(),
    tinymanSigner: vi.fn()
  })
}));

import LaunchLabPage from "./LaunchLabPage";

describe("LaunchLabPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    connectPera.mockReset();
  });

  it("allows Pera connection while signing remains locked by missing deployment configuration", () => {
    render(<LaunchLabPage />);

    expect(screen.getByRole("heading", { name: /one asset\. one tinyman pool/i })).toBeInTheDocument();
    expect(screen.getByText(/signing disabled/i)).toHaveTextContent("VITE_LAUNCHPAD_V2_APP_ID");
    const connectButton = screen.getByRole("button", { name: /connect pera/i });
    expect(connectButton).toBeEnabled();

    fireEvent.click(connectButton);

    expect(connectPera).toHaveBeenCalledOnce();
  });

  it("states the wallet and liquidity boundaries before launch", () => {
    const { container } = render(<LaunchLabPage />);

    const page = within(container);
    expect(page.getByText("Exactly 1 ALGO")).toBeInTheDocument();
    expect(page.getByText("100%")).toBeInTheDocument();
    expect(page.getByText(/80% burn · 10% creator · 10% platform/i)).toBeInTheDocument();
    expect(page.getByText(/not promises of value, profit, or permanent tvl/i)).toBeInTheDocument();
  });
});
