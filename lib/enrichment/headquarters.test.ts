import { describe, it, expect } from "vitest";
import { hqStatementsIn, decideHeadquarters, type HqStatement } from "./headquarters";
import { buildLabeledSources } from "./sources";
import { declaresHeadquarters } from "./validation";

const src = (url: string, content: string, title = "") => buildLabeledSources([{ url, title, content, provider: "serper", query_label: "overview" }], "hailo.ai")[0];

describe("the headquarters (owner, 2026-11-01): the company's declaration, else the latest tier 1–3 press; a recent disagreement leaves it empty", () => {
  it("reads '<city>-based' and 'headquartered in' from allowed press about the company — Hailo, Mistral", () => {
    const s = src("https://techcrunch.com/2021/10/12/hailo-raises-136m-ai-chips/", "Tel Aviv-based Hailo raised $136 million for its AI chips.");
    expect(hqStatementsIn(s, "Hailo")).toMatchObject([{ city: "Tel Aviv", kind: "press", date: "2021-10-12" }]);
    expect(hqStatementsIn(src("https://www.reuters.com/x", "Mistral AI, the Paris-based startup, raised €600 million."), "Mistral AI")).toMatchObject([{ city: "Paris" }]);
  });
  it("never from an unlisted site, a regional office, or a sentence about another company", () => {
    expect(hqStatementsIn(src("https://devops.com/x", "Tel Aviv-based Hailo raised $136 million."), "Hailo")).toEqual([]);
    expect(hqStatementsIn(src("https://techcrunch.com/x", "Hailo opened its US headquarters in New York."), "Hailo")).toEqual([]);
    expect(hqStatementsIn(src("https://techcrunch.com/x", "London-based Wayve raised $20 million."), "Hailo")).toEqual([]);
  });
  const st = (city: string, kind: "company" | "press", date: string | null): HqStatement => ({ city, kind, date, quote: `${city}-based`, source_id: "S1", url: "https://x" });
  it("the company's own declaration wins over any press", () => {
    expect(decideHeadquarters([st("New York", "press", "2026-05-01"), st("Tel Aviv", "company", null)], "2026-11-01")).toMatchObject({ kind: "declared", statement: { city: "Tel Aviv" } });
  });
  it("otherwise the latest press; press of the last two years that disagrees → empty, both cities offices", () => {
    expect(decideHeadquarters([st("Tel Aviv", "press", "2021-10-12"), st("Tel Aviv", "press", "2024-04-02")], "2026-11-01")).toMatchObject({ kind: "declared", statement: { date: "2024-04-02" } });
    expect(decideHeadquarters([st("New York", "press", "2026-01-10"), st("Tel Aviv", "press", "2025-06-01")], "2026-11-01")).toMatchObject({ kind: "conflict" });
    // An old disagreement is history: the latest recent one stands.
    expect(decideHeadquarters([st("Tel Aviv", "press", "2019-01-10"), st("New York", "press", "2026-02-01")], "2026-11-01")).toMatchObject({ kind: "declared", statement: { city: "New York" } });
    expect(decideHeadquarters([], "2026-11-01")).toEqual({ kind: "none" });
  });
  it("validation accepts an HQ declared in the press of tiers 1–3, not in an unlisted site", () => {
    expect(declaresHeadquarters("Tel Aviv-based Hailo", "news", "https://techcrunch.com/x")).toBe(true);
    expect(declaresHeadquarters("Tel Aviv-based Hailo", "news", "https://devops.com/x")).toBe(false);
    expect(declaresHeadquarters("offices in Tel Aviv", "company_site", null)).toBe(false);
  });
});

describe("the HQ phrase must be about THIS company (Fresha's blog gave 'Paris', an investor's HQ — eval of 2026-11-01)", () => {
  it("another company's '<city>-based' or 'headquartered in' in the same sentence is not the company's", () => {
    const s = buildLabeledSources([{ url: "https://www.fresha.com/blog/general-atlantic-lead-100m-in-freshas-future", title: "",
      content: "Fresha raised $100 million led by General Atlantic, with Paris-based Partech joining the round.", provider: "jina", query_label: "website" }], "fresha.com")[0];
    expect(hqStatementsIn(s, "Fresha")).toEqual([]);
    const own = buildLabeledSources([{ url: "https://www.fresha.com/about", title: "", content: "We are headquartered in London, with teams across Europe.", provider: "jina", query_label: "website" }], "fresha.com")[0];
    expect(hqStatementsIn(own, "Fresha")).toMatchObject([{ city: "London", kind: "company" }]);
    expect(hqStatementsIn(src("https://techcrunch.com/x", "Hailo, headquartered in Tel Aviv, raised $120 million."), "Hailo")).toMatchObject([{ city: "Tel Aviv" }]);
  });
});
