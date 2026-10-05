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

export interface TechGateVerdict {
  is_tech_company: boolean;
  confidence: "high" | "medium" | "low";
  reason: string;
}

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
          is_tech_company: { type: "boolean", description: "TRUE for any company whose core product or competitive edge is its own technology/software/R&D (broad category — AI/ML, fintech, biotech, hardware, marketplaces and platforms run on their own app/software, etc. all count)." },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          reason: { type: "string", description: "One short sentence." },
        },
        required: ["is_tech_company", "confidence", "reason"],
      },
    }],
    tool_choice: { type: "tool" as const, name: "classify_company" },
    messages: [{
      role: "user" as const,
      content: `Is "${companyName}" a technology company?\n\nAnswer is_tech_company=false with confidence "high" ONLY when the material clearly shows a non-technology business — e.g. a food or beverage brand, a restaurant, a charity or NGO without its own technology product, a consultancy or agency, a retailer of physical goods with no proprietary technology. A company that runs its own app, software platform, marketplace, or does R&D is a technology company. If the material is thin or ambiguous, answer true or use low/medium confidence.\n\n${material}`,
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
  const msg = await options.client.messages.create({ ...request, model: options.model });
  const tool = msg.content.find((b) => b.type === "tool_use");
  const input = tool && tool.type === "tool_use" ? (tool.input as Partial<TechGateVerdict>) : null;
  const verdict = input && typeof input.is_tech_company === "boolean"
    ? { is_tech_company: input.is_tech_company, confidence: (input.confidence ?? "low") as TechGateVerdict["confidence"], reason: input.reason ?? "" }
    : null;
  return { verdict, inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens };
}
