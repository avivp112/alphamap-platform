/**
 * lib/enrichment/postClassify.ts — the sector and the main sub-sector tag, from a company's verified description, for a company whose report has the description but no tag
 * (owner, round 10: Mintifi's description was carried from the memory, so the classification of this run never saw it). Same request, same retries, same rules as collect.ts.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { buildSectorRequest, parseSectorChoice, classifyWithRetry, type SectorChoice, type SectorTaxonomyLite } from "./classifySector.ts";
import { requestFor } from "./models.ts";

export async function classifyDescription(o: { anthropic: Anthropic; model: string; taxonomy: SectorTaxonomyLite; name: string; description: string; complete: boolean }): Promise<SectorChoice | null> {
  const classify = async (feedback?: string): Promise<SectorChoice | null> => {
    const msg = await o.anthropic.messages.create(requestFor(buildSectorRequest(o.name, o.description, o.taxonomy, feedback, { noCustomers: !o.complete }), o.model));
    const tool = msg.content.find((b) => b.type === "tool_use");
    return tool && tool.type === "tool_use" ? parseSectorChoice(tool.input, o.taxonomy) : null;
  };
  return classifyWithRetry(classify, o.description, () => {}, { noCustomers: !o.complete });
}

/** The tag a classification gives: its main sub-sector, never a "/ General". */
export function mainTag(choice: SectorChoice | null, taxonomy: SectorTaxonomyLite): string | null {
  const sub = choice?.sub_sector_name;
  return sub && taxonomy.subNames.includes(sub) && !/\/\s*general$/i.test(sub) ? sub : null;
}
