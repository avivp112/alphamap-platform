#!/usr/bin/env node
/**
 * scripts/retry_failed.ts — a dry run again for the companies the infrastructure failed on (owner, 2026-11-19: a second run is allowed only when the infrastructure failed — never for data errors).
 * Takes the companies of not_enriched.csv whose reason is fetch_failed, error, or domain_unresolved with an UNREADABLE address (WHY= to change), runs them alone (live, dry, a slow pace), and puts their
 * rows back into the batch's files in place of the first run's: pilot_report_dry.csv, rejected_all.csv, not_enriched.csv, domain_unresolved.csv, website_review.csv, excluded_values.csv,
 * carried_not_written.csv. The first run's files are kept in archive/batch<N>_first/.
 *   BATCH_NO=8 npx tsx scripts/retry_failed.ts            prints the list and the cost estimate, runs nothing
 *   BATCH_NO=8 GO=1 npx tsx scripts/retry_failed.ts       runs
 */
import { spawnSync } from "child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { parseCsv } from "../lib/enrichment/acceptance.ts";

const batch = Number(process.env.BATCH_NO);
if (!Number.isInteger(batch) || batch < 1) { console.error("BATCH_NO=<n> is required"); process.exit(2); }
const fold = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "");
const why = new RegExp(process.env.WHY ?? "fetch_failed|error|domain_unresolved");
const [h, ...b] = parseCsv(readFileSync("not_enriched.csv", "utf8"));
const failed = b.filter((r) => why.test(r[h.indexOf("why")]) && (r[h.indexOf("why")] !== "domain_unresolved" || /unreadable/.test(r[h.indexOf("detail")] ?? ""))).map((r) => r[h.indexOf("company")]);
const pb = JSON.parse(readFileSync(`pilot_batch_${batch}.json`, "utf8")) as { companies: Array<{ id: string; name: string }> };
const picked = pb.companies.filter((c) => failed.some((f) => fold(f) === fold(c.name)));
console.log(`${picked.length} compan(ies): ${picked.map((c) => c.name).join(", ")}`);
console.log(`estimate: about $${(picked.length * 0.015).toFixed(2)} (batch 8's first run: $0.61 for 50, most of these stopped early) and ${Math.ceil(picked.length / 3) * 3} min at 3 at a time`);
if (process.env.GO !== "1") { console.log("nothing run. GO=1 runs."); process.exit(0); }

const FILES = ["pilot_report_dry.csv", "rejected_all.csv", "not_enriched.csv", "domain_unresolved.csv", "website_review.csv", "excluded_values.csv", "carried_not_written.csv"];
const dir = `archive/batch${batch}_first`;
mkdirSync(dir, { recursive: true });
for (const f of FILES) if (existsSync(f) && !existsSync(`${dir}/${f}`)) copyFileSync(f, `${dir}/${f}`);
const run = spawnSync("npx", ["tsx", "scripts/bulk_enrich_v2.ts"], { stdio: "inherit", env: { ...process.env, PILOT: "true", DRY_RUN: "true", ALL_FIELDS: "true", SITEMAP: "on", CONCURRENCY: "3", PILOT_MAX_COMPANIES: String(Math.max(picked.length, 1)), ONLY: picked.map((c) => c.id).join(","), MAX_COST: process.env.MAX_COST ?? "3" } });
if (run.status !== 0) { console.error(`the run stopped (exit ${run.status}); the first run's files are in ${dir}/`); process.exit(run.status ?? 1); }
const names = new Set(picked.map((c) => fold(c.name)));
const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
for (const f of FILES) {
  if (!existsSync(`${dir}/${f}`)) continue;
  const [bh, ...bb] = parseCsv(readFileSync(`${dir}/${f}`, "utf8"));
  const ci = bh.indexOf("company"); if (ci < 0) continue;
  const retry = existsSync(f) && f !== undefined ? parseCsv(readFileSync(f, "utf8")) : [];
  const rows = [...bb.filter((r) => !names.has(fold(r[ci] ?? ""))), ...(retry.length && retry[0].join() === bh.join() ? retry.slice(1).filter((r) => names.has(fold(r[ci] ?? ""))) : [])];
  writeFileSync(f, "﻿" + [bh, ...rows].map((r) => r.map(q).join(",")).join("\r\n") + "\r\n");
  console.log(`${f}: ${rows.length} row(s) (the retried companies' rows replaced)`);
}
console.log("Now: BATCH_NO=8 npx tsx scripts/report_lint.ts, then sample_verdicts.");
