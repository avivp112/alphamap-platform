#!/usr/bin/env node
/**
 * scripts/field_status.ts — which fields a wet run may write, and how far each closed one is from opening (owner, round 10).
 * A field is open at 20 or more marks with 90% or more correct (eval/field_review_tracker.csv); nothing else is ever written. Free, reads only.
 *
 *   npx tsx scripts/field_status.ts
 */
import { readMarks, fieldStatus, openFieldNames } from "../lib/enrichment/fieldReview.ts";

const NEED_MARKS = 20, NEED_SHARE = 0.9;
const rows = fieldStatus(readMarks());
console.log("field".padEnd(24) + "correct/marked".padEnd(16) + "share".padEnd(8) + "state".padEnd(8) + "to open");
for (const s of rows) {
  const marked = s.marked, ok = s.correct;
  // The fewest further correct marks (no new wrong one) that reach both bars.
  let more = 0;
  while (!(marked + more >= NEED_MARKS && (ok + more) / (marked + more) >= NEED_SHARE) && more < 500) more++;
  console.log(s.field.padEnd(24) + `${ok}/${marked}`.padEnd(16) + (s.share == null ? "-" : `${Math.round(100 * s.share)}%`).padEnd(8) + (s.open ? "OPEN" : "closed").padEnd(8) + (s.open ? "" : s.pending ? `waiting for ${s.pending} review(s)` : `${more} more correct mark(s), no new wrong one`));
}
console.log(`\nOpen for writing: ${openFieldNames().join(", ") || "none"}`);
