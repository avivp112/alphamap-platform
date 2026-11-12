import { describe, it, expect } from "vitest";
import { registryUrl, formatUsd, formatPeople, evidenceLines, companyPath, SOURCE_LABEL } from "./candidateReview";

describe("registryUrl", () => {
  it("links each source to its official record", () => {
    expect(registryUrl({ source: "sec_form_d", cik: "0001234567", entity_number: null, name: "APR Labs Inc." }))
      .toBe("https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001234567&type=D");
    expect(registryUrl({ source: "uk_companies_house", cik: null, entity_number: "16123456", name: "IDMON LIMITED" }))
      .toBe("https://find-and-update.company-information.service.gov.uk/company/16123456");
    expect(registryUrl({ source: "epo_ops", cik: null, entity_number: null, name: "Field AI, Inc." }))
      .toBe("https://worldwide.espacenet.com/patent/search?q=pa%3D%22Field%20AI%2C%20Inc.%22");
  });
  it("returns null rather than a broken link", () => {
    expect(registryUrl({ source: "sec_form_d", cik: null, entity_number: null, name: "x" })).toBeNull();
    expect(registryUrl({ source: "uk_companies_house", cik: null, entity_number: null, name: "x" })).toBeNull();
    expect(registryUrl({ source: "something_else", cik: "1", entity_number: "2", name: "x" })).toBeNull();
  });
});

describe("formatUsd / formatPeople", () => {
  it("formats Form D amounts", () => {
    expect(formatUsd(24_999_982)).toBe("$25M");
    expect(formatUsd(2_500_000)).toBe("$2.5M");
    expect(formatUsd(260_000)).toBe("$260K");
    expect(formatUsd(0)).toBeNull();
    expect(formatUsd(null)).toBeNull();
  });
  it("lists people with roles, capped", () => {
    expect(formatPeople([{ name: "Jane Doe", relationships: ["Director"] }, { name: "John Roe", relationships: [] }]))
      .toBe("Jane Doe (director), John Roe");
    expect(formatPeople([{ name: "A" }, { name: "B" }, { name: "C" }], 2)).toBe("A, B +1");
    expect(formatPeople([{ name: " " }])).toBeNull();
  });
});

describe("evidenceLines", () => {
  it("SEC: industry and amount first", () => {
    const lines = evidenceLines({ source: "sec_form_d", country: "United States", founded_year: 2024,
      evidence: { industry_group: "Other Technology", total_offering: 25_000_000, total_sold: 5_000_000,
        officers: [{ name: "Ada", relationships: ["Executive Officer"] }] } });
    expect(lines.slice(0, 2)).toEqual([
      { label: "Industry", value: "Other Technology" },
      { label: "Raising", value: "$25M (sold $5M)" },
    ]);
    expect(lines).toContainEqual({ label: "Related people", value: "Ada (executive officer)" });
  });
  it("UK: SIC codes, directors and company type", () => {
    const lines = evidenceLines({ source: "uk_companies_house", country: "United Kingdom", founded_year: 2026,
      evidence: { codes: ["62012", "62020"], form_type: "ltd",
        officers: [{ name: "A", relationships: ["director"] }, { name: "B", relationships: ["director"] }] } });
    expect(lines).toEqual([
      { label: "SIC codes", value: "62012 62020" },
      { label: "Directors", value: "A (director), B (director)" },
      { label: "Company type", value: "ltd" },
      { label: "Founded", value: "2026" },
      { label: "Country", value: "United Kingdom" },
    ]);
  });
  it("EPO: patent title and a trimmed abstract first, inventors labelled as such", () => {
    const lines = evidenceLines({ source: "epo_ops", country: "United States", founded_year: null,
      evidence: { title: "Robot navigation", abstract: "x".repeat(500), officers: [{ name: "Inv One" }] } });
    expect(lines[0]).toEqual({ label: "Patent", value: "Robot navigation" });
    expect(lines[1].value.length).toBe(401);
    expect(lines).toContainEqual({ label: "Inventors", value: "Inv One" });
  });
  it("skips empty fields instead of showing blanks", () => {
    expect(evidenceLines({ source: "uk_companies_house", country: null, founded_year: null, evidence: {} })).toEqual([]);
  });
});

describe("companyPath", () => {
  it("opens the company's tearsheet on the Private Market page", () => {
    expect(companyPath("63f3cf48-db5c-4a8f-9507-075af3c57813")).toBe("/startups?company=63f3cf48-db5c-4a8f-9507-075af3c57813");
  });
});

describe("oss_github candidates (stage 7, 2026-11-12)", () => {
  const evidence = { github_url: "https://github.com/DietrichGebert/ponytail", owner: "DietrichGebert", owner_type: "User", repo: "ponytail", stars: 189155, stars_7d: 3916, forks: 200, open_issues: 40, created: "2026-06-12", age_days: 152, homepage: "https://ponytail.dev", description: "Makes your AI agent think like the laziest senior dev in the room.", suspect_stars: true };
  it("links to the repo, and only to a github.com address", () => {
    expect(registryUrl({ source: "oss_github", cik: null, entity_number: null, name: "ponytail", evidence })).toBe("https://github.com/DietrichGebert/ponytail");
    expect(registryUrl({ source: "oss_github", cik: null, entity_number: null, name: "x", evidence: { github_url: "https://evil.example/x" } })).toBeNull();
    expect(registryUrl({ source: "oss_github", cik: null, entity_number: null, name: "x" })).toBeNull();
  });
  it("shows the project, the growth, the forks and issues, the age, and the warning for bought stars", () => {
    const lines = evidenceLines({ source: "oss_github", evidence, country: null, founded_year: null });
    const by = Object.fromEntries(lines.map((l) => [l.label, l.value]));
    expect(by["Project"]).toBe("DietrichGebert/ponytail (user)");
    expect(by["Growth"]).toBe("+3,916 stars in 7 days (189,155 stars in all)");
    expect(by["Forks / issues"]).toBe("200 forks, 40 open issues");
    expect(by["Created"]).toBe("2026-06-12 (152 days old)");
    expect(by["Homepage"]).toBe("https://ponytail.dev");
    expect(by["Check"]).toMatch(/Suspected bought stars/);
  });
  it("no warning without the flag", () => {
    const lines = evidenceLines({ source: "oss_github", evidence: { ...evidence, suspect_stars: false }, country: null, founded_year: null });
    expect(lines.some((l) => l.label === "Check")).toBe(false);
  });
});

describe("hf_org candidates (stage 7b)", () => {
  const evidence = { hf_org: "newco", hf_url: "https://huggingface.co/newco", fullname: "NewCo", homepage: "https://newco.dev", models: 2, first_model: "2026-09-13", downloads: 1100, downloads_7d: 1000, likes: 7, followers: 40 };
  it("links to the org page, and only to huggingface.co", () => {
    expect(registryUrl({ source: "hf_org", cik: null, entity_number: null, name: "NewCo", evidence })).toBe("https://huggingface.co/newco");
    expect(registryUrl({ source: "hf_org", cik: null, entity_number: null, name: "x", evidence: { hf_url: "https://evil.example/x" } })).toBeNull();
  });
  it("shows the org, the models and first date, the growth and the website", () => {
    const by = Object.fromEntries(evidenceLines({ source: "hf_org", evidence, country: null, founded_year: null }).map((l) => [l.label, l.value]));
    expect(by["Organization"]).toBe("newco (NewCo)");
    expect(by["Models"]).toBe("2 models, the first on 2026-09-13");
    expect(by["Growth"]).toBe("+1,000 downloads in 7 days (1,100 in the last 30 days)");
    expect(by["Website"]).toBe("https://newco.dev");
    const t = Object.fromEntries(evidenceLines({ source: "hf_org", evidence: { ...evidence, num_users: 6, plan: "team", verified: true }, country: null, founded_year: null }).map((l) => [l.label, l.value]));
    expect(t["Team"]).toBe("6 members, team plan, verified");
    expect(SOURCE_LABEL.hf_org).toBe("Hugging Face org");
  });
});
