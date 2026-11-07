import { describe, it, expect } from "vitest";
import { companiesHouseHeadcount, brregHeadcount, waybackHeadcount, robotsAllows, type HeadcountIo } from "./headcountCollect";

const ixbrl = `<xbrli:context id="c1"><xbrli:period><xbrli:endDate>2024-12-31</xbrli:endDate></xbrli:period></xbrli:context>
<xbrli:context id="c0"><xbrli:period><xbrli:endDate>2023-12-31</xbrli:endDate></xbrli:period></xbrli:context>
<ix:nonFraction name="x:AverageNumberEmployeesDuringPeriod" contextRef="c1">230</ix:nonFraction>
<ix:nonFraction name="x:AverageNumberEmployeesDuringPeriod" contextRef="c0">150</ix:nonFraction>`;

describe("Companies House", () => {
  it("one registry point per period end, with the register's words as the quote", async () => {
    const io: HeadcountIo = { env: { COMPANIES_HOUSE_API_KEY: "k" }, fetchJson: async () => ({ items: [{ links: { document_metadata: "https://document-api/doc1" } }] }), fetchText: async () => ixbrl };
    const pts = await companiesHouseHeadcount("12345678", "WAYVE TECHNOLOGIES LTD", io);
    expect(pts.map((p) => [p.date, p.value, p.type, p.measure])).toEqual([["2023-12-31", 150, "registry", "average_in_period"], ["2024-12-31", 230, "registry", "average_in_period"]]);
    expect(pts[0].quote).toContain("150");
  });
  it("no key, no points; a failing register gives none", async () => {
    expect(await companiesHouseHeadcount("1", "X", { fetchJson: async () => ({}), fetchText: async () => "" })).toEqual([]);
    expect(await companiesHouseHeadcount("1", "X", { env: { COMPANIES_HOUSE_API_KEY: "k" }, fetchJson: async () => { throw new Error("HTTP 500"); }, fetchText: async () => "" })).toEqual([]);
  });
});

describe("Brreg", () => {
  const res = (enheter: unknown[]) => ({ _embedded: { enheter } });
  it("one certain match gives a dated registry point", async () => {
    const io: HeadcountIo = { fetchJson: async () => res([{ navn: "KONGSBERG AS", organisasjonsnummer: "123456789", antallAnsatte: 45 }]), fetchText: async () => "" };
    const [p] = await brregHeadcount("Kongsberg", null, io, "2026-11-08");
    expect(p).toMatchObject({ date: "2026-11-08", value: 45, type: "registry", measure: "count_at_date" });
  });
  it("two entities of the name, or none with a count: no point", async () => {
    const two = res([{ navn: "NOVA AS", organisasjonsnummer: "1", antallAnsatte: 5 }, { navn: "Nova A/S", organisasjonsnummer: "2", antallAnsatte: 7 }]);
    expect(await brregHeadcount("Nova", null, { fetchJson: async () => two, fetchText: async () => "" }, "2026-11-08")).toEqual([]);
    expect(await brregHeadcount("Nova", null, { fetchJson: async () => res([{ navn: "NOVA AS", organisasjonsnummer: "1" }]), fetchText: async () => "" }, "2026-11-08")).toEqual([]);
  });
});

describe("robots.txt", () => {
  it("honours Disallow for *, the longest rule wins, Allow on a tie", () => {
    const txt = "User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /careers\nAllow: /careers/open\n";
    expect(robotsAllows(txt, "/about")).toBe(true);
    expect(robotsAllows(txt, "/careers")).toBe(false);
    expect(robotsAllows(txt, "/careers/open")).toBe(true);
    expect(robotsAllows("", "/about")).toBe(true);
  });
});

describe("Wayback", () => {
  const cdx = (path: string) => [["urlkey", "timestamp", "original"], ["k", "20210315101010", `https://nova.ai/${path}`], ["k", "20230601000000", `https://nova.ai/${path}`]];
  const io = (robots = ""): HeadcountIo => ({
    fetchText: async (u) => u.endsWith("/robots.txt") ? robots : u.includes("/web/2021") ? "<p>Nova is a team of 40 people.</p>" : "<p>Nova has over 120 employees worldwide.</p>",
    fetchJson: async (u) => (u.includes("about") && !u.includes("about-us") ? cdx("about") : [["h"]]),
  });
  it("points dated by the copy, with the floor kept and the archive URL as the source", async () => {
    const pts = await waybackHeadcount("nova.ai", "Nova AI", io());
    expect(pts.map((p) => [p.date, p.value, !!p.lowerBound, p.type])).toEqual([["2021-03-15", 40, false, "site_stated"], ["2023-06-01", 120, true, "site_stated"]]);
    expect(pts[0].sourceUrl).toBe("https://web.archive.org/web/20210315101010/https://nova.ai/about");
  });
  it("a path the company's robots.txt disallows is not asked for", async () => {
    expect(await waybackHeadcount("nova.ai", "Nova AI", io("User-agent: *\nDisallow: /about"))).toEqual([]);
  });
  it("a copy that does not mention the company (another owner of the domain) gives nothing", async () => {
    const other: HeadcountIo = { ...io(), fetchText: async (u) => u.endsWith("/robots.txt") ? "" : "<p>Acme Corp is a team of 500.</p>" };
    expect(await waybackHeadcount("nova.ai", "Nova AI", other)).toEqual([]);
  });
});
