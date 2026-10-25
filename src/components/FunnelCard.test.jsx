import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import FunnelCard from "./FunnelCard";
import { summarizeFunnel } from "../launchpad/funnel";

const funnel = summarizeFunnel({
  round: 1_000_000n,
  launches: [
    { launcher: "A", status: 2n, createdRound: 999_900n, swapRound: 999_900n, terminalRound: 999_910n },
    { launcher: "B", status: 3n, createdRound: 999_800n, swapRound: 999_800n, terminalRound: 999_900n },
  ],
  pending: [],
});

describe("FunnelCard", () => {
  it("shows the funnel numbers and a bar per day", () => {
    const { container } = render(<FunnelCard funnel={funnel} />);
    const card = screen.getByRole("region", { name: /launch funnel/i });
    expect(card).toHaveTextContent("Started2");
    expect(card).toHaveTextContent("Finished1");
    expect(card).toHaveTextContent("Cancelled1");
    expect(card).toHaveTextContent("Finish rate50%");
    expect(card).toHaveTextContent("Between approvals28 s");
    expect(container.querySelectorAll(".funnel-days li")).toHaveLength(7);
    expect(screen.getByText("today")).toBeInTheDocument();
    expect(card).toHaveTextContent(/Nothing about visitors is tracked/);
  });

  it("copes with no launches and with no data", () => {
    const empty = summarizeFunnel({ round: 5n, launches: [], pending: [] });
    const { container, rerender } = render(<FunnelCard funnel={empty} />);
    expect(screen.getByRole("region", { name: /launch funnel/i })).toHaveTextContent("Finish raten/a");
    rerender(<FunnelCard funnel={null} />);
    expect(container.firstChild).toBeNull();
  });
});
