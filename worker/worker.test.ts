import { describe, it, expect, vi } from "vitest";
import { decideGate } from "./gates";
import { isTransient, backoffSeconds, PermanentError, RunTimeoutError } from "./retry";
import { processOne, withTimeout, type Outcome } from "./runner";
import type { CheckRow, Queue } from "./queue";
import { loadConfig, llmCostUsd } from "./config";

const ev = (o: Partial<Parameters<typeof decideGate>[0]> = {}) =>
  ({ listing: null, ownPagesChars: 5000, mentions: 6, tech: { is_tech_company: true, confidence: "high" as const, reason: "SaaS" }, ...o });

describe("decideGate", () => {
  it("a listed company is refused, with the quote that proves it", () => {
    const d = decideGate(ev({ listing: { url: "https://pr.example/x", quote: "Acme, Inc. (Nasdaq: ACME)" } }));
    expect(d.status).toBe("rejected_public");
    expect(d.reason).toContain("Nasdaq: ACME");
  });
  it("almost nothing public = stealth, not an error", () => {
    expect(decideGate(ev({ ownPagesChars: 120, mentions: 1 })).status).toBe("stealth");
    expect(decideGate(ev({ ownPagesChars: 120, mentions: 2 })).status).toBe("ready");
  });
  it("non-tech only on a high-confidence verdict", () => {
    expect(decideGate(ev({ tech: { is_tech_company: false, confidence: "high", reason: "a bakery" } })).status).toBe("rejected_non_tech");
    expect(decideGate(ev({ tech: { is_tech_company: false, confidence: "medium", reason: "unclear" } })).status).toBe("ready");
    expect(decideGate(ev({ tech: null })).status).toBe("ready");
  });
  it("public beats everything else", () => {
    expect(decideGate(ev({ listing: { url: "u", quote: "q" }, ownPagesChars: 0, mentions: 0 })).status).toBe("rejected_public");
  });
});

describe("retry policy", () => {
  it("retries network trouble and timeouts, not bad input", () => {
    expect(isTransient(new Error("fetch failed"))).toBe(true);
    expect(isTransient(new Error("Anthropic 529 overloaded"))).toBe(true);
    expect(isTransient(new RunTimeoutError(1000))).toBe(true);
    expect(isTransient(new PermanentError("no name"))).toBe(false);
    expect(isTransient(new TypeError("x is undefined"))).toBe(false);
  });
  it("backs off 1, 4, 16 min, capped at an hour", () => {
    expect([1, 2, 3, 9].map(backoffSeconds)).toEqual([60, 240, 960, 3600]);
  });
});

function fakeQueue(row: CheckRow | null, heartbeatHeld = true) {
  const calls: string[] = [];
  const q = {
    claim: vi.fn(async () => row),
    heartbeat: vi.fn(async () => heartbeatHeld),
    patch: vi.fn(async () => true),
    finish: vi.fn(async (_id: string, status: string, _p: unknown, err?: string | null) => { calls.push(`finish:${status}${err ? `:${err}` : ""}`); return true; }),
    retryLater: vi.fn(async (_id: string, s: number) => { calls.push(`retry:${s}`); return true; }),
    logRun: vi.fn(async () => { calls.push("log"); }),
  };
  return { q: q as unknown as Queue, calls, raw: q };
}
const row = (attempts = 1, max = 3): CheckRow => ({
  id: "c1", user_id: "u1", status: "running", attempts, max_attempts: max,
  input: { name: "Acme", website: null, host: null, country: null, founder: null, linkedin: null, sector: null },
});
const ok: Outcome = { status: "ready", patch: { gate: {} }, usage: { cost_usd: 0.002, search_calls: 2, llm_input_tokens: 900, llm_output_tokens: 80 } };
const opts = { leaseSeconds: 120, maxRunMs: 1000, model: "claude-haiku-4-5-20251001", log: () => {} };

describe("processOne", () => {
  it("nothing queued: returns false, touches nothing", async () => {
    const { q, calls } = fakeQueue(null);
    expect(await processOne(q, async () => ok, opts)).toBe(false);
    expect(calls).toEqual([]);
  });
  it("success: final status, then one cost-log row", async () => {
    const { q, calls, raw } = fakeQueue(row());
    await processOne(q, async () => ok, opts);
    expect(calls).toEqual(["finish:ready", "log"]);
    expect(raw.finish.mock.calls[0][2]).toMatchObject({ gate: {}, cost_usd: 0.002, search_calls: 2 });
  });
  it("transient error: back to the queue with backoff", async () => {
    const { q, calls } = fakeQueue(row(2));
    await processOne(q, async () => { throw new Error("fetch failed"); }, opts);
    expect(calls).toEqual(["retry:240"]);
  });
  it("transient error on the last attempt: failed", async () => {
    const { q, calls } = fakeQueue(row(3, 3));
    await processOne(q, async () => { throw new Error("ECONNRESET"); }, opts);
    expect(calls).toEqual(["finish:failed:ECONNRESET"]);
  });
  it("permanent error: failed at once", async () => {
    const { q, calls } = fakeQueue(row(1));
    await processOne(q, async () => { throw new PermanentError("check has no company name"); }, opts);
    expect(calls).toEqual(["finish:failed:check has no company name"]);
  });
  it("a run past its time limit is abandoned and retried", async () => {
    const { q, calls } = fakeQueue(row(1));
    await processOne(q, () => new Promise(() => {}), { ...opts, maxRunMs: 30 });
    expect(calls).toEqual(["retry:60"]);
  });
  it("a run that lost its lease writes nothing", async () => {
    vi.useFakeTimers();
    const { q, calls } = fakeQueue(row(1), false);
    const p = processOne(q, () => new Promise((r) => setTimeout(() => r(ok), 120_000)), { ...opts, leaseSeconds: 15, maxRunMs: 300_000 });
    await vi.advanceTimersByTimeAsync(121_000);
    await p;
    vi.useRealTimers();
    expect(calls).toEqual([]);
  });
});

describe("withTimeout / config", () => {
  it("passes a fast result through", async () => {
    expect(await withTimeout(Promise.resolve(5), 1000)).toBe(5);
  });
  it("refuses to start without its secrets, and prices like v2", () => {
    expect(() => loadConfig({})).toThrow(/SUPABASE_URL/);
    expect(llmCostUsd("claude-haiku-4-5-20251001", 1_000_000, 100_000)).toBeCloseTo(1.5);
  });
});
