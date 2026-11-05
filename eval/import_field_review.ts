#!/usr/bin/env node
/**
 * eval/import_field_review.ts — the companies of the field-review runs into eval/golden_set.json
 * (owner, 2026-11-05), with the values the owner marked (eval/fieldReviewImport.ts).
 *
 *   npx tsx eval/import_field_review.ts               # report only
 *   WRITE=true npx tsx eval/import_field_review.ts    # updates eval/golden_set.json
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (a read) and the review files in field_review/
 * (run_N.csv, batch_N.csv — they carry company_id). Each company's website is copied from the
 * database BY COMPANY ID, never by name. A company with no id, or whose row has no website, does not
 * enter the golden set; one already imported without a website is removed (WRITE=true) until it has
 * one. Writes nothing to the database.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readMarks, parseCsvText } from "../lib/enrichment/fieldReview.ts";
import { newGoldenEntries, companyIdsFromCsv, nameKey, withWebsites, type ImportResult } from "./fieldReviewImport.ts";
import type { GoldenSet } from "./score.ts";

const __dir = dirname(fileURLToPath(import.meta.url));
if (existsSync(join(__dir, "..", ".env"))) config({ path: join(__dir, "..", ".env") });
const goldenPath = join(__dir, "golden_set.json");
const golden: GoldenSet = JSON.parse(readFileSync(goldenPath, "utf8"));
const marks = readMarks();

/** name → startups.id from every review file that carries both columns (extra files: ID_FILES=a.csv,b.csv). */
function loadIds(): Map<string, string> {
  const dir = process.env.REVIEW_DIR ?? "field_review";
  const files = [...(existsSync(dir) ? readdirSync(dir).filter((f) => /\.csv$/.test(f)).map((f) => join(dir, f)) : []), ...(process.env.ID_FILES ?? "").split(",").filter(Boolean)];
  const rows = files.flatMap((f) => parseCsvText(readFileSync(f, "utf8").replace(/^﻿/, "")));
  return companyIdsFromCsv(rows);
}

(async () => {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed: the websites are read by company id."); process.exit(1); }
  const db = createClient(url, key, { auth: { persistSession: false } });
  const ids = loadIds();
  console.log(`${ids.size} company ids found in the review files.\n`);

  // Candidates: every importable company — those already imported (tag field_review) and the new ones.
  const imported = golden.companies.filter((c) => c.hard_case_tags?.includes("field_review"));
  const fresh = newGoldenEntries(marks, golden.companies);
  const candidates: ImportResult[] = [
    ...imported.map((c) => ({ company: c, counts: {} as Record<string, number> })),
    ...fresh,
  ];
  const sites = new Map<string, string | null>();
  const wanted = [...new Set(candidates.map((e) => ids.get(nameKey(e.company.name))).filter((x): x is string => !!x))];
  for (let i = 0; i < wanted.length; i += 100) {
    const { data, error } = await db.from("startups").select("id, website").in("id", wanted.slice(i, i + 100));
    if (error) throw error;
    for (const r of data ?? []) sites.set(r.id as string, (r.website as string | null) ?? null);
  }
  const { kept, dropped } = withWebsites(candidates, ids, sites);

  console.log(`Candidates ${candidates.length}: with a website ${kept.length}, still without one ${dropped.length}.`);
  for (const d of dropped) console.log(`  ✗ ${JSON.stringify(d.company.name).padEnd(30)} ${d.reason}`);
  console.log(`\nStill without a website: ${dropped.length} of ${candidates.length}.`);
  const added = kept.filter((e) => !golden.companies.some((c) => c.id === e.company.id));
  console.log(`New in the golden set: ${added.length}; golden set after: ${golden.companies.length - imported.length + kept.length} companies.`);
  if (process.env.WRITE !== "true") { console.log("\nReport only. WRITE=true updates the golden set."); return; }
  golden.companies = [
    ...golden.companies.filter((c) => !c.hard_case_tags?.includes("field_review")),
    ...kept.map((e) => e.company),
  ];
  writeFileSync(goldenPath, JSON.stringify(golden, null, 2) + "\n");
  console.log(`\n📝  ${goldenPath} updated.`);
})().catch((e) => { console.error(e); process.exit(1); });
