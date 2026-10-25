import { placeholderBadge } from "../launchpad/tokenView";

/** A coloured mark for a token that has no logo of its own: the same token always gets the same colour. */
export default function TokenBadge({ assetId, unit, name, size = "md" }) {
  const { mark, hue } = placeholderBadge({ assetId, unit, name });
  return (
    <span className={`token-badge token-badge--${size}`} style={{ background: `linear-gradient(135deg, hsl(${hue} 65% 42%), hsl(${(hue + 40) % 360} 70% 30%))` }} aria-hidden="true">
      {mark}
    </span>
  );
}
