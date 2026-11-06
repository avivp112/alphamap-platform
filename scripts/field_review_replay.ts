#!/usr/bin/env node
/**
 * scripts/field_review_replay.ts — the marks counted against the current rules (owner, 2026-11-04).
 * Writes nothing to the database. No search, no model: free, instant, repeatable.
 *
 * For every mark in eval/field_review_tracker.csv, the current rules (lib/enrichment/markRules.ts)
 * judge the stored value and its source. A mark whose value a rule now rejects leaves the count;
 * every other mark stays, correct or wrong — also when no rule can tell. The result is
 * eval/field_review_replay.csv; scripts/field_review_status.ts reads it.
 *
 *   npx tsx scripts/field_review_replay.ts                          # every mark
 *   FIELDS=leader,founder npx tsx scripts/field_review_replay.ts    # only these fields
 *
 * With SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY it reads each company's website (a read) to
 * recognise its own site; without them an unlisted source is simply not judged.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readMarks, readReplay, parseCsvText, REPLAY } from "../lib/enrichment/fieldReview.ts";
import { quotesFromRows, quotesFromCompetitorSheet, quoteOf } from "../lib/enrichment/markQuotes.ts";
import { judgeMark } from "../lib/enrichment/markRules.ts";

const __dir = dirname(fileURLToPath(import.meta.url));
if (existsSync(join(__dir, "..", ".env"))) config({ path: join(__dir, "..", ".env") });
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FIELDS = (process.env.FIELDS ?? "").split(",").map((f) => f.trim()).filter(Boolean);

const domainOf = (website: string | null | undefined) => {
  try { return new URL(website!.startsWith("http") ? website! : `https://${website}`).hostname.toLowerCase().replace(/^www\./, ""); } catch { return null; }
};

(async () => {
  const all = readMarks();
  const marks = all.filter((m) => !FIELDS.length || FIELDS.includes(m.field));
  const domains = new Map<string, string | null>();
  if (url && key) {
    const db = createClient(url, key, { auth: { persistSession: false } });
    for (const name of new Set(marks.map((m) => m.company))) {
      const { data } = await db.from("startups").select("website").ilike("name", name.replace(/[%_]/g, "\\$&")).limit(1);
      domains.set(name, domainOf((data ?? [])[0]?.website));
    }
  } else console.log("No database access: a source that is not on a list is not judged (set the keys to recognise each company's own site).\n");

  let commit = "";
  try { commit = execSync("git rev-parse --short HEAD").toString().trim(); } catch { /* not a checkout */ }
  const previous = readReplay();
  const today = new Date().toISOString().slice(0, 10);
  // The quotes stored with the values (run_N.csv, batch_N.csv): a competitor's quote is judged too.
  const quotes = new Map<string, string>();
  if (existsSync("field_review")) for (const f of readdirSync("field_review").filter((x) => /\.csv$/.test(x) && !/_sample\.csv$/.test(x))) quotesFromRows(parseCsvText(readFileSync(`field_review/${f}`, "utf8").replace(/^\uFEFF/, "")), quotes);
  // The owner's competitors sheet keeps the quote of the values he marked there (tracker ids g.c…, which kept no source).
  if (existsSync("eval/review/competitors_review.csv")) quotesFromCompetitorSheet(parseCsvText(readFileSync("eval/review/competitors_review.csv", "utf8").replace(/^\uFEFF/, "")), quotes);
  const judged = new Map(marks.map((m) => [m.id, judgeMark(m, { domain: domains.get(m.company), quote: quoteOf(m, quotes) })]));

  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = ["id,produced,replayed_at,rules,note"];
  for (const m of all) {
    const j = judged.get(m.id);
    if (j) lines.push([m.id, j.produced ? "yes" : "no", today, commit, j.rule ?? ""].map(cell).join(","));
    else if (previous.has(m.id)) lines.push([m.id, previous.get(m.id) ? "yes" : "no", "", "", "kept from an earlier replay"].map(cell).join(","));
  }
  writeFileSync(REPLAY, "﻿" + lines.join("\r\n") + "\r\n");

  const competitors = marks.filter((m) => m.field === "competitor");
  console.log(`Competitor marks judged by their stored quote: ${competitors.filter((m) => quoteOf(m, quotes)).length} of ${competitors.length} have a quote in field_review/*.csv (the rest cannot be judged and stay).`);
  const gone = marks.filter((m) => !judged.get(m.id)!.produced);
  console.log(`${marks.length} mark(s) judged by the rules at ${commit || "this checkout"}: ${gone.length} no longer produced, ${marks.length - gone.length} stay.\n`);
  for (const m of gone) console.log(`  ${m.id.padEnd(6)} ${m.field.padEnd(16)} ${m.verdict.padEnd(8)} ${m.company}: ${m.value.slice(0, 60)}  ← ${judged.get(m.id)!.rule}`);
  console.log(`\n📝  ${REPLAY} — then: npx tsx scripts/field_review_status.ts`);
})().catch((e) => { console.error(e); process.exit(1); });
