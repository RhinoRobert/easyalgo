import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../hooks/useAlgorand", () => ({ IS_MAINNET: true }));
import HowItWorks from "./HowItWorks";
import LaunchSuccess from "./LaunchSuccess";
import { CardSkeletons, EmptyState, TokenSkeleton } from "./Placeholders";

describe("HowItWorks", () => {
  it("explains the launch in three plain steps", () => {
    render(<HowItWorks />);
    const steps = screen.getByRole("list", { name: /how a launch works/i }).querySelectorAll("li");
    expect(steps).toHaveLength(3);
    expect(steps[1]).toHaveTextContent("Approve twice in Pera");
  });
});

describe("LaunchSuccess", () => {
  it("says the token is live and offers the three next steps", () => {
    render(<LaunchSuccess name="Moon Cat" unit="MCAT" assetId={3753721447n} burnedPct={80} pageUrl="https://easyalgo.org/" />);
    expect(screen.getByRole("status")).toHaveTextContent("Moon Cat is live");
    expect(screen.getByRole("status")).toHaveTextContent("80% of the liquidity is burned");
    expect(screen.getByRole("link", { name: "Open token page" })).toHaveAttribute("href", "#token/3753721447");
    expect(screen.getByRole("link", { name: /trade on vestige/i })).toHaveAttribute("href", "https://vestige.fi/asset/3753721447");
    const share = screen.getByRole("link", { name: /share on x/i });
    expect(share.getAttribute("href")).toContain("https://x.com/intent/post?");
    expect(share.getAttribute("rel")).toMatch(/noopener/);
  });

  it("does not claim a burn it cannot show", () => {
    render(<LaunchSuccess name="" unit="" assetId={5n} burnedPct={null} pageUrl="https://easyalgo.org/" />);
    expect(screen.getByRole("status")).toHaveTextContent("Your token is live");
    expect(screen.getByRole("status")).not.toHaveTextContent(/burned/);
  });
});

describe("placeholders", () => {
  it("shows skeleton cards that screen readers treat as one busy list", () => {
    const { container } = render(<CardSkeletons count={4} />);
    expect(container.querySelectorAll(".launch-card--skeleton")).toHaveLength(4);
    expect(screen.getByRole("list", { name: /loading launches/i })).toHaveAttribute("aria-busy", "true");
  });

  it("has a token skeleton and an empty state with one clear next step", () => {
    const { container, rerender } = render(<TokenSkeleton />);
    expect(container.querySelectorAll(".skeleton").length).toBeGreaterThan(3);
    rerender(<EmptyState title="No launches yet." text="Launching takes two approvals." href="#launch" cta="Launch a token" />);
    expect(screen.getByText("No launches yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Launch a token" })).toHaveAttribute("href", "#launch");
  });
});
