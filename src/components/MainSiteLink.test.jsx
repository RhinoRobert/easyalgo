import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import MainSiteLink, { MAIN_SITE_URL } from "./MainSiteLink";

describe("MainSiteLink", () => {
  it("is a plain, followed link to the main website that still passes the referrer", () => {
    render(<MainSiteLink />);
    const link = screen.getByRole("link", { name: /main website/i });
    expect(link).toHaveAttribute("href", "https://www.testedprofit.com/");
    expect(MAIN_SITE_URL).toBe("https://www.testedprofit.com/");
    const rel = link.getAttribute("rel").split(/\s+/);
    expect(rel).toContain("noopener");
    expect(rel).not.toContain("nofollow");   // a followed link is what makes it a real backlink
    expect(rel).not.toContain("noreferrer"); // the main site should see visits coming from here
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("can carry the brand name as its text", () => {
    render(<MainSiteLink>TestedProfit</MainSiteLink>);
    expect(screen.getByRole("link", { name: /testedprofit/i })).toHaveAttribute("href", MAIN_SITE_URL);
  });
});