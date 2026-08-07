#!/usr/bin/env node
/**
 * check_website_reachability.ts — Verify a batch of company websites actually resolve
 *
 * Reads a CSV (name,website — same shape as public/startups_list_v1.csv and any
 * new-company upload), makes a live HTTP request to every website concurrently,
 * and reports which ones are reachable vs. genuinely broken. Built for vetting a
 * new-company CSV before it's appended to the master list — run it from a machine
 * with normal outbound internet access (this can't run inside a sandboxed session
 * with a locked-down egress policy).
 *
 * A response — ANY response, including 403/401 — counts as "reachable": it proves
 * DNS resolves and a server is listening. Many legitimate sites block non-browser
 * clients (bot/WAF protection), so a 403 here is not evidence the company is fake,
 * just that this script isn't a browser. Only genuine failures (DNS not found,
 * connection refused, TLS failure, timeout) are marked unreachable — those are
 * the ones worth a human double-check before adding the company.
 *
 * Usage:
 *   INPUT_CSV=./new_companies.csv npx tsx scripts/check_website_reachability.ts
 *   INPUT_CSV=./new_companies.csv CONCURRENCY=40 TIMEOUT_MS=8000 npx tsx scripts/check_website_reachability.ts
 *
 * Env vars:
 *   INPUT_CSV     required — path to a CSV with a header row, columns name,website
 *   OUTPUT_CSV    default: <INPUT_CSV> with "_reachability" inserted before .csv
 *   CONCURRENCY   default 30  — parallel in-flight requests
 *   TIMEOUT_MS    default 10000 — per-request timeout
 */

import { readFileSync, writeFileSync } from "fs";

const INPUT_CSV   = process.env.INPUT_CSV;
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 30);
const TIMEOUT_MS  = Number(process.env.TIMEOUT_MS ?? 10_000);

if (!INPUT_CSV) {
  console.error("❌  INPUT_CSV is required, e.g. INPUT_CSV=./new_companies.csv npx tsx scripts/check_website_reachability.ts");
  process.exit(1);
}
const OUTPUT_CSV = process.env.OUTPUT_CSV ?? INPUT_CSV.replace(/\.csv$/i, "_reachability.csv");

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "", inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur); cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function sanitize(s: string): string {
  return s.replace(/﻿/g, "").replace(/ /g, " ").replace(/�/g, "").trim();
}

function normalizeWebsite(raw: string): string | null {
  const w = sanitize(raw);
  if (!w) return null;
  const withProto = /^https?:\/\//i.test(w) ? w : `https://${w}`;
  return withProto.replace(/\/+$/, "");
}

interface Row { name: string; website: string }
interface Result extends Row { status: "reachable" | "unreachable"; detail: string }

const raw = readFileSync(INPUT_CSV, "utf8");
const lines = raw.split(/\r?\n/).filter((l) => l.trim() !== "");
const rows: Row[] = [];
for (let i = 1; i < lines.length; i++) {
  const cols = parseCsvLine(lines[i]);
  const name = sanitize(cols[0] || "");
  const website = normalizeWebsite(cols[1] || "");
  if (name && website) rows.push({ name, website });
}

console.log(`╔${"═".repeat(60)}╗`);
console.log(`║${"  Website Reachability Check".padEnd(60)}║`);
console.log(`║  ${rows.length} companies | concurrency=${CONCURRENCY} | timeout=${TIMEOUT_MS}ms${" ".repeat(Math.max(0, 60 - 40 - String(rows.length).length))}║`);
console.log(`╚${"═".repeat(60)}╝\n`);

async function checkOne(row: Row): Promise<Result> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  };
  try {
    let res: Response;
    try {
      res = await fetch(row.website, { method: "HEAD", redirect: "follow", signal: controller.signal, headers });
    } catch {
      // Some servers reject HEAD outright — retry with GET before giving up.
      res = await fetch(row.website, { method: "GET", redirect: "follow", signal: controller.signal, headers });
    }
    return { ...row, status: "reachable", detail: `HTTP ${res.status}` };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const reason = /abort/i.test(message) ? "timeout" : message;
    return { ...row, status: "unreachable", detail: reason };
  } finally {
    clearTimeout(timer);
  }
}

async function runPool(items: Row[], limit: number): Promise<Result[]> {
  const results: Result[] = new Array(items.length);
  let next = 0;
  let done = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await checkOne(items[i]);
      done++;
      if (done % 100 === 0 || done === items.length) {
        process.stdout.write(`\r  Checked ${done}/${items.length}…`);
      }
    }
  }
  await Promise.all(Array.from({ length: limit }, () => worker()));
  process.stdout.write("\n\n");
  return results;
}

async function main() {
  const results = await runPool(rows, CONCURRENCY);

  const reachable = results.filter((r) => r.status === "reachable");
  const unreachable = results.filter((r) => r.status === "unreachable");

  const header = "name,website,status,detail\n";
  const body = results
    .map((r) => `"${r.name.replace(/"/g, '""')}","${r.website}",${r.status},"${r.detail.replace(/"/g, '""')}"`)
    .join("\n");
  writeFileSync(OUTPUT_CSV, header + body + "\n");

  console.log("── Summary " + "─".repeat(50));
  console.log(`  Total checked:  ${results.length}`);
  console.log(`  ✅  Reachable:   ${reachable.length}`);
  console.log(`  ❌  Unreachable: ${unreachable.length}`);
  console.log(`\n  Full results written to: ${OUTPUT_CSV}`);

  if (unreachable.length > 0) {
    console.log(`\n  Unreachable companies (worth a manual look before adding):`);
    for (const r of unreachable.slice(0, 50)) {
      console.log(`    - ${r.name} (${r.website}) — ${r.detail}`);
    }
    if (unreachable.length > 50) console.log(`    … and ${unreachable.length - 50} more (see ${OUTPUT_CSV})`);
  }
}

main().catch((e) => {
  console.error("💥  Fatal error:", e);
  process.exit(1);
});
