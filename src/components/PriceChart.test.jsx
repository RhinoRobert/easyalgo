import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ fetchCandles: vi.fn() }));
vi.mock("../launchpad/vestigeApi", async (importActual) => ({ ...(await importActual()), fetchCandles: api.fetchCandles }));
import PriceChart from "./PriceChart";
import TokenBadge from "./TokenBadge";

const candles = [
  { time: 1_000, open: 1e-6, high: 1.1e-6, low: 0.9e-6, close: 1e-6 },
  { time: 2_000, open: 1e-6, high: 1.3e-6, low: 1e-6, close: 1.2e-6 },
];

describe("PriceChart", () => {
  beforeEach(() => api.fetchCandles.mockReset());

  it("draws the price line and changes range on request", async () => {
    api.fetchCandles.mockResolvedValue(candles);
    render(<PriceChart assetId={5n} launchTime={900} />);
    expect(await screen.findByRole("img", { name: /price from/i })).toBeInTheDocument();
    expect(document.querySelector(".price-chart-line").getAttribute("d")).toMatch(/^M/);
    expect(screen.getByText(/\+20\.00% over 7D/)).toBeInTheDocument();
    expect(api.fetchCandles).toHaveBeenLastCalledWith(expect.objectContaining({ assetId: 5n, range: "7D", launchTime: 900 }));
    fireEvent.click(screen.getByRole("button", { name: "1D" }));
    await waitFor(() => expect(api.fetchCandles).toHaveBeenLastCalledWith(expect.objectContaining({ range: "1D" })));
    expect(screen.getByRole("button", { name: "1D" })).toHaveAttribute("aria-pressed", "true");
  });

  it("says so, without breaking, when Vestige cannot be reached or has no history", async () => {
    api.fetchCandles.mockRejectedValue(new Error("offline"));
    const { unmount } = render(<PriceChart assetId={5n} launchTime={0} />);
    expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument();
    unmount();
    api.fetchCandles.mockResolvedValue([]);
    render(<PriceChart assetId={5n} launchTime={0} />);
    expect(await screen.findByText(/no price history/i)).toBeInTheDocument();
  });
});

describe("TokenBadge", () => {
  it("shows the logo without a referrer and falls back to the coloured mark if it fails", () => {
    render(<TokenBadge assetId={5n} unit="EXM" name="Example" image="https://ipfs.vestigelabs.org/ipfs/Qm" />);
    const image = document.querySelector("img");
    expect(image).toHaveAttribute("src", "https://ipfs.vestigelabs.org/ipfs/Qm");
    expect(image).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(image).toHaveAttribute("loading", "lazy");
    fireEvent.error(image);
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText("EX")).toBeInTheDocument();
  });

  it("loads the big logo at the top of a token page at once, and the small card logos lazily", () => {
    const { unmount } = render(<TokenBadge assetId={5n} unit="EXM" name="Example" size="lg" image="https://ipfs.vestigelabs.org/ipfs/Qm" />);
    expect(document.querySelector("img")).toHaveAttribute("loading", "eager");
    unmount();
    render(<TokenBadge assetId={5n} unit="EXM" name="Example" image="https://ipfs.vestigelabs.org/ipfs/Qm" />);
    expect(document.querySelector("img")).toHaveAttribute("loading", "lazy");
  });

  it("is a coloured mark when there is no logo", () => {
    render(<TokenBadge assetId={5n} unit="EXM" name="Example" />);
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText("EX")).toBeInTheDocument();
  });
});
