import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../hooks/useAlgorand", () => ({ IS_MAINNET: true }));
import NextSteps from "./NextSteps";

const base = { name: "Moon Cat", unit: "MCAT", assetId: 3753721447n, burnedPct: 80, pageUrl: "https://easyalgo.org/", vestigeGranted: true, creatorLpClaimed: false };

describe("NextSteps", () => {
  it("ticks off what the chain confirms and leaves the rest as links", () => {
    render(<NextSteps {...base} hasLogo creatorLpClaimed />);
    const card = screen.getByRole("region", { name: /next steps/i });
    expect(card).toHaveTextContent("Your token is live (done)");
    expect(card).toHaveTextContent("Add a logo and description (done)");
    expect(card).toHaveTextContent("Claim your 10% of the liquidity tokens (optional) (done)");
    expect(within(card).getByRole("link", { name: /share on x/i })).toHaveAttribute("rel", "noopener noreferrer");
    expect(within(card).getByRole("link", { name: /open the token page/i })).toHaveAttribute("href", "#token/3753721447");
  });

  it("asks for a logo when there is none, and for Vestige access first when it was not granted", () => {
    const { rerender } = render(<NextSteps {...base} hasLogo={false} />);
    let card = screen.getByRole("region", { name: /next steps/i });
    expect(card).not.toHaveTextContent("Add a logo and description (done)");
    expect(within(card).getByRole("link", { name: /edit on vestige/i })).toHaveAttribute("href", "https://vestige.fi/asset-manager/3753721447");
    rerender(<NextSteps {...base} vestigeGranted={false} hasLogo={null} />);
    card = screen.getByRole("region", { name: /next steps/i });
    expect(card).toHaveTextContent("First press Grant Vestige access in My launches");
    expect(within(card).queryByRole("link", { name: /edit on vestige/i })).toBeNull();
  });

  it("leaves out the reply step on the token page itself, where the thread is right there, and does not repeat the page's own Edit on Vestige button", () => {
    render(<NextSteps {...base} onTokenPage />);
    expect(screen.queryByText("Say hello in the replies")).toBeNull();
    expect(screen.queryByRole("link", { name: /^edit on vestige/i })).toBeNull();
    expect(screen.getByRole("link", { name: /vestige editor/i })).toHaveAttribute("href", "https://vestige.fi/asset-manager/3753721447");
  });
});
