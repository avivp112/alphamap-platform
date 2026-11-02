import { describe, it, expect } from "vitest";
import { aboutParagraph, factsFromAbout, legalFacts, aboutIsOf } from "./companyFacts";

describe("the About paragraph of the company's own press release (owner, 2026-11-02 — coverage a)", () => {
  const release = `Guardz raises $56M Series B\n\nTEL AVIV, Israel, May 5, 2025 /PRNewswire/ -- Guardz announced today ...\n\nAbout Guardz\nGuardz is a Tel Aviv-based cybersecurity company founded in 2022 that protects small businesses. The company also has an office in Miami.\n\nMedia Contact\npress@guardz.com`;
  it("finds the paragraph and reads the HQ and the founding year", () => {
    const p = aboutParagraph(release, "Guardz")!;
    expect(p).toMatch(/^Guardz is a Tel Aviv-based/);
    expect(aboutIsOf(p, "Guardz")).toBe(true);
    expect(factsFromAbout(p, "Guardz")).toMatchObject({ city: "Tel Aviv", foundedYear: 2022 });
  });
  it("'headquartered in' counts; a partner's '<City>-based' does not; incorporation yields to founding", () => {
    expect(factsFromAbout("Founded in 2020 and headquartered in Vancouver, Photonic builds quantum computers.", "Photonic")).toMatchObject({ city: "Vancouver", foundedYear: 2020 });
    expect(factsFromAbout("EnerVenue partners with Perth-based Avid Group across Australia.", "EnerVenue").city).toBeUndefined();
    expect(factsFromAbout("Carbeniumtec was founded in 2020 and incorporated in 2022.", "Carbeniumtec").foundedYear).toBe(2020);
  });
  it("no paragraph without the heading or the inline form", () => {
    expect(aboutParagraph("Guardz raised money from investors.", "Guardz")).toBeNull();
    expect(aboutParagraph("About Guardz: Guardz is an AI-native cybersecurity platform for MSPs, founded in 2022.", "Guardz")).toMatch(/founded in 2022/);
  });
});

describe("the legal pages (owner, 2026-11-02 — coverage b)", () => {
  it("the legal name, the company number and the registered office's city", () => {
    const terms = "This website is operated by ID Ward Limited, trading as Anonymised, a company registered in England and Wales with company number 10848384. Our registered office is at 7 Bell Yard, London WC2A 2JR.";
    expect(legalFacts(terms, "Anonymised")).toMatchObject({ companyNumber: "10848384", registeredCity: "London" });
    const kets = "KETS Quantum Security Ltd, registered in England, company no. 10239876. Registered office: Unit DX, St Philips, Bristol BS2 0QR.";
    expect(legalFacts(kets, "KETS Quantum Security")).toMatchObject({ legalName: "KETS Quantum Security Ltd", companyNumber: "10239876", registeredCity: "Bristol" });
  });
  it("an Israeli company number (ח.פ.)", () => {
    expect(legalFacts("גארדז סייבר בע\"מ, ח.פ. 516588902", "Guardz").companyNumber).toBe("516588902");
  });
});
