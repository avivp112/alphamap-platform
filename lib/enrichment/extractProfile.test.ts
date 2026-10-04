import { describe, it, expect } from "vitest";
import { buildProfileExtractionRequest, processProfileExtractionResponse } from "./extractProfile";
import { buildLabeledSources, type RawSearchResult } from "./sources";

const rawSources: RawSearchResult[] = [
  {
    url: "https://www.apexspace.com/about", provider: "jina", query_label: "website",
    content: "Apex is headquartered in Los Angeles, California, United States. Founded in 2022 by Ian Cinnamon and Max Benassi.",
  },
  {
    url: "https://techcrunch.com/2023/06/22/apex-space", provider: "serper", query_label: "history",
    content: "Satellite bus manufacturing startup Apex Space, the 45-person startup, closed a $16 million Series A. Ian Cinnamon, CEO, previously founded Synapse, which was acquired by Palantir. His LinkedIn is linkedin.com/in/iancinnamon.",
  },
];
const sources = buildLabeledSources(rawSources, "apexspace.com");

describe("buildProfileExtractionRequest", () => {
  const request = buildProfileExtractionRequest("Apex", sources);

  it("forces the save_profile_extraction tool with temperature 0", () => {
    expect(request.temperature).toBe(0);
    expect(request.tool_choice).toEqual({ type: "tool", name: "save_profile_extraction" });
    expect(request.tools[0].name).toBe("save_profile_extraction");
  });

  it("embeds the labeled source blocks in the prompt", () => {
    const text = request.messages[0].content as string;
    expect(text).toContain("[W1] https://www.apexspace.com/about");
    expect(text).toContain("[S1] https://techcrunch.com/2023/06/22/apex-space");
    expect(text).toContain("Apex is headquartered in Los Angeles");
  });

  it("every material field in the schema requires value/source_id/evidence_quote", () => {
    const profileProps = (request.tools[0].input_schema.properties.profile as any).properties;
    for (const field of ["website", "founded_year", "country", "city"]) {
      expect(profileProps[field].required).toEqual(["value", "source_id", "evidence_quote"]);
    }
  });

  it("includes the bio amendment instructions (education, prior founding, CEO history, elite unit)", () => {
    const text = request.messages[0].content as string;
    expect(text).toContain("where they studied");
    expect(text).toContain("previously founded a company");
    expect(text).toContain("served as CEO");
    expect(text).toContain("Unit 8200");
  });

  it("includes the city/country same-source rule and the never-guess-URLs rule", () => {
    const text = request.messages[0].content as string;
    expect(text.toLowerCase()).toContain("same source and the same sentence");
    expect(text.toLowerCase()).toContain("never construct or guess a url");
  });

  it("constrains sector_name/sub_sector_name to the given taxonomy (ground rule 3)", () => {
    const withTaxonomy = buildProfileExtractionRequest("Apex", sources, {
      parentNames: ["Aerospace & Defense", "AI & ML"],
      subNames: ["Satellites", "LLMs"],
    });
    const profileProps = (withTaxonomy.tools[0].input_schema.properties.profile as any).properties;
    expect(profileProps.sector_name.enum).toEqual(["Aerospace & Defense", "AI & ML"]);
    expect(profileProps.sub_sector_name.enum).toEqual(["Satellites", "LLMs"]);
  });

  it("omits the enum constraint entirely when no taxonomy is given (matches v1's own fallback)", () => {
    const profileProps = (request.tools[0].input_schema.properties.profile as any).properties;
    expect(profileProps.sector_name.enum).toBeUndefined();
  });
});

describe("processProfileExtractionResponse", () => {
  it("accepts a well-evidenced response end to end", () => {
    const raw = {
      is_public_company: false,
      is_tech_company: true,
      profile: {
        city: { value: "Los Angeles", source_id: "W1", evidence_quote: "Apex is headquartered in Los Angeles, California, United States" },
        country: { value: "United States", source_id: "W1", evidence_quote: "Apex is headquartered in Los Angeles, California, United States" },
        founded_year: { value: 2022, source_id: "W1", evidence_quote: "Founded in 2022 by Ian Cinnamon and Max Benassi" },
        founders: [
          {
            name: "Ian Cinnamon", title: "CEO",
            bio: "Previously founded Synapse, which was acquired by Palantir.",
            had_prior_exit: true,
            linkedin_url: { value: "linkedin.com/in/iancinnamon", source_id: "S1", evidence_quote: "His LinkedIn is linkedin.com/in/iancinnamon" },
          },
        ],
      },
      leadership: [], metrics: {}, competitors: [], acquisitions: [], news: [], patents: [],
    };

    const { result, dropped } = processProfileExtractionResponse(raw, sources);
    expect(dropped).toHaveLength(0);
    expect(result.profile.city?.value).toBe("Los Angeles");
    expect(result.profile.country?.value).toBe("United States");
    expect(result.profile.founded_year?.value).toBe(2022);
    expect(result.profile.founders?.[0].linkedin_url?.value).toBe("linkedin.com/in/iancinnamon");
    expect(result.profile.founders?.[0].had_prior_exit).toBe(true);
  });

  it("drops a city/country claim whose quote is invented (the APEX bug shape)", () => {
    const raw = {
      is_public_company: false, is_tech_company: true,
      profile: {
        city: { value: "Los Angeles", source_id: "W1", evidence_quote: "Apex is headquartered in Los Angeles, California" },
        // Fabricated: W1's content never mentions the United Kingdom.
        country: { value: "United Kingdom", source_id: "W1", evidence_quote: "Apex is headquartered in the United Kingdom" },
      },
      leadership: [], metrics: {}, competitors: [], acquisitions: [], news: [], patents: [],
    };

    const { result, dropped } = processProfileExtractionResponse(raw, sources);
    expect(result.profile.city?.value).toBe("Los Angeles"); // survives, its own quote is real
    expect(result.profile.country).toBeUndefined(); // dropped, invented quote
    expect(dropped).toContainEqual({ field: "profile.country", reason: "evidence_mismatch" });
  });

  it("drops a LinkedIn URL that doesn't actually appear in the cited source", () => {
    const raw = {
      is_public_company: false, is_tech_company: true,
      profile: {
        founders: [
          { name: "Ian Cinnamon", linkedin_url: { value: "linkedin.com/in/someone-invented", source_id: "S1", evidence_quote: "His LinkedIn is linkedin.com/in/iancinnamon" } },
        ],
      },
      leadership: [], metrics: {}, competitors: [], acquisitions: [], news: [], patents: [],
    };
    const { result, dropped } = processProfileExtractionResponse(raw, sources);
    expect(result.profile.founders?.[0].linkedin_url).toBeUndefined();
    expect(dropped).toContainEqual({ field: "profile.founders[0].linkedin_url", reason: "url_not_in_source" });
  });

  it("drops a claim citing a source_id that was never given to the model", () => {
    const raw = {
      is_public_company: false, is_tech_company: true,
      profile: { city: { value: "Paris", source_id: "W99", evidence_quote: "anything" } },
      leadership: [], metrics: {}, competitors: [], acquisitions: [], news: [], patents: [],
    };
    const { dropped } = processProfileExtractionResponse(raw, sources);
    expect(dropped).toContainEqual({ field: "profile.city", reason: "source_not_found" });
  });

  it("strips sentinel placeholder strings before they ever reach evidence verification", () => {
    const raw = {
      is_public_company: false, is_tech_company: true,
      profile: { description: "unknown", industry: "N/A" },
      leadership: [], metrics: {}, competitors: [], acquisitions: [], news: [], patents: [],
    };
    const { result } = processProfileExtractionResponse(raw, sources);
    expect(result.profile.description).toBeUndefined();
    expect(result.profile.industry).toBeUndefined();
  });

  it("does not crash when the model collapses a one-item array into a bare object (real DRY_RUN crash: 'patents' TypeError)", () => {
    const raw = {
      is_public_company: false, is_tech_company: true,
      profile: {},
      leadership: {}, // also a bare object instead of []
      metrics: {}, competitors: [], acquisitions: [],
      news: { title: "Launch", url: "https://x.com" }, // bare object instead of [{...}]
      patents: { title: "A real patent" }, // the exact shape that crashed in production
      patent_summary: { patent_fields: "fintech" }, // bare string instead of ["fintech"]
    };
    expect(() => processProfileExtractionResponse(raw, sources)).not.toThrow();
    const { result } = processProfileExtractionResponse(raw, sources);
    expect(result.patents).toEqual([{ title: "A real patent" }]);
    expect(result.news).toEqual([{ title: "Launch", url: "https://x.com" }]);
    expect(result.leadership).toHaveLength(1); // a bare {} still gets wrapped as one entry, not silently dropped -- the point is it doesn't throw
    expect(result.patent_summary.patent_fields).toEqual(["fintech"]);
  });

  it("verifies headcount_history points independently, dropping only the unverifiable ones", () => {
    const raw = {
      is_public_company: false, is_tech_company: true,
      profile: {},
      leadership: [],
      metrics: {
        headcount_history: [
          { date: "2023-06-22", employee_count: 45, source_id: "S1", evidence_quote: "the 45-person startup closed a $16 million Series A" },
          { date: "2024-01-01", employee_count: 9999, source_id: "S1", evidence_quote: "a completely invented sentence" },
        ],
      },
      competitors: [], acquisitions: [], news: [], patents: [],
    };
    const { result, dropped } = processProfileExtractionResponse(raw, sources);
    expect(result.metrics.headcount_history).toHaveLength(1);
    expect(result.metrics.headcount_history?.[0].employee_count).toBe(45);
    expect(dropped.some((d) => d.field === "metrics.headcount_history")).toBe(true);
  });
});
