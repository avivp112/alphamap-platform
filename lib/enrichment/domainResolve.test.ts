import { describe, it, expect } from "vitest";
import { candidateSites, resolveDomain, ccTld } from "./domainResolve";

const client = (answer: { is_the_company: boolean; confidence: string }) => ({ messages: { create: async () => ({ content: [{ type: "tool_use", input: { ...answer, reason: "r" } }], usage: { input_tokens: 1, output_tokens: 1 } }) } }) as never;
describe("the right website (owner, round 10)", () => {
  it("leaves out directories, social sites, the address on file and repeats", () => {
    const r = candidateSites([{ url: "https://www.linkedin.com/company/x", title: "" }, { url: "https://nipponichi.jp/a", title: "" }, { url: "https://nisamerica.com/", title: "NIS" }, { url: "https://nisamerica.com/about", title: "" }, { url: "https://www.crunchbase.com/organization/x", title: "" }], "nipponichi.jp");
    expect(r.map((x) => x.host)).toEqual(["nisamerica.com"]);
  });
  it("takes a site only when its page names the company and the model is sure", async () => {
    const deps = (name: string, answer: { is_the_company: boolean; confidence: string }, page: string | null) => ({ client: client(answer), model: "m", search: async () => [{ url: "https://nisamerica.com/", title: "Nippon Ichi Software, Inc." }], homepage: async () => page });
    const facts = { name: "Nippon Ichi Software", country: "Japan" };
    expect((await resolveDomain(facts, "nipponichi.jp", deps("x", { is_the_company: true, confidence: "high" }, "Nippon Ichi Software makes games"))).website).toBe("https://nisamerica.com/");
    expect((await resolveDomain(facts, "nipponichi.jp", deps("x", { is_the_company: true, confidence: "medium" }, "Nippon Ichi Software makes games"))).website).toBeNull();
    expect((await resolveDomain(facts, "nipponichi.jp", deps("x", { is_the_company: true, confidence: "high" }, "A different page about calendars"))).website).toBeNull();
  });
  it("a site of another country is another business (Plott .jp ≠ PLOTT Finance .co.uk); a generic .com is not excluded", () => {
    expect(ccTld("plott.co.jp")).toBe("jp");
    expect(ccTld("example.com")).toBeNull();
    expect(candidateSites([{ url: "https://finance.plott.co.uk/", title: "" }, { url: "https://plott.com/", title: "" }, { url: "https://plott.jp/", title: "" }], "plott.co.jp").map((x) => x.host)).toEqual(["plott.com", "plott.jp"]);
  });
});
