#!/usr/bin/env node
/**
 * scripts/reason_marks.ts — the causes of the wrong marks of a batch (owner, 2026-11-19, sample round 2). A mark given by number carries no reason, and a dangerous field with an error of unknown cause is held;
 * the causes the owner named are attached here by company and field, so the field's decision is taken on what is known. Marks that still have no cause are listed.
 *   BATCH=8 npx tsx scripts/reason_marks.ts
 */
import { readMarks, saveMarks } from "../lib/enrichment/batchProcess.ts";

const batch = Number(process.env.BATCH ?? 8);
const fold = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "");
// [company (or "*"), field regex, cause]
const CAUSES: Array<[string, RegExp, string]> = [
  ["Shyft", /./, "a name several companies carry: the value does not come from the company's own site or a source naming its domain"],
  ["Screaming Frog", /^founder$/, "a role at another company (Co-Founder – The Big Deal)"],
  ["lawhive", /^round$/, "the round type was taken from an address, not from a quote"],
  ["Ionity", /^news$/, "a date read from the page's code that no other source confirms within 7 days"],
  ["Lendbox", /^round$/, "a data platform's profile page is no source for a round"],
  ["Weezy", /^(founder|leader)$/, "a role (COO) that is not in the quote"],
  ["*", /^headcount_history$/, "a story or history page dated with the run day"],
];
const marks = readMarks();
const fix: Array<{ company: string; field: string; value: string; verdict: "wrong"; reason: string }> = [];
const left: string[] = [];
for (const m of Object.values(marks)) {
  if (m.batch !== batch || m.verdict !== "wrong") continue;
  const known = m.reason && !/^wrong in the sample check$|^marked wrong before$/.test(m.reason);
  if (known) continue;
  const c = CAUSES.find(([co, f]) => (co === "*" || fold(co) === fold(m.company)) && f.test(m.field));
  if (c) fix.push({ company: m.company, field: m.field, value: m.value, verdict: "wrong", reason: c[2] });
  else left.push(`  ${m.company} · ${m.field} · ${m.value.slice(0, 90)}`);
}
saveMarks(fix, batch);
console.log(`${fix.length} wrong mark(s) got their cause:`);
for (const f of fix) console.log(`  ${f.company} · ${f.field} · ${f.value.slice(0, 70)} — ${f.reason}`);
console.log(`\n${left.length} wrong mark(s) still without a cause${left.length ? " (tell me what is wrong in each and I add it):" : "."}`);
for (const l of left) console.log(l);
