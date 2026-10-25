import { HOME } from "../seoContent";

/** Three plain-language steps under the headline, so a first-time visitor knows what is about to happen. The same steps are in the pre-rendered page. */
export default function HowItWorks() {
  return (
    <ol className="how-it-works" aria-label="How a launch works">
      {HOME.steps.map((step, index) => (
        <li key={step.title}>
          <span className="how-it-works-n" aria-hidden="true">{index + 1}</span>
          <div><strong>{step.title}</strong><small>{step.text}</small></div>
        </li>
      ))}
    </ol>
  );
}
