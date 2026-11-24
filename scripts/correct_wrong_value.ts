#!/usr/bin/env node
/**
 * scripts/correct_wrong_value.ts — a value that was wrong and is known to be wrong, so that its loss is right (owner, 2026-11-24: Shengshu's "Series A $600M", a figure in RMB read as dollars). Not an accept-lost: the value was wrong.
 *   1. the value leaves baseline/batch_N.json (exact match of company, field and value);
 *   2. it is added to archive/batch<N>/excluded_values.csv with the reason;
 *   3. field_track_record(.json, _by_batch.json): one error for the field in the batch (the count of the field's values in the baseline is taken before the value leaves).
 *   APPROVED_BY=aviv BATCH=9 COMPANY="Shengshu Technology" FIELD=round VALUE='Series A $600M · no date' REASON="RMB 600M read as dollars" npx tsx scripts/correct_wrong_value.ts
 * Run it once: a second run finds nothing in the baseline and says so, and adds nothing.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "fs";
import { dirname } from "path";
import { loadBaseline, saveBaseline, valueKey, family } from "../lib/enrichment/regressionGate.ts";
import { addToTrackRecord } from "../lib/enrichment/batchProcess.ts";

if (process.env.APPROVED_BY !== "aviv") { console.error("⛔  A baseline is changed only after the owner approved: APPROVED_BY=aviv …"); process.exit(1); }
const batch = Number(process.env.BATCH), company = process.env.COMPANY ?? "", field = process.env.FIELD ?? "", value = process.env.VALUE ?? "", reason = process.env.REASON ?? "";
if (!Number.isInteger(batch) || !company || !field || !value || !reason) { console.error("BATCH, COMPANY, FIELD, VALUE and REASON are required."); process.exit(1); }
const b = loadBaseline(batch); if (!b) { console.error(`baseline/batch_${batch}.json is missing`); process.exit(1); }
const fam = family(field);
const total = new Set(b.values.filter((v) => family(v.field) === fam).map((v) => (fam === "acquired" ? v.company : `${v.company}|${v.value}`))).size;
const key = valueKey(company, field, value);
const gone = b.values.filter((v) => valueKey(v.company, v.field, v.value) === key);
if (!gone.length) { console.log(`• ${company} · ${field} · ${value}: not in the baseline of batch ${batch} — nothing taken out, nothing counted`); process.exit(1); }
b.values = b.values.filter((v) => !gone.includes(v)); saveBaseline(b);
console.log(`✓ baseline of batch ${batch}: ${gone.length} value(s) taken out (${company} · ${field} · ${value})`);
const f = `archive/batch${batch}/excluded_values.csv`;
mkdirSync(dirname(f), { recursive: true });
const q = (x: string) => (/[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x);
if (!existsSync(f)) writeFileSync(f, "﻿" + ["id", "company", "field", "value", "why"].join(",") + "\r\n");
appendFileSync(f, [`wrong-${fam}-${batch}`, company, field, value, reason].map(q).join(",") + "\r\n");
console.log(`✓ ${f}: 1 row added`);
const per = existsSync("field_track_record_by_batch.json") ? (JSON.parse(readFileSync("field_track_record_by_batch.json", "utf8")) as Record<string, Record<string, { total: number; wrong: number }>>) : {};
const cur = per[String(batch)] ?? {}; const prev = cur[fam] ?? { total, wrong: 0 };
cur[fam] = { total: Math.max(prev.total, total), wrong: prev.wrong + 1 };
addToTrackRecord(batch, Object.entries(cur).map(([ff, v]) => ({ field: ff, total: v.total, wrong: v.wrong })));
console.log(`✓ field_track_record: ${fam} of batch ${batch}: ${cur[fam].wrong} wrong of ${cur[fam].total}`);
