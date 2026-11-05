import { companyIdsFromCsv, withWebsites } from "./fieldReviewImport.ts";
import { describe, it, expect } from "vitest";
import { goldenFromMarks, newGoldenEntries, parseRoundValue, slug } from "./fieldReviewImport";
import { scoreCompany, newScoreboard } from "./score";
import type { Mark } from "../lib/enrichment/fieldReview";

const m = (id: string, field: string, company: string, value: string, verdict: "correct" | "wrong", source_url = "https://x.com/a"): Mark => ({ id, field, company, value, source_url, verdict, source_of_mark: "t" });

describe("field-review marks as golden entries (owner, 2026-11-05)", () => {
  it("parses a round value the review printed", () => {
    expect(parseRoundValue("Series A $35M · 2026-09-09 · lead Oak HC/FT", "u")).toMatchObject({ type: "Series A", amount_usd: 35_000_000, date: "2026-09-09", lead_investor: "Oak HC/FT", confidence: "verified", source_url: "u" });
    expect(parseRoundValue("Other $1.2B · 2020-11")).toMatchObject({ type: "Other", amount_usd: 1_200_000_000, date: "2020-11" });
    expect(parseRoundValue("Debt amount not disclosed · 2024-09-19")).toBeNull();
  });
  const marks = [
    m("4.1", "founding_country", "Argus Cyber", "Israel", "correct"), m("4.3", "hq_city", "Argus Cyber", "Tel Aviv", "correct"),
    m("4.8", "founder", "Argus Cyber", "Ofer Ben-Noon — CEO & Co-Founder", "correct"),
    m("4.16", "round", "Speedb", "Other $4M · 2024-03-21", "wrong"), m("4.17", "round", "Speedb", "Seed $4M · 2022-04-05", "correct"),
    m("4.20", "competitor", "Speedb", "RocksDB", "correct"), m("4.21", "competitor", "Speedb", "Redis", "wrong"),
    m("4.22", "patent", "Trobix Bio", "EP4381061A1 Systems for modulating drug metabolism", "correct"),
    m("g.r2", "round", "Coralogix", "Series B $25M 2020-09-30", "correct"),
    m("4.30", "news", "Speedb", "x", "correct"),
  ];
  it("correct values become verified golden values; wrong ones are known wrong; the rest is not imported", () => {
    const argus = goldenFromMarks("Argus Cyber", marks)!.company;
    expect(argus).toMatchObject({ id: "argus-cyber", judged_only: true, reviewed_by_human: true, city: { value: "Tel Aviv", confidence: "verified" }, founding_country: { value: "Israel" } });
    expect(argus.founders?.[0].name).toBe("Ofer Ben-Noon");
    const speedb = goldenFromMarks("Speedb", marks)!.company;
    expect(speedb.funding_rounds).toHaveLength(1);
    expect(speedb.funding_rounds_wrong).toHaveLength(1);
    expect(speedb.competitors).toMatchObject({ names: ["RocksDB"], not_competitors: ["Redis"] });
    expect(goldenFromMarks("Trobix Bio", marks)!.company.patents).toMatchObject({ numbers: ["EP4381061A1"] });
    expect(goldenFromMarks("Nobody", marks)).toBeNull();
  });
  it("a company already in the golden set, and the owner's old sheet marks (g.*), are not imported", () => {
    const entries = newGoldenEntries(marks, [{ name: "Speedb" }]);
    expect(entries.map((e) => e.company.name).sort()).toEqual(["Argus Cyber", "Trobix Bio"]);
    expect(newGoldenEntries(marks, []).map((e) => e.company.name)).not.toContain("Coralogix");
    expect(slug("Constructor Technology AG")).toBe("constructor-technology-ag");
  });
  it("an entry from marks judges only what was marked: an unmarked produced round or patent is unjudged, a wrong one is a wrong write", () => {
    const speedb = goldenFromMarks("Speedb", marks)!.company;
    const out = { city: null, country: null, founded_year: null, founders: [], employee_range: null, competitors: ["RocksDB", "Redis", "Valkey"],
      rounds: [{ round_type: "Seed", amount_raised: 4_000_000, date: "2022-04-05" }, { round_type: "Other", amount_raised: 4_000_000, date: "2024-03-21" }, { round_type: "Series A", amount_raised: 20_000_000, date: "2025-02-01" }] };
    const board = newScoreboard();
    scoreCompany(board, speedb, out as never);
    expect(board.funding_rounds).toMatchObject({ produced: 2, correct: 1 }); // the Series A nobody judged is left out
    expect(board.competitors).toMatchObject({ produced: 2, correct: 1 });    // Valkey is unjudged
  });
  it("patents: only the numbers the owner judged count", () => {
    const trobix = goldenFromMarks("Trobix Bio", marks)!.company;
    const board = newScoreboard();
    scoreCompany(board, trobix, { city: null, country: null, founded_year: null, founders: [], rounds: [], employee_range: null, patents: ["EP4381061A1", "WO2024052907A1"] } as never);
    expect(board.patents).toMatchObject({ produced: 1, correct: 1 });
  });
});

describe("websites are copied by company id, and a company without one stays out", () => {
  const ID1 = "11111111-1111-1111-1111-111111111111", ID2 = "22222222-2222-2222-2222-222222222222";
  const cand = (name: string) => ({ company: { id: name.toLowerCase(), name } as never, counts: {} });
  it("reads ids from a csv with company and company_id columns", () => {
    const ids = companyIdsFromCsv([["id", "company", "company_id"], ["1.1", "Acme", ID1], ["1.2", "Bolt", "not-an-id"]]);
    expect(ids.get("acme")).toBe(ID1);
    expect(ids.has("bolt")).toBe(false);
  });
  it("keeps a company whose row has a website and takes it from that id", () => {
    const { kept, dropped } = withWebsites([cand("Acme")], new Map([["acme", ID1]]), new Map([[ID1, "acme.com"], [ID2, "other.com"]]));
    expect(dropped).toHaveLength(0);
    expect(kept[0].company).toMatchObject({ website: "https://acme.com", company_id: ID1 });
  });
  it("drops a company with no id, and one whose row has no website", () => {
    const { kept, dropped } = withWebsites([cand("Acme"), cand("Bolt"), cand("Cyan")], new Map([["acme", ID1], ["bolt", ID2]]), new Map([[ID1, null], [ID2, "bolt.io"]]));
    expect(kept.map((k) => k.company.name)).toEqual(["Bolt"]);
    expect(dropped.map((d) => [d.company.name, d.reason.split(" (")[0]])).toEqual([["Acme", "no website in the database"], ["Cyan", "no company id in the review files"]]);
  });
});
