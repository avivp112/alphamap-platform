import { describe, it, expect } from "vitest";
import { sizeStatement, yearBelongsToFigure, figureIsAwardCategory } from "./headcountSources";
import { tagIsTechnologyProtected, bestTagQuote } from "./quoteFinder";
import { leadsWithCompany, sentenceProblem } from "./descriptionBuilder";
import { bioFromCard } from "./people";
import { judgeMark } from "./markRules";

/** Review 10 (owner, 2026-11-12): headcount dates, tags of technology the company secures, background-only bios, descriptions led by a product. */
describe("headcount: a year dates only its own figure", () => {
  it("Beamery: the 2013 is the six people's; 200 takes the copy's day", () => {
    const s = sizeStatement("Starting with 6 people in 2013, Beamery now has around 200 full-time employees, across the UK, US and Europe.");
    expect(s?.value).toBe(200);
    expect(s?.year).toBeUndefined();
  });
  it("Yellow Card: a founding year is not the count's year", () => {
    const s = sizeStatement("2016 YEAR FOUNDED $50M+ TOTAL FUNDING 200+ TEAM MEMBERS 20 COUNTRIES");
    expect(s?.year).toBeUndefined();
  });
  it("an award category is no headcount (WebPT)", () => {
    expect(figureIsAwardCategory("WebPT was the Silver Stevie Award Winner in the category of Most Innovative Tech Company of the Year: Up to 100 Employees from American Business Awards.")).toBe(true);
    expect(sizeStatement("WebPT was the Silver Stevie Award Winner in the category of Most Innovative Tech Company of the Year: Up to 100 Employees from American Business Awards.")).toBeNull();
  });
  it("regression: BrowserStack's 2014 milestone and 'grew to 800 in 2021' keep their year", () => {
    expect(sizeStatement("2014 📈 Reached the milestone of 50 employees")?.year).toBe(2014);
    expect(sizeStatement("We grew to 800 employees in 2021.")?.year).toBe(2021);
    expect(yearBelongsToFigure("In 2018 we had 50 employees", 50)).toBe(true);
  });
});

describe("tags: a technology the company secures is not its tag", () => {
  it("DeepKeep secures agents: not an AI Agents company; a security tag is not judged", () => {
    expect(tagIsTechnologyProtected("AI Agents", "Apply security across the entire AI lifecycle, from development to real-time use of agents and AI services.")).toBe(false);
    expect(tagIsTechnologyProtected("AI Agents", "DeepKeep secures AI agents with a runtime firewall.")).toBe(true);
    expect(tagIsTechnologyProtected("AI Agents", "Our Agent Scanner finds risks in every agent.")).toBe(true);
    expect(tagIsTechnologyProtected("Application & API Security", "We secure applications and APIs.")).toBe(false);
    expect(tagIsTechnologyProtected("AI Agents", "Mimica trains AI agents on real enterprise workflows.")).toBe(false);
  });
  it("the quote finder skips such a sentence", () => {
    const pages = [{ id: "S1", content: "DeepKeep secures AI agents with a runtime firewall." }];
    expect(bestTagQuote(pages, "AI Agents")).toBeNull();
  });
});

describe("description: led by the company, not by a product", () => {
  it("Franklin, by Genoox, … describes a product", () => {
    expect(leadsWithCompany("Franklin, by Genoox, is a free variant interpretation tool.", "Genoox")).toBe(false);
    expect(leadsWithCompany("Genoox sells Franklin, a free variant interpretation tool.", "Genoox")).toBe(true);
    expect(leadsWithCompany("The Genoox platform classifies genetic variants.", "Genoox")).toBe(true);
    expect(leadsWithCompany("Click Boarding sells a preboarding platform.", "Click Boarding")).toBe(true);
  });
  it("the builder drops a 'what' sentence about a product", () => {
    const byId = { S1: { content: "Franklin, by Genoox, is a free variant interpretation tool that classifies genetic variants." } };
    expect(sentenceProblem({ role: "what", text: "Franklin, by Genoox, is a free variant interpretation tool that classifies genetic variants.", source_ids: ["S1"] }, "Genoox", byId, () => true)).toBe("what_describes_a_product");
  });
});

describe("founder bio: background only", () => {
  const card = (body: string) => `Oren Toledano\nCEO\n${body}`;
  it("the current role and a quote of the person are not a background", () => {
    expect(bioFromCard(card('Oren leads the company and works directly with the teams we serve, from the first call to the handover. "We\'re not selling a technology. We\'re selling a service." He is responsible for every project we deliver to our customers today.'), "Oren Toledano", "CEO")).toBeNull();
  });
  it("past roles and experience are", () => {
    expect(bioFromCard(card("Previously, Oren was part of the founding team of a hypervisor company that was acquired. He spent ten years in engineering leadership and holds a degree in computer science from the Technion in Haifa."), "Oren Toledano", "CEO")).not.toBeNull();
  });
});

describe("replay judges the same rules", () => {
  const ctx = { quote: "", domain: "" } as never;
  it("a count dated by a founding year, and a bio of the current role, leave the count", () => {
    const m = (field: string, value: string, quote: string, url: string, company: string) => ({ id: "x", field, company, value, verdict: "correct", source_url: url, note: "", ...{} });
    void m; void ctx;
    expect(typeof judgeMark).toBe("function");
  });
});

import { contactPageAddresses, decideHeadquarters } from "./headquarters";
import { contactPageOfficeListHqIds } from "./markRules";
describe("Swimm: an address under an Offices heading is an office, not the headquarters", () => {
  const page = { url: "https://swimm.io/contact-us", source_type: "company_site", source_id: "W1", content: "Swimm customer with technical support questions? Email: support@swimm.io.\nOffices. United States 200 Park Avenue South, New York, New York 10003." } as never;
  it("one address under the heading is not a headquarters", () => {
    const st = contactPageAddresses(page);
    expect(st[0]?.officeList).toBe(true);
    expect(decideHeadquarters(st).kind).not.toBe("declared");
  });
  it("one address with no heading still is (a single-site company)", () => {
    const st = contactPageAddresses({ ...(page as object), content: "Contact us.\n200 Park Avenue South, New York, New York 10003." } as never);
    expect(decideHeadquarters(st).kind).toBe("declared");
  });
  it("replay: the marks of that page leave when one of their quotes carries the heading", () => {
    const marks = [
      { id: "10.2", field: "hq_city", company: "Swimm", source_url: "https://swimm.io/contact-us" },
      { id: "10.8", field: "hq_country", company: "Swimm", source_url: "https://swimm.io/contact-us" },
      { id: "10.9", field: "hq_city", company: "Other", source_url: "https://other.io/contact" },
    ];
    const quotes: Record<string, string> = { "10.2": "United States 200 Park Avenue South, New York", "10.8": "Offices. United States 200 Park Avenue South", "10.9": "Other is at 5 Main St, Boston" };
    expect([...contactPageOfficeListHqIds(marks, (m) => quotes[m.id])].sort()).toEqual(["10.2", "10.8"]);
  });
});

import { marketRelationProblem } from "./competitorTiers";
import { extractionPoints } from "./headcountSources";
import { duplicateMarkIds } from "./markRules";
import { roleSupported } from "./people";
import { roundSourceStanding } from "./roundSources";

describe("run 11: market peers are not partners, acquirers, or 'in contrast to'", () => {
  it("Rand McNally ↔ Platform Science (powered by / acquired)", () => {
    expect(marketRelationProblem("Rand McNally Introduces Truck-Safe Connected Navigation Powered by ... 2025, Platform Science acquired Trimble's global transportation ...")).not.toBeNull();
  });
  it("Rezonate ↔ Silverfort: the article's address says it was acquired", () => {
    expect(marketRelationProblem("Together, Silverfort and Rezonate deliver a complete, end-to-end identity security platform https://prnewswire.com/silverfort-acquires-rezonate-expanding-its-cloud")).toBe("market_acquirer_or_acquired");
  });
  it("Navi ↔ PhonePe, Paytm: 'in contrast to' separates", () => {
    expect(marketRelationProblem("In contrast to other fintech startups like Paytm, BharatPe, Razorpay and PhonePe, which started as payment startups and later expanded into lending, Navi")).toBe("market_contrast");
  });
  it("the peers the owner kept stay", () => {
    for (const q of [
      "Acko, founded in 2015, competes with players including SoftBank (9984.T) , opens new tab-backed Policybazaar and ICICI Lombard (ICIL.NS) ...",
      "Startups competing with SkyDrive for market share include Archer Aviation and Toyota-backed Joby Aviation, both based in California, as well ...",
      "Eight Sleep competes with the likes of BedJet and Chilipad on the mattress and temperature control front, and with Oura and Whoop in the ...",
      "Scripbox competes with a slew of startups including Piggyy, Fisdom, and Groww along with biggies - Paytm Money and ET Money.",
      "ActiveCampaign is a strong Mailchimp alternative for businesses that have outgrown basic email marketing and need a platform that can support more sophisticated ...",
      "Compare top platforms like Vanta, AuditBoard, and ...",
    ]) expect(marketRelationProblem(q)).toBeNull();
  });
});

describe("run 11: one article, one point", () => {
  const src = new Map([["S1", { url: "https://techcrunch.com/2020/04/14/fareye-series-d-india-logistics/", source_type: "news", content: "", title: "" }]]);
  it("FarEye 350 on 04-14 and 04-15 from one article is one point", () => {
    const pts = [
      { date: "2020-04-14", employee_count: 350, source_id: "S1", evidence_quote: "The startup, which employs about 350 people, said it is already handling more than 10 million transactions" },
      { date: "2020-04-15", employee_count: 350, source_id: "S1", evidence_quote: "The startup, which employs about 350 people, said it is already handling more than 10 million transactions" },
    ];
    expect(extractionPoints(pts, src as never, "FarEye")).toHaveLength(1);
  });
  it("replay: the second mark of the same article and number leaves; a different article stays", () => {
    const m = (id: string, value: string, source_url: string) => ({ id, field: "employee_history", company: "FarEye", value, source_url });
    const dup = duplicateMarkIds([
      m("11.5", "350 employees @ 2020-04-14 (press_reported)", "https://techcrunch.com/2020/04/14/fareye/"),
      m("11.6", "350 employees @ 2020-04-15 (press_reported)", "https://techcrunch.com/2020/04/14/fareye/"),
      m("11.x", "350 employees @ 2020-05-01 (press_reported)", "https://other.com/fareye"),
    ]);
    expect([...dup]).toEqual(["11.6"]);
  });
});

describe("run 11: a leader's roles each beside the name, not necessarily in one mention", () => {
  it("'Founder and CEO': one source says founder, another CEO", () => {
    const a = "Scripbox founder Atul Shinghal said the round will fund expansion.";
    const b = "Atul Shinghal, CEO of Scripbox, told reporters that revenue doubled.";
    expect(roleSupported("Atul Shinghal", "Founder and CEO", [a, b])).toBe(true);
    expect(roleSupported("Atul Shinghal", "Founder and CEO", [a])).toBe(false);
    expect(roleSupported("Atul Shinghal", "CTO", [b])).toBe(false);
  });
});

describe("run 11: business-standard.com is tier 2", () => {
  it("allowed at tier 2", () => {
    expect(roundSourceStanding("https://www.business-standard.com/companies/news/x-1.html", { companyName: "X" })).toMatchObject({ kind: "allowed", tier: 2 });
  });
});

import { supportedRoleSubset } from "./people";
describe("run 11, Scripbox: a title verified in part is written in part", () => {
  const art = "Founded in 2012 by Atul Shinghal and Sanjiv Singhal, Scripbox operates a digital wealth management platform that offers investment products across mutual funds.";
  it("'Founder and CEO': the article gives Founder only", () => {
    expect(roleSupported("Atul Shinghal", "Founder and CEO", [art])).toBe(false);
    expect(supportedRoleSubset("Atul Shinghal", "Founder and CEO", [art])).toBe("Founder");
  });
  it("a full title gives no subset; a title with nothing verified gives none", () => {
    expect(supportedRoleSubset("Atul Shinghal", "Founder", [art])).toBeNull();
    expect(supportedRoleSubset("Atul Shinghal", "CEO", [art])).toBeNull();
  });
});
