#!/usr/bin/env node
/**
 * import_startups_list.ts — sync the startups table with the master company
 * list (public/startups_list_v1.csv), which is the source of truth for WHICH
 * companies belong in the database. The CSV carries only name + website;
 * everything else is filled afterwards by the enrichment pipeline
 * (bulk_enrich_all.ts).
 *
 * What it does:
 *   1. Parse + sanitize the CSV, dedupe by website domain (name as fallback
 *      key for rows without a website).
 *   2. Match each CSV row against existing startups — by domain first, then
 *      by exact-normalized name (only when unambiguous).
 *   3. MATCHED rows: file wins on name/website. With RESET_FIELDS=true
 *      (default), profile fields are also cleared back to NULL so the
 *      enrichment pipeline re-researches them from scratch — the existing
 *      values are known to be unreliable. Every overwrite/clear is recorded
 *      in startup_changes first, so nothing is lost silently.
 *      Rows with is_manually_verified=true are never reset.
 *   4. NEW rows: inserted with name + website only.
 *   5. Existing DB rows NOT in the CSV: reported. Deleted only when
 *      PURGE_MISSING=true (default: report-only, because deletion cascades
 *      to funding_rounds and is irreversible).
 *
 * Usage:
 *   PARSE_ONLY=true npx tsx scripts/import_startups_list.ts   # local: parse/dedup report, no DB
 *   npx tsx scripts/import_startups_list.ts                   # dry run (default)
 *   DRY_RUN=false npx tsx scripts/import_startups_list.ts     # live sync
 *   DRY_RUN=false PURGE_MISSING=true ...                      # live sync + delete rows missing from CSV
 *
 * GitHub Actions: see .github/workflows/import-startups-list.yml
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dir, "..", ".env");
if (existsSync(envPath)) config({ path: envPath });

const CSV_PATH     = join(__dir, "..", "public", "startups_list_v1.csv");
const PARSE_ONLY   = process.env.PARSE_ONLY === "true";
const DRY_RUN      = process.env.DRY_RUN !== "false";      // safe default
const PURGE_MISSING = process.env.PURGE_MISSING === "true"; // default: report only
const RESET_FIELDS = process.env.RESET_FIELDS !== "false"; // default: reset matched rows

// Profile fields cleared on matched rows when RESET_FIELDS is on. The
// current values are recorded in startup_changes before clearing.
// `competitors` is deliberately excluded — bulk_enrich_all.ts fills it in
// once (fill-null only) and never overwrites it, so leaving it out of the
// reset preserves both bot-filled and any manually-curated entries as-is.
const RESETTABLE_FIELDS = [
  "description", "industry", "founded_year", "employee_count",
  "country", "city", "founders", "leadership", "growth_trend",
] as const;

// ── CSV parsing ───────────────────────────────────────────────────────────────

interface CsvCompany { name: string; website: string | null }

// Minimal RFC-4180 line parser (handles quoted fields; the v1 file has none,
// but a future export might).
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "", inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur); cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function sanitize(s: string): string {
  return s.replace(/﻿/g, "").replace(/ /g, " ").replace(/�/g, "").trim();
}

function normalizeWebsite(raw: string): string | null {
  const w = sanitize(raw);
  if (!w) return null;
  const withProto = /^https?:\/\//i.test(w) ? w : `https://${w}`;
  return withProto.replace(/\/+$/, "");
}

function websiteDomain(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

function normalizeName(name: string): string {
  return sanitize(name).toLowerCase().replace(/\s+/g, " ");
}

function loadCsv(): { companies: CsvCompany[]; duplicatesDropped: string[] } {
  const text = readFileSync(CSV_PATH, "utf-8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const header = parseCsvLine(lines[0]).map((h) => sanitize(h).toLowerCase());
  const nameIdx = header.indexOf("name");
  const webIdx  = header.indexOf("website");
  if (nameIdx === -1 || webIdx === -1) {
    throw new Error(`CSV must have "name" and "website" columns — found: ${header.join(", ")}`);
  }

  const companies: CsvCompany[] = [];
  const duplicatesDropped: string[] = [];
  const seenKeys = new Set<string>();

  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    const name = sanitize(cells[nameIdx] ?? "");
    if (!name) continue;
    const website = normalizeWebsite(cells[webIdx] ?? "");
    const key = websiteDomain(website) ?? `name:${normalizeName(name)}`;
    if (seenKeys.has(key)) {
      duplicatesDropped.push(`${name} (${key})`);
      continue;
    }
    seenKeys.add(key);
    companies.push({ name, website });
  }
  return { companies, duplicatesDropped };
}

// ── DB access ─────────────────────────────────────────────────────────────────

interface DbStartup {
  id: string;
  name: string;
  website: string | null;
  is_manually_verified: boolean;
  [key: string]: unknown;
}

async function fetchAllStartups(supabase: ReturnType<typeof createClient>): Promise<DbStartup[]> {
  const BATCH = 1000;
  const all: DbStartup[] = [];
  let from = 0;
  const cols = ["id", "name", "website", "is_manually_verified", ...RESETTABLE_FIELDS].join(", ");
  while (true) {
    const { data, error } = await supabase
      .from("startups")
      .select(cols)
      .order("created_at", { ascending: true })
      .range(from, from + BATCH - 1);
    if (error) throw error;
    const batch = (data ?? []) as unknown as DbStartup[];
    all.push(...batch);
    if (batch.length < BATCH) break;
    from += BATCH;
  }
  return all;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║   AlphaMap — Import Master Startups List             ║");
  console.log(`║   DRY_RUN=${String(DRY_RUN).padEnd(8)} PURGE_MISSING=${String(PURGE_MISSING).padEnd(8)}        ║`);
  console.log(`║   RESET_FIELDS=${String(RESET_FIELDS).padEnd(38)}║`);
  console.log("╚══════════════════════════════════════════════════════╝\n");

  // ── 1. Parse CSV ────────────────────────────────────────────────────────────
  const { companies, duplicatesDropped } = loadCsv();
  console.log(`📋  CSV rows kept:            ${companies.length}`);
  console.log(`♻️   In-file duplicates dropped: ${duplicatesDropped.length}`);
  for (const d of duplicatesDropped) console.log(`      • ${d}`);
  const noWebsite = companies.filter((c) => !c.website);
  console.log(`🌐  Rows without website:      ${noWebsite.length} ${noWebsite.length ? `(${noWebsite.map((c) => c.name).join(", ")})` : ""}\n`);

  if (PARSE_ONLY) {
    console.log("PARSE_ONLY — stopping before any database access.");
    return;
  }

  for (const key of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
    if (!process.env[key]) {
      console.error(`❌  Missing required env var: ${key}`);
      process.exit(1);
    }
  }
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // ── 2. Load existing rows and index them ────────────────────────────────────
  const existing = await fetchAllStartups(supabase);
  console.log(`🗄️   Startups currently in DB: ${existing.length}\n`);

  const byDomain = new Map<string, DbStartup>();
  const byName   = new Map<string, DbStartup[]>();
  for (const s of existing) {
    const d = websiteDomain(s.website);
    if (d && !byDomain.has(d)) byDomain.set(d, s);
    const n = normalizeName(s.name);
    byName.set(n, [...(byName.get(n) ?? []), s]);
  }

  // ── 3. Diff ────────────────────────────────────────────────────────────────
  interface MatchedPair { csv: CsvCompany; db: DbStartup }
  const matched: MatchedPair[] = [];
  const toInsert: CsvCompany[] = [];
  const matchedDbIds = new Set<string>();

  for (const c of companies) {
    const domain = websiteDomain(c.website);
    let db = domain ? byDomain.get(domain) : undefined;
    if (!db) {
      const candidates = (byName.get(normalizeName(c.name)) ?? []).filter((s) => !matchedDbIds.has(s.id));
      if (candidates.length === 1) db = candidates[0];
    }
    if (db && !matchedDbIds.has(db.id)) {
      matchedDbIds.add(db.id);
      matched.push({ csv: c, db });
    } else {
      toInsert.push(c);
    }
  }

  const missingFromFile = existing.filter((s) => !matchedDbIds.has(s.id));

  console.log(`🔗  Matched to existing rows:  ${matched.length}`);
  console.log(`🆕  New companies to insert:   ${toInsert.length}`);
  console.log(`🗑️   In DB but NOT in file:     ${missingFromFile.length} ${PURGE_MISSING ? "(WILL BE DELETED)" : "(report only — set PURGE_MISSING=true to delete)"}\n`);
  for (const s of missingFromFile) console.log(`      • ${s.name}${s.is_manually_verified ? "  [manually verified — never auto-deleted]" : ""}`);
  if (missingFromFile.length) console.log("");

  if (DRY_RUN) {
    const resets = RESET_FIELDS
      ? matched.filter(({ db }) => !db.is_manually_verified && RESETTABLE_FIELDS.some((f) => db[f] != null)).length
      : 0;
    console.log(`[DRY RUN] Would update ${matched.length} matched rows (${resets} with profile fields reset), insert ${toInsert.length}, ${PURGE_MISSING ? `delete ${missingFromFile.filter((s) => !s.is_manually_verified).length}` : "delete 0"}.`);
    console.log("Re-run with DRY_RUN=false to apply.");
    return;
  }

  // ── 4. Apply: matched rows ─────────────────────────────────────────────────
  let updated = 0, resetCount = 0, changeRows = 0, failed = 0;

  for (const { csv, db } of matched) {
    const patch: Record<string, unknown> = {};
    const changes: Array<{ field: string; old_value: string | null; new_value: string | null }> = [];

    if (csv.name !== db.name) {
      patch.name = csv.name;
      changes.push({ field: "name", old_value: db.name, new_value: csv.name });
    }
    const dbWeb = db.website ?? null;
    if (csv.website && csv.website !== dbWeb) {
      patch.website = csv.website;
      changes.push({ field: "website", old_value: dbWeb, new_value: csv.website });
    }

    if (RESET_FIELDS && !db.is_manually_verified) {
      let didReset = false;
      for (const f of RESETTABLE_FIELDS) {
        const cur = db[f];
        if (cur != null) {
          patch[f] = null;
          changes.push({ field: f, old_value: typeof cur === "string" ? cur : JSON.stringify(cur), new_value: null });
          didReset = true;
        }
      }
      if (didReset) resetCount++;
    }

    if (Object.keys(patch).length === 0) continue;

    const { error } = await supabase.from("startups").update(patch).eq("id", db.id);
    if (error) {
      console.error(`  ❌  Update failed for ${csv.name}: ${error.message}`);
      failed++;
      continue;
    }
    updated++;

    const { error: chErr } = await supabase.from("startup_changes").insert(
      changes.map((ch) => ({ startup_id: db.id, ...ch, source: "excel_import" })),
    );
    if (chErr) console.warn(`  ⚠️  startup_changes insert failed for ${csv.name}: ${chErr.message}`);
    else changeRows += changes.length;
  }
  console.log(`🔗  Updated ${updated} matched rows (${resetCount} had profile fields reset; ${changeRows} change records written)`);

  // ── 5. Apply: inserts (chunked) ────────────────────────────────────────────
  let inserted = 0;
  const CHUNK = 500;
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const chunk = toInsert.slice(i, i + CHUNK).map((c) => ({
      name: c.name,
      website: c.website,
      data_sources: { name: "startups_list_v1", website: "startups_list_v1" },
    }));
    const { error } = await supabase.from("startups").insert(chunk);
    if (error) {
      console.error(`  ❌  Insert chunk ${i / CHUNK + 1} failed: ${error.message} — retrying row by row`);
      for (const row of chunk) {
        const { error: rowErr } = await supabase.from("startups").insert(row);
        if (rowErr) { console.error(`      ❌  ${row.name}: ${rowErr.message}`); failed++; }
        else inserted++;
      }
    } else {
      inserted += chunk.length;
    }
    console.log(`🆕  Inserted ${inserted}/${toInsert.length}…`);
  }

  // ── 6. Apply: purge (only when explicitly enabled) ─────────────────────────
  let deleted = 0;
  if (PURGE_MISSING) {
    for (const s of missingFromFile) {
      if (s.is_manually_verified) { console.log(`  ⏭️   Skipping manually-verified: ${s.name}`); continue; }
      const { error } = await supabase.from("startups").delete().eq("id", s.id);
      if (error) { console.error(`  ❌  Delete failed for ${s.name}: ${error.message}`); failed++; }
      else deleted++;
    }
    console.log(`🗑️   Deleted ${deleted} rows not present in the master list`);
  }

  // ── 7. Refresh the Startups Hub's materialized search view ─────────────────
  // startups_search (used by the Private Market page) is refreshed on a
  // 15-min pg_cron schedule; this call makes today's writes visible there
  // immediately instead of waiting for the next tick.
  if (updated + inserted + deleted > 0) {
    const { error: refreshErr } = await supabase.rpc("refresh_startups_search");
    if (refreshErr) console.warn(`  ⚠️  startups_search refresh failed: ${refreshErr.message}`);
    else console.log("🔄  startups_search refreshed");
  }

  // ── 8. Summary ─────────────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(58));
  console.log(`Matched/updated: ${updated}   Inserted: ${inserted}   Deleted: ${deleted}   Failed: ${failed}`);
  console.log("Next step: run the Bulk Enrich All Startups workflow to fill the empty fields.");
  console.log("═".repeat(58));
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("💥  Fatal error:", e);
  process.exit(1);
});
