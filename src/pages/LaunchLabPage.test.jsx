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
    expect(screen.getByText(/signing disabled/i)).toHaveTextContent("VITE_LAUNCHPAD_APP_ID");
    const connectButton = screen.getByRole("button", { name: /connect pera/i });
    expect(connectButton).toBeEnabled();

    fireEvent.click(connectButton);

    expect(connectPera).toHaveBeenCalledOnce();
  });

  it("helps fill in the form: plain hints, supply shortcuts, and a three-step explanation", () => {
    const { container } = render(<LaunchLabPage />);
    const page = within(container);
    expect(page.getByRole("list", { name: /how a launch works/i })).toBeInTheDocument();
    expect(page.getByText(/up to 32 characters \(0\/32\)/i)).toBeInTheDocument();
    const supply = page.getByLabelText(/display supply/i);
    expect(supply).toHaveValue("1000000");
    fireEvent.click(page.getByRole("button", { name: "1 billion" }));
    expect(supply).toHaveValue("1000000000");
    expect(page.getByText(/^1,000,000,000 supply/)).toBeInTheDocument();
    fireEvent.click(page.getByRole("button", { name: "1 trillion" }));
    expect(supply).toHaveValue("1000000000000");
    fireEvent.change(page.getByLabelText(/^asset name/i), { target: { value: "Moon Cat" } });
    expect(page.getByText(/\(8\/32\)/)).toBeInTheDocument();
    expect(page.getByText("Your launch")).toBeInTheDocument();
    expect(page.getAllByText("Not started")).toHaveLength(3); // the cost review and the two approvals
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
