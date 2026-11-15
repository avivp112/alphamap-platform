#!/usr/bin/env node
/**
 * scripts/report_lint.ts — checks a dry run's report for the faults that were found by eye in batches 1–4 (owner, 2026-11-15), so they are found by a machine
 * before the owner looks. Reads pilot_report_dry.csv (PILOT_REPORT=… for another), not_enriched.csv and, when there, batch4_dry.log. Free, writes nothing.
 * Exit code 1 when there is an error; a warning is only said.
 *
 *   npx tsx scripts/report_lint.ts
 */
import { readFileSync, existsSync } from "fs";
import { roundSourceStanding } from "../lib/enrichment/roundSources.ts";
import { domainOf } from "../lib/enrichment/rejectedDomains.ts";
import { acquisitionHeadline } from "../lib/enrichment/siteOwner.ts";

function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cur = "", q = false;
  const t = text.replace(/^﻿/, "");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && t[i + 1] === "\n") i++; row.push(cur); cur = ""; if (row.some((x) => x !== "")) rows.push(row); row = []; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

const reportPath = process.env.PILOT_REPORT ?? "pilot_report_dry.csv";
if (!existsSync(reportPath)) { console.error(`${reportPath} not found`); process.exit(1); }
const [head, ...body] = parseCsv(readFileSync(reportPath, "utf8"));
const ix = (n: string) => head.indexOf(n);
type Row = { id: string; company: string; field: string; after: string; url: string; quote: string };
const rows: Row[] = body.map((r) => ({ id: r[ix("company_id")], company: r[ix("company")], field: r[ix("field")], after: r[ix("after")] ?? "", url: r[ix("source_url")] ?? "", quote: r[ix("quote")] ?? "" })).filter((r) => r.field && r.field !== "(nothing)");

const errors: string[] = [], warnings: string[] = [];
const err = (c: string, m: string) => errors.push(`${c}: ${m}`);
const warn = (c: string, m: string) => warnings.push(`${c}: ${m}`);

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const seen = new Map<string, number>();
const unlisted = new Map<string, number>();
const archived = new Map<string, number>();
const byCompany = new Map<string, Row[]>();
for (const r of rows) {
  (byCompany.get(r.company) ?? byCompany.set(r.company, []).get(r.company)!).push(r);
  // 1. a value without a source
  if (!r.url) err(r.company, `${r.field} "${r.after.slice(0, 50)}" has no source address`);
  // 2. an identifier where a value belongs
  if (UUID.test(r.after)) err(r.company, `${r.field} shows an identifier: "${r.after.slice(0, 60)}"`);
  // 3. a value from a source that is blocked (or on no list)
  if (r.url && !/^\(/.test(r.url)) {
    const st = roundSourceStanding(r.url);
    if (st.kind === "denied") err(r.company, `${r.field} comes from a blocked source (${st.why}): ${domainOf(r.url) ?? r.url}`);
    else if (st.kind === "unlisted") unlisted.set(domainOf(r.url) ?? r.url, (unlisted.get(domainOf(r.url) ?? r.url) ?? 0) + 1);   // mostly the companies' own sites
  }
  // 4. the same value twice
  const k = `${r.company}|${r.field}|${r.after}`;
  seen.set(k, (seen.get(k) ?? 0) + 1);
  // 5. a year-only or month-only round shown as a day
  if (r.field === "round" && /·\s\d{4}-01-01\b(?!\s\()/.test(r.after)) warn(r.company, `round dated 1 January without "(year only)": ${r.after.slice(0, 60)}`);
  // 5b. a round over $2B for a private company (Pet Circle's "$10200M")
  if (r.field === "round") { const m = r.after.match(/\$(\d+(?:\.\d+)?)\s?(M|B)\b/); if (m && (m[2] === "B" ? Number(m[1]) * 1000 : Number(m[1])) >= 2000) err(r.company, `a round of $${m[1]}${m[2]} for a private company: ${r.after.slice(0, 70)}`); }
  // 5c. a value read from the Internet Archive: the domain of the original page
  const arch = r.url.match(/web\.archive\.org\/web\/\d+[a-z_]*\/(https?:\/\/[^/]+)/i);
  if (arch) archived.set(`${r.company} ← ${arch[1].replace(/^https?:\/\//, "")}`, (archived.get(`${r.company} ← ${arch[1].replace(/^https?:\/\//, "")}`) ?? 0) + 1);
  // 6. news without a date
  if (r.field === "news" && /^no date\b/.test(r.after)) err(r.company, `news without a date: ${r.after.slice(0, 60)}`);
  // 7. a headcount point without a quote
  if (r.field === "headcount_history" && !r.quote) err(r.company, `headcount point without its quote: ${r.after}`);
  // 8. a sector that is not a sector of the list
  if (r.field === "sector" && /^Design|Software$/.test(r.after) && !/&/.test(r.after) && !/\(industry/.test(r.after)) warn(r.company, `sector "${r.after}" looks like free text`);
}
for (const [k, n] of seen) if (n > 1) { const [c, f, a] = k.split("|"); err(c, `${f} "${a.slice(0, 50)}" appears ${n} times`); }

// per company
for (const [c, rs] of byCompany) {
  const f = (name: string) => rs.filter((r) => r.field === name);
  if (f("sector").length > 1) err(c, `sector appears ${f("sector").length} times`);
  if ((f("description").length || f("description_what_only").length) && !f("sector").length) warn(c, "has a description but no sector");
  if (f("sector").length && !f("tags").length) warn(c, "has a sector but no tags");
  if (f("employee_count").length && !f("headcount_history").length) err(c, "employee_count without a headcount point (it is derived from the history)");
  if (f("description").length && f("description_what_only").length) err(c, "both a complete and a what-only description");
}

// not enriched and also in the report
if (existsSync("not_enriched.csv")) {
  const names = new Set(parseCsv(readFileSync("not_enriched.csv", "utf8")).slice(1).map((r) => r[0]));
  for (const c of byCompany.keys()) if (names.has(c)) err(c, "is in not_enriched.csv and has values in the report");
}

// the log: no silent drop
if (existsSync("batch4_dry.log")) {
  const log = readFileSync("batch4_dry.log", "utf8");
  // a company's block of the log (CONCURRENCY>1 prints one block per company: "┌── Name" … "└── Name done")
  const blocks = new Map<string, string>();
  for (const m of log.matchAll(/┌── (.+)\n([\s\S]*?)\n└── \1 done/g)) blocks.set(m[1], m[2]);
  for (const [company, text] of blocks) {
    // a domain that is both the company's own site and a rebranded one
    const own = [...text.matchAll(/🏠\s+(https?:\/\/\S+) is the company's own site/g)].map((x) => domainOf(x[1]));
    const moved = text.match(/acquired \/ rebranded: \S+'s address leads to (\S+)/)?.[1];
    if (moved && own.includes(domainOf(`https://${moved}`))) err(company, `${moved} is marked both as the company's own site and as the site of another company (acquired / rebranded)`);
    // news that says the company was acquired, and the company not flagged for review
    const flagged = /acquired \/ rebranded|domain_repurposed/.test(text);
    for (const r of byCompany.get(company) ?? []) if (r.field === "news" && acquisitionHeadline(r.after.replace(/^[^—]*—\s*/, ""), company) && !flagged) warn(company, `news says the company was acquired and it is not flagged for review: ${r.after.slice(0, 80)}`);
  }
  const noDesc = [...log.matchAll(/Description \(v2\): no verified "what" — none written[^\n]*\n/g)].length;
  const dropLines = [...log.matchAll(/description sentence dropped/g)].length;
  const returnedSome = [...log.matchAll(/the model returned (?!no sentences)/g)].length;
  if (returnedSome > 0 && dropLines === 0) err("(log)", `${returnedSome} description(s) failed with sentences returned, and not one dropped sentence is named`);
  // a value the model proposed and that vanished without its own reason
  const later = [...log.matchAll(/not kept: dropped by a later check/g)].length;
  if (later) err("(log)", `${later} proposed value(s) were dropped with no reason of their own ("dropped by a later check") — a silent drop`);
  const proposedNoneKept = [...log.matchAll(/Headquarters: the model proposed (?!no city)[^\n]*kept no city(?![^\n]*not kept:)/g)].length;
  if (proposedNoneKept) err("(log)", `${proposedNoneKept} headquarters proposed and not kept without a reason on the same line`);
  if (noDesc) console.log(`(log) ${noDesc} company(ies) without a description; ${dropLines} dropped sentence(s) named.`);
}

console.log(`${rows.length} value(s) of ${byCompany.size} company(ies) checked.\n`);
for (const e of errors) console.log(`❌ ${e}`);
for (const w of warnings) console.log(`⚠️  ${w}`);
if (archived.size) console.log(`\nℹ️  Values read from the Internet Archive (original domain): ${[...archived].map(([k, n]) => `${k}×${n}`).join(", ")}`);
if (unlisted.size) console.log(`\nℹ️  Values from domains on no list (the companies' own sites, or a source to place): ${[...unlisted].sort((x, y) => y[1] - x[1]).map(([d, n]) => `${d}×${n}`).slice(0, 30).join(", ")}`);
console.log(`\n${errors.length} error(s), ${warnings.length} warning(s).`);
process.exit(errors.length ? 1 : 0);
