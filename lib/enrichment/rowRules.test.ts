import { describe, it, expect } from "vitest";
import { rowProblem, applyRowRules, acquiredFromNews } from "./rowRules";
import { runAcceptance, rowsFromCsv, type Check } from "./acceptance";
import { onlyAsHyphenatedSuffix, namesCompanyUpFront } from "./newsRelevance";
import { readFileSync } from "fs";

const TODAY = "2026-11-16";
describe("the same rules for carried values (owner, round 10)", () => {
  it("news: run-day date, tag page, guide, no company in the headline", () => {
    expect(rowProblem({ field: "news", after: "2026-11-16 — Żabka przejmuje Dietly", source_url: "https://mamstartup.pl/x/" }, "Dietly", TODAY)).toMatch(/day of the run/);
    expect(rowProblem({ field: "news", after: "2025-10-29 — Conotoxia collapses", source_url: "https://www.financemagnates.com/tag/cinkciarzpl/" }, "Conotoxia", TODAY)).toMatch(/tag/);
    expect(rowProblem({ field: "news", after: "2021-05-18 — Four rules for choosing a patient/doctor payments system", source_url: "https://www.medicalrepublic.com.au/x" }, "Medipass", TODAY)).toMatch(/guide/);
    expect(rowProblem({ field: "news", after: "2021-10-22 — Poland's Żabka Trials 'Jush' Home-Delivery App", source_url: "https://www.esmmagazine.com/x" }, "Dietly", TODAY)).toMatch(/does not name/);
    expect(rowProblem({ field: "news", after: "2021-06-03 — Żabka Group Acquires Controlling Stake In Dietly.pl", source_url: "https://www.esmmagazine.com/y" }, "Dietly", TODAY)).toBeNull();
  });
  it("any field: sponsored content", () => {
    expect(rowProblem({ field: "sector", after: "Fintech", source_url: "https://www.businessinsider.com/sc/european-fintech-2018-6" }, "Conotoxia", TODAY)).toMatch(/sponsored/);
  });
  it("founded_year from a growth phrase in an image", () => {
    expect(rowProblem({ field: "founded_year", after: "2020", source_url: "https://paradox.ai/news", quote: "[![Image 33: Paradox Named to List — Growing by More than 720% Since 2020](https://cdn/x.png)" }, "Paradox AI", TODAY)).toBeTruthy();
    expect(rowProblem({ field: "founded_year", after: "2016", source_url: "https://paradox.ai/about", quote: "Founded in 2016, Paradox builds Olivia." }, "Paradox AI", TODAY)).toBeNull();
  });
  it("tags: a bio of a person, a slogan, a cookie notice, and another company's document", () => {
    const t = (url: string, quote: string) => rowProblem({ field: "tags", after: "HR Tech", source_url: url, quote }, "Paradox AI", TODAY);
    expect(t("https://www.paradox.ai/leadership/adam-godson", "Adam was previously Chief Technology Officer at Cielo")).toBeTruthy();
    expect(t("https://www.sec.gov/Archives/edgar/data/1/workday.htm", "Workday offers HR and finance software")).toBeTruthy();
    expect(t("https://www.paradox.ai/", "Paradox sells conversational hiring software")).toBeNull();
  });
  it("founders and background merged; lead investor stripped when no quote names it", () => {
    const rows = [
      { field: "founder", after: "Alastair Mills — Founder", source_url: "a", quote: "" },
      { field: "founder", after: "Alastair Mills — Founder and CEO", source_url: "a", quote: "" },
      { field: "founder_background", after: "Alastair Mills: previous role — SpiriTel PLC, led", source_url: "w", quote: "" },
      { field: "founder_background", after: "Alastair Mills: previous role — SpiriTel PLC, led", source_url: "w2", quote: "" },
      { field: "round", after: "Seed $1.5M · 2022-07-23 · lead Insud Pharma", source_url: "h", quote: "The startup announced a USD $1.5M seed round.", payload: JSON.stringify({ round: { lead_investor: "Insud Pharma" }, evidence: [{ quote: "The startup announced a USD $1.5M seed round." }] }) },
    ];
    const r = applyRowRules(rows, "Choiz", TODAY).rows;
    expect(r.filter((x) => x.field === "founder")).toHaveLength(1);
    expect(r.find((x) => x.field === "founder")!.after).toBe("Alastair Mills — Founder and CEO");
    expect(r.filter((x) => x.field === "founder_background")).toHaveLength(1);
    expect(r.find((x) => x.field === "round")!.after).not.toMatch(/Insud/);
  });
  it("acquired is read from the news rows, newest full acquisition first, no generic buyer", () => {
    const news = (d: string, t: string) => ({ field: "news", after: `${d} — ${t}`, source_url: `https://x/${d}` });
    const six = acquiredFromNews([news("2026-11-12", "London-based Six Degrees Group sold to US investors"), news("2026-06-29", "Claranet picks up Six Degrees | Microscope")], "Six Degrees", "id")!;
    expect(six.after).toMatch(/Claranet.*2026-06/);
    const hum = acquiredFromNews([news("2025-01-09", "Employment Hero acquires Canadian employment platform Humi in $100M+ global expansion move")], "Humi", "id")!;
    expect(hum.after).toMatch(/Employment Hero.*2025-01/);
    const med = acquiredFromNews([news("2021-05-11", "Payments platform Tyro buys medical fintech startup Medipass")], "Medipass", "id")!;
    expect(med.after).toMatch(/Tyro.*2021-05/);
    const die = acquiredFromNews([news("2021-06-03", "Żabka Group Acquires Controllng Stake In Dietary Marketplace Dietly.pl")], "Dietly", "id")!;
    expect(die.after).toMatch(/majority_acquired.*Żabka.*2021-06/);
  });
  it("SW-Mototech is not Mototech", () => {
    expect(onlyAsHyphenatedSuffix("SW-Mototech launches new panniers", "Mototech")).toBe(true);
    expect(onlyAsHyphenatedSuffix("Mototech raises a round; SW-Mototech is unrelated", "Mototech")).toBe(false);
    expect(namesCompanyUpFront({ title: "SW-Mototech launches new panniers", content: "" }, "Mototech")).toBe(false);
  });
  it("the acceptance checks: the owner's bad report fails, the corrected one passes", () => {
    const checks = JSON.parse(readFileSync("eval/acceptance_batch5.json", "utf8")) as Check[];
    const bad = rowsFromCsv(["company,field,after,source_url,quote",
      "Paradox AI,founded_year,2020,https://paradox.ai/news,x",
      "Dietly,news,2026-11-16 — Żabka przejmuje Dietly,https://mamstartup.pl/x,",
      "Six Degrees,founder,Alastair Mills — Founder,a,", "Six Degrees,founder,Alastair Mills — Founder and CEO,a,",
      "Mintifi,tags,Payments,https://mintifi.com,Drive growth"].join("\n"));
    const r = runAcceptance(checks, bad, [], TODAY);
    for (const id of ["paradox_founded", "no_run_date_news", "six_degrees_founder_once", "mintifi_lending", "humi_acquired"]) expect(r.find((x) => x.id === id)!.pass).toBe(false);
    const good = rowsFromCsv(["company,field,after,source_url,quote", "Paradox AI,round,Series C $200M · 2021-12-27,https://prnewswire.com/x,", "Mintifi,tags,\"Lending, Payments\",https://mintifi.com,x"].join("\n"));
    const g = runAcceptance(checks, good, ["Plott", "noo.ma", "Mototech"], TODAY);
    for (const id of ["paradox_founded", "paradox_series_c", "mintifi_lending", "no_run_date_news", "not_enriched_plott", "not_enriched_mototech"]) expect(g.find((x) => x.id === id)!.pass).toBe(true);
  });
});

describe("a locked sector (owner, round 10: Dietly → E-commerce & Retail › Marketplaces)", () => {
  it("replaces what the memory carried", () => {
    const r = applyRowRules([{ field: "sector", after: "Fintech", source_url: "u", quote: "q" }, { field: "tags", after: "Payments", source_url: "u", quote: "Dietly is a diet catering marketplace" }], "Dietly", TODAY).rows;
    expect(r.find((x) => x.field === "sector")!.after).toBe("E-commerce & Retail");
    expect(r.find((x) => x.field === "tags")!.after).toBe("Marketplaces");
  });
});

import { amountFromAddress } from "./hints";
import { dateStatedIn } from "./newsGate";
import { isListingOrSponsoredUrl as listing } from "./pageKind";
import { aliasesOf } from "./aliases";
describe("round 3 follow-up (owner, round 10)", () => {
  it("an article under /topic/<section>/ is an article; /tag/<name>/ is a list", () => {
    expect(listing("https://www.startupdaily.net/topic/fintech/payments-platform-tyro-buys-medical-fintech-startup-medipass/")).toBeNull();
    expect(listing("https://www.financemagnates.com/tag/cinkciarzpl/")).toBe("listing_page");
  });
  it("the sum of an announcement's address", () => {
    expect(amountFromAddress("https://www.prnewswire.com/news-releases/on-a-mission-to-build-the-next-generation-of-hr-paradox-raises-200m-series-c-301450591.html")?.amount).toBe(200_000_000);
    expect(amountFromAddress("https://x.com/news/acme-raises-450-million-in-funding")?.amount).toBe(450_000_000);
    expect(amountFromAddress("https://x.com/news/acme-launches-product")).toBeNull();
  });
  it("a carried round 'amount not disclosed' gets the sum from the address", () => {
    const url = "https://www.prnewswire.com/news-releases/paradox-raises-200m-series-c-301450591.html";
    const r = applyRowRules([{ field: "news", after: "2021-12-27 — Paradox Raises $200M Series C", source_url: url, quote: "" }, { field: "round", after: "Series C amount not disclosed · 2021-12-27 · lead Stripes", source_url: url, quote: "" }], "Paradox AI", TODAY).rows.filter((x) => x.field === "round");
    expect(r[0].after).toMatch(/Series C \$200M/);
  });
  it("a lead investor named only in the model's own quote is taken out", () => {
    const row = { field: "round", after: "Seed $1.5M · 2022-07-23 · lead Insud Pharma", source_url: "h", quote: "The startup announced a USD $1.5M seed round.", payload: JSON.stringify({ round: { lead_investor: "Insud Pharma" }, evidence: [{ field: "amount_raised", quote: "The startup announced a USD $1.5M seed round." }, { field: "lead_investor", quote: "Insud Pharma led the round" }] }) };
    expect(applyRowRules([row], "Choiz", TODAY).rows[0].after).not.toMatch(/Insud/);
  });
  it("a date in the week before the run must be stated in words", () => {
    expect(dateStatedIn("Published 12 November 2026 by Ann", "2026-11-12")).toBe(true);
    expect(dateStatedIn("Sold to US investors. Related stories.", "2026-11-12")).toBe(false);
    expect(rowProblem({ field: "news", after: "2026-11-12 — London-based Six Degrees Group sold to US investors", source_url: "https://x.com/a" }, "Six Degrees", TODAY, 7)).toMatch(/week/);
  });
  it("Conotoxia's news under the name Cinkciarz.pl", () => {
    expect(aliasesOf("Conotoxia")).toContain("Cinkciarz.pl");
    expect(rowProblem({ field: "news", after: "2025-10-29 — Cinkciarz.pl Collapses After Year-Long Scandal, Trustee Takes Control", source_url: "https://financefeeds.com/cinkciarz-pl-collapses" }, "Conotoxia", TODAY)).toBeNull();
  });
});

import { brandAsWritten, looksLikeAddress } from "./rowRules";
describe("round 4 follow-up (owner, round 10)", () => {
  it("a round listed twice is one", () => {
    const row = { field: "round", company: "Choiz", after: "Seed $1.5M · 2022-07-23", source_url: "h", quote: "The startup announced a USD $1.5M seed round." };
    expect(applyRowRules([row, { ...row }], "Choiz", TODAY).rows.filter((r) => r.field === "round")).toHaveLength(1);
  });
  it("a quote is never an address: the headline of the same article stands in, else the round is not kept", () => {
    const url = "https://www.prnewswire.com/news-releases/on-a-mission-paradox-raises-200m-series-c-301450591.html";
    const slug = "on-a-mission-paradox-raises-200m-series-c-301450591.html";
    expect(looksLikeAddress(slug)).toBe(true);
    expect(looksLikeAddress("Paradox Raises $200M Series C")).toBe(false);
    const news = { field: "news", company: "Paradox AI", after: "2021-12-27 — On a Mission to Build HR Software, Paradox Raises $200M Series C", source_url: url, quote: "" };
    const round = { field: "round", company: "Paradox AI", after: "Series C amount not disclosed · 2021-12-27", source_url: url, quote: slug };
    const r = applyRowRules([news, round], "Paradox AI", TODAY).rows.find((x) => x.field === "round")!;
    expect(r.after).toMatch(/Series C \$200M/);
    expect(r.quote).toMatch(/Raises \$200M Series C/);
    expect(applyRowRules([round], "Paradox AI", TODAY).rows.filter((x) => x.field === "round")).toHaveLength(0);
  });
  it("the news of 'Paradox AI' written as 'Paradox' names the company", () => {
    expect(rowProblem({ field: "news", after: "2021-12-27 — On a Mission, Paradox Raises $200M Series C", source_url: "https://www.prnewswire.com/news-releases/x.html" }, "Paradox AI", TODAY)).toBeNull();
  });
  it("the brand as the page writes it", () => {
    expect(brandAsWritten("tyrohealth", ["Tyro Health, formerly Medipass, offers EFTPOS terminals"])).toBe("Tyro Health");
    expect(brandAsWritten("Employment Hero CA", ["Humi, now part of Employment Hero, sells an all-in-one system"])).toBe("Employment Hero");
    expect(brandAsWritten("zzz", ["nothing here"])).toBe("zzz");
  });
});
