#!/usr/bin/env node
/**
 * scripts/field_review_status.ts — the running table (owner, 2026-11-02): per
 * field, how many values the owner marked, how many were correct, and whether
 * the field is open for writing (at least 20 marked, at least 90% correct).
 *
 *   npx tsx scripts/field_review_status.ts
 */
import { readMarks, readReplay, countedMarks, fieldStatus, pendingReviews, pendingSectorItems, MIN_MARKED, MIN_CORRECT, TRACKER } from "../lib/enrichment/fieldReview.ts";

const ORDER = ["hq_city", "hq_country", "founded_year", "founding_country", "description", "sector", "tags", "office", "employee_range", "employee_count", "employee_history", "founder", "leader", "board", "round", "competitor_declared", "competitor_market", "patent", "news", "founder_background"];
const all = readMarks();
const replay = readReplay();
const counted = countedMarks(all, replay);
const pending = pendingReviews();
const status = fieldStatus(counted, pending);
// A mark whose value the current rules no longer produce leaves the count (owner, 2026-11-04).
const excluded = all.filter((m) => !counted.includes(m));
console.log(`Field review — ${TRACKER} (open: ≥${MIN_MARKED} marked and ≥${MIN_CORRECT * 100}% correct)\n`);
console.log(replay.size ? `Against the current rules: ${replay.size} mark(s) replayed, ${excluded.length} no longer produced and left out.\n` : "No replay yet: every mark counts (scripts/field_review_replay.ts).\n");
console.log(`${"field".padEnd(18)}${"marked".padEnd(8)}${"correct".padEnd(9)}${"share".padEnd(8)}status`);
for (const f of ORDER) {
  const s = status.find((x) => x.field === f) ?? { marked: 0, correct: 0, share: null, open: false };
  const waiting = pending[f] ?? 0;
  const st = waiting ? `⏳ ${waiting} new value(s) to review` : s.open ? "✅ open" : s.marked < MIN_MARKED ? `needs ${MIN_MARKED - s.marked} more` : "❌ below 90%";
  console.log(`${f.padEnd(18)}${String(s.marked).padEnd(8)}${String(s.correct).padEnd(9)}${(s.share == null ? "—" : `${Math.round(s.share * 100)}%`).padEnd(8)}${st}`);
}
const waitingItems = pendingSectorItems();
if (waitingItems.length) {
  console.log("\nSector values to review (mark them: WRONG=<id> npx tsx scripts/sector_rejudge_mark.ts):");
  for (const w of waitingItems) console.log(`  ${w.id.padEnd(12)} ${w.company}: ${w.now}`);
}
if (excluded.length) {
  console.log("\nLeft out (the current rules no longer produce them):");
  for (const m of excluded) console.log(`  ${m.id.padEnd(6)} ${m.field.padEnd(16)} ${m.verdict.padEnd(8)} ${m.company}: ${m.value.slice(0, 70)}`);
}
