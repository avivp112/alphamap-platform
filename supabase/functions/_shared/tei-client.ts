// =============================================================================
// _shared/tei-client.ts
//
// Thin client for our self-hosted Text Embeddings Inference (TEI) server,
// running nomic-ai/nomic-embed-text-v1.5 (768-d) on the same RunPod instance
// as the self-hosted LLM (see _shared/llm-client.ts), on its own port (8080)
// behind TEI's OpenAI-compatible /v1/embeddings route. Replaces every direct
// OpenAI embeddings call in this project (backfill-embeddings, semantic-search,
// chat-analyst's semantic_search tool) now that embeddings no longer depend on
// OpenAI at all.
//
// Talks to RUNPOD_TEI_URL + "/v1/embeddings" — same shape as OpenAI's
// embeddings endpoint ({model, input} -> {data: [{index, embedding}]}), which
// is what let this be a near-drop-in replacement for the OpenAI call it
// displaces. TEI's OpenAI-compat route ignores `dimensions` (that's an
// OpenAI-v3-specific Matryoshka-truncation parameter with no TEI equivalent)
// so it's never sent — nomic-embed-text-v1.5 always returns its native 768-d
// vector, which is what startups/investors/user_preference_vectors.embedding
// are now declared as (20261005000000_update_embedding_vector_dimensions.sql).
//
// ── TASK PREFIXES — REQUIRED FOR THIS MODEL, NOT OPTIONAL ───────────────────
// nomic-embed-text-v1.5 was trained with task-specific instruction prefixes
// and produces measurably worse retrieval quality without them (this is
// documented model behavior, not a quirk of this integration): corpus text
// being indexed for later retrieval should be prefixed "search_document: ",
// and a query being used to retrieve against that corpus should be prefixed
// "search_query: ". Mixing them up (or omitting them) still returns a
// 768-d vector with no error — the failure mode is silently worse cosine
// similarity, which is exactly the kind of bug that's invisible until
// someone notices match quality degraded. embedDocuments/embedQuery below
// exist specifically so no call site has to remember this itself.
//
// No API key required by default — a self-hosted TEI instance on a private
// RunPod proxy URL has no auth in front of it unless you put one there. If
// yours does, set RUNPOD_TEI_KEY and it's sent as a Bearer token; omitted
// entirely (not even an empty header) when unset.
// =============================================================================

const MAX_RETRIES = 5;

export interface EmbedOptions {
  baseUrl: string;
  apiKey?: string;
  model?: string;     // sent in the request for logging/compat; TEI ignores it (one fixed model per server)
  timeoutMs?: number;
}

const DEFAULT_MODEL = "nomic-ai/nomic-embed-text-v1.5";
const DEFAULT_TIMEOUT_MS = 60_000;

interface TEIEmbeddingResponse {
  data: { index: number; embedding: number[] }[];
}

/** Low-level call: embeds exactly the strings given, in order, no prefixing. */
async function embedRaw(texts: string[], opts: EmbedOptions): Promise<number[][]> {
  if (texts.length === 0) return [];
  const url = `${opts.baseUrl.replace(/\/$/, "")}/v1/embeddings`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`;

  let attempt = 0;
  for (;;) {
    attempt++;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ model: opts.model ?? DEFAULT_MODEL, input: texts }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch (err) {
      if (attempt > MAX_RETRIES) throw new Error(`TEI request failed (network): ${(err as Error).message}`);
      await new Promise((r) => setTimeout(r, Math.min(2 ** attempt * 1000, 32_000)));
      continue;
    }

    if (res.status === 429 || res.status >= 500) {
      if (attempt > MAX_RETRIES) throw new Error(`TEI ${res.status} after ${MAX_RETRIES} retries`);
      await new Promise((r) => setTimeout(r, Math.min(2 ** attempt * 1000, 32_000)));
      continue;
    }
    if (!res.ok) {
      throw new Error(`TEI ${res.status}: ${(await res.text()).slice(0, 2000)}`);
    }

    const body = await res.json() as TEIEmbeddingResponse;
    return body.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
}

/** Embeds corpus text (startup/investor profiles) for storage/indexing. */
export function embedDocuments(texts: string[], opts: EmbedOptions): Promise<number[][]> {
  return embedRaw(texts.map((t) => `search_document: ${t}`), opts);
}

/** Embeds a single user-provided search query, for comparison against stored document embeddings. */
export async function embedQuery(text: string, opts: EmbedOptions): Promise<number[]> {
  const [vector] = await embedRaw([`search_query: ${text}`], opts);
  return vector;
}
