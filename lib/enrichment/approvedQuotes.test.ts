import { describe, it, expect } from "vitest";
import { buildLabeledSources } from "./sources";
import { approvedQuotes, hqFromApprovedQuotes, foundersFromApprovedQuotes } from "./approvedQuotes";
import { decideHeadquarters } from "./headquarters";

const src = (url: string, content: string, domain: string) => buildLabeledSources([{ url, title: "", content, provider: "serper", query_label: "overview" }], domain)[0];
const round = (s: { source_id: string }, quote: string) => ({ round_type: "Seed", amount_raised: { value: 1, source_id: s.source_id, evidence_quote: quote } }) as never;

describe("approved quotes also feed HQ and founders (owner, batch 6)", () => {
  it("SAMCO: 'Mumbai-based online broker Samco' (2018, tier 4) → Mumbai, the latest dated statement decides", () => {
    const q = "Mumbai-based online broker Samco has raised Rs 20 crore in funding.";
    const s = src("https://www.techcircle.in/2018/03/01/samco-raises", `${q} Published 2018-03-01`, "samco.in");
    const st = hqFromApprovedQuotes(approvedQuotes([round(s, q)], [s]), "Samco");
    expect(st.map((x) => x.city)).toEqual(["Mumbai"]);
    const d = decideHeadquarters(st, "2026-11-17", []);
    expect(d.kind === "declared" && d.statement.city).toBe("Mumbai");   // dated 2018-04-30; the latest dated statement decides, whatever its age
  });
  it("Sherlok: 'Adelaide-based startup Sherlok'", () => {
    const q = "Adelaide-based startup Sherlok has closed a $1.5M seed round.";
    const s = src("https://www.startupdaily.net/x", q, "sherlok.io");
    const st = hqFromApprovedQuotes(approvedQuotes([round(s, q)], [s]), "Sherlok");
    expect(st.map((x) => x.city)).toEqual(["Adelaide"]);
  });
  it("another company's city is not ours", () => {
    const q = "Sherlok, working with Perth-based Avid Group, raised $1M.";
    const s = src("https://www.startupdaily.net/y", q, "sherlok.io");
    expect(hqFromApprovedQuotes(approvedQuotes([round(s, q)], [s]), "Sherlok")).toEqual([]);
  });
  it("founders: Kiwify and Sherlok", () => {
    const k = "Kiwify, founded in 2020 by Artur Ribas and Marinho Gomes, raised R$ 100M.";
    const s1 = src("https://example.com/k", k, "kiwify.com.br");
    expect(foundersFromApprovedQuotes(approvedQuotes([round(s1, k)], [s1]), "Kiwify").map((f) => f.name)).toEqual(expect.arrayContaining(["Artur Ribas", "Marinho Gomes"]));
    const q = "Sherlok raised $1.5M, said Founder and CEO Adam Grocke.";
    const s2 = src("https://example.com/s", q, "sherlok.io");
    expect(foundersFromApprovedQuotes(approvedQuotes([round(s2, q)], [s2]), "Sherlok").map((f) => f.name)).toContain("Adam Grocke");
  });
});
