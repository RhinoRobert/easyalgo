const STEPS = [
  { title: "Name your token", text: "Pick a name, a ticker and a supply. Nothing is sent until you press Launch." },
  { title: "Approve twice in Pera", text: "The first approval creates the token, the second opens its trading pool." },
  { title: "Trade straight away", text: "It is live on Tinyman and Vestige, and most of its liquidity is burned for good." },
];

/** Three plain-language steps under the headline, so a first-time visitor knows what is about to happen. */
export default function HowItWorks() {
  return (
    <ol className="how-it-works" aria-label="How a launch works">
      {STEPS.map((step, index) => (
        <li key={step.title}>
          <span className="how-it-works-n" aria-hidden="true">{index + 1}</span>
          <div><strong>{step.title}</strong><small>{step.text}</small></div>
        </li>
      ))}
    </ol>
  );
}
