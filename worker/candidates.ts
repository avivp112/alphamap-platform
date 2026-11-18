// =============================================================================
// worker/candidates.ts — stage 4 in the worker: a few review candidates at a
// time get their website found and verified (candidateIdentity.ts), and the
// result is saved on the candidate for the review card.
//
// Which candidates: pending SEC Form D candidates, and UK candidates that
// surfaced from the watchlist (a day-old UK company is almost never findable on
// the web, so it is searched only once something has happened to it).
//
// DRY RUN BY DEFAULT: nothing is written unless CANDIDATE_ENRICH_WRITE=true.
// A dry run still reads the web and calls the model (that is its point) and
// logs what it would have saved.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type Anthropic from "@anthropic-ai/sdk";
import {
  enrichCandidate, type CandidateInput, type Describer, type Enrichment, type IdentityDeps,
} from "./candidateIdentity.ts";
import type { Search } from "./search.ts";

const DESCRIBE_SYSTEM = `You read the text of a company's own website and say what the company does, using only its own words.
Return JSON: {"quote": string|null, "description_he": string|null}.
- "quote": ONE sentence copied EXACTLY, character for character, from the text, that states concretely what the company makes or does (a product, a service, who it is for). Copy it; do not fix, shorten or merge sentences.
- If the text has only slogans or nothing concrete, return {"quote": null, "description_he": null}. Never invent or infer.
- "description_he": one Hebrew line (at most 20 words) that says the same as the quote and adds nothing: no numbers, claims or adjectives the quote does not contain.
Return only the JSON.`;

/** The model asked for a quote; the caller (enrichCandidate) checks it is on the page. */
export function makeDescriber(anthropic: Anthropic, model: string, onUsage?: (input: number, output: number) => void): Describer {
  return async ({ name, text }) => {
    const msg = await anthropic.messages.create({
      model, max_tokens: 400, system: DESCRIBE_SYSTEM,
      messages: [{ role: "user", content: `Company: ${name}\n\nWebsite text:\n${text}` }],
    });
    onUsage?.(msg.usage?.input_tokens ?? 0, msg.usage?.output_tokens ?? 0);
    const block = msg.content.find((b) => b.type === "text");
    const raw = block && block.type === "text" ? block.text : "";
    return parseDescription(raw);
  };
}

/** Pure: the model's JSON answer, or null when it gave no usable quote. */
export function parseDescription(raw: string): { quote: string; description_he: string } | null {
  const m = /\{[\s\S]*\}/.exec(raw);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as { quote?: unknown; description_he?: unknown };
    if (typeof j.quote !== "string" || typeof j.description_he !== "string") return null;
    const quote = j.quote.trim(), he = j.description_he.trim();
    return quote && he ? { quote, description_he: he } : null;
  } catch {
    return null;
  }
}

export interface CandidateBatchDeps {
  db: SupabaseClient;
  search: Search;
  fetch: typeof fetch;
  describe: Describer;
  log?: (m: string) => void;
}

export interface CandidateBatchResult {
  checked: number; verified: number; unverified: number; no_site: number; failed: number;
  searches: number; wrote: boolean;
  results: Array<{ name: string; status?: string; website?: string | null; matches?: string[]; description?: string | null; error?: string }>;
}

const SELECT = "id, source, name, country, founded_year, entity_number, website, evidence";

/** Pending candidates still to be looked up: SEC Form D, and UK ones that came up from the watchlist. */
export async function pickCandidates(db: SupabaseClient, limit: number): Promise<CandidateInput[]> {
  const { data, error } = await db
    .from("company_candidates").select(SELECT)
    .eq("status", "pending")
    .or("source.eq.sec_form_d,and(source.eq.uk_companies_house,promoted_at.not.is.null)")
    .filter("evidence->enrichment->>enriched_at", "is", null)
    .order("gate_tier", { ascending: true })        // alert tier first
    .order("first_seen_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`company_candidates: ${error.message}`);
  return (data ?? []) as unknown as CandidateInput[];
}

/** Saves the enrichment on the candidate; a verified website also fills an empty `website`. */
export async function saveEnrichment(db: SupabaseClient, c: CandidateInput, e: Enrichment): Promise<void> {
  const { error } = await db.rpc("merge_candidate_evidence", { p_candidate_id: c.id, p_extra: { enrichment: e } });
  if (error) throw new Error(`merge_candidate_evidence: ${error.message}`);
  if (e.status === "verified" && e.website && !c.website) {
    await db.from("company_candidates").update({ website: e.website }).eq("id", c.id).is("website", null).eq("status", "pending");
  }
}

export async function candidateBatch(d: CandidateBatchDeps, opts: { limit: number; write: boolean }): Promise<CandidateBatchResult> {
  const log = d.log ?? ((m: string) => console.log(`[worker] ${m}`));
  const out: CandidateBatchResult = { checked: 0, verified: 0, unverified: 0, no_site: 0, failed: 0, searches: 0, wrote: opts.write, results: [] };
  const rows = await pickCandidates(d.db, opts.limit);
  const deps: IdentityDeps = { search: d.search, fetch: d.fetch, describe: d.describe };
  for (const c of rows) {
    try {
      const e = await enrichCandidate(c, deps);
      out.checked++; out.searches += e.search_calls; out[e.status]++;
      out.results.push({
        name: c.name, status: e.status, website: e.website, matches: e.match_signals.map((s) => s.kind), description: e.description_he,
      });
      log(`candidate ${c.name}: ${e.status}${e.website ? ` ${e.website}` : ""}${opts.write ? "" : " (dry run, not saved)"}`);
      if (opts.write) await saveEnrichment(d.db, c, e);
    } catch (err) {
      out.failed++;
      out.results.push({ name: c.name, error: String(err).slice(0, 200) });
      log(`candidate ${c.name}: ${String(err).slice(0, 200)}`);
      // A rejected search key or out of credits will fail every candidate the same way: stop the batch.
      if (/ProviderKey|credits|HTTP 40[123]/i.test(String(err))) break;
    }
  }
  return out;
}
