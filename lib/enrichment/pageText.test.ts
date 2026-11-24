import { describe, it, expect } from "vitest";
import { stripNavigation, promptText, htmlToText, footerWithFacts, promptCharsFor } from "./pageText.ts";

describe("a page for the model, and for the verifier (owner, 2026-11-15)", () => {
  const nav = "[Home](https://x.com)\n[Products](https://x.com/p)\nAbout\nPricing\nLogin\nContact\nBlog\n";
  it("takes navigation and cookie notices out", () => {
    const t = stripNavigation(`${nav}\nWe use cookies to improve your experience. Accept all.\n\nMOFT sells portable tech accessories, including MagSafe wallets and laptop stands, to owners of iPhones.\n`);
    expect(t).toContain("MOFT sells portable tech accessories");
    expect(t).not.toMatch(/cookies|\[Home\]/);
  });
  it("a short page goes whole", () => {
    const body = "Acme builds robots for warehouses and sells them to logistics companies across Europe.";
    expect(promptText(body, 6000)).toBe(body);
  });
  it("a long page keeps the opening, the passages around headquarters and founders, and the footer", () => {
    const filler = (n: number) => Array.from({ length: n }, (_, i) => `Marketing paragraph ${i} about how wonderful our fantastic product line is for every kind of customer in the world.`).join("\n");
    const page = `Acme sells robots to warehouses.\n${filler(120)}\nOur headquarters are at 33 Yonge Street, Toronto, Canada.\n${filler(40)}\nAcme was founded by Jane Doe and John Roe in 2015.\n${filler(60)}\nFooter: Acme Inc, Toronto.`;
    const out = promptText(page, 3000);
    expect(out.length).toBeLessThanOrEqual(3000);
    expect(out).toContain("Acme sells robots");
    expect(out).toContain("33 Yonge Street, Toronto");
    expect(out).toContain("founded by Jane Doe and John Roe");
    expect(out).toContain("Footer: Acme Inc");
  });
  it("what the model gets is always a part of the whole page (the verifier finds every quote in the full text)", () => {
    const page = Array.from({ length: 400 }, (_, i) => `Line ${i}: Acme was founded by Jane Doe in 2015 and has offices in Toronto ${i}.`).join("\n");
    const out = promptText(page, 2000);
    for (const piece of out.split("\n…\n")) expect(page).toContain(piece.trim().slice(0, 40));
  });
  it("html becomes text with headings kept", () => {
    const t = htmlToText("<html><script>x()</script><h1>FlowDesk</h1><p>Plan work.<br>Ship it.</p><a href=\"https://moft.com\">US shop</a></html>");
    expect(t).toContain("# FlowDesk");
    expect(t).toContain("Plan work.");
    expect(t).toContain("[US shop](https://moft.com)");
    expect(t).not.toContain("x()");
  });
  it("the bottom of a page keeps the legal name, the company number and the address (owner, 2026-11-23)", () => {
    const filler = Array.from({ length: 60 }, (_, i) => `Link ${i} to some other section of the site, nothing else.`).join("\n");
    const page = `Acme sells robots.\n${filler}\nAcme Robotics Ltd, registered in England, company number 01234567\nRegistered office: 12 High Street, London EC1A 1BB\n${Array.from({ length: 30 }, (_, i) => `Footer link ${i}`).join("\n")}`;
    const foot = footerWithFacts(page, 600);
    expect(foot).toContain("company number 01234567");
    expect(foot).toContain("12 High Street");
    expect(foot.length).toBeLessThanOrEqual(600);
  });
  it("6,000 characters for about, news and press pages, 3,000 for the others (owner, 2026-11-24)", () => {
    for (const u of ["https://a.com/about", "https://a.com/company", "https://a.com/news", "https://a.com/press", "https://a.com/press/kry-raises-usd66m", "https://a.com/en/press-releases/lendo-secures-28m", "https://a.com/newsroom/2024/x", "https://a.com/press/nyheter/kry-raises"]) expect(promptCharsFor(u)).toBe(6000);
    for (const u of ["https://a.com/", "https://a.com/products", "https://a.com/contact", "https://a.com/team", "https://a.com/impressum", "https://a.com/pricing"]) expect(promptCharsFor(u)).toBe(3000);
  });
});
