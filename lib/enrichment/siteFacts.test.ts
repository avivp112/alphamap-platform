import { describe, it, expect } from "vitest";
import { foundedYearFromSite, copyrightStartYear, foundedInCityYear } from "./siteFacts";

describe("founding year from the company's own site (owner, round 10)", () => {
  it("Founded / Established / Since / Est.", () => {
    expect(foundedYearFromSite("About us\nFounded in 2013, Acme builds boats.")).toMatchObject({ year: 2013 });
    expect(foundedYearFromSite("Acme — established 1998 in Leeds")).toMatchObject({ year: 1998 });
    expect(foundedYearFromSite("## Since 2005\nFamily run")).toMatchObject({ year: 2005 });
    expect(foundedYearFromSite("Est. 2011")).toMatchObject({ year: 2011 });
  });
  it("not launched, not ©, not another company's year", () => {
    expect(foundedYearFromSite("We launched in 2019 with one product.")).toBeNull();
    expect(foundedYearFromSite("© 2015 Acme Inc. All rights reserved.")).toBeNull();
    expect(foundedYearFromSite("Ann founded Acme after she sold her earlier company, Beta, in 2008.")).toBeNull();
    expect(foundedYearFromSite("Founded in 2090")).toBeNull();
  });
  it("© is only a sanity check: its first year, and an article's 'founded in <city> in <year>'", () => {
    expect(copyrightStartYear("Footer © 2015–2026 Acme")).toBe(2015);
    expect(copyrightStartYear("nothing")).toBeNull();
    expect(foundedInCityYear(["Acme was founded in Warsaw in 2016 by two engineers."], "Acme")).toMatchObject({ year: 2016, city: "Warsaw" });
    expect(foundedInCityYear(["Globex was founded in Berlin in 2012."], "Acme")).toBeNull();
  });
});

describe("'Since <year>' (owner, round 10: Paradox 2016, not 2020)", () => {
  it("rejects a growth phrase and an image alt", () => {
    expect(foundedYearFromSite("Paradox Named to Inc. 5000 List — Growing by More than 720% Since 2020")).toBeNull();
    expect(foundedYearFromSite("![Image 33: Paradox Named to List — Growing by 720% Since 2020](https://cdn/x.png)")).toBeNull();
  });
  it("accepts the shapes that state the start of the business", () => {
    expect(foundedYearFromSite("We have been in business since 2012 and serve banks.")?.year).toBe(2012);
    expect(foundedYearFromSite("Serving retailers across Europe since 2009.")?.year).toBe(2009);
    expect(foundedYearFromSite("Some text\nSince 2016\nMore text")?.year).toBe(2016);
  });
});
