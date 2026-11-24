#!/usr/bin/env node
/**
 * scripts/correct_wrong_acquired.ts — the files after wrong purchases were found in a written batch (owner, 2026-11-24: Aperio, Phenom, Rubicon Carbon in batch 9). Not an accept-lost: the value was wrong.
 *   1. the companies' acquired values leave baseline/batch_N.json;
 *   2. they are added to archive/batch<N>/excluded_values.csv with the reason;
 *   3. field_track_record(.json, _by_batch.json): one error each for the field "acquired" in the batch (the batch's acquired total is counted before the values leave the baseline).
 *   APPROVED_BY=aviv BATCH=9 NAMES="Aperio,Phenom,Rubicon Carbon" REASONS="another company of the same name|Phenom is the buyer|the buyer bought carbon credits, not the company" npx tsx scripts/correct_wrong_acquired.ts
 * Nothing else is touched. Run it once: a second run finds nothing in the baseline and says so.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "fs";
import { dirname } from "path";
import { loadBaseline, saveBaseline } from "../lib/enrichment/regressionGate.ts";
import { addToTrackRecord } from "../lib/enrichment/batchProcess.ts";

if (process.env.APPROVED_BY !== "aviv") { console.error("⛔  A baseline is changed only after the owner approved: APPROVED_BY=aviv …"); process.exit(1); }
const batch = Number(process.env.BATCH), names = (process.env.NAMES ?? "").split(",").map((s) => s.trim()).filter(Boolean), reasons = (process.env.REASONS ?? "").split("|").map((s) => s.trim());
if (!Number.isInteger(batch) || (!process.env.SET_TOTAL && (!names.length || reasons.length !== names.length))) { console.error("BATCH, NAMES and REASONS (one per name, separated by |) are required."); process.exit(1); }
// SET_TOTAL=46: only the number of acquired values checked in the batch is set in the track record (its wrong count stays); nothing else is touched. For when the baseline holds no acquired value (batch 9: they are checked by the acquired check).
if (process.env.SET_TOTAL) {
  const per0 = existsSync("field_track_record_by_batch.json") ? (JSON.parse(readFileSync("field_track_record_by_batch.json", "utf8")) as Record<string, Record<string, { total: number; wrong: number }>>) : {};
  const cur0 = per0[String(batch)] ?? {}; const a = cur0.acquired ?? { total: 0, wrong: 0 };
  cur0.acquired = { total: Number(process.env.SET_TOTAL), wrong: a.wrong };
  addToTrackRecord(batch, Object.entries(cur0).map(([field, v]) => ({ field, total: v.total, wrong: v.wrong })));
  console.log(`✓ field_track_record: acquired of batch ${batch}: ${cur0.acquired.wrong} wrong of ${cur0.acquired.total}`); process.exit(0);
}
const fold = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const b = loadBaseline(batch); if (!b) { console.error(`baseline/batch_${batch}.json is missing`); process.exit(1); }
const total = new Set(b.values.filter((v) => v.field === "acquired").map((v) => v.company)).size;
const gone = b.values.filter((v) => v.field === "acquired" && names.some((n) => fold(n) === fold(v.company)));
const found = new Set(gone.map((v) => fold(v.company)));
for (const n of names) if (!found.has(fold(n))) console.log(`• ${n}: no acquired value in the baseline of batch ${batch}`);
// (a purchase that is not in the baseline is still a wrong value that was written: it is listed and counted below)
if (gone.length) { b.values = b.values.filter((v) => !gone.includes(v)); saveBaseline(b); console.log(`✓ baseline of batch ${batch}: ${gone.length} acquired value(s) of ${found.size} compan(ies) taken out`); }
const f = `archive/batch${batch}/excluded_values.csv`;
mkdirSync(dirname(f), { recursive: true });
const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
if (!existsSync(f)) writeFileSync(f, "﻿" + ["id", "company", "field", "value", "why"].join(",") + "\r\n");
for (const n of names) { const v = gone.filter((x) => fold(x.company) === fold(n)).map((x) => x.value).join(" · ") || "(the purchase written to the database)"; appendFileSync(f, [`wrong-acquired-${batch}`, n, "acquired", v, reasons[names.indexOf(n)]].map(q).join(",") + "\r\n"); }
console.log(`✓ ${f}: ${names.length} row(s) added`);
// the track record: the batch's other fields stay as they are
const per = existsSync("field_track_record_by_batch.json") ? (JSON.parse(readFileSync("field_track_record_by_batch.json", "utf8")) as Record<string, Record<string, { total: number; wrong: number }>>) : {};
const cur = per[String(batch)] ?? {};
const prev = cur.acquired ?? { total, wrong: 0 };
cur.acquired = { total: Math.max(prev.total, total), wrong: prev.wrong + names.length };
addToTrackRecord(batch, Object.entries(cur).map(([field, v]) => ({ field, total: v.total, wrong: v.wrong })));
console.log(`✓ field_track_record: acquired of batch ${batch}: ${cur.acquired.wrong} wrong of ${cur.acquired.total} (${names.length} Tier 1 error(s) added)`);
console.log("Commit baseline/, field_track_record*.json and archive/batch" + batch + "/excluded_values.csv.");
