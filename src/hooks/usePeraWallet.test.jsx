import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const sign = vi.hoisted(() => vi.fn(async () => [new Uint8Array([1])]));

vi.mock("@perawallet/connect", () => ({
  PeraWalletConnect: class {
    reconnectSession() { return Promise.resolve([]); }
    connect() { return Promise.resolve(["WALLET"]); }
    disconnect() {}
    signTransaction(...args) { return sign(...args); }
  },
}));

import { usePeraWallet } from "./usePeraWallet";

describe("tinymanSigner", () => {
  it("refuses without a connected account", async () => {
    const { result } = renderHook(() => usePeraWallet());
    await expect(result.current.tinymanSigner([[]])).rejects.toThrow("Wallet not connected");
    expect(sign).not.toHaveBeenCalled();
  });

  it("asks the wallet only for the connected account's transactions", async () => {
    const { result } = renderHook(() => usePeraWallet());
    await act(async () => { await result.current.connect(); });
    const funding = { txn: "funding", signers: ["WALLET"] };
    const poolCall = { txn: "poolCall", signers: ["POOL"] };

    await result.current.tinymanSigner([[funding, poolCall]]);

    expect(sign).toHaveBeenCalledWith([[funding, { txn: "poolCall", signers: [] }]], "WALLET");
  });
});
