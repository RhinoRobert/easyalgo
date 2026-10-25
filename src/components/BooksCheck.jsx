/** The contract's own records against what its account really holds, one line per check (Operations tab). */
export default function BooksCheck({ books }) {
  if (!books) return null;
  const failing = books.failing.length;
  return (
    <section className="instant-lifecycle books-check" aria-label="Books versus chain">
      <h2>Books versus chain</h2>
      <p className={failing ? "instant-error" : "field-hint"} role={failing ? "alert" : undefined}>
        {failing
          ? `${failing} check${failing === 1 ? "" : "s"} failed: the contract holds something its records do not explain, or less than they promise. Look into it before more launches.`
          : "Everything the contract holds matches its own records. Anyone can send tokens to it, so holding more than owed is fine and is not an error."}
      </p>
      <ul className="books-list">
        {books.rows.map((entry) => (
          <li key={entry.id} className={`token-check token-check--${entry.status}`}>
            <span className="token-check-mark" aria-hidden="true">{entry.status === "pass" ? "✓" : "✕"}</span>
            <div>
              <strong>{entry.title}</strong>
              <small>{entry.detail}</small>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
