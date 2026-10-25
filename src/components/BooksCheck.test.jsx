import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import BooksCheck from "./BooksCheck";
import { reconcileBooks } from "../launchpad/reconcile";

const books = (overrides = {}) => reconcileBooks({
  pnetAssetId: 100n, holdings: new Map([[100n, 57n], [10n, 1000n]]), algo: { amount: 1_000_000n, minBalance: 500_000n },
  globals: { reserved: 50n, platpnet: 7n },
  pending: [{ assetId: 10n, totalRaw: 1000n, pnetOutput: 50n }],
  launches: [{ assetId: 30n, status: 3n, lpAssetId: 0n, creatorLp: 0n, creatorLpClaimed: 0n, cancelPlatformPnetRemaining: 7n }],
  allocations: [{ launchAssetId: 30n, holdingAssetId: 30n, remaining: 0n, kind: 1n }].filter((entry) => entry.remaining > 0n),
  ...overrides,
});

describe("BooksCheck", () => {
  it("shows a line per check and a calm summary when the books match", () => {
    const { container } = render(<BooksCheck books={books()} />);
    expect(screen.getByText(/matches its own records/)).toBeInTheDocument();
    expect(container.querySelectorAll(".token-check--pass")).toHaveLength(10);
    expect(container.querySelector(".token-check--fail")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("raises an alert and marks exactly the failing checks when something is missing", () => {
    const { container } = render(<BooksCheck books={books({ holdings: new Map([[100n, 56n], [10n, 1000n]]) })} />);
    expect(screen.getByRole("alert")).toHaveTextContent("1 check failed");
    expect(container.querySelectorAll(".token-check--fail")).toHaveLength(1);
    expect(screen.getByText(/PNET held covers everything owed/)).toBeInTheDocument();
    expect(screen.getByText(/holds 56 but owes 57: 1 missing/)).toBeInTheDocument();
  });

  it("renders nothing without data", () => {
    const { container } = render(<BooksCheck books={null} />);
    expect(container.firstChild).toBeNull();
  });
});
