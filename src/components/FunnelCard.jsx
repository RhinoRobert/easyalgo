const percent = (rate) => (rate === null ? "n/a" : `${Math.round(rate * 100)}%`);

function duration(seconds) {
  if (seconds === null) return "n/a";
  if (seconds < 90) return `${Math.round(seconds)} s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1)} h`;
}

/** How launching is going, from the chain's own records (Operations tab). No visitor tracking is involved. */
export default function FunnelCard({ funnel }) {
  if (!funnel) return null;
  const busiest = Math.max(1, ...funnel.perDay.map((day) => day.started));
  return (
    <section className="instant-lifecycle funnel" aria-label="Launch funnel">
      <h2>Launch funnel</h2>
      <p className="field-hint">Worked out from the contract's own records, so it counts only wallets that started a launch. Nothing about visitors is tracked.</p>
      <div className="token-stats">
        <div><span>Started</span><strong>{funnel.started}</strong></div>
        <div><span>Finished</span><strong>{funnel.finished}</strong></div>
        <div><span>Cancelled</span><strong>{funnel.cancelled}</strong></div>
        <div><span>Waiting / stalled</span><strong>{funnel.waiting} / {funnel.stalled}</strong></div>
        <div><span>Finish rate</span><strong>{percent(funnel.completionRate)}</strong></div>
        <div><span>Wallets · came back</span><strong>{funnel.launchers} · {funnel.repeatLaunchers}</strong></div>
        <div><span>Between approvals</span><strong>{duration(funnel.medianSecondsBetweenApprovals)}</strong></div>
      </div>
      <h3 className="funnel-days-title">Launches started, last 7 days</h3>
      <ol className="funnel-days" aria-label="Launches started per day">
        {[...funnel.perDay].reverse().map((day) => (
          <li key={day.daysAgo}>
            <span className="funnel-bar" style={{ height: `${Math.max(4, (day.started / busiest) * 100)}%` }} title={`${day.started} started`} />
            <strong>{day.started}</strong>
            <small>{day.daysAgo === 0 ? "today" : `${day.daysAgo}d ago`}</small>
          </li>
        ))}
      </ol>
    </section>
  );
}
