/**
 * lib/enrichment/classifySector.ts — the sector of a company from its VERIFIED description only (owner, 2026-11-10).
 * The profile extraction chose a sector while reading search results, so the sentence that "supported" it could be about
 * the CEO or an investor. Here the model sees nothing but the description whose sentences were checked against allowed
 * sources, the definitions of the sub-sectors, and the rules (one main sector, the customer's industry for vertical software).
 */
import { sectorGuidance } from "./sectorDefinitions.ts";

export interface SectorTaxonomyLite { parentNames: string[]; subNames: string[]; parentOf?: Record<string, string> }
export interface SectorChoice { sector_name?: string; sub_sector_name?: string; sub_sector_names: string[] }

export function buildSectorRequest(companyName: string, description: string, taxonomy: SectorTaxonomyLite) {
  const prompt = `Classify the company "${companyName}" from its description alone.

Description (checked against sources): ${description}

Pick the single most specific sector and sub-sector for what the description says the company sells. Add "sub_sector_names" for other fields it genuinely operates in (at most 3; include "Vertical SaaS" for software built for one industry). Omit anything the description does not support.

${sectorGuidance(taxonomy.subNames)}`;
  return {
    model: "", max_tokens: 400, temperature: 0,
    tools: [{
      name: "save_sector", description: "Save the classification.",
      input_schema: {
        type: "object" as const,
        properties: {
          sector_name: { type: "string", enum: taxonomy.parentNames.length ? taxonomy.parentNames : undefined },
          sub_sector_name: { type: "string", enum: taxonomy.subNames.length ? taxonomy.subNames : undefined },
          sub_sector_names: { type: "array", items: { type: "string", enum: taxonomy.subNames.length ? taxonomy.subNames : undefined }, maxItems: 3 },
        },
        required: ["sector_name"],
      },
    }],
    tool_choice: { type: "tool" as const, name: "save_sector" },
    messages: [{ role: "user" as const, content: prompt }],
  };
}

/** The model's answer, checked against the taxonomy. A sub-sector that belongs to another sector than the one named wins: it is the more specific answer (review 8: Elenium came back "Enterprise Software" with Travel Tech), so the sector becomes its parent. */
export function parseSectorChoice(input: unknown, taxonomy: SectorTaxonomyLite): SectorChoice | null {
  const i = (input ?? {}) as { sector_name?: unknown; sub_sector_name?: unknown; sub_sector_names?: unknown };
  const known = (n: unknown): n is string => typeof n === "string" && taxonomy.subNames.includes(n);
  const sub = known(i.sub_sector_name) ? i.sub_sector_name : undefined;
  const ofSub = sub ? taxonomy.parentOf?.[sub] : undefined;
  const named = typeof i.sector_name === "string" && taxonomy.parentNames.includes(i.sector_name) ? i.sector_name : undefined;
  const sector = ofSub && taxonomy.parentNames.includes(ofSub) ? ofSub : named;
  if (!sector) return null;
  const others = (Array.isArray(i.sub_sector_names) ? i.sub_sector_names : []).filter(known).filter((n) => n !== sub).slice(0, 3);
  return { sector_name: sector, sub_sector_name: sub, sub_sector_names: others };
}
