// One queue turn: claim a check, keep its lease alive, run it under a hard
// time limit, then close it — final status, or back to the queue with a
// growing delay (attempts are capped by company_checks.max_attempts, enforced
// in claim_company_check).

import type { CheckRow, Queue, Usage } from "./queue.ts";
import { backoffSeconds, isTransient, RunTimeoutError } from "./retry.ts";

export interface Outcome {
  status: "ready" | "stealth" | "rejected_public" | "rejected_non_tech" | "done";
  patch: Record<string, unknown>;
  usage: Required<Omit<Usage, "duration_ms">>;
}

export type Execute = (row: CheckRow) => Promise<Outcome>;

export interface RunnerOptions {
  leaseSeconds: number;
  maxRunMs: number;
  model: string;
  log?: (msg: string) => void;
  now?: () => number;
}

/** Resolves with the job, or rejects with RunTimeoutError after `ms`. */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise<T>((_, reject) => { t = setTimeout(() => reject(new RunTimeoutError(ms)), ms); }),
  ]);
}

/** Returns false when there was nothing to do. */
export async function processOne(queue: Queue, execute: Execute, o: RunnerOptions): Promise<boolean> {
  const log = o.log ?? ((m: string) => console.log(`[worker] ${m}`));
  const now = o.now ?? Date.now;
  const row = await queue.claim();
  if (!row) return false;

  const started = now();
  log(`check ${row.id} — attempt ${row.attempts}/${row.max_attempts}`);
  let leaseLost = false;
  const beat = setInterval(() => {
    queue.heartbeat(row.id)
      .then((held) => { if (!held) { leaseLost = true; log(`check ${row.id}: lease lost`); } })
      .catch((e) => log(`check ${row.id}: heartbeat failed: ${String(e)}`));
  }, Math.max(5, o.leaseSeconds / 3) * 1000);

  try {
    const out = await withTimeout(execute(row), o.maxRunMs);
    if (leaseLost) { log(`check ${row.id}: finished after losing the lease — result dropped`); return true; }
    const usage = { ...out.usage, duration_ms: now() - started };
    const ok = await queue.finish(row.id, out.status, { ...out.patch, ...usage });
    if (ok) await queue.logRun(row.id, o.model, usage);
    log(`check ${row.id}: ${out.status} in ${Math.round(usage.duration_ms / 1000)} s, $${usage.cost_usd.toFixed(4)}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const usage = { duration_ms: now() - started };
    if (leaseLost) return true;
    if (isTransient(err) && row.attempts < row.max_attempts) {
      const wait = backoffSeconds(row.attempts);
      log(`check ${row.id}: ${msg} — retry in ${wait} s`);
      await queue.retryLater(row.id, wait, msg, usage);
    } else {
      log(`check ${row.id}: failed — ${msg}`);
      await queue.finish(row.id, "failed", usage, msg);
    }
  } finally {
    clearInterval(beat);
  }
  return true;
}
