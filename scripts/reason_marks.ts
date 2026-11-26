#!/usr/bin/env node
/**
 * scripts/reason_marks.ts — the causes of the wrong marks of a batch (owner, 2026-11-19, sample round 2). A mark given by number carries no reason, and a dangerous field with an error of unknown cause is held;
 * the causes the owner named are attached here by company and field, so the field's decision is taken on what is known. Marks that still have no cause are listed.
 *   BATCH=8 npx tsx scripts/reason_marks.ts
 */
import { readMarks, removePendingFix, saveMarks } from "../lib/enrichment/batchProcess.ts";

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
  ["DataGateway", /^tags$/, "the quote is menu text, not the verified description"],
  ["Lulalend", /^name_proposal$/, "a proposed name must be a clean brand name, not a fragment of a sentence"],
  ["Orizuru Therapeutics", /^tags$/, "a list of companies from another company's 10-K is no source"],
  ["Weezy", /^founder_background$/, "a description in a sentence belongs to one employer, not to another named in it"],
  ["Nordigen", /^round$/, "Debt without a source that says debt, and a lead without \"led by\""],
  ["TrustCert", /^tags$/, "a technical specification, not the verified description"],
  ["Orizuru Therapeutics", /^round$/, "no quote; the page announces a launch, not funding"],
  ["Lulalend", /^tags$/, "a general sentence, not the verified description"],
  ["*", /^headcount_history$/, "a story or history page dated with the run day"],
];
// Corrections by the owner: a value marked wrong that is right (company, field, part of the value, why).
const CORRECT: Array<[string, string, string, string]> = [["Ionity", "news", "2020-11-10", "the official joining was 2020-11-05 (electrive); 11-10 is within 7 days"]];
{
  const m0 = readMarks();
  for (const [co, f, part, why] of CORRECT) for (const m of Object.values(m0)) if (m.batch === batch && fold(m.company) === fold(co) && m.field === f && fold(m.value).includes(fold(part)) && m.verdict === "wrong") {
    saveMarks([{ company: m.company, field: m.field, value: m.value, verdict: "correct" as never, reason: why }], batch);
    console.log(`✓ ${m.company} · ${f} · ${m.value.slice(0, 60)} → correct (${why}); ${removePendingFix(batch, m.company, f)} pending fix(es) removed`);
  }
}
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
