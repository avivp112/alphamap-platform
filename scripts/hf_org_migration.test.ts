import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/** Stage 7b (owner decisions, 2026-11-12): HF at org level — certain links only, review-only discovery, dry run by default. */
const sql = readFileSync("supabase/migrations/20261126000000_hf_org_layer.sql", "utf8");

describe("hf org migration", () => {
  it("a link is certain only through the profile website or the company's site; no name matching", () => {
    expect(sql).toMatch(/'profile_site'/);
    expect(sql).toMatch(/'site_link'/);
    expect(sql).toMatch(/registrable_domain\(o\.website\) = registrable_domain\(s\.website\)/);
    const view = sql.slice(sql.indexOf("CREATE OR REPLACE VIEW hf_link_candidates"), sql.indexOf("COMMENT ON VIEW hf_link_candidates"));
    expect(view).not.toMatch(/similarity|ilike|name_norm|s\.name/i);
    expect(view).toMatch(/count\(DISTINCT p2\.startup_id\) FROM per_pair p2 WHERE p2\.org = p\.org\) = 1/);   // an org pointing at two companies is dropped
  });
  it("link and propose are dry runs by default and only the service role runs them", () => {
    expect(sql).toMatch(/link_hf_orgs\(p_dry_run boolean DEFAULT true\)/);
    expect(sql).toMatch(/propose_hf_candidates\(p_limit integer DEFAULT 50, p_dry_run boolean DEFAULT true\)/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION link_hf_orgs\(boolean\) TO service_role/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION propose_hf_candidates\(integer, boolean\) TO service_role/);
  });
  it("discovery: first model within 180 days, downloads growing, own website, not a university or a big company, review only", () => {
    expect(sql).toMatch(/'max_age_days',\s+180/);
    expect(sql).toMatch(/'min_downloads_7d',\s+100/);
    expect(sql).toMatch(/oss_is_own_domain\(f\.site_domain\)/);
    expect(sql).toMatch(/oss_excluded_owners/);
    expect(sql).toMatch(/universit/);
    expect(sql).toMatch(/list_complete AND ok_recent AND ok_growth AND ok_site AND ok_kind AND NOT known_company/);
    expect(sql).toMatch(/'hf_org', 'domain:' \|\| r\.reg_domain, .*'queue'/);
    expect(sql).not.toMatch(/'alert'/);
  });
  it("the company page reads only linked orgs", () => {
    expect(sql).toMatch(/kind = 'hf_org'/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION company_hf_summary\(uuid\) TO authenticated, service_role/);
  });
  it("has a rollback", () => {
    expect(readFileSync("supabase/rollback/20261126000000_hf_org_layer_down.sql", "utf8")).toMatch(/DROP TABLE IF EXISTS hf_orgs/);
  });
});

describe("hf link on shared hosts (fix 20261128)", () => {
  const fix = readFileSync("supabase/migrations/20261128000000_hf_link_own_domain.sql", "utf8");
  it("a profile website on a shared host (readthedocs.io, github.io ...) never proves a link", () => {
    expect(fix).toMatch(/WHERE oss_is_own_domain\(registrable_domain\(o\.website\)\)/);
  });
});

describe("weekly cron and GitHub link (20261129)", () => {
  const m = readFileSync("supabase/migrations/20261129000000_oss_weekly_cron_and_github_link.sql", "utf8");
  it("schedules the snapshot in 30-org calls and links only certain pairs; candidates are not scheduled", () => {
    expect(m).toMatch(/'\*\/10 2-6 \* \* 1'.*"batch": 30/);
    expect(m).toMatch(/link_hf_orgs\(false\); SELECT link_github_orgs\(false\)/);
    expect(m).not.toMatch(/schedule\([^)]*propose_/);
    expect(m).toMatch(/DISTINCT f2\.startup_id\) FROM from_site f2 WHERE f2\.org = f\.org\) = 1/);
  });
});
