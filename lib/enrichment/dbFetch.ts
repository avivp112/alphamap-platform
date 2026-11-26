/**
 * lib/enrichment/dbFetch.ts — a fetch for the database client that tries a network failure again (owner, 2026-11-21: batch 9's write lost 156 values to "fetch failed" — a failed write is only a warning
 * in the writer, and the check after the write then undid the whole run).
 *   GET / HEAD / PATCH / PUT / DELETE: again on a thrown network error and on 502 / 503 / 504 — setting a value twice, or reading twice, changes nothing.
 *   POST (an insert): again only when the connection was never made (a failure of the name lookup, a refused or timed-out connect) — an insert that may have reached the server is never repeated.
 * Waits 1, 3 and 8 seconds between the four tries.
 */
const CONNECT_ONLY = new Set(["EAI_AGAIN", "ENOTFOUND", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT", "ENETUNREACH", "EHOSTUNREACH"]);
const codeOf = (e: unknown): string => { const x = e as { code?: string; cause?: { code?: string } }; return x?.cause?.code ?? x?.code ?? ""; };

export function retryingFetch(real: typeof fetch = (...a) => globalThis.fetch(...a), waits: number[] = [1_000, 3_000, 8_000], sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const method = (init?.method ?? (typeof input === "object" && input && "method" in input ? (input as Request).method : "GET")).toUpperCase();
    const idempotent = method !== "POST";
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await real(input, init);
        if (idempotent && [502, 503, 504].includes(res.status) && attempt < waits.length) { await sleep(waits[attempt]); continue; }
        return res;
      } catch (e) {
        if (attempt >= waits.length || (!idempotent && !CONNECT_ONLY.has(codeOf(e)))) throw e;
        console.log(`    ⚠️  database ${method}: ${(e as Error).message}${codeOf(e) ? ` (${codeOf(e)})` : ""} — trying again in ${waits[attempt] / 1000} s (${attempt + 1}/${waits.length})`);
        await sleep(waits[attempt]);
      }
    }
  }) as typeof fetch;
}
