import { describe, it, expect } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  isUpdateDue, isActiveCompany, buildUpdateQueries, knownUrlSet, newResultsOnly, mentionsFunding,
  retireReplacedExecutives, SeenUrls,
} from "./update";

const NOW = new Date("2026-10-06T00:00:00Z").getTime();
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

describe("update scheduling", () => {
  it("re-checks an active company (recent round or news) every 30 days, a quiet one every 90", () => {
    const active = { last_enriched_at: ago(40), news: [] };
    expect(isActiveCompany(active, [ago(200)], NOW)).toBe(true);
    expect(isUpdateDue(active, [ago(200)], { now: NOW })).toBe(true);
    const quiet = { last_enriched_at: ago(40), news: [{ published_date: ago(900) }] };
    expect(isUpdateDue(quiet, [ago(2000)], { now: NOW })).toBe(false);
    expect(isUpdateDue({ ...quiet, last_enriched_at: ago(95) }, [ago(2000)], { now: NOW })).toBe(true);
  });
  it("leaves never-enriched companies to a full run", () => {
    expect(isUpdateDue({ last_enriched_at: null }, [], { now: NOW })).toBe(false);
  });
});

describe("update searches", () => {
  it("limits the news and change searches to pages after the last check, and adds a search per missing core field", () => {
    const q = buildUpdateQueries("Acme", ' "acme.io"', "2026-07-01", { row: { founders: [], city: "Paris", country: "France", founded_year: null }, hasRounds: false });
    expect(q.slice(0, 2).every((x) => x.query.includes("after:2026-07-01"))).toBe(true);
    expect(q.map((x) => x.label)).toEqual(["update_news", "update_changes", "gap_founders", "gap_overview", "gap_funding"]);
    expect(buildUpdateQueries("Acme", "", "2026-07-01", null)).toHaveLength(2);
  });
  it("keeps only pages not already known for the company", () => {
    const known = knownUrlSet({ news: [{ url: "https://x.com/a?utm=1" }], roundSourceUrls: ["https://y.com/b"], seen: ["https://z.com/c"] });
    const fresh = newResultsOnly([{ url: "https://x.com/a" }, { url: "https://y.com/b/" }, { url: "https://z.com/c" }, { url: "https://new.com/d" }, { url: "https://new.com/d" }], known);
    expect(fresh).toEqual([{ url: "https://new.com/d" }]);
  });
  it("knows when new pages could carry funding news", () => {
    expect(mentionsFunding(["Acme raised a $10M Series A"])).toBe(true);
    expect(mentionsFunding(["Acme launches a new dashboard"])).toBe(false);
  });
});

describe("leadership changes", () => {
  it("keeps the replaced C-level leader as 'Former' only when the new one is announced as appointed", () => {
    const onFile = [{ name: "John Doe", role: "CEO" }, { name: "Amy Wu", role: "CTO" }];
    const r = retireReplacedExecutives(onFile, [{ name: "Jane Roe", role: "CEO", bio: "Jane Roe was appointed CEO." }]);
    expect(r.leaders).toEqual([{ name: "John Doe", role: "Former CEO" }, { name: "Amy Wu", role: "CTO" }]);
    expect(retireReplacedExecutives(onFile, [{ name: "Jane Roe", role: "CEO", bio: "Jane Roe spoke at a conference." }]).retired).toEqual([]);
    expect(retireReplacedExecutives(onFile, [{ name: "John Doe", role: "CEO", bio: "John Doe was named CEO again." }]).retired).toEqual([]);
  });
});

describe("SeenUrls", () => {
  it("remembers the pages sent to Claude and when missing fields were last searched", () => {
    const dir = mkdtempSync(join(tmpdir(), "seen-test-"));
    const s = new SeenUrls("c1", dir);
    expect(s.gapFillDue(NOW)).toBe(true);
    s.add(["https://a.com/x?utm_source=y"]);
    s.markGapFill(new Date(NOW));
    s.save();
    const again = new SeenUrls("c1", dir);
    expect(again.urls).toHaveLength(1);
    expect(again.gapFillDue(NOW + 10 * 86_400_000)).toBe(false);
    expect(again.gapFillDue(NOW + 91 * 86_400_000)).toBe(true);
  });
});
