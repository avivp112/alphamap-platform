import { supabase } from "./supabase";

// ─────────────────────────────────────────────────────────────────────────────
// semanticSearch — the browser-side entry point to the AI Search & Q&A Engine's
// retrieval layer (Phase 1). It does NOT talk to OpenAI directly (the API key
// stays server-side); it invokes the `semantic-search` Edge Function, which
// embeds the query and runs the match_companies_and_funds RPC against our DB.
//
// Everything returned is a real row from our `startups` / `investors` tables —
// this is the grounding context the answer/Q&A step consumes so the agent can
// only speak about entities that actually exist in AlphaMap.
// ─────────────────────────────────────────────────────────────────────────────

export interface SemanticMatch {
  entity_type: "startup" | "investor";
  id: string;
  name: string | null;
  slug: string | null;
  description: string | null;
  /** Cosine similarity in [0, 1]; 1 = identical semantic direction. */
  similarity: number;
  /** Type-specific fields (industry/website/city… for startups; firm_type/fund_size… for investors). */
  metadata: Record<string, unknown>;
}

export interface SemanticSearchResult {
  query: string;
  model: string;
  count: number;
  matches: SemanticMatch[];
}

export interface SemanticSearchOptions {
  /** Max results (1–50). Default 10. */
  matchCount?: number;
  /** Minimum cosine similarity (0–1) to include. Default 0.25 — filters weak matches. */
  matchThreshold?: number;
  /** Narrow to one entity type. Default 'all'. */
  entityFilter?: "all" | "startup" | "investor";
}

export async function semanticSearch(
  query: string,
  opts: SemanticSearchOptions = {}
): Promise<SemanticSearchResult> {
  const trimmed = query.trim();
  if (!trimmed) return { query: "", model: "", count: 0, matches: [] };

  const { data, error } = await supabase.functions.invoke<SemanticSearchResult>(
    "semantic-search",
    {
      body: {
        query: trimmed,
        matchCount: opts.matchCount ?? 10,
        matchThreshold: opts.matchThreshold ?? 0.25,
        entityFilter: opts.entityFilter ?? "all",
      },
    }
  );

  if (error) throw error;
  return data ?? { query: trimmed, model: "", count: 0, matches: [] };
}
