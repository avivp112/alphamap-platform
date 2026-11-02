#!/usr/bin/env node
/**
 * scripts/field_review_status.ts — the running table (owner, 2026-11-02): per
 * field, how many values the owner marked, how many were correct, and whether
 * the field is open for writing (at least 20 marked, at least 90% correct).
 *
 *   npx tsx scripts/field_review_status.ts
 */
import { readMarks, fieldStatus, MIN_MARKED, MIN_CORRECT, TRACKER } from "../lib/enrichment/fieldReview.ts";

const ORDER = ["hq_city", "hq_country", "founded_year", "founding_country", "office", "employee_range", "employee_count", "founder", "founder_bio", "leader", "round", "competitor", "patent", "news"];
const status = fieldStatus(readMarks());
console.log(`Field review — ${TRACKER} (open: ≥${MIN_MARKED} marked and ≥${MIN_CORRECT * 100}% correct)\n`);
console.log(`${"field".padEnd(18)}${"marked".padEnd(8)}${"correct".padEnd(9)}${"share".padEnd(8)}status`);
for (const f of ORDER) {
  const s = status.find((x) => x.field === f) ?? { marked: 0, correct: 0, share: null, open: false };
  const st = s.open ? "✅ open" : s.marked < MIN_MARKED ? `needs ${MIN_MARKED - s.marked} more` : "❌ below 90%";
  console.log(`${f.padEnd(18)}${String(s.marked).padEnd(8)}${String(s.correct).padEnd(9)}${(s.share == null ? "—" : `${Math.round(s.share * 100)}%`).padEnd(8)}${st}`);
}
