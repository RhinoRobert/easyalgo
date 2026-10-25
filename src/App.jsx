import { useState } from "react";
import LaunchLabPage from "./pages/LaunchLabPage";
import MyLaunchesPage from "./pages/MyLaunchesPage";
import DirectoryPage from "./pages/DirectoryPage";
import OperationsPage from "./pages/OperationsPage";
import WalletButton from "./components/WalletButton";
import Tabs, { useActiveTab } from "./components/Tabs";
import TermsFooter from "./components/TermsFooter";

// There is no router and no backend: the address fragment picks the view and every view stays mounted (hidden when not shown), so switching tabs
// never interrupts a launch that is waiting for the wallet. The wallet (Pera) signs every transaction group.
export default function App() {
  const active = useActiveTab();
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
        <WalletButton />
      </header>
      <Tabs active={active} />
      <main className="shell-main">
        <div hidden={active !== "launch"}><LaunchLabPage /></div>
        {opened.has("mine") && <MyLaunchesPage active={active === "mine"} />}
        {opened.has("recent") && <DirectoryPage mode="recent" active={active === "recent"} />}
        {opened.has("popular") && <DirectoryPage mode="popular" active={active === "popular"} />}
        {opened.has("ops") && <OperationsPage active={active === "ops"} />}
      </main>
      <TermsFooter />
    </div>
  );
}