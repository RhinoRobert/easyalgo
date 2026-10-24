import LaunchLabPage from "./pages/LaunchLabPage";

// The whole app is the LaunchLab page. There is no router, no backend and no stored secret: the wallet (Pera) signs every transaction group.
export default function App() {
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
        <span className="shell-note">Standalone · wallet-signed</span>
      </header>
      <main className="shell-main">
        <LaunchLabPage />
      </main>
    </div>
  );
}
