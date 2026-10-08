// =============================================================================
// Supabase Edge Function: backfill-embeddings
//
// The missing link in "fetch -> link -> embed -> alert". scripts/
// backfill_embeddings.ts does exactly this work but was only ever runnable by
// hand (or from a GitHub Actions / GitLab CI schedule that was documented but
// never actually created — confirmed via the GitLab API: zero pipeline
// schedules exist in this project). Every other step of the sourcing pipeline
// (the 6 ingesters, link_oss_projects, resolve_tier1, generate_live_alerts)
// already runs unattended via pg_cron + pg_net — see
// 20260726250000_sourcing_ingestion_cron.sql and
// 20261002010000_generate_live_alerts_rpc.sql. This function and its
// scheduling migration (20261004000000) bring embedding generation into that
// same, already-established pattern, closing the one gap: a startup created
// or newly linked by the morning's ingestion run now has its embedding
// computed the same day, well inside generate_live_alerts()'s lookback
// window (see 20261003000000's embedding_updated_at fix, which this directly
// feeds).
//
// Secrets: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (auto-injected)
//          RUNPOD_TEI_URL (REQUIRED — supabase secrets set
//          RUNPOD_TEI_URL="https://<POD_ID>-8080.proxy.runpod.net")
//          RUNPOD_TEI_KEY (optional — only if the TEI instance sits behind
//          its own auth, which a private RunPod proxy URL doesn't by default)
//
// Deploy:  supabase functions deploy backfill-embeddings --no-verify-jwt
// Invoke:  POST {}                                  -> dry run, startups+investors
//          POST { "dryRun": false }                 -> write for real
//          POST { "table": "startups" }             -> one table only
//          POST { "batchSize": 500, "embedBatch": 128, "force": false }
//
// ── SAME THREE SAFETY MECHANISMS AS THE SCRIPT IT REPLACES ──────────────────
//   1. Self-advancing queue: rows ordered embedding_updated_at NULLS FIRST,
//      then id -- never-embedded rows go first, so a run that times out or is
//      invoked repeatedly always makes forward progress through the backlog
//      rather than re-reading the same head every time.
//   2. Skip-unchanged: md5("<model>:<dims>:<source text>") compared against
//      the stored embedding_source_hash. An unchanged row costs zero TEI
//      spend on a re-run. p_force / {"force":true} re-embeds regardless (e.g.
//      after a model/dimension change).
//   3. Batched TEI calls: EMBED_BATCH inputs per request, not one per row.
//
// ── WHY AN EDGE FUNCTION AND NOT GITHUB ACTIONS / GITLAB CI ─────────────────
//   Both of those need a human to create a schedule object (GitLab) or add
//   platform secrets (either) in a separate UI before anything runs -- which
//   is exactly the gap that left this script orphaned since it was written.
//   pg_cron + pg_net needs none of that: once this migration applies, the job
//   exists and fires on schedule, the same as every other ingester already
//   does. The one remaining manual step -- `supabase secrets set
//   RUNPOD_TEI_URL=...` -- is unavoidable (the URL is specific to this
//   RunPod instance) and is the exact same one-time step every other
//   connector already requires for ITS OWN endpoint/credential.
//   Each invocation processes at most `batchSize` rows per table per call,
//   so a single run finishes comfortably inside the net.http_post
//   timeout_milliseconds used for every other scheduled Edge Function call in
//   this project (300000ms) -- see the scheduling migration. Daily
//   re-invocation plus the self-advancing queue means the backlog is worked
//   down a batch at a time rather than needing one run to clear it all.
//
// ── WHY TEI, NOT OPENAI ──────────────────────────────────────────────────────
//   This function originally called OpenAI's text-embedding-3-small (1536-d).
//   That dependency is now fully removed in favour of a self-hosted Text
//   Embeddings Inference (TEI) server running nomic-ai/nomic-embed-text-v1.5
//   (768-d) on the same RunPod instance as the self-hosted LLM, behind TEI's
//   own OpenAI-compatible /v1/embeddings route (see
//   supabase/functions/_shared/tei-client.ts for the client and
//   20261005000000_update_embedding_vector_dimensions.sql for the matching
//   vector(768) column migration — a 1536-d and a 768-d vector are different,
//   incompatible coordinate spaces, so that migration nulls every existing
//   embedding and this function's self-advancing queue naturally re-embeds
//   the whole corpus against the new model on its next scheduled runs).
//
// ── VERIFICATION STATUS ──────────────────────────────────────────────────────
//   The sandbox blocks outbound HTTPS, so the TEI call path is unexercised
//   here. The source-text composition, hashing and queue-ordering logic is
//   unchanged from the OpenAI-era version of this function (and, before
//   that, scripts/backfill_embeddings.ts). Run with dryRun:true first against
//   a real project to confirm the queue looks right before flipping to live.
// =============================================================================

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { embedDocuments } from "../_shared/tei-client.ts";
import { withRunLog } from "../_shared/run-log.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const DEFAULT_BATCH_SIZE  = 500;   // rows read from DB per table per invocation
const DEFAULT_EMBED_BATCH = 128;   // inputs per TEI request
const DEFAULT_MODEL       = "nomic-ai/nomic-embed-text-v1.5";
const DEFAULT_DIMENSIONS  = 768;   // must match startups.embedding / investors.embedding vector(N)

type TableName = "startups" | "investors";

interface Row {
  id: string;
  name: string | null;
  description: string | null;
  industry?: string | null;   // startups only
  thesis?: string | null;     // investors only
  embedding_source_hash: string | null;
}

// Identical to the script's sourceText(): deterministic, so its md5 is a
// stable change-detection key. A bare name with no prose is not embedded --
// that would pollute cosine-similarity results with a near-meaningless
// vector, which matters doubly here since a low-information embedding could
// spuriously clear the 85% thesis-match alert threshold.
function sourceText(table: TableName, row: Row): string | null {
  const parts: string[] = [];
  if (row.name) parts.push(row.name.trim());

  if (table === "startups") {
    if (row.industry)    parts.push(row.industry.trim());
    if (row.description) parts.push(row.description.trim());
  } else {
    if (row.description) parts.push(row.description.trim());
    if (row.thesis)       parts.push(row.thesis.trim());
  }

  const hasProse = table === "startups" ? !!row.description : !!(row.description || row.thesis);
  if (!hasProse) return null;

  return parts.join(". ").replace(/\s+/g, " ").slice(0, 8000);
}

async function md5Hex(s: string): Promise<string> {
  const data = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest("MD5", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface BackfillOptions {
  dryRun: boolean;
  /** Epoch ms after which no new page is started — the run stops cleanly and reports timedOut. */
  deadline: number;
  batchSize: number;
  embedBatch: number;
  force: boolean;
  model: string;
  dimensions: number;
  teiUrl: string;
  teiKey?: string;
}

async function backfillTable(supabase: SupabaseClient, table: TableName, opts: BackfillOptions) {
  const selectCols = table === "startups"
    ? "id, name, description, industry, embedding_source_hash"
    : "id, name, description, thesis, embedding_source_hash";

  let processed = 0, embedded = 0, skipped = 0, noText = 0, from = 0;
  let timedOut = false;

  for (;;) {
    if (Date.now() > opts.deadline) { timedOut = true; break; }
    const { data, error } = await supabase
      .from(table)
      .select(selectCols)
      .order("embedding_updated_at", { ascending: true, nullsFirst: true })
      .order("id", { ascending: true })
      .range(from, from + opts.batchSize - 1);

    if (error) throw new Error(`${table} select: ${error.message}`);
    const rows = (data ?? []) as unknown as Row[];
    if (rows.length === 0) break;

    let movedThisPage = 0;
    const pending: { row: Row; text: string; hash: string }[] = [];
    for (const row of rows) {
      const text = sourceText(table, row);
      if (!text) { noText++; continue; }
      const hash = await md5Hex(`${opts.model}:${opts.dimensions}:${text}`);
      if (!opts.force && row.embedding_source_hash === hash) { skipped++; continue; }
      pending.push({ row, text, hash });
    }

    for (let i = 0; i < pending.length; i += opts.embedBatch) {
      const chunk = pending.slice(i, i + opts.embedBatch);
      if (opts.dryRun) { embedded += chunk.length; continue; }

      const vectors = await embedDocuments(chunk.map((c) => c.text), {
        baseUrl: opts.teiUrl, apiKey: opts.teiKey, model: opts.model,
      });
      const now = new Date().toISOString();

      // Per-row update (not a bulk upsert): Supabase/PostgREST can't upsert
      // distinct values per row in one call, and this keeps one row's
      // failure from blocking its batch-mates.
      await Promise.all(chunk.map(async (c, j) => {
        const { error: upErr } = await supabase
          .from(table)
          .update({ embedding: vectors[j], embedding_source_hash: c.hash, embedding_updated_at: now })
          .eq("id", c.row.id);
        if (upErr) console.error(`update ${table}.${c.row.id}: ${upErr.message}`);
        else { embedded++; movedThisPage++; }
      }));
    }

    processed += rows.length;
    // Paging. A row that was embedded just now moves to the END of the
    // order (its embedding_updated_at is now the newest); every other row of
    // this page — unchanged, without prose, or failed — stays where it was.
    // So the next page starts after the rows that stayed. Without this the
    // loop re-read the same head forever: rows with no description keep a
    // NULL embedding_updated_at and sort first, and once a page was all
    // such rows nothing ever moved — no embeddings, until the function was
    // killed by its time limit. A dry run writes nothing, so all rows stay.
    from += opts.dryRun ? rows.length : rows.length - movedThisPage;
    if (rows.length < opts.batchSize) break;
  }

  return { table, processed, embedded, skipped, noText, timedOut };
}

// Stop starting new pages well inside the Edge Function wall-clock limit, so
// a long backlog ends as a clean, logged run instead of a killed one; the
// next daily run continues where this one stopped.
const RUN_BUDGET_MS = 110_000;

/** Rows embedded across all tables of the run (for source_runs.rows_in). */
function embeddedRows(body: Record<string, unknown>): number {
  const results = Array.isArray(body.results) ? body.results as Array<{ embedded?: number }> : [];
  return results.reduce((n, r) => n + (typeof r.embedded === "number" ? r.embedded : 0), 0);
}

Deno.serve(withRunLog("backfill_embeddings", embeddedRows, async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "Supabase env not available" }, 500);

  const teiUrl = Deno.env.get("RUNPOD_TEI_URL")?.trim();
  if (!teiUrl) {
    return json({
      error: "RUNPOD_TEI_URL is not set.",
      fix: 'supabase secrets set RUNPOD_TEI_URL="https://<POD_ID>-8080.proxy.runpod.net"',
    }, 500);
  }
  const teiKey = Deno.env.get("RUNPOD_TEI_KEY")?.trim() || undefined;

  let opts: BackfillOptions = {
    dryRun: true,
    deadline: Date.now() + RUN_BUDGET_MS,
    batchSize: DEFAULT_BATCH_SIZE,
    embedBatch: DEFAULT_EMBED_BATCH,
    force: false,
    model: DEFAULT_MODEL,
    dimensions: DEFAULT_DIMENSIONS,
    teiUrl,
    teiKey,
  };
  let table = "both";

  try {
    const b = await req.json();
    if (b?.dryRun === false) opts.dryRun = false;
    if (typeof b?.batchSize === "number" && b.batchSize > 0) opts.batchSize = Math.floor(b.batchSize);
    if (typeof b?.embedBatch === "number" && b.embedBatch > 0) opts.embedBatch = Math.floor(b.embedBatch);
    if (b?.force === true) opts.force = true;
    if (typeof b?.model === "string" && b.model) opts.model = b.model;
    if (typeof b?.dimensions === "number" && b.dimensions > 0) opts.dimensions = Math.floor(b.dimensions);
    if (typeof b?.table === "string") table = b.table.toLowerCase();
  } catch { /* defaults */ }

  const supabase: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY);
  const targets: TableName[] =
    table === "startups" ? ["startups"] :
    table === "investors" ? ["investors"] :
    ["startups", "investors"];

  try {
    const results = [];
    for (const t of targets) results.push(await backfillTable(supabase, t, opts));
    return json({ dryRun: opts.dryRun, model: opts.model, dimensions: opts.dimensions, results });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "backfill failed" }, 500);
  }
}));
