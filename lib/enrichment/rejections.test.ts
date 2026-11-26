import { describe, it, expect } from "vitest";
import { parseRejections, sampleRejections, rejectionStats } from "./rejections";

const L = [
  `    🚫  founded_year 2013 not written — its sentence is not about Ardens Health Informatics: "Founded in 2013, Ardens was created by GPs who shared a drive" (https://ardens.org.uk/about/company)`,
  `    🚫  news "Agrosmart Funding History: $6.8M" not written — its source is not on the allowed list: https://indexed.vc/companies/agrosmart`,
  `    🚫  founder Brian Farmer not written — the title "Co-Founder, Chief Executive Officer" is at another company`,
  `    🚫  leader Percy Schultz not written — no allowed source`,
  `    🚫  Seed not written (round_without_substance)`,
  `    🚫  city "Cape Town" not written as the headquarters — it comes from a legal page (https://netcash.co.za/privacy-policy); kept as an office`,
  `    🚫  news "Gousto founder to step down" not written — the same event as another item: https://www.thegrocer.co.uk/x`,
  `    🚫  market peer Bank Raya not written — peer_not_a_company_with_a_site`,
  `    🚫  REJECTED — not a technology-driven company`,
  `    🚫  description sentence dropped (no_supporting_sentence): "hibank offers online banking."`,
];
describe("rejections", () => {
  const rows = parseRejections(L, "X", "id1");
  it("gives each rejection its code, field and source", () => {
    const by = (c: string) => rows.find((r) => r.reason_code === c);
    expect(by("sentence_not_about_company")).toMatchObject({ field: "founded_year", value: "2013" });
    expect(by("sentence_not_about_company")?.evidence).toMatch(/Ardens was created/);
    expect(by("source_not_allowed")).toMatchObject({ field: "news", source_url: "https://indexed.vc/companies/agrosmart" });
    expect(by("title_at_another_company")?.field).toBe("founder");
    expect(by("no_allowed_source")?.field).toBe("leader");
    expect(by("round_without_substance")?.field).toBe("round");
    expect(by("legal_page_hq_kept_as_office")?.field).toBe("hq_city");
    expect(by("news_same_event")?.source_url).toMatch(/thegrocer/);
    expect(by("peer_not_a_company_with_a_site")?.field).toBe("competitor_market");
    expect(by("description_sentence_no_supporting_sentence")).toBeTruthy();
  });
  it("leaves out the company-level turn-away", () => { expect(rows.some((r) => /REJECTED/.test(r.value))).toBe(false); expect(rows.length).toBe(9); });
  it("samples by reason code, the same rows each time", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ ...rows[i % 2], company: `C${i}` }));
    const s = sampleRejections([...many, rows[2], rows[3]], 6);
    expect(s.length).toBe(6);
    expect(new Set(s.map((x) => x.reason_code)).size).toBe(4);
    expect(sampleRejections([...many, rows[2]], 6).map((x) => x.company)).toEqual(sampleRejections([...many, rows[2]], 6).map((x) => x.company));
  });
  it("flags a code with more than 20% wrong rejections", () => {
    const st = rejectionStats([...Array(4).fill({ reason_code: "a", verdict: "right" }), { reason_code: "a", verdict: "wrong" }, { reason_code: "b", verdict: "right" }, { reason_code: "b", verdict: "" }]);
    expect(st.find((x) => x.reason_code === "a")).toMatchObject({ marked: 5, wrong: 1, widen: false });
    const st2 = rejectionStats([{ reason_code: "a", verdict: "right" }, { reason_code: "a", verdict: "wrong" }]);
    expect(st2[0].widen).toBe(true);
  });
});
