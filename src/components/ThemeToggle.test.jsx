import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./TradeToasts", () => ({ AlertsToggle: () => null }));
import { ThemeToggle } from "./TermsFooter";
import { setTheme } from "../launchpad/themePrefs";

afterEach(() => {
  setTheme("auto");
  document.head.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.remove());
});

describe("ThemeToggle", () => {
  it("follows the system by default and pins dark or light when chosen, remembering the choice", () => {
    for (const colour of ["#08071a", "#f3f6fb"]) {
      const meta = document.createElement("meta");
      meta.name = "theme-color";
      meta.content = colour;
      document.head.appendChild(meta);
    }
    render(<ThemeToggle />);
    const group = screen.getByRole("group", { name: /colour theme/i });
    expect(screen.getByRole("button", { name: "auto" })).toHaveAttribute("aria-pressed", "true");
    expect(document.documentElement).not.toHaveAttribute("data-theme");

    fireEvent.click(screen.getByRole("button", { name: "light" }));
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(window.localStorage.getItem("pnet-launchlab:theme")).toBe("light");
    expect(screen.getByRole("button", { name: "light" })).toHaveAttribute("aria-pressed", "true");
    expect([...document.querySelectorAll('meta[name="theme-color"]')].map((meta) => meta.content)).toEqual(["#f3f6fb", "#f3f6fb"]);

    fireEvent.click(screen.getByRole("button", { name: "dark" }));
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");

    fireEvent.click(screen.getByRole("button", { name: "auto" }));
    expect(document.documentElement).not.toHaveAttribute("data-theme");
    expect(window.localStorage.getItem("pnet-launchlab:theme")).toBeNull();
    expect(group).toBeInTheDocument();
  });
});
