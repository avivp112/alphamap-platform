#!/usr/bin/env node
/**
 * scripts/not_enriched_table.ts — the companies a dry run did not enrich (🔍) or crashed on (💥), by reason and one line each (owner, 2026-11-19): domain, reason, the log lines that decided it.
 *   LOG=batch8_live1.log npx tsx scripts/not_enriched_table.ts
 */
import { existsSync, readFileSync } from "fs";
import { parseCsv } from "../lib/enrichment/acceptance.ts";

const logFile = process.env.LOG ?? "batch8_live1.log";
const log = existsSync(logFile) ? readFileSync(logFile, "utf8").split("\n") : [];
const host = (w: string) => { try { return new URL(/^https?:/.test(w) ? w : `https://${w}`).hostname.replace(/^www\./, ""); } catch { return w; } };
const block = (co: string) => { const at = log.findIndex((l) => l.startsWith(`── ${co} (`)); if (at < 0) return []; let end = log.findIndex((l, i) => i > at && /^── .* \(/.test(l)); if (end < 0) end = log.length; return log.slice(at, end); };
const rows: Array<{ company: string; domain: string; why: string; detail: string }> = [];
if (existsSync("not_enriched.csv")) { const [h, ...b] = parseCsv(readFileSync("not_enriched.csv", "utf8")); for (const r of b) rows.push({ company: r[h.indexOf("company")], domain: host(r[h.indexOf("website")] ?? ""), why: r[h.indexOf("why")], detail: r[h.indexOf("detail")] ?? "" }); }
const by = new Map<string, typeof rows>();
for (const r of rows) (by.get(r.why) ?? by.set(r.why, []).get(r.why)!).push(r);
console.log(`not enriched: ${rows.length}\n`);
for (const [why, list] of [...by].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`■ ${why} — ${list.length}`);
  for (const r of list) {
    const lines = block(r.company).filter((l) => /🧪  Technology decision|⚠️|🚫  REJECTED|The website \(|unreadable|domain|🔒/i.test(l) && !/🌐/.test(l)).map((l) => l.trim().slice(0, 170)).slice(0, 3);
    console.log(`   ${r.company.padEnd(26)} ${r.domain.padEnd(28)} ${r.detail.slice(0, 90)}`);
    for (const l of lines) console.log(`        │ ${l}`);
  }
}
const crashes = log.filter((l) => /💥|Unhandled error processing/.test(l) && !/📍/.test(l));
if (crashes.length) { console.log(`\n■ crashed — ${crashes.length}`); for (const l of crashes.slice(0, 10)) console.log(`   ${l.trim().slice(0, 260)}`); }
