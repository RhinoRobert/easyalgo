import { IS_MAINNET } from "../hooks/useAlgorand";
import { vestigeManagerUrl } from "../launchpad/links";
import { shareOnXUrl, tokenHash } from "../launchpad/tokenView";

/**
 * What a creator can do after launching, with the steps the chain can confirm ticked off: the token is live, a logo is set on Vestige, the creator's
 * liquidity tokens are claimed. Sharing and replying cannot be checked, so they are links only. `hasLogo` is null while it is not known yet.
 */
export default function NextSteps({ name, unit, assetId, burnedPct, pageUrl, vestigeGranted, hasLogo = null, creatorLpClaimed, onTokenPage = false }) {
  const steps = [
    { id: "live", done: true, title: "Your token is live", detail: "Its pool is open on Tinyman." },
    ...(IS_MAINNET ? [{
      id: "logo",
      done: hasLogo === true,
      title: "Add a logo and description",
      detail: vestigeGranted
        ? "Set them on Vestige; they then show here too."
        : "First press Grant Vestige access in My launches, then set them on Vestige.",
      link: vestigeGranted
        ? { href: vestigeManagerUrl(assetId), label: onTokenPage ? "Open the Vestige editor ↗" : "Edit on Vestige ↗", external: true }
        : { href: "#mine", label: "Open My launches" },
    }] : []),
    {
      id: "share",
      done: false,
      title: "Tell people about it",
      detail: "A post with the link shows your token's name and numbers.",
      link: { href: shareOnXUrl({ name, unit, assetId, burnedPct, pageUrl }), label: "Share on X ↗", external: true },
    },
    ...(onTokenPage ? [] : [{
      id: "replies",
      done: false,
      title: "Say hello in the replies",
      detail: "Your token's page has a thread. A first post gives visitors something to answer.",
      link: { href: tokenHash(assetId), label: "Open the token page" },
    }]),
    {
      id: "claim",
      done: creatorLpClaimed === true,
      title: "Claim your 10% of the liquidity tokens (optional)",
      detail: creatorLpClaimed ? "Claimed. They are in your wallet." : "They are held for you. Claiming lets you withdraw that share of the pool, so most creators leave them.",
      link: creatorLpClaimed ? null : { href: "#mine", label: "Open My launches" },
    },
  ];
  return (
    <section className="instant-card next-steps" aria-label="Next steps">
      <h2>Next steps</h2>
      <ul>
        {steps.map((step) => (
          <li key={step.id} className={`token-check token-check--${step.done ? "pass" : "info"}`}>
            <span className="token-check-mark" aria-hidden="true">{step.done ? "✓" : "→"}</span>
            <div>
              <strong>{step.title}{step.done ? " (done)" : ""}</strong>
              <small>{step.detail}{step.link ? <> <a href={step.link.href} {...(step.link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{step.link.label}</a></> : null}</small>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
