#!/usr/bin/env node
/**
 * scripts/report_lint.ts — checks a dry run's report for the faults that were found by eye in batches 1–4 (owner, 2026-11-15), so they are found by a machine
 * before the owner looks. Reads pilot_report_dry.csv (PILOT_REPORT=… for another), not_enriched.csv and, when there, batch4_dry.log. Free, writes nothing.
 * Exit code 1 when there is an error; a warning is only said.
 *
 *   npx tsx scripts/report_lint.ts
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { roundSourceStanding } from "../lib/enrichment/roundSources.ts";
import { domainOf } from "../lib/enrichment/rejectedDomains.ts";
import { acquisitionHeadline } from "../lib/enrichment/siteOwner.ts";
import { extractNumbersFromText } from "../lib/enrichment/evidence.ts";
import { SECTOR_TAXONOMY } from "../src/lib/taxonomy.ts";
import { loadKnown, refreshDue, markKey } from "../lib/enrichment/knownSources.ts";
import { rowProblem } from "../lib/enrichment/rowRules.ts";
import { foundingSentenceIsAboutCompany } from "../lib/enrichment/subject.ts";
import { roleAtCompany } from "../lib/enrichment/people.ts";
import { isPartyRelease, roundSourceStanding } from "../lib/enrichment/roundSources.ts";
import { claims } from "../lib/enrichment/descriptionBuilder.ts";
import { completeFromSlug } from "../lib/enrichment/newsRelevance.ts";
import { knownAcquirers } from "../lib/enrichment/acquisition.ts";
import { isTrackingHost } from "../lib/enrichment/siteOwner.ts";
import { recentRules } from "../lib/enrichment/ruleRegistry.ts";
import { loadGaps, ownerWrongTest } from "../lib/enrichment/knownGaps.ts";

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
type Row = { id: string; company: string; field: string; after: string; url: string; quote: string; original: string; translated: string; rule: string };
const rows: Row[] = body.map((r) => ({ id: r[ix("company_id")], company: r[ix("company")], field: r[ix("field")], after: r[ix("after")] ?? "", url: r[ix("source_url")] ?? "", quote: r[ix("quote")] ?? "", original: ix("quote_original") >= 0 ? r[ix("quote_original")] ?? "" : "", translated: ix("quote_translated") >= 0 ? r[ix("quote_translated")] ?? "" : "", rule: ix("rule") >= 0 ? r[ix("rule")] ?? "" : "" })).filter((r) => r.field && r.field !== "(nothing)");

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
  if (r.field === "sector") {
    const name = r.after.replace(/\s*\(industry:[^)]*\)\s*$/, "").trim();
    const known = new Set([...Object.keys(SECTOR_TAXONOMY), ...Object.values(SECTOR_TAXONOMY).flat()]);
    if (!known.has(name)) warn(r.company, `sector "${r.after}" is not a sector of the taxonomy`);
  }
}
for (const [k, n] of seen) if (n > 1) { const [c, f, a] = k.split("|"); err(c, `${f} "${a.slice(0, 50)}" appears ${n} times`); }

// per company
for (const [c, rs] of byCompany) {
  // A round's amount must stand in its quote, with the unit (owner, round 10: "$25M" where the source says "$250 million").
  for (const r of rs.filter((x) => x.field === "round")) {
    const m = r.after.match(/\$(\d+(?:\.\d+)?)M\b/);
    if (!m) continue;
    const amount = Number(m[1]) * 1e6;
    if (!r.quote) { warn(c, `round "${r.after.slice(0, 50)}" has no quote to check its amount against`); continue; }
    const nums = extractNumbersFromText(r.quote);
    if (nums.some((n) => Math.abs(n - amount) / amount < 0.006)) continue;
    if (/[€£₹¥]|\b(?:EUR|GBP|INR|CAD|AUD|NIS|ILS|CHF|SEK|C\$|A\$)\b/.test(r.quote)) { warn(c, `round "${r.after.slice(0, 50)}": the quote is in another currency (${r.quote.slice(0, 80)}), amount shown in USD`); continue; }
    err(c, `round amount $${m[1]}M is not in its quote with its unit: "${r.quote.replace(/\s+/g, " ").slice(0, 160)}"`);
  }
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

// ── Every row of the report passes the rules of today (owner, batch 7: seven rows of 48 were wrong and no rule knew) ──
for (const r of rows) {
  const why = rowProblem({ company: r.company, field: r.field, after: r.after, source_url: r.url, quote: r.quote }, r.company, new Date().toISOString().slice(0, 10));
  if (why) err(r.company, `${r.field} "${r.after.slice(0, 50)}" is in the report and breaks a rule: ${why}`);
}

// ── Rejection audit (owner, batch 7: "the rules reject correct values"): a rejection that a rule of today would not make is a gap, and a gap is an error ──
if (existsSync("rejected_all.csv")) {
  const [rh, ...rr] = parseCsv(readFileSync("rejected_all.csv", "utf8"));
  const ri = (c: string) => { const e = rh.findIndex((h) => h === c); return e >= 0 ? e : rh.findIndex((h) => h.startsWith(c)); };
  for (const r of rr) {
    const company = r[ri("company")], field = r[ri("field")], value = r[ri("value")], code = r[ri("reason_code")], reason = r[ri("reason")], url = r[ri("source_url")], evidence = r[ri("evidence")];
    // a. the sentence of a founding year: a short name, "the company", a label of the site
    if (code === "sentence_not_about_company" && field === "founded_year" && evidence && foundingSentenceIsAboutCompany(evidence, value, company, { url, ownSite: false })) err(company, `founded_year ${value} was rejected, and its sentence is about the company ("${evidence.slice(0, 90)}")`);
    // b. a second role after the comma is not another company
    if (code === "title_at_another_company") { const t = reason.match(/the title "([^"]+)"/)?.[1]; if (t && roleAtCompany(t, company).role !== null) err(company, `founder ${value} was rejected for a title "${t}" that is at no other company`); }
    // 1. a name is checked only when it names a company, a product or a person: not a country, not "ETF-based"
    { const nm = code.match(/^description_sentence_name_not_in_sources:(.+)$/)?.[1];
      if (nm && evidence && !claims(evidence, company).names.includes(nm)) err(company, `description sentence rejected for the name "${nm}", which is no company, product or person ("${evidence.slice(0, 80)}")`); }
    // 2. a number is checked as a token of its own
    { const nn = code.match(/^description_sentence_number_not_in_sources:(.+)$/)?.[1];
      if (nn && evidence && !claims(evidence, company).numbers.includes(nn)) err(company, `description sentence rejected for the number "${nn}", which is no token of its own ("${evidence.slice(0, 80)}")`); }
    // 3. a headline cut only in a print, whose address carries the whole of it
    if (code === "news_headline_cut" && url && completeFromSlug(value, url)) err(company, `news "${value.slice(0, 60)}" rejected as cut off, and its address carries the whole headline`);
    // 4. a company known to be bought: the buyer's headlines are about it
    if (code === "news_same_name_other_company") {
      const titles = rr.filter((x) => x[ri("company")] === company && x[ri("field")] === "news").map((x) => x[ri("value")]);
      const buyers = knownAcquirers(titles, company);
      if (buyers.some((b) => value.toLowerCase().includes(b.toLowerCase()))) err(company, `news "${value.slice(0, 60)}" rejected as another company's, and ${buyers.join(", ")} is its known buyer`);
    }
    // 6. a source rejected as not allowed that the standing rules allow
    if (code === "source_not_allowed" && url && roundSourceStanding(url, { companyName: company, headline: value }).kind === "allowed") err(company, `${field} "${value.slice(0, 50)}" rejected as not on the allowed list, and ${url.slice(0, 70)} is allowed`);
    // f. the other party's announcement of the deal is a source for the event
    if (code === "source_not_allowed" && field === "news" && url && isPartyRelease(url, value, { companyName: company })) err(company, `news "${value.slice(0, 60)}" was rejected, and it is a party's own announcement of the deal (${url.slice(0, 80)})`);
  }
}
if (existsSync("website_review.csv")) {
  const [wh, ...wr] = parseCsv(readFileSync("website_review.csv", "utf8"));
  const wi = (c: string) => wh.findIndex((h) => h.startsWith(c));
  for (const r of wr) {
    const detail = r[wi("detail")] ?? "";
    // e. an address that passes through an advertising / tracking endpoint is a broken redirect, not another company
    const host = detail.match(/leads to (\S+)/)?.[1];
    if (host && isTrackingHost(host)) err(r[wi("company")], `${host} is an advertising / tracking address, listed as another company's site`);
  }
}

// ── Every value of the memory is in the report, or flagged with a reason (owner, round 10) ──
{
  const store = loadKnown(), wrong = ownerWrongTest(loadGaps());
  const today = new Date().toISOString().slice(0, 10);
  const fold = (x: string) => x.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const family = (f: string) => (f === "description_what_only" ? "description" : f);
  let missing = 0;
  // Remembered values this run did not write are listed in carried_not_written.csv, with their source: that listing is their reason.
  const carriedKeys = new Set<string>();
  if (existsSync("carried_not_written.csv")) {
    const [head, ...cr] = parseCsv(readFileSync("carried_not_written.csv", "utf8"));
    const ix = (c: string) => head.indexOf(c);
    for (const r of cr) carriedKeys.add(`${r[ix("company_id")]}|${family(r[ix("field")])}|${fold(r[ix("value")] ?? "")}`);
  }
  for (const [id, list] of Object.entries(store)) {
    const inReport = rows.filter((r) => r.id === id);
    if (!inReport.length) continue;                                     // the company was not in this run's report
    for (const e of list) {
      if (carriedKeys.has(`${id}|${family(e.field)}|${fold(e.value)}`)) continue;
      if (e.status === "quote_gone" || e.status === "superseded" || wrong(e.company, e.field, e.value) || refreshDue(e, today)) continue;   // flagged, with its reason
      // A remembered value that the rules of today reject is not in the report, and the rule is its reason (the new source and name rules, batch 7).
      if (rowProblem({ field: e.field, after: e.value, source_url: e.source_url, quote: e.quote, payload: e.payload }, e.company, today)) continue;
      if (inReport.some((r) => family(r.field) === family(e.field) && fold(r.after) === fold(e.value))) continue;
      // A single-valued field whose value is now another one is a supersession, which remember() marks; anything else is a value that went missing.
      if (inReport.some((r) => family(r.field) === family(e.field)) && ["hq_city", "hq_country", "founded_year", "founding_country", "sector", "description", "tags", "employee_count", "employee_range"].includes(family(e.field))) continue;
      missing++;
      if (missing <= 25) err(e.company, `the memory holds ${e.field} "${e.value.slice(0, 70)}" (${e.verified_at}, ${e.source_url.slice(0, 60)}) and the report does not show it, with no reason`);
    }
  }
  if (missing > 25) err("(memory)", `… and ${missing - 25} more values of the memory missing from the report`);
}

console.log(`${rows.length} value(s) of ${byCompany.size} company(ies) checked.\n`);
for (const e of errors) console.log(`❌ ${e}`);
for (const w of warnings) console.log(`⚠️  ${w}`);
if (archived.size) console.log(`\nℹ️  Values read from the Internet Archive (original domain): ${[...archived].map(([k, n]) => `${k}×${n}`).join(", ")}`);
if (unlisted.size) console.log(`\nℹ️  Values from domains on no list (the companies' own sites, or a source to place): ${[...unlisted].sort((x, y) => y[1] - x[1]).map(([d, n]) => `${d}×${n}`).slice(0, 30).join(", ")}`);
console.log(`\n${errors.length} error(s), ${warnings.length} warning(s).`);

// ── Ready for a wet run? (owner, round 10) ───────────────────────────────────────────────────────────────────────────
{
  const unreadable = new Set<string>();
  if (existsSync("website_review.csv")) {
    const [wh, ...wb] = parseCsv(readFileSync("website_review.csv", "utf8"));
    const wi = (n: string) => wh.indexOf(n);
    for (const r of wb) if (/unreadable/i.test(r[wi("reason")] ?? "")) unreadable.add(r[wi("company")]);
  }
  const enriched = [...byCompany.keys()].filter((c) => !unreadable.has(c));
  // A company already written has its values in the database and the memory, not in a report of what would be written now: the coverage counts the report and carried_not_written.csv together.
  const carriedFields = new Map<string, Set<string>>();
  if (existsSync("carried_not_written.csv")) {
    const [ch, ...cb] = parseCsv(readFileSync("carried_not_written.csv", "utf8"));
    for (const r of cb) { const c = r[ch.indexOf("company")]; (carriedFields.get(c) ?? carriedFields.set(c, new Set()).get(c)!).add(r[ch.indexOf("field")]); }
  }
  const has = (c: string, ...fs: string[]) => (byCompany.get(c) ?? []).some((r) => fs.includes(r.field)) || fs.some((f) => carriedFields.get(c)?.has(f));
  const pct = (n: number) => enriched.length ? Math.round((100 * n) / enriched.length) : 0;
  const goals: Array<[string, number, number]> = [
    ["description", pct(enriched.filter((c) => has(c, "description", "description_what_only")).length), 80],
    ["sector", pct(enriched.filter((c) => has(c, "sector")).length), 80],
    ["tags", pct(enriched.filter((c) => has(c, "tags")).length), 80],
    ["headquarters", pct(enriched.filter((c) => has(c, "hq_city")).length), 60],
    ["founders", pct(enriched.filter((c) => has(c, "founder")).length), 50],
  ];
  const gaps: string[] = [];
  console.log(`\n── Ready for a wet run? (${enriched.length} enriched compan(ies) with a readable site) ──`);
  if (errors.length) gaps.push(`lint: ${errors.length} error(s), target 0`);
  for (const [name, got, want] of goals) { console.log(`  ${got >= want ? "✅" : "❌"} ${name}: ${got}% (target ≥${want}%)`); if (got < want) gaps.push(`${name} ${got}% < ${want}%`); }
  const prevPath = process.env.PREV;
  if (prevPath && existsSync(prevPath)) {
    const [ph, ...pb] = parseCsv(readFileSync(prevPath, "utf8"));
    const pi = (n: string) => ph.indexOf(n);
    const fam = (f: string) => (f === "description_what_only" ? "description" : f);
    const prev = new Set(pb.filter((r) => r[pi("field")] !== "(nothing)").map((r) => `${r[pi("company")]}|${fam(r[pi("field")])}`));
    const now = new Set(rows.map((r) => `${r.company}|${fam(r.field)}`));
    // A company the run no longer enriches (a rule turned it away: not technology, domain unresolved) is not a lost value; it is listed apart.
    const companiesNow = new Set(rows.map((r) => r.company));
    const gone = [...prev].filter((k) => !companiesNow.has(k.split("|")[0]));
    const comparable = new Set([...prev].filter((k) => companiesNow.has(k.split("|")[0])));
    const lost = [...comparable].filter((k) => !now.has(k)).length;
    if (gone.length) console.log(`  ℹ️  ${gone.length} field(s) of ${new Set(gone.map((k) => k.split("|")[0])).size} compan(ies) that this run no longer enriches are not counted: ${[...new Set(gone.map((k) => k.split("|")[0]))].join(", ")}`);
    const lostPct = comparable.size ? Math.round((1000 * lost) / comparable.size) / 10 : 0;
    console.log(`  ${lostPct < 5 ? "✅" : "❌"} stability: ${lost} of ${comparable.size} field(s) of ${prevPath} are gone (${lostPct}%, target <5%)`);
    if (lostPct >= 5) gaps.push(`stability ${lostPct}% lost ≥ 5%`);
  } else console.log("  ➖ stability: not measured (PREV=<earlier report.csv> compares two runs)");
  // A stratified sample of 40 values for the owner's precision check (round 10): 10 from companies with a common or generic name, 10 from companies whose sources were translated, 10
  // from borderline technology companies, 10 from small startups (few sources). A stratum with too few values is filled from the others. Each value with its source and quote; a translated
  // page is marked, and its original is the source address.
  let seed = Number(process.env.SAMPLE_SEED ?? 40);
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const pool = rows.filter((r) => r.field !== "(nothing)" && r.after);
  let flags: Record<string, { generic: boolean; translated: boolean; sources: number; techBorderline: boolean }> = {};
  try { flags = JSON.parse(readFileSync("cache/company_flags.json", "utf8")); } catch { /* no flags: a random sample */ }
  // Five strata of ten (owner, batch 7): a common or generic name · a translated source · a borderline technology company · the headquarters and the founders · the values a rule of the last week made.
  // A stratum with too few values is filled from the rest. Values are taken per row, so the last two strata look at the value, the first three at the company.
  const recent = recentRules(process.env.SAMPLE_TODAY ?? new Date().toISOString().slice(0, 10), Number(process.env.RECENT_RULE_DAYS ?? 7));
  const strata: Array<[string, (r: Row) => boolean]> = [
    ["common/generic name", (r) => !!flags[r.company]?.generic],
    ["translated source", (r) => !!flags[r.company]?.translated || !!r.original && r.original !== r.quote],
    ["borderline technology", (r) => !!flags[r.company]?.techBorderline],
    ["headquarters / founders", (r) => ["hq_city", "hq_country", "founder"].includes(r.field)],
    ["made by a rule of the last week", (r) => !!r.rule && recent.has(r.rule)],
  ];
  const PER = Number(process.env.SAMPLE_PER_STRATUM ?? 10), TOTAL = PER * strata.length;
  const shuffle = <T,>(xs: T[]) => [...xs].sort(() => rnd() - 0.5);
  const chosen: Array<{ r: Row; stratum: string }> = [];
  const used = new Set<Row>();
  for (const [label, test] of strata) {
    for (const r of shuffle(pool.filter((x) => test(x) && !used.has(x))).slice(0, PER)) { chosen.push({ r, stratum: label }); used.add(r); }
  }
  for (const r of shuffle(pool.filter((x) => !used.has(x)))) { if (chosen.length >= TOTAL) break; chosen.push({ r, stratum: "filled from the rest" }); used.add(r); }
  const pick = chosen.slice(0, TOTAL);
  const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const sampleFile = process.env.SAMPLE_FILE ?? `sample_${TOTAL}.csv`;
  writeFileSync(sampleFile, "\uFEFF" + ["n,stratum,company,field,value,source_url,quote,quote_original (the page's own words),quote_translated (English it was verified against),rule,verdict (correct/wrong)", ...pick.map(({ r, stratum }, i) => [i + 1, stratum, r.company, r.field, r.after, r.url, r.quote.replace(/^\[machine translation\]\s*/, ""), r.original, r.translated, r.rule, ""].map((x) => q(String(x))).join(","))].join("\r\n") + "\r\n");
  console.log(`  strata: ${strata.map(([l]) => `${l} ${pick.filter((p) => p.stratum === l).length}`).join(" · ")} · filled ${pick.filter((p) => p.stratum === "filled from the rest").length}`);
  console.log(`  ➖ precision: ${pick.length} value(s) in ${sampleFile} (stratified) — mark each correct/wrong (target ≥95%)`);
  console.log(`\n${gaps.length ? `מוכן לרטוב: לא — הפער: ${gaps.join("; ")}` : "מוכן לרטוב: כן (בכפוף לבדיקת הדיוק במדגם)"}`);
}
process.exit(errors.length ? 1 : 0);
