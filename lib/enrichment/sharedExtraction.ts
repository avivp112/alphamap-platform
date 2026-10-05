/**
 * lib/enrichment/sharedExtraction.ts — the three first-pass extraction
 * calls (profile / funding / market) as one prompt-cache-friendly family.
 *
 * Each call used to embed the full labeled research (~20K tokens) in its
 * own user message, so the same sources were billed three times per
 * company. Here every call sends an IDENTICAL prefix — the same three tool
 * definitions in the same order, then the sources in a cached system
 * block — and differs only in tool_choice and the user message carrying
 * that call's own rules. tool_choice changes don't invalidate the
 * tools+system cache, so the first call writes the cache (1.25x) and the
 * other two read it (0.1x).
 *
 * The per-kind instructions and tool schema are taken from the existing
 * build*ExtractionRequest() builders (split at their "Labeled research"
 * marker), so the rules and schemas live in exactly one place each and the
 * single-call builders keep working unchanged for the deep-dive calls.
 */

import { buildProfileExtractionRequest, type SectorTaxonomy } from "./extractProfile";
import { buildFundingExtractionRequest } from "./extractFunding";
import { buildMarketExtractionRequest } from "./extractMarket";
import { formatSourcesForPrompt, type LabeledSource } from "./sources";

export type ExtractionKind = "profile" | "funding" | "market";

const KINDS: ExtractionKind[] = ["profile", "funding", "market"];
export const SOURCES_MARKER = "\n\nLabeled research";

interface KindParts { tool: unknown; toolName: string; instructions: string }

function partsFor(kind: ExtractionKind, companyName: string, taxonomy: SectorTaxonomy, today: string): KindParts {
  const req =
    kind === "profile" ? buildProfileExtractionRequest(companyName, [], taxonomy)
    : kind === "funding" ? buildFundingExtractionRequest(companyName, [])
    : buildMarketExtractionRequest(companyName, [], today);
  const text = req.messages[0].content as string;
  const idx = text.indexOf(SOURCES_MARKER);
  if (idx < 0) throw new Error(`${kind} extraction prompt is missing its "Labeled research" marker`);
  return { tool: req.tools[0], toolName: req.tool_choice.name, instructions: text.slice(0, idx) };
}

export interface SharedRequestOptions {
  taxonomy: SectorTaxonomy;
  today?: string;
  /** Mark the sources for caching. Off for one-off calls, where the 1.25x write would never be read back. */
  cache?: boolean;
}

export function buildSharedExtractionRequest(
  kind: ExtractionKind,
  companyName: string,
  sources: LabeledSource[],
  options: SharedRequestOptions,
) {
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const all = KINDS.map((k) => partsFor(k, companyName, options.taxonomy, today));
  const mine = all[KINDS.indexOf(kind)];
  const systemText =
    `Labeled research about the company "${companyName}" (each source is tagged [S#] for a search result or [W#] for a fetched website page). ` +
    `Every extraction task uses ONLY these sources — "the sources below" in a task's rules means this research.\n\n` +
    formatSourcesForPrompt(sources);
  return {
    model: "",
    max_tokens: 8192,
    temperature: 0,
    tools: all.map((p) => p.tool),
    tool_choice: { type: "tool" as const, name: mine.toolName },
    system: [{
      type: "text" as const,
      text: systemText,
      ...(options.cache === false ? {} : { cache_control: { type: "ephemeral" as const } }),
    }],
    messages: [{
      role: "user" as const,
      content: `${mine.instructions}\n\nThe labeled research is in the system prompt. Answer only by calling ${mine.toolName}.`,
    }],
  };
}
