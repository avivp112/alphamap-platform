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
