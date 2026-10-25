import { useEffect, useState } from "react";
import TokenView from "../components/TokenView";
import "../LaunchLab.css";
import { useAlgorand } from "../hooks/useAlgorand";
import { usePeraWallet } from "../hooks/usePeraWallet";
import { launchNetwork } from "../launchpad/config";
import { loadTokenDetail } from "../launchpad/tokenDetail";

/** The page for one launched token (`#token/<asset id>`): live figures, safety checklist and holders, all read from the chain. */
export default function TokenPage({ assetId }) {
  const { algodClient, indexerClient } = useAlgorand();
  const { account } = usePeraWallet();
  const [state, setState] = useState({ status: "loading", detail: null, error: "" });
  const configured = launchNetwork.launchpadAppId !== 0n;

  useEffect(() => {
    if (!configured) return undefined;
    let cancelled = false;
    setState({ status: "loading", detail: null, error: "" });
    loadTokenDetail({ algodClient, indexerClient, config: launchNetwork, assetId })
      .then((detail) => { if (!cancelled) setState({ status: detail.found ? "ready" : "missing", detail, error: "" }); })
      .catch((cause) => { if (!cancelled) setState({ status: "error", detail: null, error: cause?.message || String(cause) }); });
    return () => { cancelled = true; };
  }, [algodClient, indexerClient, assetId, configured]);

  const pageUrl = `${window.location.origin}${window.location.pathname}`;
  return (
    <section className="launchlab-page directory">
      {!configured && <div className="instant-warning">No launchpad application is configured for this build.</div>}
      {state.status === "loading" && configured ? <p className="field-hint">Reading the token from the chain…</p> : null}
      {state.status === "error" && <div className="instant-error">Could not load this token: {state.error}</div>}
      {state.status === "missing" && (
        <div className="instant-card">
          <h2>Not a launch from this launchpad</h2>
          <p className="field-hint">The launchpad has no finished or cancelled record for asset {assetId.toString()}. If it was only just launched, wait a moment and reload.</p>
          <a className="af-btn-ghost link-button" href="#recent">Back to recent launches</a>
        </div>
      )}
      {state.status === "ready" && <TokenView detail={state.detail} account={account} pageUrl={pageUrl} />}
    </section>
  );
}
