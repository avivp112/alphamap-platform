#!/usr/bin/env node
/**
 * scripts/regression.ts — the regression gate (owner, 2026-11-19). Every batch already written is run again, from the recordings and the cache (REPLAY=1, no search, no fetch, the memory off, the
 * database's own values left out: a clean slate), and compared with its baseline (baseline/batch_<N>.json). It fails when
 *   (a) an acceptance check returns ERROR, or
 *   (b) a value that was good in the baseline is rejected now.
 * Each loss is listed with its reason code; the values that are new are listed apart. On a pass it writes regression_pass_<commit>.json, which a wet run (DRY_RUN=false) needs for its code.
 * A model call a fix made new runs live, for the values of these batches only; the cost is reported (aim: under $0.10 a run).
 *
 *   npx tsx scripts/regression.ts                       the gate: every written batch (baseline/batches.json)
 *   npx tsx scripts/regression.ts init [5 6 7]          the baselines, from the code as it is now (a baseline that exists is replaced only with APPROVED_BY=aviv)
 *   REPORT=pilot_report_write.csv npx tsx scripts/regression.ts init 7     a batch's baseline from the report that was WRITTEN (its values are the proven ones), not from the code
 *   APPROVED_BY=aviv npx tsx scripts/regression.ts accept-lost "Company:field:value" …   takes values out of a baseline (a lost value that was really wrong) — only after the owner approved it
 *   ONLY_BATCHES=7 npx tsx scripts/regression.ts        one batch, to look; no pass file is written for a part
 */
import { spawnSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tierOf } from "../lib/enrichment/tiers.ts";
import { parseCsv, rowsFromCsv, runAcceptance, type Check } from "../lib/enrichment/acceptance.ts";
import { specPathsFor } from "./acceptance_check.ts";
import {
  acceptanceErrors, baselinePath, compare, family, headCommit, headTree, loadBaseline, saveBaseline, saveWrittenBatches, treeIsClean, valueKey, watched, writePass, writtenBatches,
  type Baseline, type Rejected, type RunRow,
} from "../lib/enrichment/regressionGate.ts";

const OUT = "regression/out";
/** A cost cap is always on (owner, 2026-11-24): MAX_COST dollars for the whole run, 5 when not given. The cost of a company is estimated at $0.012 (batch 8 measured it), the rest of the call is free from the recordings. */
const CAP = Number(process.env.MAX_COST ?? 5);
const PER_COMPANY = 0.012;
function printPlan(batches: number[], what: string): void {
  let total = 0;
  console.log(`\n${what}: the companies of each batch and the estimate at $${PER_COMPANY} a company (what the recordings do not have is asked live; what they have is free):`);
  for (const n of batches) { const k = idsOf(n).length; total += k; console.log(`  batch ${n}: ${String(k).padStart(4)} compan(ies) → up to $${(k * PER_COMPANY).toFixed(2)}`); }
  console.log(`  total: ${total} compan(ies) → up to $${(total * PER_COMPANY).toFixed(2)} · the cap of this run: $${CAP} (MAX_COST=<dollars> changes it) — at the cap the run stops and what was recorded stays.\n`);
}
const today = new Date().toISOString().slice(0, 10);

function idsOf(n: number): string[] {
  const f = `pilot_batch_${n}.json`;
  if (!existsSync(f)) throw new Error(`${f} is missing — the batch's companies are not known`);
  const j = JSON.parse(readFileSync(f, "utf8")) as { companies?: Array<{ id: string }> } | Array<{ id: string }>;
  return (Array.isArray(j) ? j : j.companies ?? []).map((c) => c.id);
}
const readCsv = (p: string) => { const [head, ...body] = parseCsv(readFileSync(p, "utf8")); return { head, body, ix: (c: string) => { const e = head.findIndex((h) => h === c); return e >= 0 ? e : head.findIndex((h) => h.startsWith(c)); } }; };

interface RunResult { capped?: boolean; n: number; rows: RunRow[]; rejections: Rejected[]; acceptance: Array<{ id: string; severity: string; pass: boolean; detail: string }>; cost: number; companies: number; misses: string[]; live: string; diag: Record<string, string[]>; runLog: string[] }

/** One batch, clean slate, from the recordings. */
function runBatch(n: number, fill = false, costBase = 0, only?: { ids: string[]; dir: string }): RunResult {
  const dir = only?.dir ?? `${OUT}/batch_${n}`;
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const ids = only?.ids ?? idsOf(n);
  console.log(`▶ batch ${n}: ${ids.length} compan(ies), REPLAY from the recordings …`);
  // The run's log goes to run.log and its progress lines — one per company: "batch N [i/M] … $x so far ($y in all)" — to the screen as they come (owner, 2026-11-24: a batch was silent for minutes).
  const env = { ...process.env, PILOT: "true", DRY_RUN: "true", REGRESSION: "1", REGRESSION_DIR: dir, REPLAY: "1", KNOWN_SOURCES: "off", ALL_FIELDS: "true", SITEMAP: "on", BATCH_NO: String(n),
    CONCURRENCY: process.env.CONCURRENCY ?? "10", PILOT_MAX_COMPANIES: String(Math.max(ids.length, 1)), ONLY: ids.join(","), PILOT_REPORT: `${dir}/pilot_report.csv`, GIT_CHECK: "off", PREFLIGHT: "off",
    BATCH_LABEL: `batch ${n}`, COST_BASE: String(costBase), V2_COMPONENTS: process.env.V2_COMPONENTS ?? "linkedin_links=off",   // the LinkedIn searches are new web requests the recordings cannot answer; they are measured by the dry run, not by the gate
    ...(fill ? { REPLAY_FILL: "1" } : {}) };
  const child = spawnSync("bash", ["-o", "pipefail", "-c", `npx tsx scripts/bulk_enrich_v2.ts 2>&1 | tee ${dir}/run.log | (grep --line-buffered -E '^(📍|⛔|💸)' || true)`], { stdio: "inherit", env, maxBuffer: 1 << 29 });
  const logText = existsSync(`${dir}/run.log`) ? readFileSync(`${dir}/run.log`, "utf8") : "";
  const capped = child.status === 3;   // MAX_COST reached: what was collected is reported and what was recorded stays (bulk_enrich_v2.ts)
  if ((child.status !== 0 && !capped) || !existsSync(`${dir}/pilot_report.csv`)) throw new Error(`batch ${n}: the run failed (exit ${child.status}). ${logText.slice(-400)}`);
  const rep = readCsv(`${dir}/pilot_report.csv`);
  const rows: RunRow[] = rep.body.map((r) => ({ company: r[rep.ix("company")] ?? "", field: r[rep.ix("field")] ?? "", value: r[rep.ix("after")] ?? "" }));
  const rejections: Rejected[] = [];
  if (existsSync(`${dir}/rejected_all.csv`)) { const rj = readCsv(`${dir}/rejected_all.csv`); for (const r of rj.body) rejections.push({ company: r[rj.ix("company")] ?? "", field: r[rj.ix("field")] ?? "", value: r[rj.ix("value")] ?? "", reason_code: r[rj.ix("reason_code")] ?? "" }); }
  // The acceptance checks of the batch, on this report; the list of the companies not enriched is this run's own.
  const seen = new Set<string>();
  const checks = specPathsFor(n).flatMap((p) => JSON.parse(readFileSync(p, "utf8")) as Check[]).filter((c) => !seen.has(c.id) && !!seen.add(c.id));
  const notEnriched = existsSync(`${dir}/not_enriched.csv`) ? parseCsv(readFileSync(`${dir}/not_enriched.csv`, "utf8")).slice(1).map((r) => r[0]) : [];
  const acceptance = runAcceptance(checks, rowsFromCsv(readFileSync(`${dir}/pilot_report.csv`, "utf8")), notEnriched, today).map((r) => ({ id: r.id, severity: r.severity, pass: r.pass, detail: r.detail }));
  const summary = existsSync(`${dir}/batch_${n}_summary.md`) ? readFileSync(`${dir}/batch_${n}_summary.md`, "utf8") : logText;
  const cost = Number(summary.match(/model cost \$([\d.]+)/)?.[1] ?? 0);
  // A web response the recordings did not have makes the replay unfaithful for that company: the gate says so (the log of the run is regression/out/batch_N/run.log).
  const out = logText;
  const misses = out.split("\n").filter((l) => /^\s*REPLAY MISS /.test(l)).map((l) => l.trim());
  const live = out.split("\n").find((l) => /live model steps:/.test(l))?.trim() ?? "";
  // For a check that fails on a company, that company's own log lines (what the run found, what it dropped and why) — so the cause is read at once, not asked for.
  const diag: Record<string, string[]> = {};
  const runLog = out.split("\n");
  for (const c of checks) {
    const co = (c as { company?: string }).company;
    const r = acceptance.find((x) => x.id === c.id);
    if (!co || !r || r.pass || diag[c.id]) continue;
    if (Object.entries(diag).some(([id, v]) => (checks.find((k) => k.id === id) as { company?: string } | undefined)?.company === co && v[0] !== "(same company, above)")) { diag[c.id] = ["(same company, above)"]; continue; }
    const at = runLog.findIndex((l) => new RegExp(`^── ${co.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(`).test(l));
    if (at < 0) {
      const near = runLog.filter((l) => l.toLowerCase().includes(co.toLowerCase()) && !/🌐/.test(l)).map((l) => l.trim().slice(0, 190)).slice(0, 12);
      diag[c.id] = [`(no block "── ${co} (" in the run's log; ${near.length} line(s) name it)`, ...near]; continue;
    }
    let end = runLog.findIndex((l, i) => i > at && /^── .* \(/.test(l)); if (end < 0) end = runLog.length;
    diag[c.id] = runLog.slice(at, end).filter((l) => /🏁|acquisition|🚫  (news|Acquired|Seed|Series|Other|Growth)|🚦|🏷️|📅  news|\[DRY\] would write (acquired|round|tags|news)|✅ \d+ field|🟠 /.test(l) && !/🌐/.test(l)).map((l) => l.trim().slice(0, 190)).slice(0, 36);
  }
  return { n, rows, rejections, acceptance, cost, companies: ids.length, misses, live, diag, runLog, capped };
}

function baselineFrom(res: RunResult, source: string): Baseline {
  return { batch: res.n, commit: headCommit(), created_at: new Date().toISOString(), companies: res.companies, source, values: watched(res.rows), acceptance: res.acceptance.map(({ id, severity, pass }) => ({ id, severity, pass })) };
}

function usage(): never { console.error("usage: regression.ts [init [N…] | accept-lost \"Company:field:value\"… ]"); process.exit(2); }

const [cmd, ...args] = process.argv.slice(2);

if (cmd === "init") {
  const batches = (args.length ? args.map(Number) : [5, 6, 7]).filter((x) => Number.isInteger(x) && x > 0);
  if (!batches.length) usage();
  const exists = batches.filter((n) => loadBaseline(n));
  if (exists.length && process.env.APPROVED_BY !== "aviv") { console.error(`⛔  A baseline already exists for batch ${exists.join(", ")}. It is replaced only on an explicit command the owner approved: APPROVED_BY=aviv npx tsx scripts/regression.ts init ${exists.join(" ")}`); process.exit(1); }
  let cost = 0;
  for (const n of batches) {
    let b: Baseline;
    if (process.env.REPORT) {
      // The values of a report that was written: they are the proven ones.
      const rep = readCsv(process.env.REPORT);
      const rows: RunRow[] = rep.body.map((r) => ({ company: r[rep.ix("company")] ?? "", field: r[rep.ix("field")] ?? "", value: r[rep.ix("after")] ?? "" }));
      b = { batch: n, commit: headCommit(), created_at: new Date().toISOString(), companies: idsOf(n).length, source: `written report ${process.env.REPORT}`, values: watched(rows), acceptance: [] };
    } else {
      const res = runBatch(n); cost += res.cost;
      b = baselineFrom(res, `the code at ${headCommit().slice(0, 10)}, from the recordings`);
      const bad = acceptanceErrors(res.acceptance);
      if (bad.length) console.log(`   ⚠️  batch ${n}: the baseline is made with acceptance ERRORs: ${bad.map((x) => x.id).join(", ")}`);
    }
    saveBaseline(b);
    console.log(`✓ ${baselinePath(n)}: ${b.values.length} value(s), ${b.acceptance.length} acceptance result(s) — ${b.source}`);
  }
  saveWrittenBatches([...writtenBatches(), ...batches]);
  console.log(`batches in the gate: ${writtenBatches().join(", ")}${cost ? ` · cost $${cost.toFixed(2)}` : ""}`);
  process.exit(0);
}

if (cmd === "accept-lost") {
  if (process.env.APPROVED_BY !== "aviv") { console.error("⛔  A baseline is changed only after the owner approved the values: APPROVED_BY=aviv npx tsx scripts/regression.ts accept-lost \"Company:field:value\" …"); process.exit(1); }
  if (!args.length) usage();
  let removed = 0;
  for (const n of writtenBatches()) {
    const b = loadBaseline(n); if (!b) continue;
    const before = b.values.length;
    b.values = b.values.filter((v) => !args.some((a) => { const [co, f, ...rest] = a.split(":"); return valueKey(v.company, v.field, v.value) === valueKey(co, f, rest.join(":")); }));
    if (b.values.length !== before) { saveBaseline(b); removed += before - b.values.length; console.log(`✓ batch ${n}: ${before - b.values.length} value(s) taken out of the baseline`); }
  }
  console.log(removed ? `${removed} value(s) taken out.` : "no value of the list is in a baseline.");
  process.exit(removed ? 0 : 1);
}

// `replace-value`: one value of a baseline replaced by another, only after the owner approved it (owner, 2026-11-24: CyberOwl's purchase date).
//   APPROVED_BY=aviv npx tsx scripts/regression.ts replace-value 9 'CyberOwl:acquired:2024-10-02' '2024-09-25'
if (cmd === "replace-value") {
  if (process.env.APPROVED_BY !== "aviv") { console.error("⛔  A baseline is changed only after the owner approved the value: APPROVED_BY=aviv npx tsx scripts/regression.ts replace-value <batch> 'Company:field:old' 'new'"); process.exit(1); }
  const [bn, oldSpec, newValue] = args; const b = bn ? loadBaseline(Number(bn)) : null;
  if (!b || !oldSpec || newValue == null) usage();
  const [co, f, ...rest] = oldSpec.split(":"); const key = valueKey(co, f, rest.join(":"));
  const hit = b!.values.filter((v) => valueKey(v.company, v.field, v.value) === key);
  if (hit.length !== 1) { console.error(`${hit.length} value(s) match "${oldSpec}" in batch ${bn} (exactly one is needed).`); process.exit(1); }
  console.log(`✓ batch ${bn}: ${hit[0].company} · ${hit[0].field}: "${hit[0].value}" → "${newValue}"`); hit[0].value = newValue; saveBaseline(b!); process.exit(0);
}

// `acquired`: the purchases of batch 9 (owner, 2026-11-24, after the change of the news searches). The 46 companies whose reviewed dry report (REPORT, pilot_report_dry.csv of batch 9) holds an acquired row are
// run again from the recordings (the cost cap is on), and each purchase is compared with the reviewed one: status, buyer and date. A purchase that is gone or different is a Tier 1 loss. Nothing is written.
if (cmd === "acquired") {
  const f = process.env.REPORT ?? "pilot_report_dry.csv";
  if (!existsSync(f)) { console.error(`${f} is missing`); process.exit(2); }
  const rep = readCsv(f);
  const want = new Map<string, { company: string; after: string }>();
  for (const r of rep.body) if (r[rep.ix("field")] === "acquired") want.set(r[rep.ix("company_id")], { company: r[rep.ix("company")], after: r[rep.ix("after")] });
  // The values the owner changed after review (eval/regression/acquired_9_approved.json): the reviewed purchase is replaced by the approved one.
  const approvedFile = "eval/regression/acquired_9_approved.json";
  if (existsSync(approvedFile)) {
    const ap = (JSON.parse(readFileSync(approvedFile, "utf8")).approved ?? []) as Array<{ company: string; after: string; approved_by?: string }>;
    for (const a of ap) { if (a.approved_by !== "aviv") continue; for (const [id, w] of want) if (w.company === a.company) want.set(id, { company: w.company, after: a.after }); }
  }
  const known = new Set(idsOf(9));
  const inBatch = [...want.keys()].filter((id) => known.has(id));
  if (!want.size || inBatch.length < want.size * 0.9) { console.error(`${f} does not look like the dry report of batch 9 (${want.size} acquired row(s), ${inBatch.length} of them in pilot_batch_9.json) — it may have been overwritten by a later dry run`); process.exit(2); }
  const ids = [...want.keys()];
  console.log(`\nacquired check: ${ids.length} compan(ies) of batch 9 with a reviewed purchase → up to $${(ids.length * PER_COMPANY).toFixed(2)} at $${PER_COMPANY} a company · cap $${CAP}`);
  process.env.MAX_COST = String(CAP);
  const res = runBatch(9, false, 0, { ids, dir: `${OUT}/acquired_9` });
  const got = new Map<string, string>();
  for (const r of res.rows) if (r.field === "acquired") got.set(r.company, r.value);
  const fold = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  let same = 0; const lost: string[] = [], diff: string[] = [];
  for (const { company, after } of want.values()) {
    const g = got.get(company);
    if (g == null) lost.push(`${company}: expected "${after}" — no purchase now`);
    else if (fold(g) === fold(after)) same++;
    else diff.push(`${company}: expected "${after}" · now "${g}"`);
  }
  console.log(`\n── purchases of batch 9: ${want.size} reviewed · identical ${same} · different ${diff.length} · lost ${lost.length} · cost $${res.cost.toFixed(2)}${res.capped ? " · ⛔ the cap was reached, the check is incomplete" : ""}`);
  for (const l of lost) console.log(`   ❌ LOST [Tier 1] ${l}`);
  for (const d of diff) console.log(`   ❌ DIFFERENT [Tier 1] ${d}`);
  console.log(lost.length + diff.length === 0 && !res.capped ? "\n✅ every reviewed purchase is found again, identical." : "\n⛔  Tier 1: a purchase is lost or different — shown to the owner; nothing is accepted by anyone else.");
  process.exit(lost.length + diff.length === 0 && !res.capped ? 0 : 1);
}

// One-time "complete the recordings" (owner, 2026-11-19): the replay lacks web responses that a later fix asked for (the acquisition searches). `fill-estimate` counts them from the last gate run's logs and
// prices them; `fill` runs the batches again with REPLAY_FILL=1 — what the recordings have is replayed, what they lack is fetched live and recorded. Nothing is written (REGRESSION is a dry pass).
const PRICE = { "google.serper.dev": 0.001, "api.tavily.com": 0.008, "s.jina.ai": 0.0005, "r.jina.ai": 0.0002 } as Record<string, number>;
if (cmd === "fill-estimate") {
  const total = new Map<string, number>(), cos = new Set<string>();
  for (const n of writtenBatches()) {
    const f = `${OUT}/batch_${n}/run.log`; if (!existsSync(f)) { console.log(`batch ${n}: no run.log — run the gate once first`); continue; }
    for (const l of readFileSync(f, "utf8").split("\n")) { const m = l.match(/^\s*REPLAY MISS (.+?): (.*)$/); if (!m) continue; cos.add(`${n}:${m[1]}`); for (const h of m[2].split(", ")) { const x = h.match(/^(.+?)×(\d+)$/); if (x) total.set(x[1], (total.get(x[1]) ?? 0) + Number(x[2])); } }
  }
  let web = 0;
  console.log(`companies with a missing response: ${cos.size}`);
  for (const [h, c] of [...total].sort((a, b) => b[1] - a[1])) { const price = PRICE[h] ?? 0; web += price * c; console.log(`  ${h.padEnd(34)} ${String(c).padStart(4)} request(s) × $${price} ${PRICE[h] === undefined ? "(a page of a site: free)" : ""}`); }
  console.log(`web requests: about $${web.toFixed(2)} (unit prices are assumptions: Serper $1 per 1000, Tavily $8 per 1000 credits, Jina a fraction of a cent)`);
  console.log(`model: a new search result can change a prompt, and a changed prompt is a new model call; the run prints every one ("live model steps") and its cost. Upper bound used: ${cos.size} companies × 6 calls × $0.02 = $${(cos.size * 6 * 0.02).toFixed(2)}`);
  console.log(`estimate: $${web.toFixed(2)} web + up to $${(cos.size * 6 * 0.02).toFixed(2)} model = at most $${(web + cos.size * 6 * 0.02).toFixed(2)}. Nothing is written.`);
  process.exit(0);
}
if (cmd === "fill") {
  const batches = (args.length ? args.map(Number) : writtenBatches()).filter((x) => Number.isInteger(x) && x > 0);
  let cost = 0;
  const cap = CAP;
  printPlan(batches, "fill");
  if (process.env.GO !== "1") { console.log("Nothing was run. To run it: GO=1 npx tsx scripts/regression.ts fill"); process.exit(0); }
  for (const n of batches) {
    let res: RunResult;
    if (cap - cost <= 0.01) { console.log(`── batch ${n}: not run — the cap of $${cap} is spent`); process.exit(3); }
    process.env.MAX_COST = String(cap - cost);
    try { res = runBatch(n, true, cost); } catch (e) { console.log(`── batch ${n}: stopped — ${String((e as Error).message).slice(0, 300)}${/MAX_COST/.test(String((e as Error).message)) ? "  (the cap was reached; what was recorded stays)" : ""}`); process.exit(3); }
    cost += res.cost;
    if (res.capped) { console.log(`── batch ${n}: the cap of $${cap} was reached (cost so far $${cost.toFixed(2)}) — stopped; what was recorded stays. Run it again (GO=1 MAX_COST=<more>): the recordings made are used and cost nothing.`); process.exit(3); }
    console.log(`── batch ${n}: recordings completed · ${res.misses.length ? `still missing for ${res.misses.length} company(ies)` : "no response missing"}${res.live ? ` · ${res.live}` : ""} · model cost $${res.cost.toFixed(2)}`);
  }
  console.log(`cost of this run: $${cost.toFixed(2)} (web requests not included). Run the gate again: npx tsx scripts/regression.ts`);
  process.exit(0);
}

if (cmd) usage();

// ── the gate ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const all = writtenBatches();
const only = (process.env.ONLY_BATCHES ?? "").split(",").map((x) => Number(x.trim())).filter(Boolean);
const batches = only.length ? all.filter((n) => only.includes(n)) : all;
if (!batches.length) { console.error("⛔  No written batch is in the gate (baseline/batches.json). Create the baselines first: npx tsx scripts/regression.ts init"); process.exit(1); }
const missing = batches.filter((n) => !loadBaseline(n));
if (missing.length) { console.error(`⛔  No baseline for batch ${missing.join(", ")}: npx tsx scripts/regression.ts init ${missing.join(" ")}`); process.exit(1); }

let failed = false, cost = 0, totalValues = 0;
printPlan(batches, "the gate");
for (const n of batches) {
  const base = loadBaseline(n)!;
  if (CAP - cost <= 0.01) { console.log(`\n💸  The cap of $${CAP} is spent: batch ${n} and the ones after it were not run. What was recorded stays; run the gate again (MAX_COST=<more>): the recordings made are used and cost nothing.`); process.exit(3); }
  process.env.MAX_COST = String(CAP - cost);
  const res = runBatch(n, false, cost);
  cost += res.cost;
  if (res.capped) { console.log(`\n💸  The cap of $${CAP} was reached in batch ${n} (cost so far $${cost.toFixed(2)}): the gate stopped — it is neither passed nor failed. What was recorded stays; run it again (MAX_COST=<more>): the recordings made are used and cost nothing.`); process.exit(3); }
  const cmp = compare(base.values, res.rows, res.rejections);
  const errs = acceptanceErrors(res.acceptance);
  totalValues += base.values.length;
  console.log(`\n── batch ${n}: ${base.values.length} baseline value(s) · lost ${cmp.lost.length} · new ${cmp.added.length} · changed ${cmp.changed.length} · acceptance ERRORs ${errs.length} · cost $${res.cost.toFixed(2)}`);
  if (res.misses.length) { console.log(`   ⚠️  the replay is not faithful for ${res.misses.length} compan(ies) — a web response the recordings do not have:`); for (const m of res.misses.slice(0, 12)) console.log(`      ${m.slice(0, 170)}`); }
  if (res.live) console.log(`   ${res.live.slice(0, 200)}`);
  for (const e of errs) { failed = true; console.log(`   ❌ acceptance ${e.id}: ${e.detail.slice(0, 160)}`); for (const l of res.diag[e.id] ?? []) console.log(`        │ ${l}`); }
  for (const l of cmp.lost) { failed = true; console.log(`   ❌ LOST [Tier ${tierOf(l.field) ?? "?"}] ${l.company} · ${l.field} · ${l.value.slice(0, 90)}   [${l.reason_code}]`); }
  if (cmp.lost.length) { const t1 = cmp.lost.filter((l) => tierOf(l.field) === 1).length; console.log(`   Tier 1 lost: ${t1} (must be 0) · Tier 2 lost: ${cmp.lost.length - t1} (each is shown to the owner; none is accepted by anyone else)`); }
  // Why: that company's own lines of the run (what it found, dropped and why), once per company.
  for (const co of [...new Set(cmp.lost.map((l) => l.company))].slice(0, 12)) {
    const at = res.runLog.findIndex((l) => new RegExp(`^── ${co.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(`).test(l));
    if (at < 0) { console.log(`        │ ${co}: no block in the run's log`); continue; }
    let end = res.runLog.findIndex((l, i) => i > at && /^── .* \(/.test(l)); if (end < 0) end = res.runLog.length;
    console.log(`        │ ── ${co}`);
    for (const l of res.runLog.slice(at, end).filter((x) => /🏁|🚫  (news|Acquired)|🚦|🧹|📅  news|\[DRY\] would write (acquired|news)|REPLAY MISS/.test(x) && !/🌐/.test(x)).map((x) => x.trim().slice(0, 190)).slice(0, 30)) console.log(`        │ ${l}`);
  }
  if (cmp.changed.length) { console.log("   changed (one value per company, a different one now — not a failure, to look at):"); for (const c of cmp.changed.slice(0, 15)) console.log(`   ~ ${c.company} · ${c.field}: ${c.was.slice(0, 50)} → ${c.now.slice(0, 50)}`); if (cmp.changed.length > 15) console.log(`   … and ${cmp.changed.length - 15} more`); }
  if (cmp.added.length) { console.log("   new values:"); for (const a of cmp.added.slice(0, 25)) console.log(`   + ${a.company} · ${a.field} · ${a.value.slice(0, 90)}`); if (cmp.added.length > 25) console.log(`   … and ${cmp.added.length - 25} more`); }
}
console.log(`\ncost of this run: $${cost.toFixed(2)} of the cap $${CAP}${cost > 0.1 ? "  ⚠️ over the aim of $0.10 (a model call a fix made new ran live)" : ""}`);

if (failed) { console.log("\n⛔  REGRESSION GATE: FAILED — a good value was lost, or an acceptance check is an ERROR. No wet run is allowed for this code."); process.exit(1); }
if (only.length) { console.log("\n✅  The batches asked for pass. A part of the batches writes no pass file: run the gate without ONLY_BATCHES."); process.exit(0); }
if (!treeIsClean()) { console.log("\n✅  The gate passes, but the working tree has uncommitted changes: no pass file (the code that was checked is not a commit)."); process.exit(0); }
const file = writePass({ commit: headCommit(), tree: headTree(), at: new Date().toISOString(), batches, values: totalValues, cost_usd: cost });
console.log(`\n✅  REGRESSION GATE: PASSED for ${batches.length} batch(es), ${totalValues} value(s) — ${file}`);
