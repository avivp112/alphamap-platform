#!/usr/bin/env node
/**
 * scripts/field_review_replay.ts — the marks counted against the current rules (owner, 2026-11-04).
 * Writes nothing to the database.
 *
 * Whenever a field's rules change: for every company with a mark in eval/field_review_tracker.csv,
 * runs the current collection again (searches and pages from the search cache, where kept), derives
 * every value it would write — as if each field were empty on file — and records for each mark
 * whether its value is still produced. A mark the current rules no longer produce leaves the
 * count; the others stay, correct or wrong. scripts/field_review_status.ts reads the result,
 * eval/field_review_replay.csv.
 *
 *   npx tsx scripts/field_review_replay.ts                 # every marked company
 *   FIELDS=leader,founder npx tsx scripts/field_review_replay.ts   # only the marks of these fields
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import Anthropic from "@anthropic-ai/sdk";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { collectCompany, newCollectStats, V2_STARTUP_COLUMNS, type V2StartupRow } from "../lib/enrichment/collect.ts";
import { loadSectorTaxonomy } from "../lib/enrichment/extractProfile.ts";
import { createSearchProviderState } from "../lib/enrichment/searchProviders.ts";
import { openSearchCache } from "../lib/enrichment/searchCache.ts";
import { UsageMeter } from "../lib/enrichment/models.ts";
import { readMarks, readReplay, sameReviewValue, REPLAY } from "../lib/enrichment/fieldReview.ts";
import { wouldWrite } from "../lib/enrichment/reviewValues.ts";

const __dir = dirname(fileURLToPath(import.meta.url));
if (existsSync(join(__dir, "..", ".env"))) config({ path: join(__dir, "..", ".env") });
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key || !process.env.ANTHROPIC_API_KEY) { console.error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and ANTHROPIC_API_KEY are required."); process.exit(1); }
const MODEL = process.env.ENRICH_MODEL ?? "claude-haiku-5-5";
const FIELDS = (process.env.FIELDS ?? "").split(",").map((f) => f.trim()).filter(Boolean);
const db = createClient(url, key, { auth: { persistSession: false } });

/** As if every review field were empty on file: the collection's values, all of them. */
const blank = (row: V2StartupRow): V2StartupRow => ({
  ...row, city: null, country: null, founded_year: null, founding_country: null, employee_range: null, employee_count: null,
  founders: [], competitors: [], patents: [], news: [],
} as V2StartupRow);

(async () => {
  const marks = readMarks().filter((m) => !FIELDS.length || FIELDS.includes(m.field));
  const names = [...new Set(marks.map((m) => m.company))];
  const drawn = new Set(existsSync("field_review/drawn.json") ? JSON.parse(readFileSync("field_review/drawn.json", "utf8")) as string[] : []);
  let commit = "";
  try { commit = execSync("git rev-parse --short HEAD").toString().trim(); } catch { /* not a checkout */ }
  console.log(`Replay of ${marks.length} mark(s) over ${names.length} compan(ies), rules at ${commit || "this checkout"}, model ${MODEL}. Nothing is written to the database.\n`);

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const taxonomy = await loadSectorTaxonomy(db);
  const meter = new UsageMeter();
  const previous = readReplay();
  const result = new Map<string, { produced: boolean | null; note: string }>();

  for (const name of names) {
    const { data } = await db.from("startups").select(V2_STARTUP_COLUMNS).ilike("name", name.replace(/[%_]/g, "\\$&"));
    const rows = (data ?? []) as V2StartupRow[];
    const row = rows.find((r) => drawn.has(r.id)) ?? rows[0];
    const mine = marks.filter((m) => m.company === name);
    if (!row) { for (const m of mine) result.set(m.id, { produced: null, note: "company not found" }); console.log(`── ${name}: not found — its marks stay as they are`); continue; }
    console.log(`── ${row.name} (${mine.length} mark(s))`);
    const state = createSearchProviderState();
    state.cache = openSearchCache(row.id);
    try {
      const c = await collectCompany(blank(row), [], taxonomy, {
        anthropic, models: { enrich: MODEL, profile: MODEL, funding: MODEL, market: MODEL },
        update: false, deepDive: true, techGate: true, articlesToRead: 4, verbose: false, seen: null,
        recordCost: (m, u) => meter.add(m, u),
      }, newCollectStats(), state);
      const values = wouldWrite(c, blank(row));
      for (const m of mine) {
        const produced = values.some((v) => v.field === m.field && sameReviewValue(m.field, v.value, m.value));
        result.set(m.id, { produced, note: c.outcome });
        if (!produced) console.log(`    ✖  ${m.id} ${m.field} (${m.verdict}) no longer produced: ${m.value.slice(0, 80)}`);
      }
    } catch (e) {
      for (const m of mine) result.set(m.id, { produced: null, note: `replay failed: ${e instanceof Error ? e.message : String(e)}` });
      console.error(`    💥  ${e instanceof Error ? e.message : String(e)} — its marks stay as they are`);
    } finally {
      state.cache?.save();
    }
  }

  // The file keeps every mark's latest replay; a mark not replayed this time keeps its last one.
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const today = new Date().toISOString().slice(0, 10);
  const lines = ["id,produced,replayed_at,rules,note"];
  for (const m of readMarks()) {
    const r = result.get(m.id);
    if (r && r.produced !== null) lines.push([m.id, r.produced ? "yes" : "no", today, commit, r.note].map(cell).join(","));
    else if (previous.has(m.id)) lines.push([m.id, previous.get(m.id) ? "yes" : "no", "", "", "kept from an earlier replay"].map(cell).join(","));
  }
  writeFileSync(REPLAY, "﻿" + lines.join("\r\n") + "\r\n");

  const gone = [...result.entries()].filter(([, r]) => r.produced === false);
  console.log(`\n${gone.length} of ${result.size} mark(s) no longer produced (left out of the count) · Claude $${meter.costUsd.toFixed(4)}`);
  console.log(`📝  ${REPLAY} — then: npx tsx scripts/field_review_status.ts`);
})().catch((e) => { console.error(e); process.exit(1); });
