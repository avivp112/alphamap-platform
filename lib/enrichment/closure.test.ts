import { describe, it, expect } from "vitest";
import { closureIn, detectClosure } from "./closure";

describe("a company that closed (owner, batch 6)", () => {
  it("the company is the one that shuts down", () => {
    expect(closureIn("Okra shuts down after failing to raise funding", "Okra")).toBe(true);
    expect(closureIn("Nigerian fintech Okra ceases operations", "Okra")).toBe(true);
    expect(closureIn("Okra is winding down", "Okra")).toBe(true);
    expect(closureIn("Okra closes its doors", "Okra")).toBe(true);
    expect(closureIn("Okra encerra atividades no Brasil", "Okra")).toBe(true);
    expect(closureIn("Okra zamyka działalność", "Okra")).toBe(true);
  });
  it("a closed thing, a partner or a plain mention is not a closure", () => {
    expect(closureIn("Okra shuts down the legacy API", "Okra")).toBe(false);
    expect(closureIn("Acme shuts down; Okra raises $10M", "Okra")).toBe(false);
    expect(closureIn("Okra launches a new product", "Okra")).toBe(false);
  });
  it("the newest dated headline wins, with its source", () => {
    const c = detectClosure([{ url: "u1", title: "Okra shuts down", date: "2025-05-01" }, { url: "u2", title: "Okra ceases operations", date: "2025-06-01" }], "Okra");
    expect(c).toEqual({ quote: "Okra ceases operations", url: "u2", date: "2025-06-01" });
  });
});
