#!/usr/bin/env node
/**
 * scripts/sector_rejudge_mark.ts — the owner's verdicts on the NEW sector values of scripts/sector_rejudge.ts (2026-11-10).
 * When the classifier changes, the old marks say nothing about its new values: each value that changed is entered as a mark of its own
 * (id rj.<old id>, rj2.<old id> for a second round …; the new value), correct unless its old id is named in WRONG. Run it BEFORE running sector_rejudge again (that
 * rewrites eval/sector_rejudged.csv). Nothing is changed in the database; the old marks stay and the replay retires them.
 *
 *   WRONG=6.26,9.61,8.21 npx tsx scripts/sector_rejudge_mark.ts
 */
import { appendFileSync } from "node:fs";
import { readMarks, readRejudged, TRACKER } from "../lib/enrichment/fieldReview.ts";
import { trackerLine } from "../lib/enrichment/batchReport.ts";
import { marksForNewClassifications } from "../lib/enrichment/sectorRejudge.ts";
import { latestDescriptions } from "../lib/enrichment/runDescriptions.ts";

const wrong = (process.env.WRONG ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const have = readMarks();
const rows = readRejudged();
if (!rows.length) { console.error("eval/sector_rejudged.csv is empty or missing — run scripts/sector_rejudge.ts first."); process.exit(1); }
const stored = latestDescriptions();
const { marks, unknown } = marksForNewClassifications(rows, have, wrong, (company) => stored.get(company)?.source_url || undefined, `owner ${new Date().toISOString().slice(0, 10)} (sector rejudge)`);
if (unknown.length) { console.error(`Not among the changed values: ${unknown.join(", ")} — nothing entered.`); process.exit(1); }
if (!marks.length) { console.error("Every changed sector value already has a mark — nothing to enter."); process.exit(1); }
appendFileSync(TRACKER, marks.map(trackerLine).join("\n") + "\n");
console.log(`${marks.length} new sector value(s) entered: ${marks.filter((m) => m.verdict === "wrong").length} wrong, ${marks.filter((m) => m.verdict === "correct").length} correct.`);
for (const m of marks.filter((x) => x.verdict === "wrong")) console.log(`  wrong  ${m.company}: ${m.value}`);
console.log("Then: npx tsx scripts/field_review_replay.ts > /dev/null && npx tsx scripts/field_review_status.ts");
