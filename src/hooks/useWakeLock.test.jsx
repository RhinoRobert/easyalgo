import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWakeLock } from "./useWakeLock";

function fakeWakeLock() {
  const locks = [];
  const request = vi.fn(async () => {
    const listeners = [];
    const lock = { released: false, addEventListener: (_n, fn) => listeners.push(fn), release: vi.fn(async () => { lock.released = true; listeners.forEach((fn) => fn()); }) };
    locks.push(lock);
    return lock;
  });
  return { request, locks };
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("useWakeLock", () => {
  let wake;
  beforeEach(() => { wake = fakeWakeLock(); Object.defineProperty(navigator, "wakeLock", { value: { request: wake.request }, configurable: true }); });
  afterEach(() => { delete navigator.wakeLock; });

  it("holds the screen awake only while active, and lets go afterwards", async () => {
    const { rerender, unmount } = renderHook(({ on }) => useWakeLock(on), { initialProps: { on: false } });
    await flush();
    expect(wake.request).not.toHaveBeenCalled();
    rerender({ on: true });
    await flush();
    expect(wake.request).toHaveBeenCalledWith("screen");
    rerender({ on: false });
    await flush();
    expect(wake.locks[0].release).toHaveBeenCalled();
    unmount();
  });

  it("asks again when the page comes back to the front (the browser drops the lock while it is hidden)", async () => {
    renderHook(() => useWakeLock(true));
    await flush();
    await wake.locks[0].release();   // the browser released it while Pera was in front
    document.dispatchEvent(new Event("visibilitychange"));
    await flush();
    expect(wake.request).toHaveBeenCalledTimes(2);
  });

  it("does nothing, without error, where the feature does not exist", async () => {
    delete navigator.wakeLock;
    expect(() => renderHook(() => useWakeLock(true))).not.toThrow();
  });
});