#!/usr/bin/env node
/**
 * backfill_embeddings.ts — Populate vector embeddings for the semantic search
 * engine (Phase 1). Walks `startups` and `investors`, composes each row's
 * semantic profile text, embeds it with OpenAI text-embedding-3-small, and
 * writes the 1536-d vector back to the row's `embedding` column.
 *
 * Depends on migration 20260721000000_semantic_search_pgvector.sql having run
 * (adds embedding / embedding_source_hash / embedding_updated_at columns).
 *
 * INCREMENTAL BY DESIGN — three mechanisms keep re-runs cheap and safe:
 *   1. Self-advancing queue: rows are ordered embedding_updated_at NULLS FIRST,
 *      so never-embedded rows are always processed first and repeated identical
 *      runs walk the whole table batch by batch with OFFSET left at 0.
 *   2. Skip-unchanged: each row's source text is md5-hashed; if the hash equals
 *      the stored embedding_source_hash, the row is already current and is
 *      skipped WITHOUT calling OpenAI (zero spend on unchanged rows). Pass
 *      FORCE=true to re-embed regardless (e.g. after changing the model).
 *   3. Request batching: OpenAI's embeddings endpoint accepts many inputs per
 *      call, so we embed EMBED_BATCH rows in a single request (far fewer HTTP
 *      round-trips and better throughput than one-at-a-time).
 *
 * Rows with no usable source text (no description/thesis) are skipped and left
 * with a NULL embedding — the retrieval RPC ignores NULL-embedding rows, so a
 * company we know nothing about simply isn't a semantic-search candidate yet
 * (it'll get embedded once enrichment gives it a description). We never embed a
 * placeholder — that would pollute results with meaningless vectors.
 *
 * Usage:
 *   npx tsx scripts/backfill_embeddings.ts                              # dry run (default)
 *   DRY_RUN=false npx tsx scripts/backfill_embeddings.ts               # write for real
 *   DRY_RUN=false TABLE=startups BATCH_SIZE=500 npx tsx scripts/backfill_embeddings.ts
 *   DRY_RUN=false FORCE=true npx tsx scripts/backfill_embeddings.ts    # re-embed everything
 *
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY
 * GitHub Actions: see .github/workflows/backfill-embeddings.yml
 */

import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { config } from "dotenv";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// ── Bootstrap: load .env for local dev (GHA uses repository secrets) ──────────
const __dir   = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dir, "..", ".env");
if (existsSync(envPath)) config({ path: envPath });

// ── Configuration ─────────────────────────────────────────────────────────────
const DRY_RUN      = process.env.DRY_RUN !== "false";                     // safe default
const TABLE        = (process.env.TABLE ?? "both").toLowerCase();          // 'startups' | 'investors' | 'both'
const BATCH_SIZE   = Number(process.env.BATCH_SIZE   ?? 1000);            // rows fetched from DB per page
const EMBED_BATCH  = Number(process.env.EMBED_BATCH  ?? 128);            // inputs per OpenAI request
const OFFSET       = Number(process.env.OFFSET       ?? 0);
const FORCE        = process.env.FORCE === "true";                        // ignore skip-unchanged
const MODEL        = process.env.EMBED_MODEL ?? "text-embedding-3-small"; // 1536-d
const DIMENSIONS   = Number(process.env.EMBED_DIMENSIONS ?? 1536);       // must match the vector(N) column
const MAX_RETRIES  = Number(process.env.MAX_RETRIES  ?? 5);

for (const key of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "OPENAI_API_KEY"]) {
  if (!process.env[key]) {
    console.error(`✖ Missing required env var: ${key}`);
    process.exit(1);
  }
}

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

// ── Types ─────────────────────────────────────────────────────────────────────
interface Row {
  id: string;
  name: string | null;
  description: string | null;
  // startups only
  industry?: string | null;
  // investors only
  thesis?: string | null;
  embedding_source_hash: string | null;
}

type TableName = "startups" | "investors";

// ── Source-text composition ───────────────────────────────────────────────────
// The exact string we embed. Keep this deterministic — the md5 of it is the
// change-detection key, so any tweak here re-embeds the whole table on the next
// run (which is correct: the semantic representation changed).
function sourceText(table: TableName, row: Row): string | null {
  const parts: string[] = [];
  if (row.name) parts.push(row.name.trim());

  if (table === "startups") {
    if (row.industry)    parts.push(row.industry.trim());
    if (row.description)  parts.push(row.description.trim());
  } else {
    if (row.description) parts.push(row.description.trim());
    if (row.thesis)      parts.push(row.thesis.trim());
  }

  // A bare name is not enough signal to embed usefully — require some prose.
  const hasProse = table === "startups" ? !!row.description : !!(row.description || row.thesis);
  if (!hasProse) return null;

  return parts.join(". ").replace(/\s+/g, " ").slice(0, 8000); // clamp well under the model's token limit
}

function md5(s: string): string {
  return createHash("md5").update(s).digest("hex");
}

// ── OpenAI embeddings (batched, with retry/backoff) ───────────────────────────
async function embedBatch(inputs: string[]): Promise<number[][]> {
  let attempt = 0;
  while (true) {
    attempt++;
    try {
      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: MODEL, input: inputs, dimensions: DIMENSIONS }),
      });

      if (res.status === 429 || res.status >= 500) {
        // Rate-limited or transient server error — back off and retry.
        if (attempt > MAX_RETRIES) throw new Error(`OpenAI ${res.status} after ${MAX_RETRIES} retries`);
        const wait = Math.min(2 ** attempt * 1000, 32_000);
        console.warn(`  ⚠ OpenAI ${res.status}; retry ${attempt}/${MAX_RETRIES} in ${wait}ms`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      if (!res.ok) {
        throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
      }

      const json = await res.json() as { data: { index: number; embedding: number[] }[] };
      // The API preserves input order via `index`; sort defensively before returning.
      return json.data.sort((a, b) => a.index - b.index).map(d => d.embedding);
    } catch (err) {
      if (attempt > MAX_RETRIES) throw err;
      const wait = Math.min(2 ** attempt * 1000, 32_000);
      console.warn(`  ⚠ embed error (${(err as Error).message}); retry ${attempt}/${MAX_RETRIES} in ${wait}ms`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
}

// ── Per-table backfill ────────────────────────────────────────────────────────
async function backfillTable(table: TableName): Promise<void> {
  const selectCols = table === "startups"
    ? "id, name, description, industry, embedding_source_hash"
    : "id, name, description, thesis, embedding_source_hash";

  console.log(`\n━━━ ${table} ━━━`);

  let processed = 0, embedded = 0, skipped = 0, noText = 0;
  let from = OFFSET;

  while (true) {
    // Self-advancing queue: never-embedded rows (NULL embedding_updated_at) first,
    // then oldest — so identical re-runs walk the whole table with OFFSET=0.
    const { data, error } = await supabase
      .from(table)
      .select(selectCols)
      .order("embedding_updated_at", { ascending: true, nullsFirst: true })
      .order("id", { ascending: true })
      .range(from, from + BATCH_SIZE - 1);

    if (error) throw error;
    const rows = (data ?? []) as unknown as Row[];
    if (rows.length === 0) break;

    // Compose source text + decide which rows actually need an OpenAI call.
    const pending: { row: Row; text: string; hash: string }[] = [];
    for (const row of rows) {
      const text = sourceText(table, row);
      if (!text) { noText++; continue; }
      const hash = md5(`${MODEL}:${DIMENSIONS}:${text}`);
      if (!FORCE && row.embedding_source_hash === hash) { skipped++; continue; }
      pending.push({ row, text, hash });
    }

    // Embed the pending rows in OpenAI-sized sub-batches, then write back.
    for (let i = 0; i < pending.length; i += EMBED_BATCH) {
      const chunk = pending.slice(i, i + EMBED_BATCH);
      if (DRY_RUN) {
        embedded += chunk.length;
        continue;
      }

      const vectors = await embedBatch(chunk.map(c => c.text));
      const now = new Date().toISOString();

      // Write each row individually — Supabase can't upsert distinct values per
      // row in one call, and a per-row update keeps failures isolated.
      await Promise.all(chunk.map((c, j) =>
        supabase.from(table).update({
          embedding: vectors[j] as unknown as string, // pgvector accepts a JSON number[]
          embedding_source_hash: c.hash,
          embedding_updated_at: now,
        }).eq("id", c.row.id).then(({ error: upErr }) => {
          if (upErr) console.error(`  ✖ update ${c.row.id}: ${upErr.message}`);
          else embedded++;
        })
      ));

      console.log(`  … ${embedded} embedded (${skipped} skipped, ${noText} no-text)`);
    }

    processed += rows.length;
    // In DRY_RUN nothing is written, so embedding_updated_at never advances — we
    // must page forward manually to avoid re-reading the same head of the queue.
    if (DRY_RUN) from += BATCH_SIZE;
    if (rows.length < BATCH_SIZE) break;
  }

  console.log(`  ✔ ${table}: ${processed} scanned · ${embedded} embedded · ${skipped} unchanged · ${noText} no-text`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  console.log("════════════════════════════════════════");
  console.log(`  backfill_embeddings  (${DRY_RUN ? "DRY RUN — no writes" : "LIVE"})`);
  console.log(`  model=${MODEL} dims=${DIMENSIONS} table=${TABLE} force=${FORCE}`);
  console.log("════════════════════════════════════════");

  const targets: TableName[] =
    TABLE === "startups"  ? ["startups"] :
    TABLE === "investors" ? ["investors"] :
                            ["startups", "investors"];

  for (const t of targets) await backfillTable(t);

  console.log(`\n${DRY_RUN ? "Dry run complete — re-run with DRY_RUN=false to write." : "Done."}`);
})().catch(err => {
  console.error("\n✖ Fatal:", err);
  process.exit(1);
});
