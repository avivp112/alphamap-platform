#!/usr/bin/env node
/**
 * scripts/why_round_lost.ts — where a lost round fell (READS the logs only, free; owner, 2026-11-24). For each Tier 1 round the gate lost, from the gate's output (GATE=gate89s.log) or a list (NAMES="Flock Safety,Infisical"),
 * the lines of that company's block in regression/out/batch_N/run.log (BATCH=9): the news rows written that carry the amount, the round lines (not written / row rules / headline / dates), the pages read with the characters read
 * and the characters sent to the model (a funding article cut at its limit), and one line with the stage:
 *   - "reached the rows": a round line says why it fell (extraction dropped it with a reason, or a row rule);
 *   - "no round was made": no round line at all, while a news row states the amount (the extraction never had it, or never made it a round);
 *   - "article cut": the page of the article was cut before the model saw all of it.
 *   GATE=gate89s.log BATCH=9 npx tsx scripts/why_round_lost.ts
 */
import { existsSync, readFileSync } from "fs";
const batch = process.env.BATCH ?? "9", gate = process.env.GATE;
const logFile = `regression/out/batch_${batch}/run.log`;
if (!existsSync(logFile)) { console.error(`${logFile} is missing — run the gate first`); process.exit(2); }
const lost: Array<{ company: string; value: string }> = [];
if (gate && existsSync(gate)) for (const l of readFileSync(gate, "utf8").split("\n")) { const m = l.match(/LOST \[Tier 1\] (.+?) · round · (.+?)\s{2,}\[/) ?? l.match(/LOST \[Tier 1\] (.+?) · round · (.+)$/); if (m) lost.push({ company: m[1].trim(), value: m[2].trim() }); }
for (const n of (process.env.NAMES ?? "").split(",").map((x) => x.trim()).filter(Boolean)) lost.push({ company: n, value: "" });
if (!lost.length) { console.error('GATE=<gate output> or NAMES="Company,…" is required.'); process.exit(2); }
const lines = readFileSync(logFile, "utf8").split("\n");
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const tally = new Map<string, number>();
for (const { company, value } of lost) {
  const at = lines.findIndex((l) => new RegExp(`^── ${esc(company)} \\(`).test(l));
  console.log(`\n════ ${company}${value ? ` · ${value.slice(0, 80)}` : ""}`);
  if (at < 0) { console.log("  no block of this company in the log"); tally.set("no block", (tally.get("no block") ?? 0) + 1); continue; }
  let end = lines.findIndex((l, i) => i > at && /^── .* \(/.test(l)); if (end < 0) end = lines.length;
  const b = lines.slice(at, end);
  const amt = value.match(/\$(\d[\d.,]*)\s?([MBK])?/); const num = amt ? amt[1].replace(/\.0+$/, "") : "";
  const mentions = (x: string) => !!num && new RegExp(`\\$?\\s?${esc(num)}\\s?(?:M\\b|million|mn\\b|m\\b)`, "i").test(x);
  const news = b.filter((l) => /\[DRY\] would write news/.test(l) && (mentions(l) || /rais|funding|series|seed|round|invest/i.test(l))).map((l) => l.trim().slice(0, 190));
  const roundLines = b.filter((l) => /🚫 +(?:Seed|Series|Pre-Seed|Growth|Debt|Other|Unknown|Venture)|not written \((?:round|another company's round|incomplete|no_|round_)|🚦 +round|🗞️|🔧|⚔️|\[DRY\] would write round|📅 +(?:Seed|Series|Unknown|Other|Growth)|Round source/i.test(l)).map((l) => l.trim().slice(0, 200));
  const pages = b.filter((l) => /🌐\s+fetched/.test(l)).map((l) => { const m = l.match(/fetched (\S+) \((\d+) chars.*?(\d+) sent/); return m ? { url: m[1], chars: +m[2], sent: +m[3] } : null; }).filter((x): x is { url: string; chars: number; sent: number } => !!x);
  const articles = pages.filter((p) => /rais|fund|series|seed|round|invest|news|press|blog|reuters|prnewswire|businesswire|techcrunch/i.test(p.url));
  const cut = articles.filter((p) => p.sent < p.chars * 0.9);
  console.log(`  news rows written about money (${news.length}):`); for (const x of news.slice(0, 4)) console.log(`    ${x}`);
  console.log(`  round lines (${roundLines.length}):`); for (const x of roundLines.slice(0, 8)) console.log(`    ${x}`);
  console.log(`  pages read: ${pages.length} · funding/news/press pages: ${articles.length} · cut before the model: ${cut.length}`); for (const p of cut.slice(0, 4)) console.log(`    ${p.url}  ${p.chars} → ${p.sent}`);
  const wrote = b.some((l) => /\[DRY\] would write round/.test(l) && mentions(l));
  const stage = wrote ? "the round is written now (the gate's match is the matter, not the pipeline)" : roundLines.some((l) => /🚫|🚦/.test(l)) ? "reached the rows: dropped with a reason (above)" : news.length && !roundLines.length ? (cut.length ? "no round was made, and an article was cut" : "no round was made, while a news row states money") : "no round line and no news row about it: the article was not found or not read";
  console.log(`  ▶ stage: ${stage}`);
  tally.set(stage, (tally.get(stage) ?? 0) + 1);
}
console.log("\n── by stage:"); for (const [k, v] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(3)} × ${k}`);
