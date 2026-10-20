// One queue turn: claim a check, keep its lease alive, run it under a hard
// time limit, then close it — final status, or back to the queue with a
// growing delay (attempts are capped by company_checks.max_attempts, enforced
// in claim_company_check).
//
// Usage is counted on a Meter while the run goes, so a run that fails half
// way still records the searches and tokens it already spent.

import type { CheckRow, Queue, Usage } from "./queue.ts";
import { backoffSeconds, isProviderKeyError, isTransient, keyErrorProvider, RunTimeoutError } from "./retry.ts";

export interface Meter {
  searchCalls: number;
  llmInputTokens: number;
  llmOutputTokens: number;
  /** Each model call adds its own price (prompt-cache rates differ per call). */
  llmCostUsd: number;
}

export const newMeter = (): Meter => ({ searchCalls: 0, llmInputTokens: 0, llmOutputTokens: 0, llmCostUsd: 0 });

export interface Outcome {
  status: "awaiting_confirmation" | "ready" | "stealth" | "rejected_public" | "rejected_non_tech" | "no_new_data" | "done";
  patch: Record<string, unknown>;
  /** A bell notification for the check's owner once the result is saved. */
  notify?: { title: string; body: string };
  /** Runs once the result is saved (e.g. propose the company for review). Its failure does not touch the check. */
  after?: () => Promise<void>;
}

export type Execute = (row: CheckRow, meter: Meter) => Promise<Outcome>;

/** A rejected key is retried after this long: whoever fixes it gets a few minutes. */
export const KEY_ERROR_RETRY_SECONDS = 300;

export interface RunnerOptions {
  leaseSeconds: number;
  maxRunMs: number;
  model: string;
  /** Estimated USD of what the meter counted (model calls + searches). */
  cost: (m: Meter) => number;
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
  const meter = newMeter();
  const usage = (): Required<Usage> => ({
    duration_ms: now() - started,
    cost_usd: o.cost(meter),
    search_calls: meter.searchCalls,
    llm_input_tokens: meter.llmInputTokens,
    llm_output_tokens: meter.llmOutputTokens,
  });
  log(`check ${row.id} (${row.phase}) — attempt ${row.attempts}/${row.max_attempts}`);
  let leaseLost = false;
  const beat = setInterval(() => {
    queue.heartbeat(row.id)
      .then((held) => { if (!held) { leaseLost = true; log(`check ${row.id}: lease lost`); } })
      .catch((e) => log(`check ${row.id}: heartbeat failed: ${String(e)}`));
  }, Math.max(5, o.leaseSeconds / 3) * 1000);

  try {
    const out = await withTimeout(execute(row, meter), o.maxRunMs);
    if (leaseLost) { log(`check ${row.id}: finished after losing the lease — result dropped`); return true; }
    const u = usage();
    const ok = await queue.finish(row.id, out.status, { ...out.patch, ...u });
    if (ok) await queue.logRun(row.id, o.model, u);
    if (ok && out.notify) await queue.notify(row.user_id, out.notify.title, out.notify.body, `/checks/${row.id}`);
    if (ok && out.after) await out.after().catch((e) => log(`check ${row.id}: after-step failed: ${String(e)}`));
    log(`check ${row.id}: ${out.status} in ${Math.round(u.duration_ms / 1000)} s, $${u.cost_usd.toFixed(4)}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (leaseLost) return true;
    const u = usage();
    if (isProviderKeyError(err)) {
      // Ours, not the check's: back to the queue, no attempt used.
      log(`CONFIG ${keyErrorProvider(err)} key rejected — check ${row.id} waits ${KEY_ERROR_RETRY_SECONDS} s: ${msg}`);
      await queue.release(row.id, KEY_ERROR_RETRY_SECONDS, `waiting: ${keyErrorProvider(err)} rejected the worker's API key`, u);
    } else if (isTransient(err) && row.attempts < row.max_attempts) {
      const wait = backoffSeconds(row.attempts);
      log(`check ${row.id}: ${msg} — retry in ${wait} s`);
      await queue.retryLater(row.id, wait, msg, u);
    } else {
      log(`check ${row.id}: failed — ${msg}`);
      await queue.finish(row.id, "failed", u, msg);
    }
    if (u.search_calls || u.llm_input_tokens) await queue.logRun(row.id, o.model, u);
  } finally {
    clearInterval(beat);
  }
  return true;
}
