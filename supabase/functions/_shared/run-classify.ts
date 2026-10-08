// =============================================================================
// _shared/run-classify.ts
//
// Turns one Edge Function response into a source_runs row: status, rows that
// came in, and the error in plain words. Pure (no Deno, no network) so the
// rules are unit-tested in vitest (run-classify.test.ts).
//
//   error    — HTTP status >= 400, a body with `error`, or every item of the
//              run failed (results[].ok === false with nothing written).
//   partial  — rows came in, but some items failed.
//   empty    — the call worked and wrote nothing (`note` says why). Normal
//              now and then (no Form D filings on a Sunday); a source that is
//              empty for days is caught by the health check, not here.
//   dry_run  — a manual dryRun / synthetic call; never counted as a run.
//   ok       — rows came in.
// =============================================================================

export type RunStatus = "ok" | "empty" | "partial" | "error" | "dry_run";

export interface RunOutcome {
  status: RunStatus;
  rows_in: number;
  error: string | null;
  http_status: number;
  /** The response body with long arrays cut to their length, for the run log. */
  detail: Record<string, unknown>;
}

export type RowCounter = (body: Record<string, unknown>) => number;

/** Sums the numeric fields `keys` of the body. */
export function countKeys(...keys: string[]): RowCounter {
  return (body) => keys.reduce((n, k) => n + (typeof body[k] === "number" ? (body[k] as number) : 0), 0);
}

function compactDetail(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (Array.isArray(v)) out[k] = v.length > 10 ? `[${v.length} items]` : v;
    else if (typeof v === "string" && v.length > 1000) out[k] = `${v.slice(0, 1000)}…`;
    else out[k] = v;
  }
  return out;
}

function failedItems(body: Record<string, unknown>): { count: number; firstReason: string | null } {
  const results = Array.isArray(body.results) ? body.results : [];
  const failed = results.filter((r) => r && typeof r === "object" && (r as { ok?: unknown }).ok === false) as Array<Record<string, unknown>>;
  let count = failed.length;
  if (typeof body.failed === "number" && body.failed > count) count = body.failed;
  if (Array.isArray(body.fundErrors)) count += body.fundErrors.length;
  const r = failed[0];
  const firstReason = r ? String(r.reason ?? r.error ?? r.message ?? "item failed") : null;
  return { count, firstReason };
}

export function classifyRun(httpStatus: number, rawBody: unknown, countRows: RowCounter): RunOutcome {
  const body: Record<string, unknown> =
    rawBody && typeof rawBody === "object" && !Array.isArray(rawBody) ? (rawBody as Record<string, unknown>) : { raw: String(rawBody ?? "") };
  const detail = compactDetail(body);

  if (httpStatus >= 400 || typeof body.error === "string") {
    const msg = [body.error ?? `HTTP ${httpStatus}`, body.fix].filter(Boolean).map(String).join(" — fix: ");
    return { status: "error", rows_in: 0, error: msg, http_status: httpStatus, detail };
  }
  if (body.dryRun === true || body.synthetic === true || body.rawSample === true) {
    return { status: "dry_run", rows_in: 0, error: null, http_status: httpStatus, detail };
  }

  const rows = countRows(body);
  const { count: failures, firstReason } = failedItems(body);
  if (failures > 0 && rows === 0) {
    return { status: "error", rows_in: 0, error: `all ${failures} item(s) failed: ${firstReason ?? "see detail"}`, http_status: httpStatus, detail };
  }
  if (failures > 0) {
    return { status: "partial", rows_in: rows, error: `${failures} item(s) failed: ${firstReason ?? "see detail"}`, http_status: httpStatus, detail };
  }
  if (rows === 0) {
    return { status: "empty", rows_in: 0, error: null, http_status: httpStatus, detail };
  }
  return { status: "ok", rows_in: rows, error: null, http_status: httpStatus, detail };
}
