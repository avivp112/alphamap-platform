#!/usr/bin/env node
/**
 * scripts/rerun_some.ts — a dry run again for NAMED companies only (owner, 2026-11-19: a new decision about three companies — a technology call, an address, a dead address with a buyer). Their rows replace
 * their rows in the batch's CURRENT files; every other company's rows stay exactly as the last full run left them (the files are copied to archive/batch<N>_before_rerun/ first).
 * REPLAY with REPLAY_FILL: what the recordings hold is replayed, what they lack is fetched live and recorded (MAX_COST=1 by default).
 *   BATCH_NO=8 COMPANIES="Triskell Interactive,Multiable,Nordigen" npx tsx scripts/rerun_some.ts
 */
import { spawnSync } from "child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { parseCsv } from "../lib/enrichment/acceptance.ts";

const batch = Number(process.env.BATCH_NO);
if (!Number.isInteger(batch) || batch < 1) { console.error("BATCH_NO=<n> is required"); process.exit(2); }
const fold = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "");
const want = (process.env.COMPANIES ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const pb = JSON.parse(readFileSync(`pilot_batch_${batch}.json`, "utf8")) as { companies: Array<{ id: string; name: string }> };
const picked = pb.companies.filter((c) => want.some((w) => fold(w) === fold(c.name)));
const missing = want.filter((w) => !picked.some((c) => fold(c.name) === fold(w)));
if (missing.length || !picked.length) { console.error(`not in pilot_batch_${batch}.json: ${missing.join(", ") || "(no COMPANIES given)"}`); process.exit(2); }
console.log(`${picked.length} compan(ies): ${picked.map((c) => c.name).join(", ")}`);

const FILES = ["pilot_report_dry.csv", "rejected_all.csv", "not_enriched.csv", "domain_unresolved.csv", "website_review.csv", "excluded_values.csv", "carried_not_written.csv"];
const dir = `archive/batch${batch}_before_rerun`;
mkdirSync(dir, { recursive: true });
for (const f of FILES) if (existsSync(f)) copyFileSync(f, `${dir}/${f}`);
const run = spawnSync("npx", ["tsx", "scripts/bulk_enrich_v2.ts"], { stdio: "inherit", env: { ...process.env, PILOT: "true", DRY_RUN: "true", REPLAY: "1", REPLAY_FILL: "1", MAX_COST: process.env.MAX_COST ?? "1", ALL_FIELDS: "true", SITEMAP: "on", BATCH_NO: String(batch), CONCURRENCY: "3", PILOT_MAX_COMPANIES: String(picked.length), ONLY: picked.map((c) => c.id).join(",") } });
if (run.status !== 0) { console.error(`the run stopped (exit ${run.status}); the files before it are in ${dir}/`); process.exit(run.status ?? 1); }
const names = new Set(picked.map((c) => fold(c.name)));
const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
for (const f of FILES) {
  if (!existsSync(`${dir}/${f}`)) continue;
  const [bh, ...bb] = parseCsv(readFileSync(`${dir}/${f}`, "utf8"));
  const ci = bh.indexOf("company"); if (ci < 0) continue;
  const retry = existsSync(f) ? parseCsv(readFileSync(f, "utf8")) : [];
  const rows = [...bb.filter((r) => !names.has(fold(r[ci] ?? ""))), ...(retry.length && retry[0].join() === bh.join() ? retry.slice(1).filter((r) => names.has(fold(r[ci] ?? ""))) : [])];
  writeFileSync(f, "﻿" + [bh, ...rows].map((r) => r.map(q).join(",")).join("\r\n") + "\r\n");
  console.log(`${f}: ${rows.length} row(s) (${picked.map((c) => c.name).join(", ")} replaced)`);
}
