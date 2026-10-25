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
    expect(container.querySelector(".trade-toast")).toBeNull();
    act(() => { vi.advanceTimersByTime(800); });
    expect(screen.getByText(/bought 4\.67 ALGO of CNRY2/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /bought 4\.67 ALGO/ })).toHaveAttribute("href", "#token/3753533790");
    act(() => { vi.advanceTimersByTime(6100); });
    expect(container.querySelector(".trade-toast")).toBeNull();
  });

  it("waits while the pointer is over it, and shows the next one only after a pause", () => {
    feed.queue = [trade(1), trade(2, { side: "sell", algo: 12 })];
    const { container } = render(<TradeToasts />);
    act(() => { vi.advanceTimersByTime(800); });
    const toast = container.querySelector(".trade-toast");
    fireEvent.mouseEnter(toast);
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(container.querySelector(".trade-toast")).not.toBeNull();
    fireEvent.mouseLeave(toast);
    act(() => { vi.advanceTimersByTime(6100); });
    expect(container.querySelector(".trade-toast")).toBeNull();
    act(() => { vi.advanceTimersByTime(800); });
    expect(screen.getByText(/sold 12\.00 ALGO|sold 12 ALGO/)).toBeInTheDocument();
  });

  it("calls the user's own trade 'You', and turns a busy moment into one summary", () => {
    feed.queue = [trade(1, { address: "ME" })];
    const { container, unmount } = render(<TradeToasts />);
    act(() => { vi.advanceTimersByTime(800); });
    expect(screen.getByText(/You bought/)).toBeInTheDocument();
    unmount();
    feed.queue = [trade(1), trade(2), trade(3), trade(4, { assetId: "5" })];
    const second = render(<TradeToasts />);
    act(() => { vi.advanceTimersByTime(800); });
    expect(screen.getByText("4 new trades")).toBeInTheDocument();
    expect(second.container.querySelectorAll(".trade-toast")).toHaveLength(1);
  });

  it("can be dismissed and muted, and muting stops all alerts", () => {
    feed.queue = [trade(1), trade(2)];
    const { container } = render(<><TradeToasts /><AlertsToggle /></>);
    act(() => { vi.advanceTimersByTime(800); });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(container.querySelector(".trade-toast")).toBeNull();
    act(() => { vi.advanceTimersByTime(800); });
    expect(container.querySelector(".trade-toast")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Mute" }));
    expect(container.querySelector(".trade-toast")).toBeNull();
    expect(screen.getByRole("button", { name: /trade alerts: off/i })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: /trade alerts: off/i }));
    expect(screen.getByRole("button", { name: /trade alerts: on/i })).toBeInTheDocument();
  });
});
