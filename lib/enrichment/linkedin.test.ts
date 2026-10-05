import { describe, it, expect } from "vitest";
import {
  normalizeLinkedInProfileUrl, samePersonName, parseLinkedInPersonResult, findPersonProfile, discoverFounders, founderTitleFromHeadline,
} from "./linkedin";

const results = [
  { url: "https://fr.linkedin.com/in/jlqueguiner?trk=x", title: "Jean-Louis Quéguiner - Gladia | LinkedIn", content: "Co-founder & CEO at Gladia. Paris, Île-de-France." },
  { url: "https://www.linkedin.com/in/jonathan-soto-123", title: "Jonathan Soto – Co-founder & CTO – Gladia | LinkedIn", content: "Building speech AI." },
  { url: "https://www.linkedin.com/in/someone-else", title: "Jane Doe - Gladiator Labs | LinkedIn", content: "Founder at Gladiator Labs" },
  { url: "https://www.crunchbase.com/person/jean-louis-queguiner", title: "Jean-Louis Quéguiner - Crunchbase", content: "Founder of Gladia" },
  { url: "https://www.linkedin.com/in/anna-j", title: "Anna Jelezovskaia - Founding Marketing - Gladia | LinkedIn", content: "Marketing at Gladia" },
];

describe("LinkedIn profile URLs", () => {
  it("canonicalizes regional hosts and strips tracking params; rejects non-/in/ pages", () => {
    expect(normalizeLinkedInProfileUrl("https://fr.linkedin.com/in/JLQueguiner?trk=x")).toBe("https://www.linkedin.com/in/jlqueguiner");
    expect(normalizeLinkedInProfileUrl("https://www.linkedin.com/company/gladia")).toBeNull();
    expect(normalizeLinkedInProfileUrl("https://www.crunchbase.com/person/x")).toBeNull();
  });
  it("matches names by first + last token, ignoring accents and middle names", () => {
    expect(samePersonName("Jean-Louis Queguiner", "Jean-Louis Quéguiner")).toBe(true);
    expect(samePersonName("John A. Smith", "John Smith")).toBe(true);
    expect(samePersonName("John Smith", "Jane Smith")).toBe(false);
  });
});

describe("findPersonProfile / discoverFounders", () => {
  it("finds a known founder's /in/ profile, never the Crunchbase person page", () => {
    expect(findPersonProfile("Jean-Louis Queguiner", results, "Gladia")).toBe("https://www.linkedin.com/in/jlqueguiner");
  });
  it("never matches a profile from a different company with a similar name", () => {
    expect(findPersonProfile("Jane Doe", results, "Gladia")).toBeNull();
  });
  it("discovers self-declared founders of THIS company only", () => {
    const found = discoverFounders(results, "Gladia");
    expect(found.map((f) => f.name)).toEqual(["Jean-Louis Quéguiner", "Jonathan Soto"]);
    expect(found.every((f) => f.url.startsWith("https://www.linkedin.com/in/"))).toBe(true);
  });
  it("does not treat 'Founding Marketing' as a founder", () => {
    expect(parseLinkedInPersonResult(results[4], "Gladia")?.isFounder).toBe(false);
  });
  it("derives a title from the headline", () => {
    expect(founderTitleFromHeadline("Co-founder & CTO - Gladia", "Gladia")).toBe("Co-founder & CTO");
    expect(founderTitleFromHeadline("Gladia", "Gladia")).toBe("Founder");
  });
});

describe("background facts from the LinkedIn search snippet", async () => {
  const { parseLinkedInFacts, bioFromLinkedInFacts } = await import("./linkedin");
  it("reads education, prior experience and elite flags only from what the snippet states", () => {
    const facts = parseLinkedInFacts("Dana Levi - Co-founder & CEO - Acme | LinkedIn Co-founder & CEO at Acme · Experience: Google · Education: Technion - Israel Institute of Technology · Location: Tel Aviv. Former Unit 8200 officer.");
    expect(facts.education).toEqual(["Technion - Israel Institute of Technology"]);
    expect(facts.experience).toEqual(["Google"]);
    expect(facts.eliteUnit).toBe("Unit 8200");
    expect(facts.eliteSchool).toBe("Technion");
    expect(bioFromLinkedInFacts(facts, "Acme")).toBe("Previously at Google. Studied at Technion - Israel Institute of Technology. Served in Unit 8200.");
  });
  it("leaves out the company itself as 'previous' and returns null when the snippet states nothing", () => {
    const facts = parseLinkedInFacts("Experience: Acme · Location: Paris");
    expect(bioFromLinkedInFacts(facts, "Acme")).toBeNull();
    expect(parseLinkedInFacts("Education: Tel Aviv University").eliteSchool).toBeNull();
  });
});
