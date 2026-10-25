import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const feed = vi.hoisted(() => ({ queue: [], setQueue: null }));
const clients = vi.hoisted(() => ({ algodClient: {}, indexerClient: {} }));
vi.mock("../hooks/useAlgorand", () => ({ IS_MAINNET: true, useAlgorand: () => clients }));
vi.mock("../hooks/usePeraWallet", () => ({ usePeraWallet: () => ({ account: "ME" }) }));
vi.mock("../launchpad/config", () => ({ launchNetwork: { launchpadAppId: 1n } }));
vi.mock("../hooks/useTradeAlerts", async () => {
  const { useState } = await import("react");
  return { useTradeAlerts: ({ enabled }) => { const [queue, setQueue] = useState(() => (enabled ? feed.queue : [])); feed.setQueue = setQueue; return { queue: enabled ? queue : [], setQueue }; } };
});
import TradeToasts, { AlertsToggle } from "./TradeToasts";
import { setAlertsOn } from "../launchpad/alertPrefs";

const trade = (n, overrides = {}) => ({ key: `k${n}`, assetId: "3753533790", side: "buy", algo: 4.6708, address: "7VGZHV5AYKQSP34R2R5QM2M32VCTXJ6VXXPCWCOPOPKI744X4YRPPOIQWQ", time: n, name: "Canary v2", ticker: "CNRY2", ...overrides });

describe("TradeToasts", () => {
  beforeEach(() => { vi.useFakeTimers(); setAlertsOn(true); feed.queue = []; });
  afterEach(() => { vi.useRealTimers(); });

  it("shows nothing until a trade arrives, then one smooth notice that goes away by itself", () => {
    feed.queue = [trade(1)];
    const { container } = render(<TradeToasts />);
    expect(container.querySelector(".trade-banner")).toBeNull();
    act(() => { vi.advanceTimersByTime(800); });
    expect(container.querySelector(".trade-banner-text strong")).toHaveTextContent(/7VGZH.*bought 4\.67 ALGO of CNRY2/);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /bought 4\.67 ALGO/ })).toHaveAttribute("href", "#token/3753533790");
    act(() => { vi.advanceTimersByTime(8100); });
    act(() => { vi.advanceTimersByTime(400); });
    expect(container.querySelector(".trade-banner")).toBeNull();
  });

  it("waits while the pointer is over it, and shows the next one only after a pause", () => {
    feed.queue = [trade(1), trade(2, { side: "sell", algo: 12 })];
    const { container } = render(<TradeToasts />);
    act(() => { vi.advanceTimersByTime(800); });
    const toast = container.querySelector(".trade-banner");
    fireEvent.mouseEnter(toast);
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(container.querySelector(".trade-banner")).not.toBeNull();
    fireEvent.mouseLeave(toast);
    act(() => { vi.advanceTimersByTime(8100); });
    act(() => { vi.advanceTimersByTime(400); });
    expect(container.querySelector(".trade-banner")).toBeNull();
    act(() => { vi.advanceTimersByTime(800); });
    expect(container.querySelector(".trade-banner-text strong")).toHaveTextContent(/sold 12\.00 ALGO of CNRY2/);
  });

  it("is a wide banner that opens the token's page, with its logo when it has one", () => {
    feed.queue = [trade(1, { image: "https://ipfs.vestigelabs.org/ipfs/Qm" })];
    const { container } = render(<TradeToasts />);
    act(() => { vi.advanceTimersByTime(800); });
    const link = container.querySelector("a.trade-banner-link");
    expect(link).toHaveAttribute("href", "#token/3753533790");
    expect(link.querySelector("img")).toHaveAttribute("src", "https://ipfs.vestigelabs.org/ipfs/Qm");
    expect(link).toHaveTextContent("View token");
    expect(container.querySelector(".trade-banner--buy")).not.toBeNull();
    expect(container.querySelector("a button")).toBeNull();
  });

  it("calls the user's own trade 'You', and turns a busy moment into one summary", () => {
    feed.queue = [trade(1, { address: "ME" })];
    const { container, unmount } = render(<TradeToasts />);
    act(() => { vi.advanceTimersByTime(800); });
    expect(container.querySelector(".trade-banner-text strong")).toHaveTextContent(/^You bought/);
    unmount();
    feed.queue = [trade(1), trade(2), trade(3), trade(4, { assetId: "5" })];
    const second = render(<TradeToasts />);
    act(() => { vi.advanceTimersByTime(800); });
    expect(screen.getByText("4 new trades")).toBeInTheDocument();
    expect(second.container.querySelectorAll(".trade-banner")).toHaveLength(1);
  });

  it("can be dismissed and muted, and muting stops all alerts", () => {
    feed.queue = [trade(1), trade(2)];
    const { container } = render(<><TradeToasts /><AlertsToggle /></>);
    act(() => { vi.advanceTimersByTime(800); });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(container.querySelector(".trade-banner-wrap--leaving")).not.toBeNull();
    act(() => { vi.advanceTimersByTime(400); });
    expect(container.querySelector(".trade-banner")).toBeNull();
    act(() => { vi.advanceTimersByTime(800); });
    expect(container.querySelector(".trade-banner")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Mute" }));
    expect(container.querySelector(".trade-banner")).toBeNull();
    expect(screen.getByRole("button", { name: /trade alerts: off/i })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: /trade alerts: off/i }));
    expect(screen.getByRole("button", { name: /trade alerts: on/i })).toBeInTheDocument();
  });
});
