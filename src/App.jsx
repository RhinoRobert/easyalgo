import { Suspense, lazy, useState } from "react";
import LaunchLabPage from "./pages/LaunchLabPage";
import MyLaunchesPage from "./pages/MyLaunchesPage";
import DirectoryPage from "./pages/DirectoryPage";
import WalletButton from "./components/WalletButton";
import Tabs, { useRoute } from "./components/Tabs";
import TermsFooter from "./components/TermsFooter";
import TradeToasts from "./components/TradeToasts";
import MainSiteLink from "./components/MainSiteLink";
import { usePeraWallet } from "./hooks/usePeraWallet";
import { PLATFORM_WALLET } from "./launchpad/config";

// The operations view is fetched as a separate piece of code and only when the platform authority wallet is connected: for everyone else it is
// not listed, not loaded and #ops behaves like any unknown address (the Launch page). This is a convenience, not security: the figures on it are
// public chain data and the contract itself refuses every authority action from any other wallet.
const OperationsPage = lazy(() => import("./pages/OperationsPage"));
const TokenPage = lazy(() => import("./pages/TokenPage"));

// There is no router and no backend: the address fragment picks the view and every view stays mounted (hidden when not shown), so switching tabs
// never interrupts a launch that is waiting for the wallet. The wallet (Pera) signs every transaction group.
export default function App() {
  const { account } = usePeraWallet();
  const isAuthority = account === PLATFORM_WALLET;
  const { tab: requested, assetId: tokenAssetId } = useRoute();
  const active = requested === "ops" && !isAuthority ? "launch" : requested;
  // A view loads its data the first time it is opened, not at page load.
  const [opened, setOpened] = useState(() => new Set([active]));
  if (!opened.has(active)) setOpened(new Set([...opened, active]));
  return (
    <div className="shell">
      <header className="shell-header">
        <div className="shell-brand">
          <span className="shell-mark" aria-hidden="true">P</span>
          <div>
            <strong>PNET LaunchLab</strong>
            <span>Algorand asset + Tinyman liquidity launcher</span>
          </div>
        </div>
        <div className="shell-actions">
          <MainSiteLink />
          <WalletButton />
        </div>
      </header>
      <Tabs active={active} showOperations={isAuthority} />
      <TradeToasts />
      <main className="shell-main">
        <div hidden={active !== "launch"}><LaunchLabPage /></div>
        {opened.has("mine") && <MyLaunchesPage active={active === "mine"} />}
        {opened.has("recent") && <DirectoryPage mode="recent" active={active === "recent"} />}
        {opened.has("popular") && <DirectoryPage mode="popular" active={active === "popular"} />}
        {active === "token" && (
          <Suspense fallback={null}>
            <TokenPage key={tokenAssetId.toString()} assetId={tokenAssetId} />
          </Suspense>
        )}
        {isAuthority && opened.has("ops") && (
          <Suspense fallback={null}>
            <OperationsPage active={active === "ops"} />
          </Suspense>
        )}
      </main>
      <TermsFooter />
    </div>
  );
}