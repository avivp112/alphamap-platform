import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/** Stage 7 (owner decisions, 2026-11-12): the migration holds the thresholds, the corporate owners, the dry-run default and the flag. */
const sql = readFileSync("supabase/migrations/20261125000000_oss_candidates.sql", "utf8");

describe("oss candidates migration", () => {
  it("100 stars a week to the queue, 50–99 to the watch list, 180 days", () => {
    expect(sql).toMatch(/'queue_stars_7d',\s+100/);
    expect(sql).toMatch(/'watch_stars_7d',\s+50/);
    expect(sql).toMatch(/'max_age_days',\s+180/);
  });
  it("the corporate owners are in oss_excluded_owners, Tencent and Amazon's Kiro among them", () => {
    for (const o of ["TencentCloud", "kirodotdev", "alibaba", "bytedance", "huawei", "aws-samples", "SAP"]) expect(sql).toContain(`'${o}'`);
  });
  it("the stars check is a flag in the view and in the evidence, not a filter", () => {
    expect(sql).toMatch(/AS suspect_stars/);
    expect(sql).toMatch(/'suspect_stars', r\.suspect_stars/);
    const tierCase = sql.slice(sql.indexOf("CASE\n    WHEN f.ok_owner"), sql.indexOf("END AS tier"));
    expect(tierCase).not.toMatch(/suspect_stars/);
  });
  it("one candidate per homepage domain, GitHub only, review only (never an alert)", () => {
    expect(sql).toMatch(/rank_in_domain = 1/);
    expect(sql).toMatch(/v\.source = 'github_repo'/);
    expect(sql).toMatch(/'oss_github', 'domain:' \|\| r\.reg_domain, left\(r\.name, 120\), r\.homepage, 'queue'/);
    expect(sql).not.toMatch(/'alert'/);
  });
  it("propose_oss_candidates is a dry run by default and only the service role runs it; a decided candidate is left as decided", () => {
    expect(sql).toMatch(/propose_oss_candidates\(p_limit integer DEFAULT 50, p_dry_run boolean DEFAULT true\)/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION propose_oss_candidates\(integer, boolean\) TO service_role/);
    expect(sql).toMatch(/CASE WHEN c\.status = 'pending' THEN EXCLUDED\.evidence ELSE c\.evidence END/);
  });
  it("has a rollback", () => {
    expect(readFileSync("supabase/rollback/20261125000000_oss_candidates_down.sql", "utf8")).toMatch(/DROP FUNCTION IF EXISTS propose_oss_candidates/);
  });
});
