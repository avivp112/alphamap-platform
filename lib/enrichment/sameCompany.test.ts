import { describe, it, expect } from "vitest";
import { sameSite, resolveCollision, parseSameCompany, buildSameCompanyRequest, type DbRecord } from "./sameCompany";

const db: DbRecord = { id: "1", name: "Omie", website: "https://omie.com", country: "Brazil", city: null, industry: "ERP", description: "Cloud ERP for small businesses." };
const base = { countryHint: () => "Brazil" };
describe("a name that matches a company in the database: the checks before the owner is asked", () => {
  it("one site: the same host or domain after the redirects", () => {
    expect(sameSite("www.doctolib.fr", "doctolib.fr")).toBe(true);
    expect(sameSite("app.x.com", "x.com")).toBe(true);
    expect(sameSite("lomi.cl", "lomi.com")).toBe(false);
    expect(sameSite(null, "x.com")).toBe(false);
  });
  it("an address that redirects to the other is the same company, without a model call", async () => {
    let asked = 0;
    const r = await resolveCollision({ ...base, finalHost: async (u) => (u.includes("cinnamon.ai") ? "cinnamon.is" : "cinnamon.is"), homepageText: async () => "", ask: async () => { asked++; return {}; } },
      { ...db, name: "Cinnamon AI", website: "https://cinnamon.is" }, "Cinnamon AI", "https://cinnamon.ai");
    expect(r).toMatchObject({ verdict: "same", how: "redirect" });
    expect(asked).toBe(0);
  });
  it("no redirect: the model compares the record with the homepage; same, different, unclear", async () => {
    const mk = (verdict: string, text = "x".repeat(300)) => resolveCollision({ ...base, finalHost: async (u) => new URL(u).hostname, homepageText: async () => text, ask: async () => ({ verdict, reason: "r" }) }, db, "Omie", "https://omie.com.br");
    expect((await mk("same")).verdict).toBe("same");
    expect((await mk("different")).verdict).toBe("different");
    expect((await mk("unclear")).verdict).toBe("unclear");
  });
  it("'different' on a homepage that could not be read is unclear, never a company added on no evidence", async () => {
    const r = await resolveCollision({ ...base, finalHost: async (u) => new URL(u).hostname, homepageText: async () => "", ask: async () => ({ verdict: "different", reason: "r" }) }, db, "Omie", "https://omie.com.br");
    expect(r.verdict).toBe("unclear");
  });
  it("the request holds both records; an answer that is not one of the three is unclear", () => {
    const req = buildSameCompanyRequest(db, "Omie", "https://omie.com.br", "ERP para empresas", "Brazil");
    expect(req.messages[0].content).toContain("country: Brazil");
    expect(req.messages[0].content).toContain("ERP para empresas");
    expect(parseSameCompany({ verdict: "maybe" }).verdict).toBe("unclear");
    expect(parseSameCompany(null).verdict).toBe("unclear");
  });
});
