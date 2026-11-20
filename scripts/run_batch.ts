#!/usr/bin/env node
/**
 * scripts/run_batch.ts — one batch of up to 500 companies, start to end (owner, 2026-11-20):
 *   regression gate (core fields) → one live run → acceptance → automatic write if all passed → verify_written → candidate values (Tier 3) → the post-write audit sample.
 * No manual stop before the write. An infrastructure failure (rate limit, timeout) is retried once for the companies that failed — never the whole batch. A gate loss or an acceptance ERROR stops the batch
 * before anything is written, and says what.
 *
 *   BATCH_NO=9 npx tsx scripts/run_batch.ts                       the plan and the cost estimate; runs nothing
 *   BATCH_NO=9 MAX_COST=8 GO=1 npx tsx scripts/run_batch.ts       runs (MAX_COST is the cap of the live run, in dollars; required)
 * The companies are those of pilot_batch_<N>.json (scripts/pilot_sample.ts).
 */
import { spawnSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { acceptanceReport, specPathsFor } from "./acceptance_check.ts";

const batch = Number(process.env.BATCH_NO);
if (!Number.isInteger(batch) || batch < 1) { console.error("BATCH_NO=<n> is required"); process.exit(2); }
const file = `pilot_batch_${batch}.json`;
if (!existsSync(file)) { console.error(`${file} is missing`); process.exit(2); }
const companies = (JSON.parse(readFileSync(file, "utf8")) as { companies: Array<{ id: string; name: string }> }).companies;
if (companies.length > 500) { console.error(`${companies.length} companies: a batch is at most 500`); process.exit(2); }
const ids = companies.map((c) => c.id).join(",");
const perCompany = Number(process.env.COST_PER_COMPANY ?? 0.02);   // batch 8's live dry run: $0.61 for 50 (+ headroom)
const estimate = companies.length * perCompany;
console.log(`Batch ${batch}: ${companies.length} compan(ies). Estimated model cost of the live run: about $${estimate.toFixed(2)} (at $${perCompany}/company; batch 8 cost $0.012). MAX_COST ${process.env.MAX_COST ?? "(not set)"}.`);
console.log("Steps: gate (core fields) → live run → [retry of infrastructure failures, once] → acceptance → write → verify_written → candidate values → audit sample.");
if (process.env.GO !== "1") { console.log("\nnothing run. MAX_COST=<dollars> GO=1 runs it."); process.exit(0); }
if (!process.env.MAX_COST) { console.error("⛔  MAX_COST=<dollars> is required to run a batch."); process.exit(2); }

const today = () => new Date().toISOString().slice(0, 10);
const run = (label: string, cmd: string, args: string[], env: Record<string, string> = {}): number => {
  console.log(`\n══ ${label} ══`);
  const r = spawnSync(cmd, args, { stdio: "inherit", env: { ...process.env, ...env } });
  return r.status ?? 1;
};
const stop = (why: string): never => { console.error(`\n⛔  Batch ${batch} stopped: ${why}\n    Nothing was written by this script after this point.`); process.exit(1); };
const common = { PILOT: "true", SITEMAP: "on", BATCH_NO: String(batch), CONCURRENCY: "10", PILOT_MAX_COMPANIES: String(companies.length), ONLY: ids };

// 1. the gate (core fields): the replay of the written batches. Run on the recordings' day (PIN_DATE) when it is another day.
if (run("1/7 regression gate", "npx", ["tsx", "scripts/regression.ts"], process.env.PIN_DATE ? { NODE_OPTIONS: `--require ${process.cwd()}/scripts/pin_date.cjs` } : {}) !== 0) stop("the regression gate lost a value or an acceptance check is an ERROR — show it to Aviv; accept-lost is his decision alone");

// 2. one live run (dry, everything found: the write reads its recordings)
const liveDate = today();
if (run("2/7 live run", "npx", ["tsx", "scripts/bulk_enrich_v2.ts"], { ...common, DRY_RUN: "true", ALL_FIELDS: "true", MAX_COST: process.env.MAX_COST }) !== 0) stop("the live run failed (see above)");

// 3. infrastructure failures: once, for the companies that failed
{
  const ne = existsSync("not_enriched.csv") ? readFileSync("not_enriched.csv", "utf8") : "";
  if (/fetch_failed|website_unreachable|,error,/.test(ne)) {
    if (run("3/7 retry of the infrastructure failures (once)", "npx", ["tsx", "scripts/retry_failed.ts"], { GO: "1", WHY: "fetch_failed|error|website_unreachable" }) !== 0) console.log("⚠️  the retry stopped; the batch goes on with what it has");
  } else console.log("\n══ 3/7 no infrastructure failure to retry ══");
}

// 4. acceptance
{
  console.log("\n══ 4/7 acceptance ══");
  const a = acceptanceReport("pilot_report_dry.csv", specPathsFor(batch));
  console.log(a.text);
  if (a.failed > 0) stop(`${a.failed} acceptance ERROR(s) on core fields`);
}

// 5. the write — from the live run's recordings; on another day than the live run, with the live run's date
const pin = today() !== liveDate ? { PIN_DATE: liveDate, NODE_OPTIONS: `--require ${process.cwd()}/scripts/pin_date.cjs` } : {};
if (run("5/7 write (core fields)", "npx", ["tsx", "scripts/bulk_enrich_v2.ts"], { ...common, DRY_RUN: "false", REPLAY: "1", ...pin }) !== 0) stop("the write failed or was undone by its own check (see above)");

// 6. verify_written, then the Tier 3 values to candidate_values
if (run("6/7 verify_written", "npx", ["tsx", "scripts/verify_written.ts"], { REPORT: "pilot_report_write.csv" }) !== 0) stop("a written value is missing from the database — undo with the run_id in batch_" + batch + "_summary.md");
run("6/7 candidate values (Tier 3)", "npx", ["tsx", "scripts/write_candidates.ts"], { REPORT: "pilot_report_dry.csv", DRY_RUN: "false" });

// 7. the audit sample
run("7/7 audit sample", "npx", ["tsx", "scripts/audit_sample.ts"], { REPORT: "pilot_report_write.csv" });
console.log(`\n✓ Batch ${batch} written. Mark the audit sample, then:  BATCH_NO=${batch} WRONG=<numbers> DRY_RUN=false npx tsx scripts/audit_apply.ts`);
