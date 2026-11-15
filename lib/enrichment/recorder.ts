/**
 * lib/enrichment/recorder.ts — record and replay (owner, 2026-11-15, speed). A dry run costs 20–40 minutes and real money; a code fix that touches
 * only what happens AFTER the web and the model have answered should be checked in seconds for nothing.
 *
 *   The web:   every search and page read is already kept per company (searchCache.ts, 30 days). REPLAY=1 turns the network off for everything but the
 *              model: a search or page that is not in the cache comes back empty (and is named), it is never fetched.
 *   The model: every reply is kept by the signature of its request (cache/model/<sha256>.json). REPLAY=1 answers a request that was seen before from the
 *              recording, with zero tokens (so the cost line reads $0); a request that is new (a prompt that changed) goes to the model and is recorded.
 *              REPLAY=strict: a new request is an error instead — a guarantee of $0.
 * Recording is always on. Requests that carry today's date in their text change at midnight, so a replay is best the same day.
 */
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

export const recorderStats = { replayed: 0, live: 0, blockedFetches: new Map<string, number>() };

export const replayMode = (): "off" | "on" | "strict" => (process.env.REPLAY === "strict" ? "strict" : process.env.REPLAY && process.env.REPLAY !== "0" && process.env.REPLAY !== "false" ? "on" : "off");

const dir = () => process.env.MODEL_RECORD_DIR ?? join("cache", "model");
export const requestKey = (params: unknown): string => createHash("sha256").update(JSON.stringify(params)).digest("hex");

/** Wraps `client.messages.create`: answers from the recording when REPLAY is on, records every live reply. */
export function wrapAnthropic<T extends { messages: { create: (...a: any[]) => any } }>(client: T): T {
  const real = client.messages.create.bind(client.messages);
  const mode = replayMode();
  const create = async (params: unknown, options?: unknown) => {
    const key = requestKey(params);
    const file = join(dir(), `${key}.json`);
    if (mode !== "off" && existsSync(file)) {
      try {
        const msg = JSON.parse(readFileSync(file, "utf8"));
        recorderStats.replayed++;
        // No tokens: a replay costs nothing, and the cost line says so.
        return { ...msg, usage: { ...msg.usage, input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } };
      } catch { /* an unreadable recording is a miss */ }
    }
    if (mode === "strict") throw new Error(`REPLAY=strict: a model request that was never recorded (${key.slice(0, 10)}) — a prompt changed. Run once with REPLAY=1.`);
    const msg = await real(params, options);
    recorderStats.live++;
    try { mkdirSync(dir(), { recursive: true }); writeFileSync(file, JSON.stringify(msg)); } catch { /* recording is a convenience */ }
    return msg;
  };
  (client.messages as { create: unknown }).create = create;
  return client;
}

/** With REPLAY on, nothing but the model API is fetched from the network; what is asked of anything else is counted and fails (the callers treat it as an empty answer). */
export function enterOfflineMode(allowedHosts: string[] = ["api.anthropic.com"]): void {
  if (replayMode() === "off") return;
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    let host = ""; try { host = new URL(url).hostname; } catch { /* relative */ }
    if (allowedHosts.some((h) => host === h || host.endsWith(`.${h}`))) return real(input, init);
    recorderStats.blockedFetches.set(host, (recorderStats.blockedFetches.get(host) ?? 0) + 1);
    throw new Error(`offline (REPLAY): ${host} not fetched`);
  }) as typeof fetch;
}

/** A default timeout for every fetch that has none (a dead site must not hold a run: CALL_TIMEOUT_MS, default 30 s). */
export function installFetchTimeout(ms = Number(process.env.CALL_TIMEOUT_MS ?? 30_000)): void {
  const real = globalThis.fetch;
  globalThis.fetch = ((input: any, init?: any) => {
    if (init?.signal) return real(input, init);
    return real(input, { ...(init ?? {}), signal: AbortSignal.timeout(ms) });
  }) as typeof fetch;
}

export function recorderSummary(): string[] {
  const out: string[] = [];
  if (replayMode() !== "off") {
    out.push(`  REPLAY=${replayMode()}: ${recorderStats.replayed} model reply(ies) from the recording, ${recorderStats.live} new (live)`);
    if (recorderStats.blockedFetches.size) out.push(`  not fetched (offline): ${[...recorderStats.blockedFetches].map(([h, n]) => `${h}×${n}`).join(", ")}`);
  } else out.push(`  recorded ${recorderStats.live} model reply(ies) for a later REPLAY=1`);
  return out;
}
