#!/usr/bin/env node
/**
 * scripts/why_lost.ts — for the companies named, the lines of the gate's log about what was lost: the description and its dropped sentences, the pages read, the sector, the rounds and the rules that
 * touched them. READS regression/out/batch_<N>/run.log only.   npx tsx scripts/why_lost.ts 8 Kry Multiable Orizuru Shyft
 */
import { existsSync, readFileSync } from "fs";
const [batch, ...names] = process.argv.slice(2);
const f = `regression/out/batch_${batch}/run.log`;
if (!batch || !names.length || !existsSync(f)) { console.error(`usage: why_lost.ts <batch> <company…>   (needs ${f})`); process.exit(2); }
const lines = readFileSync(f, "utf8").split("\n");
const KEEP = /description|📝|Pages of the company read|sector|round|Series|Seed|quote stands|amount|marketing|🚦|🔧|funding extraction|Deep dive|checked against/i;
for (const n of names) {
  const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const at = lines.findIndex((l) => new RegExp(`^── ${esc} \\(`).test(l));
  console.log(`\n=========== ${n}`);
  if (at < 0) { console.log("no block in the log"); continue; }
  let end = lines.findIndex((l, i) => i > at && /^── .* \(/.test(l)); if (end < 0) end = lines.length;
  const keep = lines.slice(at + 1, end).filter((l) => KEEP.test(l) && !/🌐|news "/.test(l)).map((l) => l.trim().slice(0, 240));
  for (const l of keep.slice(0, 30)) console.log("  " + l);
  if (keep.length > 30) console.log(`  … ${keep.length - 30} more`);
}
