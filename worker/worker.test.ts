import { describe, it, expect, vi } from "vitest";
import { decideGate } from "./gates";
import { isTransient, backoffSeconds, PermanentError, RunTimeoutError, ProviderKeyError, isProviderKeyError } from "./retry";
import { processOne, withTimeout, KEY_ERROR_RETRY_SECONDS, type Outcome, type Meter } from "./runner";
import type { CheckRow, Queue } from "./queue";
import { loadConfig, llmCostUsd, ConfigError } from "./config";

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
    release: vi.fn(async (_id: string, s: number) => { calls.push(`release:${s}`); return true; }),
    logRun: vi.fn(async () => { calls.push("log"); }),
  };
  return { q: q as unknown as Queue, calls, raw: q };
}
const row = (attempts = 1, max = 3): CheckRow => ({
  id: "c1", user_id: "u1", status: "running", phase: "check", attempts, max_attempts: max,
  input: { name: "Acme", website: null, host: null, country: null, founder: null, linkedin: null, sector: null },
});
const ok: Outcome = { status: "ready", patch: { gate: {} } };
// What a real run would have counted: two searches, one LLM call.
const spend = (m: Meter) => { m.searchCalls += 2; m.llmInputTokens += 900; m.llmOutputTokens += 80; };
const opts = { leaseSeconds: 120, maxRunMs: 1000, model: "claude-haiku-4-5-20251001", log: () => {},
  cost: (m: Meter) => llmCostUsd("claude-haiku-4-5-20251001", m.llmInputTokens, m.llmOutputTokens) + m.searchCalls * 0.001 };

describe("processOne", () => {
  it("nothing queued: returns false, touches nothing", async () => {
    const { q, calls } = fakeQueue(null);
    expect(await processOne(q, async () => ok, opts)).toBe(false);
    expect(calls).toEqual([]);
  });
  it("success: final status, then one cost-log row", async () => {
    const { q, calls, raw } = fakeQueue(row());
    await processOne(q, async (_r, m) => { spend(m); return ok; }, opts);
    expect(calls).toEqual(["finish:ready", "log"]);
    expect(raw.finish.mock.calls[0][2]).toMatchObject({ gate: {}, search_calls: 2, llm_input_tokens: 900 });
    expect((raw.finish.mock.calls[0][2] as { cost_usd: number }).cost_usd).toBeCloseTo(0.0033);
  });
  // 2026-10-18: a run that failed after its searches recorded a cost of 0.
  it("a run that fails half way still records what it spent", async () => {
    const { q, calls, raw } = fakeQueue(row(3, 3));
    await processOne(q, async (_r, m) => { m.searchCalls += 2; throw new Error("ECONNRESET"); }, opts);
    expect(calls).toEqual(["finish:failed:ECONNRESET", "log"]);
    expect(raw.finish.mock.calls[0][2]).toMatchObject({ search_calls: 2 });
  });
  // 2026-10-18: two test checks failed on a revoked Anthropic key — our fault, not the check's.
  it("a provider rejecting our key puts the check back without using an attempt", async () => {
    const anthropic401 = Object.assign(new Error('401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}'), { status: 401 });
    for (const err of [anthropic401, new ProviderKeyError("Serper", "HTTP 403")]) {
      const { q, calls, raw } = fakeQueue(row(3, 3));
      const lines: string[] = [];
      await processOne(q, async (_r, m) => { m.searchCalls += 1; throw err; }, { ...opts, log: (l) => lines.push(l) });
      expect(calls).toEqual([`release:${KEY_ERROR_RETRY_SECONDS}`, "log"]);
      expect(raw.release.mock.calls[0][3]).toMatchObject({ search_calls: 1 });
      expect(lines.some((l) => l.startsWith("CONFIG"))).toBe(true);
    }
  });
  it("key errors are told apart from other failures", () => {
    expect(isProviderKeyError(Object.assign(new Error("x"), { status: 403 }))).toBe(true);
    expect(isProviderKeyError(new Error("400 Your credit balance is too low to access the Anthropic API"))).toBe(true);
    expect(isProviderKeyError(new Error("fetch failed"))).toBe(false);
    expect(isProviderKeyError(Object.assign(new Error("overloaded"), { status: 529 }))).toBe(false);
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
    expect(() => loadConfig({})).toThrow(/SERP_KEY/);
    expect(llmCostUsd("claude-haiku-4-5-20251001", 1_000_000, 100_000)).toBeCloseTo(1.5);
  });
  // 2026-10-18: the first Fly deploy crash-looped on SUPABASE_URL copied
  // verbatim from the README ("https://<project>.supabase.co").
  it("rejects values left as the template placeholder, with a one-line reason", () => {
    const ok = { SUPABASE_URL: "https://abcd1234.supabase.co/", SUPABASE_SERVICE_ROLE_KEY: "eyJ.x.y", ANTHROPIC_API_KEY: "sk-ant-x", SERP_KEY: "k" };
    expect(loadConfig(ok).supabaseUrl).toBe("https://abcd1234.supabase.co");
    expect(() => loadConfig({ ...ok, SUPABASE_URL: "https://<project>.supabase.co" })).toThrow(ConfigError);
    expect(() => loadConfig({ ...ok, SUPABASE_URL: "abcd1234.supabase.co" })).toThrow(/project address/);
    expect(() => loadConfig({ ...ok, ANTHROPIC_API_KEY: "..." })).toThrow(/ANTHROPIC_API_KEY still holds the template/);
    expect(() => loadConfig({ ...ok, SERP_KEY: " " })).toThrow(/Missing SERP_KEY/);
  });
});
