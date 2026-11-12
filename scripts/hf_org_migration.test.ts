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
    expect(view).toMatch(/count\(DISTINCT p2\.startup_id\)\) = 1/);   // an org pointing at two companies is dropped
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
