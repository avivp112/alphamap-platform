/**
 * lib/enrichment/techGate.ts — a cheap "is this a technology company?"
 * check run on the company's own homepage (fetched free via Jina) and the
 * description already on file, BEFORE the ~10 searches and three large
 * extraction calls. A real batch spent full price on a non-alcoholic
 * aperitif brand and a solar charity only to reject both at the end.
 *
 * Deliberately one-sided: a company is skipped only on a HIGH-confidence
 * "not tech" verdict. Anything uncertain goes through the full pipeline,
 * where extractProfile makes the final call with all the evidence — so a
 * real tech company is never dropped by this pre-check on a thin homepage.
 */

import Anthropic from "@anthropic-ai/sdk";
import { requestFor } from "./models.ts";

export interface TechGateVerdict {
  is_tech_company: boolean;
  confidence: "high" | "medium" | "low";
  reason: string;
  /** false when the material (an unreadable, suspended or empty homepage) is too thin to say what the company does: there is no decision then. */
  enough_information?: boolean;
  /** false when the homepage shows another business than the description on file (a parked domain, a casino…). */
  site_matches_description?: boolean;
}

/**
 * What "technology company" means here (owner, 2026-11-13): the product falls in one of the platform's sector categories — software and AI,
 * fintech, cybersecurity, health and life sciences, climate and energy (energy storage, clean energy, carbon), deep tech (advanced materials,
 * robotics, space, semiconductors), industrial and manufacturing technology, food and agriculture technology (vertical farming, cultivated food),
 * automotive and mobility, proptech, e-commerce and marketplaces run on their own platform. NOT technology: professional services (design or
 * creative studios, agencies, consultancies), non-profits, incubators, accelerators and funds, and consumer products or shops with no technology of their own.
 * One definition for the early check and for the profile extraction, so they cannot disagree.
 */
export const TECH_DEFINITION = "A technology company is one whose product falls in a technology category: software, AI/ML, fintech, cybersecurity, health or life-science technology, climate and energy technology (energy storage, clean energy, carbon capture), deep tech (advanced materials, robotics, space, semiconductors), industrial or manufacturing technology, food or agriculture technology (vertical farming, cultivated food), automotive or mobility technology, proptech, or an online-first e-commerce / marketplace business (selling online is its main business and it is venture-backed, like an online pet shop), or a business built on its own platform. NOT technology: professional services (design or creative studios, agencies, consultancies), non-profits, incubators, accelerators and funds, a maker of physical consumer products that also sells online (phone accessories, coffee), and physical shops with no technology of their own.";

export function buildTechGateRequest(companyName: string, homepageText: string, description: string | null, industry: string | null) {
  const material = [
    description ? `Description on file: ${description}` : "",
    industry ? `Industry on file: ${industry}` : "",
    homepageText ? `Homepage text:\n${homepageText.slice(0, 3500)}` : "",
  ].filter(Boolean).join("\n\n");
  return {
    model: "",
    max_tokens: 300,
    temperature: 0,
    tools: [{
      name: "classify_company",
      description: "Classify whether the company is a technology company.",
      input_schema: {
        type: "object" as const,
        properties: {
          is_tech_company: { type: "boolean", description: TECH_DEFINITION },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          enough_information: { type: "boolean", description: "FALSE when the homepage is unreadable, suspended, parked or too thin to tell what the company does, and nothing else on file says. Then is_tech_company is not a decision." },
          reason: { type: "string", description: "One short sentence." },
          site_matches_description: { type: "boolean", description: "FALSE when the homepage text is about a different business than the description on file — a parked or sold domain, a casino, an unrelated company. TRUE when they describe the same business, or when there is no description to compare." },
        },
        required: ["is_tech_company", "confidence", "reason"],
      },
    }],
    tool_choice: { type: "tool" as const, name: "classify_company" },
    messages: [{
      role: "user" as const,
      content: `Is "${companyName}" a technology company?\n\n${TECH_DEFINITION}\n\nAnswer is_tech_company=false with confidence "high" ONLY when the material clearly shows a business outside those categories. A company whose product falls in one of them is a technology company, however traditional its industry sounds. If the material is thin or ambiguous, answer true or use low/medium confidence. In "reason" name the product and the category it falls in, or why it falls in none.\n\n${material}`,
    }],
  };
}

/** Skip the company only on a high-confidence non-tech verdict. */
export function shouldSkipAsNonTech(v: TechGateVerdict | null): boolean {
  return !!v && v.is_tech_company === false && v.confidence === "high";
}

export async function runTechGate(
  companyName: string,
  homepageText: string,
  description: string | null,
  industry: string | null,
  options: { client: Anthropic; model: string },
): Promise<{ verdict: TechGateVerdict | null; inputTokens: number; outputTokens: number }> {
  if (!homepageText && !description) return { verdict: null, inputTokens: 0, outputTokens: 0 };
  const request = buildTechGateRequest(companyName, homepageText, description, industry);
  const msg = await options.client.messages.create(requestFor(request, options.model));
  const tool = msg.content.find((b) => b.type === "tool_use");
  const input = tool && tool.type === "tool_use" ? (tool.input as Partial<TechGateVerdict>) : null;
  const verdict = input && typeof input.is_tech_company === "boolean"
    ? { is_tech_company: input.is_tech_company, confidence: (input.confidence ?? "low") as TechGateVerdict["confidence"], reason: input.reason ?? "", enough_information: input.enough_information !== false }
    : null;
  return { verdict, inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens };
}
