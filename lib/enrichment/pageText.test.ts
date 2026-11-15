import { describe, it, expect } from "vitest";
import { stripNavigation, promptText, htmlToText } from "./pageText.ts";

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
});
