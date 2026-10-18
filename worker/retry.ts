// What to do with a failed run: retry later (transient) or give up (permanent).

export class PermanentError extends Error {
  constructor(message: string) { super(message); this.name = "PermanentError"; }
}

export class RunTimeoutError extends Error {
  constructor(ms: number) { super(`run exceeded ${Math.round(ms / 1000)} s`); this.name = "RunTimeoutError"; }
}

/**
 * A provider rejected one of the WORKER's keys (revoked, wrong, out of
 * credits). Not the check's fault: the check goes back to the queue without
 * using an attempt (release_company_check) and the log says which key.
 */
export class ProviderKeyError extends Error {
  constructor(public provider: string, detail: string) {
    super(`${provider} rejected the worker's API key (${detail})`);
    this.name = "ProviderKeyError";
  }
}

/** ProviderKeyError, or the Anthropic SDK's own 401/403 / no-credit errors. */
export function isProviderKeyError(err: unknown): boolean {
  if (err instanceof ProviderKeyError) return true;
  const status = (err as { status?: unknown } | null)?.status;
  const msg = err instanceof Error ? err.message : String(err);
  if (status === 401 || status === 403) return true;
  return /authentication_error|invalid x-api-key|permission_error|credit balance is too low/i.test(msg);
}

/** Which provider a key error names, for the log line. */
export function keyErrorProvider(err: unknown): string {
  return err instanceof ProviderKeyError ? err.provider : "Anthropic";
}

/** Network trouble, rate limits, provider 5xx, our own timeout: worth another attempt. Bad input or code bugs: not. */
export function isTransient(err: unknown): boolean {
  if (err instanceof PermanentError) return false;
  if (err instanceof RunTimeoutError) return true;
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  return /timeout|timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|fetch failed|socket hang up|network|\b429\b|rate.?limit|overloaded|\b5\d\d\b/i.test(msg);
}

/** 1 min, 4 min, 16 min … capped at 1 h. `attempt` is the attempt that just failed (1-based). */
export function backoffSeconds(attempt: number): number {
  return Math.min(3600, 60 * 4 ** Math.max(0, attempt - 1));
}
