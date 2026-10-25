/** Grey shimmering stand-ins while a list loads, so the page keeps its shape instead of showing "Loading…". */
export function CardSkeletons({ count = 6 }) {
  return (
    <ul className="launch-grid" aria-busy="true" aria-label="Loading launches">
      {Array.from({ length: count }, (_, index) => (
        <li key={index} className="launch-card launch-card--skeleton" aria-hidden="true">
          <div className="skeleton-row"><span className="skeleton skeleton--badge" /><span className="skeleton skeleton--line" /></div>
          <span className="skeleton skeleton--figure" />
          <span className="skeleton skeleton--small" />
          <span className="skeleton skeleton--button" />
        </li>
      ))}
    </ul>
  );
}

export function TokenSkeleton() {
  return (
    <div className="token-page" aria-busy="true" aria-label="Loading token">
      <div className="token-head" aria-hidden="true">
        <span className="skeleton skeleton--badge skeleton--large" />
        <div className="token-head-text"><span className="skeleton skeleton--title" /><span className="skeleton skeleton--small" /></div>
      </div>
      <div className="token-stats" aria-hidden="true">{[0, 1, 2, 3].map((n) => <div key={n}><span className="skeleton skeleton--small" /><span className="skeleton skeleton--figure" /></div>)}</div>
    </div>
  );
}

/** A friendly empty state with one clear next step. */
export function EmptyState({ title, text, href, cta }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      {text ? <p>{text}</p> : null}
      {href ? <a className="trade-button" href={href}>{cta}</a> : null}
    </div>
  );
}
