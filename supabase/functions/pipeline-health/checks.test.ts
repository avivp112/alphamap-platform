import { describe, it, expect } from "vitest";
import { evaluateChecks, sourceCheck, windowHours, type SourceFacts, type Snapshot, type CronFacts } from "./checks";

// Wednesday 2026-10-14 05:30 UTC
const NOW = "2026-10-14T05:30:00Z";
const ago = (h: number, from = NOW) => new Date(new Date(from).getTime() - h * 3_600_000).toISOString();

const src = (over: Partial<SourceFacts>): SourceFacts => ({
  source: "github_velocity", label: "GitHub", enabled: true, max_age_hours: 24, require_rows: true, weekend_tolerant: false,
  last_run_at: ago(5), last_status: "ok", last_error: null, last_ok_at: ago(5), last_rows_at: ago(5), data_last_row_at: ago(5), note: null,
  ...over,
});
const cron = (over: Partial<CronFacts>): CronFacts => ({
  jobname: "generate-live-alerts", active: true, last_run_at: ago(0.2), last_status: "succeeded", last_message: "1 row",
  last_success_at: ago(0.2), failures_24h: 0, ...over,
});
const healthy: Snapshot = {
  now: NOW,
  sources: [src({}), src({ source: "backfill_embeddings", label: "Embedding job", require_rows: false, max_age_hours: 26, last_ok_at: ago(1.5) })],
  cron: [cron({})],
  embeddings: { backlog: 0, oldest_backlog_at: null, last_embedded_at: ago(1.5) },
};

describe("source checks", () => {
  it("passes when new rows arrived within the window", () => {
    expect(sourceCheck(src({}), new Date(NOW)).ok).toBe(true);
  });
  it("fails a source with a missing key, quoting the error", () => {
    const c = sourceCheck(src({ last_status: "error", last_error: "GITHUB_TOKEN is not set.", last_rows_at: null, data_last_row_at: ago(80) }), new Date(NOW));
    expect(c.ok).toBe(false);
    expect(c.detail).toContain("GITHUB_TOKEN is not set.");
  });
  it("fails a source that never ran (function not deployed)", () => {
    const c = sourceCheck(src({ last_run_at: null, last_status: null, last_ok_at: null, last_rows_at: null, data_last_row_at: null }), new Date(NOW));
    expect(c).toMatchObject({ ok: false });
    expect(c.detail).toContain("last run never");
  });
  it("judges by the data table too — rows that arrived before the run log existed count", () => {
    expect(sourceCheck(src({ last_run_at: null, last_rows_at: null, data_last_row_at: ago(3) }), new Date(NOW)).ok).toBe(true);
  });
  it("gives SEC / Companies House 72h on Sunday and Monday only", () => {
    const sec = { max_age_hours: 24, weekend_tolerant: true };
    expect(windowHours(sec, new Date("2026-10-12T05:30:00Z"))).toBe(72); // Monday
    expect(windowHours(sec, new Date("2026-10-14T05:30:00Z"))).toBe(24); // Wednesday
    expect(windowHours({ ...sec, weekend_tolerant: false }, new Date("2026-10-12T05:30:00Z"))).toBe(24);
  });
  it("a weekly source has 8 days", () => {
    expect(sourceCheck(src({ source: "epo_ops", max_age_hours: 192, last_rows_at: ago(150), data_last_row_at: ago(150) }), new Date(NOW)).ok).toBe(true);
    expect(sourceCheck(src({ source: "epo_ops", max_age_hours: 192, last_rows_at: ago(200), data_last_row_at: ago(200) }), new Date(NOW)).ok).toBe(false);
  });
  it("a source where empty runs are normal needs only a successful run", () => {
    const ats = src({ source: "ats_crawl", require_rows: false, last_rows_at: null, data_last_row_at: null, last_status: "empty", last_ok_at: ago(2) });
    expect(sourceCheck(ats, new Date(NOW)).ok).toBe(true);
    expect(sourceCheck({ ...ats, last_ok_at: ago(30), last_status: "error", last_error: "select crawl queue: timeout" }, new Date(NOW)).ok).toBe(false);
  });
});

describe("evaluateChecks", () => {
  it("all green on a healthy day", () => {
    expect(evaluateChecks(healthy, { ok: true, detail: "answered in 120 ms" }).every((c) => c.ok)).toBe(true);
  });
  it("skips disabled sources (USPTO)", () => {
    const snap = { ...healthy, sources: [...healthy.sources, src({ source: "uspto_patents", enabled: false, last_run_at: null, last_rows_at: null, data_last_row_at: null })] };
    expect(evaluateChecks(snap, { ok: true, detail: "" }).some((c) => c.check === "source:uspto_patents")).toBe(false);
  });
  it("flags the TEI server being down", () => {
    const c = evaluateChecks(healthy, { ok: false, detail: "no answer (pod stopped?)" }).find((x) => x.check === "tei")!;
    expect(c.ok).toBe(false);
  });
  it("flags an embedding backlog and a stale embedding job", () => {
    const backlog = evaluateChecks({ ...healthy, embeddings: { backlog: 40, oldest_backlog_at: ago(300), last_embedded_at: ago(300) } }, { ok: true, detail: "" });
    expect(backlog.find((c) => c.check === "embeddings")!.ok).toBe(false);
    const stale = evaluateChecks({ ...healthy, sources: [healthy.sources[0], { ...healthy.sources[1], last_ok_at: ago(50) }] }, { ok: true, detail: "" });
    expect(stale.find((c) => c.check === "embeddings")!.ok).toBe(false);
  });
  it("flags generate-live-alerts not running, and failed SQL cron jobs", () => {
    const snap = { ...healthy, cron: [cron({ last_success_at: ago(30), last_status: "failed", last_message: "relation does not exist" }), cron({ jobname: "link-oss-projects", failures_24h: 1, last_message: "boom" })] };
    const checks = evaluateChecks(snap, { ok: true, detail: "" });
    expect(checks.find((c) => c.check === "live_alerts")!.ok).toBe(false);
    expect(checks.find((c) => c.check === "cron_failures")!.detail).toContain("link-oss-projects");
    expect(evaluateChecks({ ...healthy, cron: [] }, { ok: true, detail: "" }).find((c) => c.check === "live_alerts")!.detail).toContain("not scheduled");
  });
});
