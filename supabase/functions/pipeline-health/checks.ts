// =============================================================================
// pipeline-health/checks.ts — the daily health rules, as a pure function of
// the facts pipeline_health_snapshot() returns plus the TEI probe. No Deno, no
// network: unit-tested in vitest (checks.test.ts).
// =============================================================================

export interface SourceFacts {
  source: string;
  label: string;
  enabled: boolean;
  max_age_hours: number;
  require_rows: boolean;
  weekend_tolerant: boolean;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
  last_ok_at: string | null;
  last_rows_at: string | null;
  /** Newest row this source put in its data table, read from the table itself. */
  data_last_row_at: string | null;
  note: string | null;
}

export interface CronFacts {
  jobname: string;
  active: boolean;
  last_run_at: string | null;
  last_status: string | null;
  last_message: string | null;
  last_success_at: string | null;
  failures_24h: number;
}

export interface Snapshot {
  now: string;
  sources: SourceFacts[];
  cron: CronFacts[];
  embeddings: { backlog: number; oldest_backlog_at: string | null; last_embedded_at: string | null };
}

export interface TeiProbe { ok: boolean; detail: string }

export interface HealthCheck { check: string; ok: boolean; detail: string }

const HOUR = 3_600_000;

function hoursSince(iso: string | null, now: number): number | null {
  return iso ? (now - new Date(iso).getTime()) / HOUR : null;
}

function newest(...isos: Array<string | null>): string | null {
  return isos.filter((x): x is string => !!x).sort().at(-1) ?? null;
}

const fmt = (h: number | null) => (h == null ? "never" : `${Math.round(h)}h ago`);

/**
 * The window a source has to show life in. A daily government source may
 * legitimately bring nothing for a weekend (SEC publishes no Form D index on
 * Saturday/Sunday, and "yesterday's" UK tech incorporations can be zero), so
 * on Sunday and Monday (UTC) those sources get 72 hours.
 */
export function windowHours(s: Pick<SourceFacts, "max_age_hours" | "weekend_tolerant">, now: Date): number {
  const dow = now.getUTCDay(); // 0 = Sunday
  return s.weekend_tolerant && (dow === 0 || dow === 1) ? Math.max(s.max_age_hours, 72) : s.max_age_hours;
}

export function sourceCheck(s: SourceFacts, now: Date): HealthCheck {
  const t = now.getTime();
  const w = windowHours(s, now);
  const lastRun = hoursSince(s.last_run_at, t);
  const runInfo = `last run ${fmt(lastRun)}${s.last_status ? ` (${s.last_status})` : ""}${s.last_error ? `: ${s.last_error}` : ""}`;

  if (s.require_rows) {
    const rowsAt = newest(s.last_rows_at, s.data_last_row_at);
    const age = hoursSince(rowsAt, t);
    if (age == null || age > w) {
      return { check: `source:${s.source}`, ok: false, detail: `${s.label}: no new rows in the last ${w}h (newest ${fmt(age)}); ${runInfo}` };
    }
    return { check: `source:${s.source}`, ok: true, detail: `${s.label}: newest row ${fmt(age)}` };
  }

  const okAge = hoursSince(s.last_ok_at, t);
  if (okAge == null || okAge > w) {
    return { check: `source:${s.source}`, ok: false, detail: `${s.label}: no successful run in the last ${w}h; ${runInfo}` };
  }
  return { check: `source:${s.source}`, ok: true, detail: `${s.label}: last successful run ${fmt(okAge)}` };
}

export function evaluateChecks(snap: Snapshot, tei: TeiProbe): HealthCheck[] {
  const now = new Date(snap.now);
  const t = now.getTime();
  const checks: HealthCheck[] = snap.sources.filter((s) => s.enabled).map((s) => sourceCheck(s, now));

  checks.push({ check: "tei", ok: tei.ok, detail: `Embedding server (TEI on RunPod): ${tei.detail}` });

  const backfill = snap.sources.find((s) => s.source === "backfill_embeddings");
  const backfillOkAge = hoursSince(backfill?.last_ok_at ?? null, t);
  const e = snap.embeddings;
  const embedOk = e.backlog === 0 && backfillOkAge != null && backfillOkAge <= 26;
  checks.push({
    check: "embeddings",
    ok: embedOk,
    detail: e.backlog > 0
      ? `${e.backlog} compan(ies) with a description have had no embedding for over 26h (oldest since ${e.oldest_backlog_at}); last embedding written ${e.last_embedded_at ?? "never"}; embedding job last succeeded ${fmt(backfillOkAge)}`
      : `no backlog; embedding job last succeeded ${fmt(backfillOkAge)}${backfill?.last_error ? ` (last error: ${backfill.last_error})` : ""}`,
  });

  const alerts = snap.cron.find((c) => c.jobname === "generate-live-alerts");
  const alertsAge = hoursSince(alerts?.last_success_at ?? null, t);
  checks.push({
    check: "live_alerts",
    ok: !!alerts?.active && alertsAge != null && alertsAge <= 24,
    detail: !alerts
      ? "generate-live-alerts is not scheduled"
      : `generate-live-alerts ${alerts.active ? "" : "(INACTIVE) "}last succeeded ${fmt(alertsAge)}${alerts.last_status === "failed" ? `; last run failed: ${alerts.last_message}` : ""}`,
  });

  // SQL jobs report their real outcome to cron.job_run_details (HTTP jobs do
  // not — those are covered by the source checks above).
  const failing = snap.cron.filter((c) => c.failures_24h > 0);
  checks.push({
    check: "cron_failures",
    ok: failing.length === 0,
    detail: failing.length === 0
      ? "no failed cron runs in the last 24h"
      : failing.map((c) => `${c.jobname}: ${c.failures_24h} failed run(s), last: ${c.last_message ?? "?"}`).join("; "),
  });

  return checks;
}
