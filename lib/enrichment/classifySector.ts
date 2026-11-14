/**
 * lib/enrichment/classifySector.ts — the sector of a company from its VERIFIED description only (owner, 2026-11-10).
 * The profile extraction chose a sector while reading search results, so the sentence that "supported" it could be about
 * the CEO or an investor. Here the model sees nothing but the description whose sentences were checked against allowed
 * sources, the definitions of the sub-sectors, and the rules (one main sector, the customer's industry for vertical software).
 */
import { sectorGuidance, definitionSupports } from "./sectorDefinitions.ts";

export interface SectorTaxonomyLite { parentNames: string[]; subNames: string[]; parentOf?: Record<string, string> }
export interface SectorChoice { sector_name?: string; sub_sector_name?: string; sub_sector_names: string[] }

/** A description with a verified "what" but no "for whom" (owner, 2026-11-14): the sector follows the product, not an assumed business customer. */
export const NO_CUSTOMERS_NOTE = "The description does not say who buys the product. Decide by the product itself and do not assume business customers: a product anyone can sign up for by themselves (a personal mailbox, a consumer app, a shop) is a consumer product; choose an Enterprise or industry sector only when the description names organisations, teams or businesses as the buyers.";

export function buildSectorRequest(companyName: string, description: string, taxonomy: SectorTaxonomyLite, feedback?: string, opts: { noCustomers?: boolean } = {}) {
  const prompt = `Classify the company "${companyName}" from its description alone.

Description (checked against sources): ${description}

Pick the single most specific sector and sub-sector for what the description says the company sells. Add "sub_sector_names" for other fields it genuinely operates in (at most 3; include "Vertical SaaS" for software built for one industry). Omit anything the description does not support.

${opts.noCustomers ? NO_CUSTOMERS_NOTE + "\n\n" : ""}${sectorGuidance(taxonomy.subNames)}${feedback ? `\n\nYOUR PREVIOUS ANSWER WAS REJECTED: ${feedback}\nChoose again.` : ""}`;
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

/**
 * What is wrong with an answer, or null (owner, 2026-11-10, review 9): a sub-sector the description is not about (a rocket maker
 * as PropTech), or a "General" while a specific one fits.
 */
export function sectorProblem(choice: SectorChoice | null, description: string): string | null {
  if (!choice) return "no usable classification";
  if (!definitionSupports(choice.sub_sector_name, description)) return `"${choice.sub_sector_name}" has nothing in common with the description; read the definitions and pick what the company sells`;
  // "Vertical SaaS" is a tag; the main sector is the customer's industry (owner, 2026-11-10; SafetyCulture came back as SaaS & Dev Tools › Vertical SaaS).
  if (choice.sub_sector_name === "Vertical SaaS") return `"Vertical SaaS" is a tag, not the main sub-sector; name the customers' industry (the market the company serves) and keep Vertical SaaS among the other fields`;
  if (choice.sub_sector_name && /\/\s*general$/i.test(choice.sub_sector_name)) return `"${choice.sub_sector_name}" is a last resort; name the closest specific sub-sector of any sector, or keep General only if none fits`;
  return null;
}

/**
 * The classification as the pipeline runs it: one answer; a problem (an unsupported sub-sector, a General) gets a second look
 * with the reason; a General that stays General is accepted, an answer the description is not about is not. One function for the
 * collection, the examples check and the marks' rejudge, so they cannot disagree.
 */
export async function classifyWithRetry(
  call: (feedback?: string) => Promise<SectorChoice | null>, description: string, log: (m: string) => void = () => {},
): Promise<SectorChoice | null> {
  const choice = await call();
  const problem = sectorProblem(choice, description);
  if (!problem) return choice;
  log(`answer rejected (${problem}) \u2014 asking once more`);
  const again = await call(`${choice ? `${choice.sector_name}${choice.sub_sector_name ? ` \u203A ${choice.sub_sector_name}` : ""}: ` : ""}${problem}.`);
  const stillBad = sectorProblem(again, description);
  // Still "Vertical SaaS" as the main sub-sector: the industry is not named, so no main sub-sector, and it stays among the tags.
  if (again && again.sub_sector_name === "Vertical SaaS") return { ...again, sub_sector_name: undefined, sub_sector_names: [...new Set(["Vertical SaaS", ...again.sub_sector_names])].slice(0, 3) };
  if (again && (!stillBad || /last resort/.test(stillBad))) return again;
  if (!again) return null;
  // Still not supported by the description (owner, 2026-11-13: Motorway, Pet Circle and Versabox came back with no sector at all): a classification
  // always ends with a value. A last look asks for the closest sector with its "General" sub-sector; whatever sub-sector the description does not
  // support is dropped, and the sector stays.
  const last = await call(`${again.sector_name}${again.sub_sector_name ? ` \u203A ${again.sub_sector_name}` : ""}: ${stillBad}. None of the specific sub-sectors fits well: name the closest sector and its "General" sub-sector (or leave the sub-sector out).`);
  const pick = last ?? again;
  return definitionSupports(pick.sub_sector_name, description) ? pick : { ...pick, sub_sector_name: undefined };
}
