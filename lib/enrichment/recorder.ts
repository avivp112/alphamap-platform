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
import { gzipSync, gunzipSync } from "zlib";
import { currentCompany } from "./companyLog.ts";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

export const recorderStats = {
  replayed: 0, live: 0, blockedFetches: new Map<string, number>(),
  httpRecorded: 0, httpReplayed: 0, filled: 0,
  /** company → host → count: a request that REPLAY needed and the recordings did not have. */
  misses: new Map<string, Map<string, number>>(),
  /** the model steps asked live in a REPLAY: step → count */
  liveSteps: new Map<string, number>(),
};

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
    if (mode !== "off") {
      const step = (params as { tools?: Array<{ name?: string }> })?.tools?.[0]?.name ?? "(no tool)";
      recorderStats.liveSteps.set(step, (recorderStats.liveSteps.get(step) ?? 0) + 1);
      console.log(`    🧠  REPLAY: a live model call for the step "${step}" — its request is new (${currentCompany()}).`);
    }
    const msg = await real(params, options);
    recorderStats.live++;
    try { mkdirSync(dir(), { recursive: true }); writeFileSync(file, JSON.stringify(msg)); } catch { /* recording is a convenience */ }
    return msg;
  };
  (client.messages as { create: unknown }).create = create;
  return client;
}

const httpDir = () => process.env.HTTP_RECORD_DIR ?? join("cache", "http");
const SKIP_HOSTS = ["api.anthropic.com", "supabase.co", "supabase.in"];
const skipped = (host: string) => SKIP_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
const MAX_RECORDED_BYTES = 4_000_000;

/**
 * Records every web response of a live run (searches, page reads, archive, registers) by the signature of its request, and with REPLAY on answers
 * from those recordings and fetches nothing: a request that was never recorded is a MISS, counted against the company that made it (owner, 2026-11-15:
 * the search cache alone left holes — hydrostor.ca, web.archive.org, r.jina.ai — and a replay lost values that a live run finds).
 * The model API and the database are not recorded here (the model has its own recording; the database is read live).
 */
export function installHttpRecorder(): void {
  const real = globalThis.fetch;
  const mode = replayMode();
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    let host = ""; try { host = new URL(url).hostname; } catch { /* relative */ }
    if (skipped(host)) return real(input, init);
    const method = (init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();
    const body = typeof init?.body === "string" ? init.body : "";
    const key = createHash("sha256").update(`${method}|${url}|${body}`).digest("hex");
    const file = join(httpDir(), `${key}.json.gz`);
    if (mode !== "off") {
      if (existsSync(file)) {
        try {
          const rec = JSON.parse(gunzipSync(readFileSync(file)).toString("utf8")) as { status?: number; type?: string; finalUrl?: string; body?: string; error?: string };
          recorderStats.httpReplayed++;
          if (rec.error) throw new Error(rec.error);
          const resp = new Response(Buffer.from(rec.body ?? "", "base64"), { status: rec.status ?? 200, headers: rec.type ? { "content-type": rec.type } : {} });
          Object.defineProperty(resp, "url", { value: rec.finalUrl ?? url });
          return resp;
        } catch (e) { if (e instanceof Error && !/Unexpected token|JSON/.test(e.message)) throw e; }
      }
      // REPLAY_FILL=1 (the one-time "complete the recordings" run of the regression gate): what the recordings do not have is fetched live and recorded; what they have is replayed.
      if (process.env.REPLAY_FILL === "1") { recorderStats.filled++; return fetchLive(); }
      const company = currentCompany();
      const m = recorderStats.misses.get(company) ?? new Map<string, number>();
      m.set(host, (m.get(host) ?? 0) + 1); recorderStats.misses.set(company, m);
      throw new Error(`offline (REPLAY): ${host} not fetched`);
    }
    return fetchLive();
    async function fetchLive(): Promise<Response> {
    // Live: record the answer (or the failure) and hand the answer on.
    const save = (rec: unknown) => { try { mkdirSync(httpDir(), { recursive: true }); writeFileSync(file, gzipSync(Buffer.from(JSON.stringify(rec)))); recorderStats.httpRecorded++; } catch { /* a convenience */ } };
    try {
      const res = await real(input, init);
      try {
        const buf = Buffer.from(await res.clone().arrayBuffer());
        if (buf.length <= MAX_RECORDED_BYTES) save({ status: res.status, type: res.headers.get("content-type") ?? undefined, finalUrl: res.url || undefined, body: buf.toString("base64") });
      } catch { /* a body that cannot be read twice is not recorded */ }
      return res;
    } catch (e) { save({ error: `${e instanceof Error ? e.message : String(e)}${(e as { cause?: { code?: string } })?.cause?.code ? ` (${(e as { cause?: { code?: string } }).cause!.code})` : ""}` }); throw e; }
    }
  }) as typeof fetch;
}

/** With REPLAY on, the lines "offline (REPLAY)" are not printed one by one; the run's summary names what was missing, per company. */
export function quietOffline(): void {
  if (replayMode() === "off") return;
  for (const k of ["log", "warn", "error"] as const) {
    const real = console[k].bind(console);
    console[k] = ((...args: unknown[]) => { if (args.some((a) => typeof a === "string" && a.includes("offline (REPLAY)"))) return; real(...args); }) as never;
  }
}

/** Kept for callers that only want the network shut: the same as installHttpRecorder in REPLAY mode. */
export function enterOfflineMode(): void { installHttpRecorder(); quietOffline(); }

/** A default timeout for every fetch that has none (a dead site must not hold a run: CALL_TIMEOUT_MS, default 30 s). */
// ── The pace of a many-company run (owner, batch 7: CONCURRENCY=10, the delay kept per domain) ──
// Requests to ONE site (the company's own pages, an archive, a newspaper) start at least DOMAIN_DELAY_MS apart, however many companies run at once; a page read through the
// reader (r.jina.ai/<address>) counts for the address' site. The search and model providers have no per-site pace but at most PROVIDER_CONCURRENCY calls in flight together.
const PROVIDER_HOSTS = new Set(["google.serper.dev", "scrape.serper.dev", "api.tavily.com", "s.jina.ai", "api.anthropic.com", "r.jina.ai"]);
const registrable = (h: string) => { const p = h.split("."); return p.slice(-(/\.(co|com|org|net|gov|ac)\.[a-z]{2}$/.test(h) ? 3 : 2)).join("."); };
export function paceKey(input: unknown): { kind: "provider" | "site"; key: string } | null {
  let u: URL;
  try { u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : (input as { url?: string })?.url ?? ""); } catch { return null; }
  const host = u.hostname.toLowerCase();
  if (host === "r.jina.ai") {
    const target = u.pathname.replace(/^\//, "") + u.search;
    try { return { kind: "site", key: registrable(new URL(/^https?:/i.test(target) ? target : `https://${target}`).hostname.toLowerCase()) }; } catch { return { kind: "provider", key: host }; }
  }
  if (PROVIDER_HOSTS.has(host)) return { kind: "provider", key: host };
  return { kind: "site", key: registrable(host) };
}
const nextStart = new Map<string, number>();
let inFlight = 0; const waiting: Array<() => void> = [];
const sleepMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function pace(input: unknown): Promise<() => void> {
  const gapMs = Number(process.env.DOMAIN_DELAY_MS ?? (Number(process.env.CONCURRENCY ?? 1) > 1 ? 1500 : 0));
  const limit = Math.max(1, Number(process.env.PROVIDER_CONCURRENCY ?? 20));
  const k = paceKey(input);
  if (!k || (gapMs <= 0 && Number(process.env.CONCURRENCY ?? 1) <= 1)) return () => {};
  if (k.kind === "site") {
    const now = Date.now(); const at = Math.max(now, nextStart.get(k.key) ?? 0);
    nextStart.set(k.key, at + gapMs);
    if (at > now) await sleepMs(at - now);
    return () => {};
  }
  if (inFlight >= limit) await new Promise<void>((r) => waiting.push(r));
  inFlight++;
  return () => { inFlight--; waiting.shift()?.(); };
}

export function installFetchTimeout(ms = Number(process.env.CALL_TIMEOUT_MS ?? 30_000)): void {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const done = await pace(input);
    try {
      if (init?.signal) return await real(input, init);
      return await real(input, { ...(init ?? {}), signal: AbortSignal.timeout(ms) });
    } finally { done(); }
  }) as typeof fetch;
}

export function recorderSummary(): string[] {
  const out: string[] = [];
  if (replayMode() !== "off") {
    out.push(`  REPLAY=${replayMode()}: ${recorderStats.replayed} model reply(ies) from the recording, ${recorderStats.live} new (live); ${recorderStats.httpReplayed} web response(s) from the recording`);
    if (recorderStats.filled) out.push(`  REPLAY_FILL: ${recorderStats.filled} web request(s) the recordings lacked were fetched live and recorded`);
    if (recorderStats.liveSteps.size) out.push(`  live model steps: ${[...recorderStats.liveSteps].map(([k, n]) => `${k}×${n}`).join(", ")}`);
    if (recorderStats.misses.size) {
      out.push(`  ⚠️ REPLAY CACHE MISSES — not a faithful replay for these companies (a live run records what is missing):`);
      for (const [c, m] of recorderStats.misses) out.push(`  REPLAY MISS ${c}: ${[...m].map(([h, n]) => `${h}×${n}`).join(", ")}`);
    } else out.push("  no REPLAY cache misses: every web response came from the recordings");
  } else out.push(`  recorded ${recorderStats.live} model reply(ies) and ${recorderStats.httpRecorded} web response(s) for a later REPLAY=1`);
  return out;
}
