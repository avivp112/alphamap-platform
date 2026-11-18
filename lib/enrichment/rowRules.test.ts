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

import { brandFromTexts } from "./rowRules";
import { renderAcceptance, runAcceptance as runAcc } from "./acceptance";
describe("round 5 follow-up (owner, round 10)", () => {
  it("the brand after a purchase, as the company's pages write it", () => {
    expect(brandFromTexts("Medipass", ["Tyro Health, formerly Medipass, offers EFTPOS terminals"])).toBe("Tyro Health");
    expect(brandFromTexts("Medipass", ["Tyro Health, which operates under the Medipass name, provides EFTPOS terminals"])).toBe("Tyro Health");
    expect(brandFromTexts("Humi", ["Humi by Employment Hero is an all-in-one HR and payroll platform"])).toBe("Employment Hero");
    expect(brandFromTexts("Humi", ["Humi, now part of Employment Hero, sells an all-in-one system"])).toBe("Employment Hero");
    expect(brandFromTexts("Acme", ["Acme sells anvils."])).toBeNull();
  });
  it("one description per company: the run's own over the memory's", () => {
    const rows = [
      { field: "description", company: "Medipass", after: "Tyro Health, formerly Medipass, offers EFTPOS", origin: "new", source_url: "a", quote: "q" },
      { field: "description", company: "Medipass", after: "Tyro Health, which operates under the Medipass name, provides EFTPOS", origin: "known_source", source_url: "a", quote: "q" },
    ];
    const r = applyRowRules(rows, "Medipass", TODAY).rows.filter((x) => x.field === "description");
    expect(r).toHaveLength(1);
    expect(r[0].origin).toBe("new");
  });
  it("an error blocks the report, a gap does not", () => {
    const checks: any[] = [
      { id: "wrong", why: "a wrong value", kind: "absent", field: "round", match: "bad" },
      { id: "missing", why: "a missing value", kind: "present", company: "Humi", field: "round", match: "Series B", severity: "gap" },
    ];
    const gapOnly = runAcc(checks, [], [], TODAY);
    expect(renderAcceptance(gapOnly)).toMatch(/no error — 1 gap/);
    const err = runAcc(checks, [{ company: "X", field: "round", after: "bad round", source_url: "", quote: "" }], [], TODAY);
    expect(renderAcceptance(err)).toMatch(/1 ERROR/);
  });
});

import { chooseRegistryRecord } from "./registerRecord";
import { matchOpenCorporates, extractRegisterNumbers, parseKrsExtract, parseCnpj, matchByNumber, ilDate, type RegisterFinding } from "./registers";
describe("registers as columns of their own (owner, round 10)", () => {
  const f = (o: Partial<RegisterFinding>): RegisterFinding => ({ register: "uk_companies_house", entity: "Acme Ltd", number: "01", founded_year: 2018, founding_country: "United Kingdom", url: "u", quote: "q", match: "m", ...o });
  const ctx = { name: "Acme", siteText: "", siteCities: [] as string[] };
  it("the record is the entity in the headquarters country; a foreign register does not decide alone", () => {
    expect(chooseRegistryRecord([f({ founding_country: "Israel", entity: "Acme Ltd", incorporation_date: "2019-01-01" })], "Acme", "United Kingdom")).toBeNull();
    expect(chooseRegistryRecord([f({ incorporation_date: "2018-05-02" })], "Acme", null)).toBeNull();
    const r = chooseRegistryRecord([f({ incorporation_date: "2018-05-02", registered_address: "1 High St, London" })], "Acme", "United Kingdom")!;
    expect(r).toMatchObject({ legal_name: "Acme Ltd", incorporation_jurisdiction: "United Kingdom", registered_address: "1 High St, London", incorporation_date: "2018-05-02" });
  });
  it("incorporation date: the earliest among entries of the same company; a local subsidiary is not the company", () => {
    const us = f({ register: "us_sec_form_d", founding_country: "United States", incorporation_date: "2016", number: "CIK1" });
    const uk = f({ incorporation_date: "2018-05-02" });
    expect(chooseRegistryRecord([uk, us], "Acme", "United Kingdom")!.incorporation_date).toBe("2016");
    expect(chooseRegistryRecord([f({ entity: "Acme UK Ltd", incorporation_date: "2021-01-01" })], "Acme", "United Kingdom")).toBeNull();
  });
  it("OpenCorporates: name + country + a second signal; several entries → nothing written", () => {
    const item = (num: string, addr: string) => ({ company: { name: "Acme Ltd", company_number: num, jurisdiction_code: "gb", incorporation_date: "2018-05-02", registered_address_in_full: addr } });
    const one = matchOpenCorporates([item("111", "1 High St, London")], { ...ctx, siteCities: ["London"], country: "United Kingdom" });
    expect(one.finding?.number).toBe("111");
    const two = matchOpenCorporates([item("111", "1 High St, London"), item("222", "9 Low Rd, London")], { ...ctx, siteCities: ["London"], country: "United Kingdom" });
    expect(two.finding).toBeNull();
    expect(two.ambiguous).toHaveLength(2);
    expect(matchOpenCorporates([item("111", "1 High St, London")], { ...ctx, siteCities: ["London"], country: "Israel" }).finding).toBeNull();
    expect(matchOpenCorporates([item("111", "1 High St, Leeds")], { ...ctx, siteCities: ["London"], country: "United Kingdom" }).finding).toBeNull();
  });
  it("KRS and CNPJ by the number the site gives", () => {
    expect(extractRegisterNumbers("Spółka wpisana do KRS 0000123456, NIP 123").krs).toBe("0000123456");
    expect(extractRegisterNumbers("CNPJ: 12.345.678/0001-90").cnpj).toBe("12345678000190");
    const krs = parseKrsExtract({ odpis: { naglowekA: { dataRejestracjiWKRS: "14.03.2019" }, dane: { dzial1: { danePodmiotu: { nazwa: "ACME SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ" }, siedzibaIAdres: { adres: { ulica: "ul. Prosta", nrDomu: "1", kodPocztowy: "00-001", miejscowosc: "Warszawa" } } } } } }, "0000123456")!;
    expect(krs).toMatchObject({ date: "2019-03-14", address: "ul. Prosta 1, 00-001 Warszawa" });
    expect(parseCnpj({ razao_social: "ACME LTDA", data_inicio_atividade: "2015-02-10", logradouro: "RUA A", numero: "5", municipio: "SAO PAULO", uf: "SP", cep: "01000000" })?.date).toBe("2015-02-10");
    expect(matchByNumber("pl_krs", "0000123456", { entity: "ACME SP. Z O.O.", date: "2019-03-14", address: null }, { name: "Acme", siteText: "", siteCities: [] })?.incorporation_date).toBe("2019-03-14");
    expect(matchByNumber("pl_krs", "0000123456", { entity: "OTHER SP. Z O.O.", date: "2019-03-14", address: null }, { name: "Acme", siteText: "", siteCities: [] })).toBeNull();
  });
  it("the Israeli registrar's date", () => {
    expect(ilDate("14/03/2019")).toBe("2019-03-14");
    expect(ilDate("2019-03-14")).toBe("2019-03-14");
    expect(ilDate("2019")).toBe("2019");
  });
});

import { sentenceIsAboutCompany, isThirdPartyPage } from "./subject";
import { quoteIsNotASentence } from "./evidence";
import { foundedYearFromSite } from "./siteFacts";
import { companyLanguage, localQueries } from "./localSearch";
import { techOverride, techAccepted, sectorDecision } from "./techOverrides";
import { leaderRoleEvidence } from "./people";
describe("batch 6 (owner, round 10)", () => {
  it("a sentence is evidence about the company only when it is its subject", () => {
    expect(sentenceIsAboutCompany("DHNY was founded in 2022 in collaboration with AlleyCorp.", "Canopy", { ownSite: true })).toBe(false);
    expect(sentenceIsAboutCompany("Founded in 1901, the Whitechapel Gallery sits in the heart of London's East End.", "Spin Studio", { ownSite: true })).toBe(false);
    expect(sentenceIsAboutCompany("Estimote, Inc. was founded in 2012 by Jakub and Lukasz", "Estimote")).toBe(true);
    expect(sentenceIsAboutCompany("We were founded in 2015 in Austin.", "Acme", { ownSite: true })).toBe(true);
    expect(sentenceIsAboutCompany("We were founded in 2015 in Austin.", "Acme", { ownSite: false })).toBe(false);
    expect(sentenceIsAboutCompany("Founded in 2013", "Acme", { ownSite: true })).toBe(true);
  });
  it("customer, project and partner pages say nothing of the company's own founding", () => {
    expect(isThirdPartyPage("https://spin.co.uk/projects/whitechapel-gallery")).toBe(true);
    expect(isThirdPartyPage("https://x.com/case-studies/acme")).toBe(true);
    expect(isThirdPartyPage("https://x.com/about")).toBe(false);
    const text = "Founded in 1901, the Whitechapel Gallery sits in the heart of London.";
    expect(foundedYearFromSite(text, 2026, { companyName: "Spin Studio", ownSite: true })).toBeNull();
    expect(foundedYearFromSite("Spin Studio was founded in 2009.", 2026, { companyName: "Spin Studio", ownSite: true })?.year).toBe(2009);
  });
  it("a quote is a sentence, not page code", () => {
    expect(quoteIsNotASentence("Title: SPIN Studio URL Source: https://spin.co.uk/ Markdown Content: [Spin](https://spin.co.uk/)")).toBe(true);
    expect(quoteIsNotASentence("1. $1M Pre-seed Pre-seed, $1M, $1M raised to date")).toBe(true);
    expect(quoteIsNotASentence("Estimote sells indoor location and sensing technology.")).toBe(false);
  });
  it("a round type no quote names is Unknown, in the report too", () => {
    const row = (after: string, quote: string) => ({ field: "round", company: "Ripio", after, source_url: "u", quote });
    const out = (r: ReturnType<typeof row>) => applyRowRules([r], "Ripio", TODAY).rows[0].after;
    expect(out(row("Series A $1.9M · 2017-01-03", "Argentinian bitcoin startup Ripio has announced what may be the first funding round of the new year, raising $1.9m"))).toMatch(/^Unknown \$1\.9M/);
    expect(out(row("Other $100M · 2020-12-17", "The $100 million round was led by Grok Ventures"))).toMatch(/^Unknown \$100M/);
    expect(out(row("Seed $3.1M · 2013-12", "Estimote secured $3.1 million in Seed funding from Bessemer"))).toMatch(/^Seed \$3\.1M/);
  });
  it("the language of a company without a country: its domain, then its site", () => {
    expect(companyLanguage({ website: "https://kiwify.com.br" })).toBe("pt");
    expect(companyLanguage({ website: "https://supaero.fr" })).toBe("fr");
    expect(companyLanguage({ website: "https://zand.ae" })).toBe("ar");
    expect(companyLanguage({ website: "https://spin.co.uk" })).toBeNull();
    expect(companyLanguage({ country: "Poland" })).toBe("pl");
    expect(companyLanguage({ website: "https://ripio.com", siteText: "Nuestro equipo es una empresa para todos. Somos una empresa más." })).toBe("es");
    expect(localQueries("Kiwify", "", "pt").map(([l]) => l)).toEqual(["founders_local", "founded_local", "headquarters_local", "raises_local", "acquired_local"]);
    expect(localQueries("Kiwify", "", "pt")[0][1]).toContain("fundador");
  });
  it("the owner's tech and sector decisions of batch 6", () => {
    expect(techOverride("Spin Studio")).not.toBeNull();
    expect(techOverride("zpharm")).not.toBeNull();
    expect(techAccepted("Datahut")).toBe(true);
    expect(techAccepted("Holu")).toBe(true);
    expect(sectorDecision("Kiwify")).toEqual({ sector: "Consumer & Media", sub_sector: "EdTech" });
    expect(sectorDecision("Sherlok")).toEqual({ sector: "Fintech", sub_sector: "Lending" });
    expect(sectorDecision("Estimote")?.sub_sector).toBe("IoT & Connectivity");
  });
  it("a leader's executive role must be in a sentence with the name", () => {
    const src = [{ url: "u1", content: "In this demo, Sherlok founder Adam Grocke explains how Sherlok helps brokers." }, { url: "u2", content: "Paradox Hires Marc Chesley As CPO To Drive Product Innovation." }];
    expect(leaderRoleEvidence("Adam Grocke", "Founder & CEO", src)).toBeNull();
    expect(leaderRoleEvidence("Marc Chesley", "Chief Product Officer", src)?.url).toBe("u2");
  });
});

describe("batch 6, round 2: rounds and competitors unified, subject test", () => {
  it("founded_year: 'Contact us' and a .us domain are not the company speaking; the year's own sentence decides", () => {
    const q = "Canopy was founded in 2022 by DHNY. ... Contact us at hello@canopycare.us";
    expect(rowProblem({ field: "founded_year", after: "2022", source_url: "https://other.com/x", quote: "In 2022 the DHNY group launched a fund. Contact us today." }, "Canopy", TODAY)).toMatch(/not about the company/);
    expect(rowProblem({ field: "founded_year", after: "2022", source_url: "https://canopy.com/about", quote: q }, "Canopy", TODAY)).toBeNull();
  });
  it("one round per company+type+amount; the day beats the month", () => {
    const a = { field: "round", company: "Brighte", after: "Series A $4M · 2017-09 (month only)", source_url: "h", quote: "Brighte raised a $4M Series A round." };
    const b = { field: "round", company: "Brighte", after: "Series A $4M · 2017-09-05", source_url: "h2", quote: "Brighte raised a $4M Series A round." };
    const out = applyRowRules([a, b], "Brighte", TODAY).rows.filter((x) => x.field === "round");
    expect(out).toHaveLength(1);
    expect(out[0].after).toBe("Series A $4M · 2017-09-05");
    const c = applyRowRules([{ ...a, after: "Series A $5M · 2018", quote: "Brighte raised a $5M Series A round." }, b], "Brighte", TODAY).rows.filter((x) => x.field === "round");
    expect(c).toHaveLength(2);
  });
  it("competitors: names cleaned and merged; categories and other sites' comparison pages refused", () => {
    const rows = [
      { field: "competitor_declared", company: "SAMCO", after: "Dhan", source_url: "https://www.samco.in/dhan-vs-samco", quote: "Samco vs Dhan" },
      { field: "competitor_declared", company: "SAMCO", after: "Dhan (2026)", source_url: "https://www.samco.in/dhan-vs-samco-2026", quote: "Samco vs Dhan 2026" },
    ];
    const out = applyRowRules(rows, "SAMCO", TODAY).rows.filter((x) => x.field === "competitor_declared");
    expect(out.map((x) => x.after)).toEqual(["Dhan"]);
    expect(rowProblem({ field: "competitor_declared", after: "Real Estate", source_url: "https://www.samco.in/x", quote: "Samco vs Real Estate" }, "SAMCO", TODAY)).toMatch(/category/);
    expect(rowProblem({ field: "competitor_declared", after: "Xe", source_url: "https://www.xe.com/mbank-vs-xe", quote: "mBank vs Xe" }, "MBank", TODAY)).toMatch(/another site/);
  });
});

describe("batch 6, round 3: legal suffix does not split the founding sentence", () => {
  it("Estimote, Inc. was founded in 2012 stays", () => {
    expect(rowProblem({ field: "founded_year", after: "2012", source_url: "https://estimote.com/about", quote: "Estimote, Inc. was founded in 2012 and builds beacons." }, "Estimote", TODAY)).toBeNull();
    expect(rowProblem({ field: "founded_year", after: "2012", source_url: "https://www.crunchbase.com/x", quote: "Estimote, Inc. was founded in 2012." }, "Estimote", TODAY)).toBeNull();
  });
});

describe("IPO pages give no competitor", () => {
  it("Gaja on an IPO page of the company's own site", () => {
    expect(rowProblem({ field: "competitor_declared", after: "Gaja", source_url: "https://www.samco.in/ipo/gaja-capital-ipo", quote: "Gaja Capital India Ltd" }, "SAMCO", TODAY)).toMatch(/IPO/);
    expect(rowProblem({ field: "competitor_declared", after: "Dhan", source_url: "https://www.samco.in/dhan-vs-samco", quote: "Samco vs Dhan" }, "SAMCO", TODAY)).toBeNull();
  });
});

describe("hq_quote_valid", () => {
  it("prize text and event list fail; address and declaration pass", () => {
    const c = [{ id: "x", why: "x", kind: "hq_quote_valid" }] as never;
    const row = (company: string, quote: string) => ({ company, field: "hq_city", after: "X", source_url: "u", quote });
    expect(runAcceptance(c, [row("Kiwify", "além de uma placa exclusiva, você ganha uma viagem de Dubai"), row("Brighte", "Events: SXSW Sydney, Forbes")], [], "2026-11-17")[0].pass).toBe(false);
    expect(runAcceptance(c, [row("Canopy", "New York, NY 10003-1502"), row("Sherlok", "Adelaide-based startup Sherlok has secured $3.4 million")], [], "2026-11-17")[0].pass).toBe(true);
  });
});

import { missingRows, NOT_YET_BUILT_FIELDS } from "./knownGaps";
describe("missing list leaves out fields that cannot be filled yet", () => {
  it("registers are not listed", () => {
    const g = { c1: { company: "A", fields: { company_number: { field: "company_number", searched: [], rejected_candidates: [], last_run: "x", run_id: "r" }, hq_city: { field: "hq_city", searched: [], rejected_candidates: [], last_run: "x", run_id: "r" } } } } as never;
    expect(missingRows(g, ["c1"], new Set()).map((r) => r.field)).toEqual(["hq_city"]);
    expect(NOT_YET_BUILT_FIELDS.has("registered_address")).toBe(true);
  });
});

describe("batch 6, round 4: one set of rules for new and remembered headquarters", () => {
  const T = "2026-11-17";
  it("Kiwify's Dubai from prize text, Estimote's New York from a 2014 article", () => {
    expect(rowProblem({ field: "hq_city", after: "Dubai", source_url: "https://kiwify.com.br", quote: "Quando você atingir R$10 milhões na Kiwify, além de uma placa exclusiva, você e + 1 acompanhante vão ganhar uma viagem de Dubai" }, "Kiwify", T)).toMatch(/neither a street address/);
    expect(rowProblem({ field: "hq_city", after: "New York", source_url: "https://www.geekwire.com/2014/sticker-beacon-estimote-launching-tiny-nearables/", quote: "New York-based Estimote is launching" }, "Estimote", T)).toMatch(/only a year/);
    expect(rowProblem({ field: "hq_city", after: "Mumbai", source_url: "https://www.techcircle.in/2018/04/30/samco-raises", quote: "Mumbai-based online broker Samco" }, "SAMCO", T)).toBeNull();   // a dated article of any age
    expect(rowProblem({ field: "hq_city", after: "Adelaide", source_url: "https://www.mpamag.com/au/news/x", quote: "Adelaide-based startup Sherlok has secured $3.4 million" }, "Sherlok", T)).toBeNull();
  });
});

import { closedFromNews } from "./rowRules";
describe("closed company from its accepted news", () => {
  it("Okra shuts down → one acquired-field row, status closed, headline as quote; a purchase wins", () => {
    const news = [{ field: "news", after: "2025-06-01 — Okra shuts down after failing to raise funds", source_url: "https://techcabal.com/okra", quote: "" }];
    const r = closedFromNews(news, "Okra", "id1");
    expect(r?.after).toBe("status = closed · Closed (2025-06-01)");
    expect(r?.quote).toBe("Okra shuts down after failing to raise funds");
    expect(closedFromNews([...news, { field: "news", after: "2023-02-02 — Envision Pharma Group acquires Okra", source_url: "https://x.com/a", quote: "" }], "Okra", "id1")).toBeNull();
  });
});

describe("an ERROR points at the values that broke it (owner, batch 6)", () => {
  it("offenders are the rows, a missing value has none", () => {
    const checks = [
      { id: "no_dubai", why: "x", kind: "absent", company: "Kiwify", field: "hq_city", match: "Dubai" },
      { id: "needs_mumbai", why: "x", kind: "present", company: "SAMCO", field: "hq_city", match: "Mumbai" },
    ] as never;
    const rows = [{ company: "Kiwify", field: "hq_city", after: "Dubai", source_url: "u", quote: "q" }, { company: "Kiwify", field: "founder", after: "A B", source_url: "u", quote: "q" }];
    const res = runAcceptance(checks, rows, [], "2026-11-17");
    expect(res[0].offenders).toEqual([rows[0]]);
    expect(res[1].offenders).toBeUndefined();
  });
});

import { gateLines, parseRoundLine } from "./reportGate";
describe("the write follows the report (owner, batch 6: wet 1 wrote what the dry report had already removed)", () => {
  const T = "2026-11-18";
  it("a news item that does not name the company, a patent from a search page, a round type no quote names", () => {
    const lines = [
      { field: "news", after: "2025-12-10 — UAE telecom operator E& aims to offer stablecoin payments", source_url: "https://laraontheblock.com/uae", quote: "" },
      { field: "patent", after: "US3537134A MACHINE FOR CONTINUOUSLY BLOW-MOLDING", source_url: "https://worldwide.espacenet.com/patent/search?q=pn%3DUS3537134A", quote: "" },
      { field: "round", before: null, after: "Other $40M · 2025-11-04", source_url: "https://fintech.global/2025/11/04/brighte-secures-40m", quote: "Brighte secures $40m CEFC funding for home energy push" },
      { field: "round", before: null, after: "Series A $4M · 2017-09-05 · lead Mike Cannon-Brookes", source_url: "https://www.smartcompany.com.au/x", quote: "Brighte raised a $4M Series A round led by Mike Cannon-Brookes" },
    ];
    const g = gateLines(lines as never, "MBank", T);
    expect([...g.drop].sort()).toContain(0);
    expect([...g.drop]).toContain(1);
    const g2 = gateLines([lines[2]] as never, "Brighte", T);
    expect(g2.after.get(0)).toMatch(/^Unknown \$40M/);
    expect(parseRoundLine("Unknown $40M · 2025-11-04").type).toBe("Unknown");
    expect(parseRoundLine("Series A $4M · 2017-09-05 · lead Mike Cannon-Brookes")).toEqual({ type: "Series A", lead: "Mike Cannon-Brookes" });
  });
});

import { closureIn } from "./closure";
import { roundFromHeadline } from "./newsRounds";
import { sizeStatement } from "./headcountSources";
describe("batch 6, wet 1 findings", () => {
  it("Okra: 'Co-Founder Exits as Startup Shuts Down' is a closure of Okra", () => {
    expect(closureIn("Dabafinance - Okra Co-Founder Fara Ashiru Jituboh Exits as Startup Shuts Down", "Okra")).toBe(true);
    expect(closureIn("Okra raises $10M as startup grows", "Okra")).toBe(false);
  });
  it("one news item per address", () => {
    const a = { field: "news", company: "Okra", after: "2025-07-04 — Okra Co-Founder Exits", source_url: "https://dabafinance.com/en/news/okra", quote: "", origin: "new" };
    const b = { field: "news", company: "Okra", after: "2025-07-18 — Okra Co-Founder Exits", source_url: "https://www.dabafinance.com/en/news/okra", quote: "", origin: "known_source" };
    expect(applyRowRules([b, a] as never, "Okra", TODAY).rows.filter((r) => r.field === "news").map((r) => r.after)).toEqual(["2025-07-04 — Okra Co-Founder Exits"]);
  });
  it("a loan is a Debt round, not an equity one", () => {
    expect(roundFromHeadline("Brighte secures $40m loan facility to fund home energy", "Brighte")?.type).toBe("Debt");
    expect(roundFromHeadline("Brighte raises $4m Series A", "Brighte")?.type).toBe("Series A");
  });
  it("headcount: the last figure of 'grew from … to …'", () => {
    expect(sizeStatement("In 2021, the Brighte team grew from a team of 84 in Jan 2021 to a team of 181 in December 2021.")?.value).toBe(181);
  });
});

describe("batch 6: a dated press page is not the headcount of today", () => {
  it("the page-date regex of the current count covers /media/press-releases/", () => {
    const re = /\/(news|newsroom|blog|press|press-releases?|media|insights|stories|updates)(\/|-|$)/i;
    expect(re.test("https://brighte.com.au/media/press-releases/year-in-review-2021")).toBe(true);
    expect(re.test("https://canopycare.us/about")).toBe(false);
  });
});

describe("batch 6: remembered headcount values obey the same rules", () => {
  const T = "2026-11-18";
  it("Brighte's 2021 year-in-review is not the headcount of the run day", () => {
    const url = "https://brighte.com.au/media/press-releases/year-in-review-2021";
    const q = "In 2021, the Brighte team grew from a team of 84 in Jan 2021 to a team of 181 in December 2021.";
    expect(rowProblem({ field: "employee_count", after: "84", source_url: url, quote: q }, "Brighte", T)).toMatch(/not today's headcount/);
    expect(rowProblem({ field: "employee_range", after: "51-200", source_url: url, quote: q }, "Brighte", T)).toMatch(/not today's headcount/);
    expect(rowProblem({ field: "headcount_history", after: "84 on 2026-11-18 (site_stated)", source_url: url, quote: q }, "Brighte", T)).toMatch(/run day/);
    expect(rowProblem({ field: "employee_count", after: "20", source_url: "https://canopycare.us/about", quote: "20 people" }, "Canopy", T)).toBeNull();
  });
  it("archive copies of one statement keep the first and the last, the ones between are merged", () => {
    const mk = (d: string, quote: string) => ({ field: "headcount_history", company: "Datahut", after: `42 on ${d} (site_stated)`, source_url: `https://web.archive.org/web/${d.replace(/-/g, "")}/https://datahut.co/about`, quote });
    const q1 = "Our growth story We’ve bootstrapped Datahut with a very small team and within three years we’ve grown to 42 team members, a bigger office.";
    const q2 = "wth story We&rsquo;ve bootstrapped Datahut with a very small team and within three years we&rsquo;ve grown to 42 team members, a bigger office.";
    const rows = [mk("2025-01-20", q2), mk("2019-08-18", q1), mk("2021-01-27", q1), mk("2023-01-30", q2)];
    const out = applyRowRules(rows as never, "Datahut", T).rows.filter((r) => r.field === "headcount_history").map((r) => r.after.match(/on (\d{4}-\d{2}-\d{2})/)![1]).sort();
    expect(out).toEqual(["2019-08-18", "2025-01-20"]);
  });
});

import { isWritten, checkWritten } from "./writtenCheck";
describe("the report against the database", () => {
  const c = { id: "1", city: "Sydney", country: "Australia", founded_year: null, description: "Brighte provides easy finance for solar", industry: "Fintech", offices: [], founders: [{ name: "Katherine McConnell" }], leadership: [], competitors: [{ name: "Dhan" }], news: [{ url: "https://x.com/a" }], patents: [], status: "active",
    rounds: [{ round_type: "Series A", amount_raised: 4_000_000, announcement_date: "2017-09-05" }], headcount: [{ employee_count: 181, snapshot_date: "2022-02-08" }] } as never;
  it("finds what is there and names what is not", () => {
    expect(isWritten({ company_id: "1", company: "B", field: "hq_city", after: "Sydney" }, c)).toBe("yes");
    expect(isWritten({ company_id: "1", company: "B", field: "founded_year", after: "2015" }, c)).toBe("no");
    expect(isWritten({ company_id: "1", company: "B", field: "round", after: "Series A $4M · 2017-09-05 · lead X" }, c)).toBe("yes");
    expect(isWritten({ company_id: "1", company: "B", field: "round", after: "Unknown $0.4M · 2017-05-05" }, c)).toBe("no");
    expect(isWritten({ company_id: "1", company: "B", field: "headcount_history", after: "181 on 2022-02-08 (site_stated)" }, c)).toBe("yes");
    expect(isWritten({ company_id: "1", company: "B", field: "founder", after: "Pratik Adani — CTO" }, c)).toBe("no");
    expect(isWritten({ company_id: "1", company: "B", field: "tags", after: "X" }, c)).toBe("not_checked");
    const r = checkWritten([{ company_id: "1", company: "B", field: "hq_city", after: "Sydney" }, { company_id: "1", company: "B", field: "founded_year", after: "2015" }], new Map([["1", c]]));
    expect(r.missing.map((m) => m.field)).toEqual(["founded_year"]);
  });
});

import { paceKey } from "./recorder";
import { recentRules, ruleOf, RULES } from "./ruleRegistry";
describe("pace and rule codes (batch 7)", () => {
  it("a page read through the reader belongs to the address' site; providers are not throttled per site", () => {
    expect(paceKey("https://r.jina.ai/https://www.brighte.com.au/about")).toEqual({ kind: "site", key: "brighte.com.au" });
    expect(paceKey("https://r.jina.ai/https://blog.estimote.com/post/1")).toEqual({ kind: "site", key: "estimote.com" });
    expect(paceKey("https://google.serper.dev/search")).toEqual({ kind: "provider", key: "google.serper.dev" });
    expect(paceKey("https://web.archive.org/web/2020/https://datahut.co/about")).toEqual({ kind: "site", key: "archive.org" });
  });
  it("recent rules are the ones added in the last seven days; a line gets its rule by field and text", () => {
    const r = recentRules("2026-11-20");
    expect(r.has("hq_from_approved_quote")).toBe(true);
    expect(r.has("hq_from_site_address")).toBe(false);
    expect(RULES.every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.added))).toBe(true);
    expect(ruleOf({ field: "hq_city", after: "Adelaide" }, [{ field: "hq_city", rule: "hq_from_approved_quote", value: "Adelaide" }])).toBe("hq_from_approved_quote");
    expect(ruleOf({ field: "hq_city", after: "Sydney" }, [{ field: "hq_city", rule: "hq_from_approved_quote", value: "Adelaide" }])).toBe("");
  });
});

import { cleanPersonName } from "./people";
describe("batch 7: names of people", () => {
  it("no function word before, no role fragment after", () => {
    expect(cleanPersonName("As Karim Nour")).toBe("Karim Nour");
    expect(cleanPersonName("Karim Nour Co")).toBe("Karim Nour");
    expect(cleanPersonName("Sumair Farooqui")).toBe("Sumair Farooqui");
    expect(cleanPersonName("Jakub Krzych CEO")).toBe("Jakub Krzych");
    expect(cleanPersonName("Co Lee")).toBe("Co Lee");
  });
});

import { detectAcquisition, acquirerIn } from "./acquisition";
describe("batch 7: the buyer's name and the purchase date", () => {
  it("no country in front of the buyer; the first announcement dates it", () => {
    expect(acquirerIn("Egypts Raseedi Acquires Kashat To Expand Fintech", "Kashat")?.acquirer).toBe("Raseedi");
    expect(acquirerIn("Egypt's Raseedi acquires Kashat", "Kashat")?.acquirer).toBe("Raseedi");
    expect(acquirerIn("Kashat acquired by UK-based Acme", "Kashat")?.acquirer).toBe("Acme");
    const c = detectAcquisition([{ url: "a", title: "Raseedi completes acquisition of Kashat", date: "2025-01-13" }, { url: "b", title: "Egypts Raseedi Acquires Kashat To Expand Fintech", date: "2025-01-23" }], "Kashat");
    expect(c?.acquirer).toBe("Raseedi");
    expect(c?.date).toBe("2025-01-13");
  });
});

import { caseName } from "./nameCase";
describe("batch 7: evidence rules", () => {
  const T = "2026-11-20";
  it("tags: a careers page, a job advertisement, a menu and a person's speech are no evidence", () => {
    expect(rowProblem({ field: "tags", after: "Healthcare SaaS", source_url: "https://www.nilosaude.com.br/carreiras-account-executive", quote: "Experiência comprovada em vendas B2B de tecnologia" }, "Nilo Saúde", T)).toMatch(/careers|job/);
    expect(rowProblem({ field: "tags", after: "Mobility", source_url: "https://www.zuldigital.com.br/entrar", quote: "Digital CRLV · ZUL+ Tag · Taxes · Auto Insurance · Rodízio." }, "Zul+", T)).toMatch(/menu/);
    expect(rowProblem({ field: "tags", after: "Marketplaces", source_url: "https://snupit.co.za/x", quote: "Samlall said, ''At Snupit we like to keep a finger on the market's pulse." }, "Snupit", T)).toMatch(/speech/);
    expect(rowProblem({ field: "tags", after: "D2C", source_url: "https://gousto.co.uk", quote: "Gousto sells recipe boxes, delivered to the customer's door, that contain fresh ingredients." }, "Gousto", T)).toBeNull();
  });
  it("news: paid distribution, sponsored paths, republishers and product reviews", () => {
    expect(rowProblem({ field: "news", after: "2020-03-30 — Snupit Expands Internationally", source_url: "https://news.marketersmedia.com/snupit-expands/88951584/", quote: "" }, "Snupit", T)).toMatch(/paid press/);
    expect(rowProblem({ field: "news", after: "2023-06-22 — Zul Digital expande operações", source_url: "https://valor.globo.com/patrocinado/dino/noticia/2023/06/22/zul", quote: "" }, "Zul Digital", T)).toMatch(/sponsored/);
    expect(rowProblem({ field: "news", after: "2026-07-01 — Gousto review 2026, here's my honest verdict", source_url: "https://www.the-independent.com/extras/gousto-review", quote: "" }, "Gousto", T)).toMatch(/review/);
    expect(rowProblem({ field: "news", after: "2019-04-15 — Snupit Releases Results From its Popular Small Business Survey", source_url: "https://finance.yahoo.com/news/snupit-releases-results-popular-small-143800986.html", quote: "" }, "Snupit", T)).toMatch(/not allowed|republish/);
  });
  it("office needs a quote; people shown on a page give no range; capitals become a name", () => {
    expect(rowProblem({ field: "office", after: "São Paulo", source_url: "https://www.nilosaude.com.br/terms", quote: "" }, "Nilo Saúde", T)).toMatch(/needs a quote/);
    expect(rowProblem({ field: "employee_range", after: "1-10", source_url: "https://sycamore.ng/about-us", quote: "5 people with a name and a role are shown on the page" }, "Sycamore", T)).toMatch(/lower bound/);
    expect(caseName("MICROSOFT")).toBe("Microsoft");
    expect(caseName("IBM")).toBe("IBM");
    expect(caseName("Mon Petit Placement")).toBe("Mon Petit Placement");
  });
});

import { siteBelongsToAnotherCompany } from "./siteOwner";
describe("acquired companies are enriched as usual (owner, batch 7)", () => {
  const page = (content: string) => [{ url: "https://sikhona.co.za", content } as never];
  const filler = " Sikhona money transfers to and from South Africa. Send money safely with Sikhona at any branch.".repeat(8);
  it("a page that says the company was bought and still names it is its own page", () => {
    expect(siteBelongsToAnotherCompany("Sikhona", "https://sikhona.co.za", page(`Ria Money Transfer acquired Sikhona. ${filler}`))).toBeNull();
  });
  it("a page that names the company once, in the sale, still is (owner, batch 7: Sikhona); one the address moved away from is not", () => {
    expect(siteBelongsToAnotherCompany("Hofy", "https://other.com", page(`Deel acquires Hofy. ${"Deel runs global payroll for teams everywhere. ".repeat(20)}`))).toBeNull();
    expect(siteBelongsToAnotherCompany("Hofy", "https://hofy.com", [{ url: "https://hofy.com", content: `Final URL: https://www.deel.com/it/\n\nMarkdown Content:\nDeel acquires Hofy. ${"Deel runs global payroll for teams everywhere. ".repeat(20)}` } as never])).toMatch(/acquired \/ rebranded/);
  });
});

describe("a founder from a republisher with no allowed original (owner, batch 7: Snupit, yahoo.com)", () => {
  it("is not a row", () => {
    const r = { field: "founder", after: "Avinash Samlall — Founder", source_url: "https://za.finance.yahoo.com/news/snupit-founder-123.html", quote: "Avinash Samlall is the founder of Snupit." };
    expect(rowProblem(r as never, "Snupit", "2026-11-18")).toMatch(/not allowed/);
  });
});

import { runAcceptance } from "./acceptance";
describe("round_type_in_quote leaves a 'filled' row alone (owner, batch 7: Inipharm)", () => {
  it("is not an offender", () => {
    const rows = [{ company: "Inipharm", field: "round", after: 'Series A filled: {"lead_investor":"5AM Ventures"}', quote: "5AM Ventures and Wu Capital joined existing investors Frazier.", source_url: "https://biospace.com/x" }];
    const res = runAcceptance([{ id: "round_type_in_quote", why: "w", kind: "round_type_in_quote" }] as never, rows as never, [], "2026-11-18");
    expect(res[0].pass).toBe(true);
  });
});

import { claims, sentenceProblem } from "./descriptionBuilder";
import { roundSourceStanding as standingOf } from "./roundSources";
describe("description checks that rejected correct sentences (owner, batch 7 sample)", () => {
  it("B2B is not the number 2B; ETF-based is not a name", () => {
    expect(claims("ShopX sells a B2B enterprise application that helps small retailers.", "ShopX").numbers).toEqual([]);
    expect(claims("Yomoni offers online wealth management through ETF-based portfolios.", "Yomoni").names).toEqual([]);
    expect(claims("more than 2,500 companies use it", "X").numbers).toEqual(["2500"]);
  });
  it("2,500 is 2.500 on a Portuguese page; Brazil is Brasil", () => {
    const byId = { s1: { content: "Mais de 2.500 empresas usam a Contraktor. A plataforma de Contraktor é para equipes jurídicas, comerciais e operacionais das empresas.", source_type: "company_site" } };
    expect(sentenceProblem({ role: "for_whom", text: "Its platform is built for legal, commercial and operational teams in companies, and more than 2,500 companies use Contraktor.", source_ids: ["s1"] }, "Contraktor", byId as never, () => true) ?? "").not.toMatch(/number_not_in_sources/);
    const b2 = { s1: { content: "A Ksecurity vende serviços de segurança da informação a empresas, incluindo instituições financeiras que precisam cumprir as resoluções do Central Bank do Brasil.", source_type: "company_site" } };
    expect(sentenceProblem({ role: "what", text: "Ksecurity sells its information security services to businesses, including financial institutions that must comply with Central Bank of Brazil resolutions.", source_ids: ["s1"] }, "KSecurity", b2 as never, () => true) ?? "").not.toMatch(/name_not_in_sources/);
  });
  it("accessnewswire.com is the wire accesswire.com became", () => {
    expect(standingOf("https://www.accessnewswire.com/newsroom/en/x/kontent-ai-launches-1129445", { companyName: "Kontent.ai" }).kind).toBe("allowed");
  });
});

describe("name claims are for companies, products and people (owner, batch 7)", () => {
  it("not a country or a compound with a plain word", () => {
    expect(claims("Ksecurity serves banks that must comply with Central Bank of Brazil rules in Germany and Latin America.", "KSecurity").names).not.toContain("Brazil");
    expect(claims("Ksecurity serves banks in Germany.", "KSecurity").names).not.toContain("Germany");
    expect(claims("It offers ETF-based and Cloud-native portfolios.", "Yomoni").names).toEqual([]);
    expect(claims("The platform integrates with Salesforce and Stripe.", "Acme").names).toEqual(["Salesforce", "Stripe"]);
  });
});

import { completeFromSlug, newsProblem as newsProblem2 } from "./newsRelevance";
import { knownAcquirers } from "./acquisition";
describe("news: a headline cut in a print, and a company that was bought (owner, batch 7)", () => {
  it("completes a cut headline from its address", () => {
    const url = "https://www.lwolf.com/press-releases/lone-wolf-acquires-liondesk-and-homespotter-expanding-real-estates-leading-end-to-end-technology-suite";
    expect(completeFromSlug("Lone Wolf acquires LionDesk and HomeSpotter, expanding real ", url)).toBe("Lone Wolf acquires LionDesk and HomeSpotter, expanding real estates leading end to end technology suite");
    expect(completeFromSlug("Something else entirely about a deal", url)).toBeNull();
    expect(completeFromSlug("Short", url)).toBeNull();
  });
  it("the buyer of a company found in several headlines makes its acquisition headlines news about it", () => {
    const titles = ["Alexforbes buys digital wealth platform OUTvest as it continues to snap up acquisitions", "OUTsurance Sale Of OUTvest Proprietary Limited To Alexforbes", "Alexforbes acquires digital investments platform from outsurance", "Outvest raises seed"];
    expect(knownAcquirers(titles, "Outvest")).toContain("Alexforbes");
    const item = { title: titles[0], content: "" };
    expect(newsProblem2(item, "Outvest", "A robo-advisor for retirement savings.")).toBe("different_product");
    expect(newsProblem2(item, "Outvest", "A robo-advisor for retirement savings.", { acquirers: ["Alexforbes"] })).toBeNull();
  });
});

describe("one headline on one date is one news item whatever the address (owner, batch 7)", () => {
  it("merges", () => {
    const rows = [
      { company: "Inipharm", field: "news", after: "2024-05-22 — Inipharm to Present Pharmacokinetic Data at a conference", source_url: "https://inipharm.com/news/a", quote: "Inipharm to Present Pharmacokinetic Data" },
      { company: "Inipharm", field: "news", after: "2024-05-22 — Inipharm to Present Pharmacokinetic Data at a conference", source_url: "https://www.globenewswire.com/news-release/b", quote: "Inipharm to Present Pharmacokinetic Data" },
    ];
    expect(applyRowRules(rows as never, "Inipharm", "2026-11-18").rows.length).toBe(1);
  });
});

describe("a short headline that is its address' whole slug is whole (owner, batch 7)", () => {
  it("confirms it", () => {
    expect(completeFromSlug("Alexforbes buys Outvest", "https://dailyinvestor.com/finance/43233/alexforbes-buys-outvest/")).toBe("Alexforbes buys Outvest");
    expect(completeFromSlug("Alexforbes buys Outvest", "https://dailyinvestor.com/finance/43233/something-else-entirely/")).toBeNull();
  });
});
