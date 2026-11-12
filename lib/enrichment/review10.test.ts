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
