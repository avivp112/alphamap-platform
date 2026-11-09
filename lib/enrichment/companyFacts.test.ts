import { describe, it, expect } from "vitest";
import { aboutParagraph, factsFromAbout, legalFacts, aboutIsOf, releasePointsTo } from "./companyFacts";

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
  it("a street named after a city is not the registered city; a doubled word is dropped (field review run 1)", () => {
    const kraken = "Kraken Technologies Limited, company number 12014731. Registered office: Uk House, 4th Floor, 164-182 Oxford Street, London, United Kingdom, W1D 1NN.";
    expect(legalFacts(kraken, "Kraken Technologies")).toMatchObject({ registeredCity: "London", companyNumber: "12014731" });
    expect(legalFacts("Leverate Leverate Technological Trading Ltd. operates this site.", "Leverate").legalName).toBe("Leverate Technological Trading Ltd.");
  });
  it("an Israeli company number (ח.פ.)", () => {
    expect(legalFacts("גארדז סייבר בע\"מ, ח.פ. 516588902", "Guardz").companyNumber).toBe("516588902");
  });
});

describe("a namesake's press release (field review run 2)", () => {
  it("is used only when it points to the company's own domain", () => {
    const streak = "About Streak\nStreak is a Singapore-based company that envisions bringing institutional-quality algorithmic trading. For more information visit www.streak.tech";
    expect(releasePointsTo(streak, "streak.com")).toBe(false);
    expect(releasePointsTo("Learn more at https://www.mutiny.gg/about", "mutinyhq.com")).toBe(false);
    expect(releasePointsTo("Visit www.insightec.com.", "insightec.com")).toBe(true);
    expect(releasePointsTo("Contact: press@insightec.com", "https://www.insightec.com/")).toBe(true);
    expect(releasePointsTo("Visit getstreak.com or streak.com.sg", "streak.com")).toBe(false);
    expect(releasePointsTo("Visit streak.com", null)).toBe(false);
  });
});

describe("the headcount a press release states about its company (owner, 2026-11-05)", () => {
  it("an exact figure counts; 'more than', a range or an estimate does not", () => {
    expect(factsFromAbout("Acme is a Boston-based software company with 120 employees.", "Acme").employees).toBe(120);
    expect(factsFromAbout("Acme, founded in 2018, has a team of 85 and serves 400 customers.", "Acme").employees).toBe(85);
    expect(factsFromAbout("Argus is headquartered in Tel Aviv, Israel, has a team of more than 70 people.", "Argus").employees).toBeUndefined();
    expect(factsFromAbout("Acme has over 200 employees worldwide.", "Acme").employees).toBeUndefined();
    expect(factsFromAbout("Acme employs 50-100 people.", "Acme").employees).toBeUndefined();
    expect(factsFromAbout("Acme has 300+ employees.", "Acme").employees).toBeUndefined();
    expect(factsFromAbout("Acme serves 2,000 customers and 14 countries.", "Acme").employees).toBeUndefined();
  });
});

describe("legalFacts — a heading glued to the name (Datatruck, pilot dry run 4)", () => {
  it("keeps only the entity after the sentence stop", () => {
    expect(legalFacts("Disclose Your Information.Datatruck Inc. operates this site.", "Datatruck").legalName).toBe("Datatruck Inc.");
  });
});
