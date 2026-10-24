import { useEffect, useRef, useState } from "react";
import { PLATFORM_WALLET, launchNetwork } from "../launchpad/config";
import { usePeraWallet } from "../hooks/usePeraWallet";

export const shortAddress = (address) => (address ? `${address.slice(0, 5)}…${address.slice(-5)}` : "");

// The wallet control in the header: Connect Pera when disconnected; when connected, the account stays visible with a menu to copy the address or disconnect.
export default function WalletButton() {
  const { account, connect, disconnect, isConnecting, connectionError } = usePeraWallet();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const box = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => { if (box.current && !box.current.contains(event.target)) setOpen(false); };
    const onKey = (event) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(account);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable: the address is shown in full in the menu */ }
  };

  if (!account) {
    return (
      <div className="wallet" ref={box}>
        <span className="wallet-net">{launchNetwork.label}</span>
        <button type="button" className="wallet-connect" onClick={connect} disabled={isConnecting}>
          {isConnecting ? "Connecting…" : "Connect Pera"}
        </button>
        {connectionError && <span className="wallet-error" role="alert">{connectionError}</span>}
      </div>
    );
  }

  const isAuthority = account === PLATFORM_WALLET;
  return (
    <div className="wallet" ref={box}>
      <span className="wallet-net">{launchNetwork.label}</span>
      <button type="button" className="wallet-account" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="wallet-dot" aria-hidden="true" />
        <span>Pera · {shortAddress(account)}</span>
        {isAuthority && <span className="wallet-badge">platform authority</span>}
        <span className="wallet-caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="wallet-menu" role="menu">
          <div className="wallet-menu-address">{account}</div>
          <button type="button" role="menuitem" onClick={copy}>{copied ? "Copied" : "Copy address"}</button>
          <button type="button" role="menuitem" className="wallet-disconnect" onClick={() => { setOpen(false); disconnect(); }}>Disconnect</button>
        </div>
      )}
    </div>
  );
}
