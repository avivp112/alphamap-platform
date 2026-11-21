#!/usr/bin/env node
/**
 * scripts/run_batch.ts — one batch of up to 500 companies, start to end (owner, 2026-11-20):
 *   regression gate (core fields) → one live run → acceptance → automatic write if all passed → verify_written → candidate values (Tier 3) → the post-write audit sample.
 * No manual stop before the write. An infrastructure failure (rate limit, timeout) is retried once for the companies that failed — never the whole batch. A gate loss or an acceptance ERROR stops the batch
 * before anything is written, and says what.
 *
 *   BATCH_NO=9 npx tsx scripts/run_batch.ts                       the plan and the cost estimate; runs nothing
 *   BATCH_NO=9 MAX_COST=8 GO=1 npx tsx scripts/run_batch.ts       runs (MAX_COST is the cap of the live run, in dollars; required; at the cap the batch goes on with what was collected)
 *   FROM_STEP=5 BATCH_NO=9 GO=1 GATE_PIN_DATE=2026-11-19 PIN_DATE=<day of the live run> …   steps 5–7 from the report and recordings of the live run (the gate first; no live run, no model call)
 *   RESUME=1 …                                                    a stopped batch: companies that already ran come from the recordings, the rest live
 * The companies are those of pilot_batch_<N>.json (scripts/pilot_sample.ts).
 */
import { spawnSync } from "child_process";
import { existsSync, readFileSync, unlinkSync } from "fs";
import { acceptanceReport, specPathsFor } from "./acceptance_check.ts";
import { rowsFromCsv, runAcceptance } from "../lib/enrichment/acceptance.ts";
import { addPendingFixes } from "../lib/enrichment/batchProcess.ts";

const batch = Number(process.env.BATCH_NO);
if (!Number.isInteger(batch) || batch < 1) { console.error("BATCH_NO=<n> is required"); process.exit(2); }
const file = `pilot_batch_${batch}.json`;
if (!existsSync(file)) { console.error(`${file} is missing`); process.exit(2); }
const companies = (JSON.parse(readFileSync(file, "utf8")) as { companies: Array<{ id: string; name: string }> }).companies;
if (companies.length > 500) { console.error(`${companies.length} companies: a batch is at most 500`); process.exit(2); }
const perCompany = Number(process.env.COST_PER_COMPANY ?? 0.012);   // batch 8's live dry run: $0.61 for 50 companies
const estimate = companies.length * perCompany;
console.log(`Batch ${batch}: ${companies.length} compan(ies). Estimated model cost of the live run: about $${estimate.toFixed(2)} (at $${perCompany}/company; batch 8 cost $0.012). MAX_COST ${process.env.MAX_COST ?? "(not set)"}.`);
if (process.env.RESUME === "1") console.log("RESUME=1: the live run replays what the recordings hold (companies that already ran) and fetches the rest live (REPLAY=1 REPLAY_FILL=1).");
console.log("Steps: gate (core fields) → live run → [retry of infrastructure failures, once] → acceptance → write → verify_written → candidate values → audit sample.");
if (process.env.GO !== "1") { console.log("\nnothing run. MAX_COST=<dollars> GO=1 runs it."); process.exit(0); }
if (!process.env.MAX_COST && Number(process.env.FROM_STEP ?? 1) < 5) { console.error("⛔  MAX_COST=<dollars> is required to run a batch."); process.exit(2); }

const today = () => new Date().toISOString().slice(0, 10);
const run = (label: string, cmd: string, args: string[], env: Record<string, string> = {}): number => {
  console.log(`\n══ ${label} ══`);
  const r = spawnSync(cmd, args, { stdio: "inherit", env: { ...process.env, ...env } });
  return r.status ?? 1;
};
const stop = (why: string): never => { console.error(`\n⛔  Batch ${batch} stopped: ${why}\n    Nothing was written by this script after this point.`); process.exit(1); };
const common = (list: string[]) => ({ PILOT: "true", SITEMAP: "on", BATCH_NO: String(batch), CONCURRENCY: "10", PILOT_MAX_COMPANIES: String(list.length), ONLY: list.join(",") });
const allIds = companies.map((c) => c.id);

// FROM_STEP=5 (owner, 2026-11-21: the write failed on a network error): steps 2–4 are not repeated — no live run, no retry, no acceptance — and the write reads pilot_report_dry.csv and the recordings of that run. The companies the
// cost cap left out (unprocessed_batch_<N>.json) stay out. REPLAY=strict: a model request that was never recorded fails that company instead of calling the model; PIN_DATE=<the day of the live run> gives the
// prompts their recorded date (date -u -r pilot_report_dry.csv +%F).
const fromStep = Number(process.env.FROM_STEP ?? 1);
let processed = allIds, liveDate = today();
if (fromStep >= 5) {
  try { const left = (JSON.parse(readFileSync(`unprocessed_batch_${batch}.json`, "utf8")) as { ids: string[] }).ids; processed = allIds.filter((id) => !left.includes(id)); } catch { /* the whole batch ran */ }
  if (!existsSync("pilot_report_dry.csv")) stop("pilot_report_dry.csv is missing — there is no live run to write from");
  console.log(`\nFROM_STEP=${fromStep}: the gate (its pass file is for the code the write runs on), then no live run — the write of ${processed.length} compan(ies) from pilot_report_dry.csv${process.env.PIN_DATE ? `, dated ${process.env.PIN_DATE}` : ""}.`);
}
// 1. the gate (core fields) — always, also for FROM_STEP=5: the write needs the pass file of the code it runs on, and any change of code makes the earlier one void. The replay of the written batches. Run on the recordings' day (PIN_DATE) when it is another day. A loss or an acceptance ERROR stops the batch before anything is written.
console.log("\n══ 1/7 regression gate ══");
if (spawnSync("bash", ["-o", "pipefail", "-c", "npx tsx scripts/regression.ts 2>&1 | tee regression_run.log"], { stdio: "inherit", env: { ...process.env, ...((process.env.GATE_PIN_DATE ?? process.env.PIN_DATE) ? { PIN_DATE: (process.env.GATE_PIN_DATE ?? process.env.PIN_DATE)!, NODE_OPTIONS: `--require ${process.cwd()}/scripts/pin_date.cjs` } : {}) } }).status !== 0)
  stop("the regression gate lost a value or an acceptance check is an ERROR — show it to Aviv; accept-lost is his decision alone (regression_run.log)");

if (fromStep <= 4) {
  // 2. one live run (dry, everything found: the write reads its recordings)
  liveDate = today();
  // Exit code 3 = MAX_COST reached (owner, 2026-11-21): the companies not started are left out and everything that was collected goes on to the write; the rest waits for the next run.
  try { unlinkSync(`unprocessed_batch_${batch}.json`); } catch { /* none */ }
  const liveStatus = run("2/7 live run", "npx", ["tsx", "scripts/bulk_enrich_v2.ts"], { ...common(allIds), DRY_RUN: "true", ALL_FIELDS: "true", MAX_COST: process.env.MAX_COST, ...(process.env.RESUME === "1" ? { REPLAY: "1", REPLAY_FILL: "1" } : {}) });
  if (liveStatus !== 0 && liveStatus !== 3) stop("the live run failed (see above)");
  if (liveStatus === 3) {
    let left: string[] = [];
    try { left = (JSON.parse(readFileSync(`unprocessed_batch_${batch}.json`, "utf8")) as { ids: string[] }).ids; } catch { /* no list */ }
    processed = allIds.filter((id) => !left.includes(id));
    console.log(`\n💸  MAX_COST reached: ${processed.length} of ${allIds.length} companies were collected and go on to the write; ${left.length} were not started (unprocessed_batch_${batch}.json) — they are the next batch's to run.`);
  }

  // 3. infrastructure failures: once, for the companies that failed
  {
    const ne = existsSync("not_enriched.csv") ? readFileSync("not_enriched.csv", "utf8") : "";
    if (liveStatus === 3) console.log("\n══ 3/7 no retry: the cost cap was reached ══");
    else if (/fetch_failed|website_unreachable|,error,/.test(ne)) {
      if (run("3/7 retry of the infrastructure failures (once)", "npx", ["tsx", "scripts/retry_failed.ts"], { GO: "1", WHY: "fetch_failed|error|website_unreachable" }) !== 0) console.log("⚠️  the retry stopped; the batch goes on with what it has");
    } else console.log("\n══ 3/7 no infrastructure failure to retry ══");
  }

  // 4. acceptance. A founder name that is not a person's name does not stop the batch: it is excluded by its content (pending_fixes.csv) and the rest is written (owner, 2026-11-21); any other ERROR stops it.
  // (This check is run here only: it is in no spec of the gate, whose result must stay what it was.)
  {
    console.log("\n══ 4/7 acceptance ══");
    const a = acceptanceReport("pilot_report_dry.csv", specPathsFor(batch));
    console.log(a.text);
    const founderCheck = runAcceptance([{ id: "founder_name_is_person", why: "A founder's name is the name of a person", kind: "founder_name_is_person" }], rowsFromCsv(readFileSync("pilot_report_dry.csv", "utf8")), [], today())[0];
    if (!founderCheck.pass) {
      const bad = founderCheck.offenders ?? [];
      addPendingFixes(bad.map((b) => ({ batch, company: b.company, field: b.field, value: b.after, reason: "acceptance: founder name is not a person's name" })));
      console.log(`${bad.length} founder value(s) excluded by content (pending_fixes.csv): ${bad.slice(0, 5).map((b) => `${b.company}: ${b.after.slice(0, 40)}`).join(" | ")}`);
    }
    if (a.failed > 0) stop(`${a.failed} acceptance ERROR(s) on core fields`);
  }
}

// 5. the write — from the live run's recordings; on another day than the live run, with the live run's date
const pin = fromStep >= 5 ? (process.env.PIN_DATE ? { PIN_DATE: process.env.PIN_DATE, NODE_OPTIONS: `--require ${process.cwd()}/scripts/pin_date.cjs` } : {}) : today() !== liveDate ? { PIN_DATE: liveDate, NODE_OPTIONS: `--require ${process.cwd()}/scripts/pin_date.cjs` } : {};
if (run("5/7 write (core fields)", "npx", ["tsx", "scripts/bulk_enrich_v2.ts"], { ...common(processed), DRY_RUN: "false", REPLAY: fromStep >= 5 ? "strict" : "1", EXCLUDE_FROM: "pilot_report_dry.csv", ...pin }) !== 0) stop("the write failed or was undone by its own check (see above)");

// 6. verify_written, then the Tier 3 values to candidate_values
if (run("6/7 verify_written", "npx", ["tsx", "scripts/verify_written.ts"], { REPORT: "pilot_report_write.csv" }) !== 0) stop("a written value is missing from the database — undo with the run_id in batch_" + batch + "_summary.md");
run("6/7 candidate values (Tier 3)", "npx", ["tsx", "scripts/write_candidates.ts"], { REPORT: "pilot_report_dry.csv", DRY_RUN: "false" });

// 7. the audit sample
run("7/7 audit sample", "npx", ["tsx", "scripts/audit_sample.ts"], { REPORT: "pilot_report_write.csv" });
console.log(`\n✓ Batch ${batch} written. Mark the audit sample, then:  BATCH_NO=${batch} WRONG=<numbers> DRY_RUN=false npx tsx scripts/audit_apply.ts`);
