import { describe, it, expect } from "vitest";
import { checkFoundingCountry, checkIsraelRnd, isIsraelRelated } from "./origin";

describe("founding country", () => {
  it("keeps a founding sentence that names the country or one of its cities", () => {
    expect(checkFoundingCountry("Israel", "Wiz was founded in Israel in 2020 by Assaf Rappaport")).toBeNull();
    expect(checkFoundingCountry("Israel", "the company, founded in Tel Aviv in 2021, moved its headquarters to New York")).toBeNull();
    expect(checkFoundingCountry("Germany", "Black Forest Labs, founded in August 2024 in Freiburg, Germany")).toBeNull();
  });

  it("keeps the country's adjective used for the company itself", () => {
    expect(checkFoundingCountry("Israel", "Israeli cybersecurity startup Upwind raised $250 million")).toBeNull();
    expect(checkFoundingCountry("France", "the French AI company Mistral")).toBeNull();
  });

  it("drops a founder's nationality, a customer or an office", () => {
    // A person, not the company.
    expect(checkFoundingCountry("Israel", "CEO Assaf Rappaport, an Israeli Army veteran, said")).toBe("founding_country_not_stated");
    expect(checkFoundingCountry("Israel", "co-founder and CEO Assaf Rappaport, an Israeli Army veteran")).toBe("founding_country_not_stated");
    // "Israeli" and "company" in one sentence, but not about each other.
    expect(checkFoundingCountry("Israel", "CEO Amiram Shachar, an Israeli Army veteran, said the company will hire")).toBe("founding_country_not_stated");
    // An office is not the founding place.
    expect(checkFoundingCountry("Israel", "The company also has an office in Tel Aviv")).toBe("founding_country_not_stated");
    // The quote names another country.
    expect(checkFoundingCountry("Israel", "founded in 2020 and headquartered in New York")).toBe("founding_country_not_stated");
    expect(checkFoundingCountry("Israel", null)).toBe("founding_country_not_stated");
  });

  it("does not read 'Israel' inside another word", () => {
    expect(checkFoundingCountry("India", "founded by an Indianapolis team")).toBe("founding_country_not_stated");
  });
});

describe("R&D centre in Israel", () => {
  it("keeps an R&D or engineering centre in Israel", () => {
    expect(checkIsraelRnd(true, "headquartered in San Francisco with its R&D center in Tel Aviv")).toBeNull();
    expect(checkIsraelRnd(true, "100 employees in its Tel Aviv development center")).toBeNull();
    expect(checkIsraelRnd(true, "its engineering team in Israel")).toBeNull();
  });

  it("drops a sales office, or R&D somewhere else", () => {
    expect(checkIsraelRnd(true, "a sales office in Tel Aviv")).toBe("israel_rnd_not_stated");
    expect(checkIsraelRnd(true, "its R&D center in Berlin")).toBe("israel_rnd_not_stated");
  });
});

describe("Israel-related", () => {
  it("is founded, R&D or HQ in Israel", () => {
    expect(isIsraelRelated({ country: "United States", founding_country: "Israel" })).toBe(true);
    expect(isIsraelRelated({ country: "United States", israel_rnd_center: true })).toBe(true);
    expect(isIsraelRelated({ country: "Israel" })).toBe(true);
    expect(isIsraelRelated({ country: "United States", founding_country: "United States" })).toBe(false);
  });
});
