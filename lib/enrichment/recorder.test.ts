import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { wrapAnthropic, requestKey, recorderStats, enterOfflineMode } from "./recorder.ts";
import { gathered, installCompanyLog } from "./companyLog.ts";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "rec-")); process.env.MODEL_RECORD_DIR = dir; recorderStats.replayed = 0; recorderStats.live = 0; recorderStats.blockedFetches.clear(); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); delete process.env.MODEL_RECORD_DIR; delete process.env.REPLAY; vi.unstubAllGlobals(); });

const fake = () => {
  const calls: unknown[] = [];
  return { calls, messages: { create: async (p: unknown) => { calls.push(p); return { id: "m1", content: [{ type: "tool_use", input: { ok: true } }], usage: { input_tokens: 100, output_tokens: 20 } }; } } };
};

describe("record and replay of the model (owner, 2026-11-15)", () => {
  it("records every live reply, and with REPLAY=1 answers the same request from the recording for zero tokens", async () => {
    const c1 = wrapAnthropic(fake());
    const params = { model: "m", messages: [{ role: "user", content: "hello" }] };
    const first = await c1.messages.create(params);
    expect(first.usage.input_tokens).toBe(100);
    expect(recorderStats.live).toBe(1);
    process.env.REPLAY = "1";
    const c2 = fake(); const w = wrapAnthropic(c2);
    const again = await w.messages.create(params);
    expect(c2.calls).toHaveLength(0);                  // the model was not asked
    expect(again.usage.input_tokens).toBe(0);          // and it costs nothing
    expect(again.content[0].input).toEqual({ ok: true });
    expect(recorderStats.replayed).toBe(1);
  });
  it("a request that changed goes live and is recorded; REPLAY=strict refuses it", async () => {
    await wrapAnthropic(fake()).messages.create({ model: "m", messages: [{ role: "user", content: "v1" }] });
    process.env.REPLAY = "1";
    const c = fake(); const w = wrapAnthropic(c);
    await w.messages.create({ model: "m", messages: [{ role: "user", content: "v2" }] });
    expect(c.calls).toHaveLength(1);
    process.env.REPLAY = "strict";
    await expect(wrapAnthropic(fake()).messages.create({ model: "m", messages: [{ role: "user", content: "v3" }] })).rejects.toThrow(/never recorded/);
  });
  it("the key is the request's signature", () => {
    expect(requestKey({ a: 1 })).toBe(requestKey({ a: 1 }));
    expect(requestKey({ a: 1 })).not.toBe(requestKey({ a: 2 }));
  });
  it("offline: anything but the model API is not fetched, and is counted", async () => {
    process.env.REPLAY = "1";
    const real = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", real);
    enterOfflineMode();
    await expect(fetch("https://r.jina.ai/https://acme.com")).rejects.toThrow(/offline/);
    await fetch("https://api.anthropic.com/v1/messages");
    expect(real).toHaveBeenCalledTimes(1);
    expect(recorderStats.blockedFetches.get("r.jina.ai")).toBe(1);
  });
});

describe("a company's log is one block (CONCURRENCY>1)", () => {
  it("lines of companies running at once do not mix", async () => {
    installCompanyLog();
    const job = (name: string, ms: number) => async () => { console.log(`${name} 1`); await new Promise((r) => setTimeout(r, ms)); console.log(`${name} 2`); return name; };
    const [a, b] = await Promise.all([gathered(job("A", 30)), gathered(job("B", 5))]);
    expect(a.lines).toEqual(["A 1", "A 2"]);
    expect(b.lines).toEqual(["B 1", "B 2"]);
    expect(a.result).toBe("A");
  });
  it("an error is returned with the lines so far", async () => {
    const r = await gathered(async () => { console.log("before"); throw new Error("boom"); });
    expect(r.lines).toEqual(["before"]);
    expect(String(r.error)).toMatch(/boom/);
  });
});
