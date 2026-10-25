import { useEffect, useState } from "react";
import { placeholderBadge } from "../launchpad/tokenView";

/**
 * A token's logo when Vestige has one (the creator sets it there), otherwise a coloured mark: the same token always gets the same colour. The image
 * link has already been checked by safeLogoUrl; it is loaded without sending a referrer and falls back to the mark if it fails.
 */
export default function TokenBadge({ assetId, unit, name, size = "md", image = "" }) {
  const { mark, hue } = placeholderBadge({ assetId, unit, name });
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [image]);
  if (image && !failed) {
    return <img className={`token-badge token-badge--${size} token-badge--image`} src={image} alt="" loading={size === "lg" ? "eager" : "lazy"} decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
  }
  return (
    <span className={`token-badge token-badge--${size}`} style={{ background: `linear-gradient(135deg, hsl(${hue} 65% 42%), hsl(${(hue + 40) % 360} 70% 30%))` }} aria-hidden="true">
      {mark}
    </span>
  );
}
