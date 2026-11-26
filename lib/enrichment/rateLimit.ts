/**
 * lib/enrichment/rateLimit.ts — one pause for every company running at once (owner, 2026-11-23, maintenance window: CONCURRENCY 15 with an automatic wait at a rate limit).
 * A provider that answers 429 says "slow down" to the whole account, not to one request: noteRateLimit sets the time before which no call to that provider starts, and waitIfLimited makes
 * every caller wait for it. Without it, fifteen companies each find the limit alone and each waits and retries on its own.
 */
const until = new Map<string, number>();

export function noteRateLimit(provider: string, waitMs: number, now = Date.now()): void {
  until.set(provider, Math.max(until.get(provider) ?? 0, now + waitMs));
}
export function limitedFor(provider: string, now = Date.now()): number {
  return Math.max(0, (until.get(provider) ?? 0) - now);
}
export async function waitIfLimited(provider: string, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<number> {
  let waited = 0;
  for (let ms = limitedFor(provider); ms > 0; ms = limitedFor(provider)) { await sleep(ms); waited += ms; }
  return waited;
}
export const resetRateLimits = () => until.clear();
