import { FAQ, plain } from "../seoContent";

/** The questions people ask before launching. The same list is published as structured data, so what is shown here is what search engines are told. */
export default function Faq() {
  return (
    <section className="faq" aria-labelledby="faq-title">
      <h2 id="faq-title">Frequently asked questions</h2>
      <div className="faq-list">
        {FAQ.map((item) => (
          <details key={item.q}>
            <summary>{item.q}</summary>
            <p>{plain(item.a)}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
