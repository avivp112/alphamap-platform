import { describe, it, expect, beforeEach } from "vitest";
import { noteRateLimit, limitedFor, waitIfLimited, resetRateLimits } from "./rateLimit.ts";

describe("rateLimit", () => {
  beforeEach(() => resetRateLimits());
  it("a provider that said 429 is limited for everyone until the time it named", () => {
    noteRateLimit("serper", 10_000, 1_000);
    expect(limitedFor("serper", 1_000)).toBe(10_000);
    expect(limitedFor("serper", 6_000)).toBe(5_000);
    expect(limitedFor("serper", 11_000)).toBe(0);
    expect(limitedFor("jina", 1_000)).toBe(0);
  });
  it("a longer wait stands, a shorter one does not shorten it", () => {
    noteRateLimit("serper", 20_000, 0); noteRateLimit("serper", 5_000, 0);
    expect(limitedFor("serper", 0)).toBe(20_000);
  });
  it("waitIfLimited waits until the limit is over, and not at all when there is none", async () => {
    expect(await waitIfLimited("serper", async () => { throw new Error("must not sleep"); })).toBe(0);
    noteRateLimit("serper", 50);
    const slept: number[] = [];
    const waited = await waitIfLimited("serper", (ms) => new Promise((r) => { slept.push(ms); setTimeout(r, ms + 5); }));
    expect(waited).toBeGreaterThan(0); expect(slept.length).toBeGreaterThan(0); expect(limitedFor("serper")).toBe(0);
  });
});
