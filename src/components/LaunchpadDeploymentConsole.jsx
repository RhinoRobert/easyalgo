import { useState } from "react";
import { PLATFORM_WALLET, launchNetwork, launchNetworkName } from "../launchpad/config";
import {
  decodeAndValidateDeploymentPackage,
  deploymentPackageSha256,
} from "../launchpad/deploymentPackage";
import { simulateSignerGroup } from "../launchpad/simulation";

export default function LaunchpadDeploymentConsole({ account, algodClient, signAndSubmit }) {
  const [deploymentPackage, setDeploymentPackage] = useState(null);
  const [packageHash, setPackageHash] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const loadPackage = async (event) => {
    setError("");
    setStatus("");
    setDeploymentPackage(null);
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const payload = JSON.parse(new TextDecoder().decode(bytes));
      decodeAndValidateDeploymentPackage(payload, {
        network: launchNetworkName, account, config: launchNetwork,
      });
      setDeploymentPackage(payload);
      setPackageHash(await deploymentPackageSha256(bytes));
      setStatus("Package decoded, transaction IDs matched, and authority/network guards passed.");
    } catch (cause) {
      setError(cause?.message || String(cause));
    }
  };

  const signPackage = async () => {
    setError("");
    try {
      const group = decodeAndValidateDeploymentPackage(
        deploymentPackage,
        { network: launchNetworkName, account, config: launchNetwork },
      );
      const simulation = await simulateSignerGroup(algodClient, group);
      setStatus(
        `Simulation passed (${simulation.appBudgetConsumed} app budget). Waiting for Pera/Ledger signature…`,
      );
      await signAndSubmit(algodClient, group, 20);
      const appTxnId = deploymentPackage.transactionIds.at(-1);
      const confirmation = await algodClient.pendingTransactionInformation(appTxnId).do();
      const appId = confirmation.applicationIndex ?? confirmation["application-index"];
      setStatus(
        `${deploymentPackage.stage} confirmed at round `
        + `${confirmation.confirmedRound ?? confirmation["confirmed-round"]}`
        + `${appId ? `; new App ID ${appId}` : ""}. Run the CLI verify-record stage before enabling any frontend.`,
      );
    } catch (cause) {
      setError(cause?.message || String(cause));
    }
  };

  return (
    <section className="instant-lifecycle" aria-label="Local deployment console">
      <div className="instant-lifecycle-heading">
        <div><div className="af-section-eyebrow">Local-only deployment gate</div><h2>Pera / Ledger unsigned package console</h2></div>
        <p>This panel never accepts mnemonics or private keys.</p>
      </div>
      <div className="instant-card">
        <div className="instant-summary"><span>Required authority</span><strong>{PLATFORM_WALLET}</strong></div>
        <div className="instant-summary"><span>Connected authority</span><strong>{account || "not connected"}</strong></div>
        <label>
          Unsigned package from <code>launchpad_v2/deploy.py</code>
          <input type="file" accept="application/json,.json" onChange={loadPackage} />
        </label>
        {deploymentPackage && (
          <>
            <div className="instant-summary"><span>Stage / network</span><strong>{deploymentPackage.stage} · {deploymentPackage.network}</strong></div>
            <div className="instant-summary"><span>Package SHA-256</span><strong className="instant-hash">{packageHash}</strong></div>
            {Object.entries(deploymentPackage.artifacts || {}).map(([name, value]) => (
              <div className="instant-summary" key={name}><span>{name}</span><strong className="instant-hash">{String(value)}</strong></div>
            ))}
            <button className="af-cta-btn" onClick={signPackage}>Simulate, inspect in Pera, and sign</button>
          </>
        )}
        {status && <div className="instant-warning">{status}</div>}
        {error && <div className="instant-error">{error}</div>}
      </div>
    </section>
  );
}
