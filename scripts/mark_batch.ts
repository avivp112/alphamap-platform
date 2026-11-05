#!/usr/bin/env node
/**
 * scripts/mark_batch.ts — the owner's verdicts on a writing batch into the tracker (owner, 2026-11-05).
 *
 *   BATCH=field_review/batch_3.csv WRONG=w3.2,w3.7 npx tsx scripts/mark_batch.ts
 *
 * The numbers in WRONG are marked wrong; every other value of the batch is marked correct. The
 * rows are appended to eval/field_review_tracker.csv (a batch is entered once). Then commit the
 * tracker. Writes nothing to the database.
 */
import { existsSync, readFileSync, appendFileSync } from "fs";
import { parseCsvText, readMarks, TRACKER } from "../lib/enrichment/fieldReview.ts";
import { marksFromBatch, trackerLine, type NumberedValue } from "../lib/enrichment/batchReport.ts";

const path = process.env.BATCH;
if (!path || !existsSync(path)) { console.error("BATCH=<batch csv> is required (the file the batch wrote)."); process.exit(1); }
const [head, ...rows] = parseCsvText(readFileSync(path, "utf8").replace(/^﻿/, ""));
const at = (n: string) => head.indexOf(n);
const values: NumberedValue[] = rows.map((r) => ({
  id: r[at("id")], field: r[at("field")], company: r[at("company")], value: r[at("value")], source_url: r[at("source_url")], quote: r[at("quote")] ?? "", company_id: r[at("company_id")] ?? "",
}));
const wrong = (process.env.WRONG ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const note = `owner ${new Date().toISOString().slice(0, 10)} (${path.split("/").pop()?.replace(/\.csv$/, "")})`;
const { marks, unknown } = marksFromBatch(values, wrong, note);
if (unknown.length) { console.error(`Not in the batch: ${unknown.join(", ")} — nothing entered.`); process.exit(1); }
const have = new Set(readMarks().map((m) => m.id));
if (marks.some((m) => have.has(m.id))) { console.error(`${path} is already in the tracker — nothing entered.`); process.exit(1); }
appendFileSync(TRACKER, marks.map(trackerLine).join("\n") + "\n");
console.log(`${marks.length} value(s) entered in ${TRACKER}: ${marks.filter((m) => m.verdict === "wrong").length} wrong, ${marks.filter((m) => m.verdict === "correct").length} correct.`);
console.log("Then: npx tsx scripts/field_review_status.ts");
