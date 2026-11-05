#!/usr/bin/env node
/**
 * eval/import_field_review.ts — the companies of the field-review runs into eval/golden_set.json
 * (owner, 2026-11-05), with the values the owner marked (eval/fieldReviewImport.ts).
 *
 *   npx tsx eval/import_field_review.ts               # report only
 *   WRITE=true npx tsx eval/import_field_review.ts    # adds the entries to eval/golden_set.json
 *
 * With SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY it also reads each company's website (a read).
 * The first marking of every value is the measurement: the tracker's verdicts as given. Writes
 * nothing to the database.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readMarks } from "../lib/enrichment/fieldReview.ts";
import { newGoldenEntries } from "./fieldReviewImport.ts";
import type { GoldenSet } from "./score.ts";

const __dir = dirname(fileURLToPath(import.meta.url));
if (existsSync(join(__dir, "..", ".env"))) config({ path: join(__dir, "..", ".env") });
const goldenPath = join(__dir, "golden_set.json");
const golden: GoldenSet = JSON.parse(readFileSync(goldenPath, "utf8"));
const entries = newGoldenEntries(readMarks(), golden.companies);

(async () => {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    const db = createClient(url, key, { auth: { persistSession: false } });
    for (const e of entries) {
      const { data } = await db.from("startups").select("website").ilike("name", e.company.name.replace(/[%_]/g, "\\$&")).limit(1);
      const site = (data ?? [])[0]?.website as string | null | undefined;
      if (site) e.company.website = site.startsWith("http") ? site : `https://${site}`;
    }
  } else console.log("No database access: the entries carry no website (the evaluation then searches by name).\n");

  console.log(`${entries.length} compan(ies) to add to the golden set (now ${golden.companies.length}):`);
  for (const e of entries) console.log(`  ${e.company.name.padEnd(28)} ${Object.entries(e.counts).map(([k, n]) => `${k} ${n}`).join(" · ")}${e.company.website ? "" : "  (no website)"}`);
  const total = (k: string) => entries.reduce((n, e) => n + (e.counts[k] ?? 0), 0);
  console.log(`\nJudged values added: rounds ${total("round")} (+${total("round_wrong")} wrong), competitors ${total("competitor")}, patents ${total("patent")}, founders ${total("founder")}.`);
  console.log(`Golden set after: ${golden.companies.length + entries.length} companies.`);
  if (process.env.WRITE !== "true") { console.log("\nReport only. WRITE=true adds them."); return; }
  golden.companies.push(...entries.map((e) => e.company));
  writeFileSync(goldenPath, JSON.stringify(golden, null, 2) + "\n");
  console.log(`\n📝  ${goldenPath} updated.`);
})().catch((e) => { console.error(e); process.exit(1); });
