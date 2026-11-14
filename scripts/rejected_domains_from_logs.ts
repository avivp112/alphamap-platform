#!/usr/bin/env node
/**
 * scripts/rejected_domains_from_logs.ts — the domains turned away as "not on the allowed list", from the logs of earlier runs (owner, 2026-11-14),
 * the 40 most frequent, for the owner to place in one pass: tier 2 / 3 / 4 or blocked. Reads text; writes rejected_domains_top.csv. Free.
 *
 *   LOGS="batch4_dry.log eval/field_review/*.log" npx tsx scripts/rejected_domains_from_logs.ts
 *   LOGS_DIR=. npx tsx scripts/rejected_domains_from_logs.ts           # every *.log and *.txt in the directory (not below)
 *   TABLE=1 ...                                                         # also the database's source_domain_review (the rounds' unlisted domains of real runs)
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { mergeRejected, rejectedFromLog, topDomains } from "../lib/enrichment/rejectedDomains.ts";

const files = new Set<string>();
for (const p of (process.env.LOGS ?? "").split(/\s+/).filter(Boolean)) if (existsSync(p)) files.add(p);
if (process.env.LOGS_DIR) for (const f of readdirSync(process.env.LOGS_DIR)) if (/\.(log|txt)$/.test(f)) files.add(join(process.env.LOGS_DIR, f));
if (!files.size && !process.env.TABLE) { console.error('LOGS="a.log b.log" or LOGS_DIR=. (or TABLE=1)'); process.exit(1); }

const all = [...files].map((f) => rejectedFromLog(readFileSync(f, "utf8")));
console.log(`${files.size} log file(s): ${[...files].join(", ")}`);
let rows = mergeRejected(all);

if (process.env.TABLE) {
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error("TABLE=1 needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }
  const { data } = await createClient(url, key, { auth: { persistSession: false } }).from("source_domain_review").select("domain, seen_count, example_url, decision").is("decision", null);
  rows = mergeRejected([rows, ((data ?? []) as Array<{ domain: string; seen_count: number; example_url: string | null }>).map((d) => ({ domain: d.domain, count: d.seen_count, field: "round", example_title: "(database)", example_url: d.example_url ?? "", standing: "unlisted" }))]);
}

const top = topDomains(rows, 40);
const cell = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
writeFileSync("rejected_domains_top.csv", "﻿" + ["domain,count,fields,standing,example_title,example_url", ...top.map((t) => [t.domain, t.count, t.fields, t.standing, t.example_title, t.example_url].map(cell).join(","))].join("\r\n") + "\r\n");
console.log(`\nTop ${top.length} of ${new Set(rows.map((r) => r.domain)).size} domains (standing: unlisted = on no list, denied = already blocked):\n`);
top.forEach((t, i) => console.log(`${String(i + 1).padStart(2)}. ${t.domain.padEnd(34)} ${String(t.count).padStart(4)}  ${t.standing.padEnd(9)} ${t.fields.slice(0, 28).padEnd(28)} ${t.example_url.slice(0, 90)}`));
console.log("\n📋  rejected_domains_top.csv");
