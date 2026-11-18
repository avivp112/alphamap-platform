import { describe, it, expect } from "vitest";
import { foundingSentenceIsAboutCompany as ok, shortNames, sentenceWithYear } from "./subject";

describe("founding sentence subject (owner, batch 7: rules rejected correct values)", () => {
  it("short names", () => {
    expect(shortNames("Ardens Health Informatics")).toContain("Ardens");
    expect(shortNames("Nilo Saúde")).toContain("Nilo");
    expect(shortNames("Canopy")).toEqual([]);
    expect(shortNames("Health Informatics")).toEqual([]);
  });
  it("the short name is the subject", () => {
    expect(ok("Founded in 2013, Ardens was created by GPs who shared a drive to make a difference", 2013, "Ardens Health Informatics", { ownSite: true, url: "https://ardens.org.uk/about/company" })).toBe(true);
    expect(ok("Fundada em 2020, a Nilo é uma healthtech brasileira que desenvolve infraestrutura operacional", 2020, "Nilo Saúde", { ownSite: false, url: "https://www.nilosaude.com.br/carreiras" })).toBe(true);
  });
  it("the company without its name, on a page about it", () => {
    expect(ok("A empresa foi fundada em julho de 2020 por Rafael Cló, Bernardo Ribeiro e Renato Farias.", 2020, "Azos", { url: "https://fintechs.com.br/empresas/azos/" })).toBe(true);
    expect(ok("The company was founded in 2018 and focuses on liver diseases.", 2018, "Inipharm", { url: "https://www.biospace.com/inipharm-closes-on-35-million-series-a-to-go-after-the-nash-market", title: "Inipharm Closes on $35 Million Series A" })).toBe(true);
    expect(ok("La société a été fondée en 2015 à Paris.", 2015, "Yomoni", { ownSite: true, url: "https://www.yomoni.fr/a-propos" })).toBe(true);
  });
  it("It was founded — only on a profile page of the company", () => {
    expect(ok("It was founded in 2015 and is based in Stockholm, Sweden.", 2015, "Luvly", { url: "https://www.cbinsights.com/company/luvly" })).toBe(true);
    expect(ok("It was founded in 2015 and is based in Stockholm, Sweden.", 2015, "Luvly", { url: "https://www.example.com/news/luvly-raises" })).toBe(false);
  });
  it("a label of the site itself", () => {
    expect(sentenceWithYear("Date of Establishment. October 24, 2014", 2014)).toBe("Date of Establishment. October 24, 2014");
    expect(ok("Date of Establishment. October 24, 2014", 2014, "WOTA", { ownSite: true, url: "https://wota.co.jp/en/company/" })).toBe(true);
    expect(ok("Mama Money. mamamoney.co.za. Founded: 2013. Co-Founders/Directors", 2013, "Mama Money", { url: "https://www.fxcintel.com/research/reports/x" })).toBe(true);
    expect(ok("Proudly educating since 2020", 2020, "Uxcel", { ownSite: true, url: "https://uxcel.com/about" })).toBe(true);
  });
  it("still not another company's sentence", () => {
    expect(ok("DHNY was founded in 2022 and runs clinics", 2022, "Canopy", { ownSite: true, url: "https://canopy.com/blog/dhny" })).toBe(false);
    expect(ok("Founded in 1901, the Whitechapel Gallery …", 1901, "Spin Studio", { url: "https://spinstudio.co.uk/projects/whitechapel" })).toBe(false);
    expect(ok("The company was founded in 1990 by Mr Smith.", 1990, "Ardens Health Informatics", { url: "https://other.com/news/some-other-firm" })).toBe(false);
  });
});
