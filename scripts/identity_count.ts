#!/usr/bin/env node
/**
 * scripts/identity_count.ts — how many companies the identity check would flag (owner, 2026-11-24). READS ONLY the run logs of the gate (regression/out/batch_N/run.log): the line
 * "🧭 identity: … overlap 0.xx" that collect.ts prints before the news gate. Prints the cut, the coverage (companies with the line / all blocks), the distribution, and the flagged companies, lowest first.
 *   BATCHES=8,9 CUT=0.25 npx tsx scripts/identity_count.ts
 */
import { existsSync, readFileSync } from "fs";
const cut = Number(process.env.CUT ?? 0.25);
// LOGS="regression/out/acquired_9/run.log,…": other logs are counted too (each under its own name)
const targets = process.env.LOGS ? process.env.LOGS.split(",").map((f) => ({ n: f.trim(), f: f.trim() })) : (process.env.BATCHES ?? "8,9").split(",").map(Number).map((n) => ({ n: `batch ${n}`, f: `regression/out/batch_${n}/run.log` }));
for (const { n, f } of targets) {
  if (!existsSync(f)) { console.log(`${n}: ${f} missing`); continue; }
  const lines = readFileSync(f, "utf8").split("\n"); let co = ""; let blocks = 0; const seen: Array<{ co: string; share: number }> = [];
  for (const l of lines) {
    const h = l.match(/^── (.+?) \([0-9a-f-]{36}\) ──/); if (h) { co = h[1]; blocks++; continue; }
    const m = l.match(/🧭\s+identity: .*overlap (\d\.\d+)/); if (m && co) seen.push({ co, share: Number(m[1]) });
  }
  const bucket = (x: number) => (x < 0.1 ? "<0.10" : x < 0.25 ? "0.10–0.25" : x < 0.4 ? "0.25–0.40" : x < 0.6 ? "0.40–0.60" : "≥0.60");
  const dist = new Map<string, number>(); for (const s of seen) dist.set(bucket(s.share), (dist.get(bucket(s.share)) ?? 0) + 1);
  const flagged = seen.filter((s) => s.share < cut).sort((a, b) => a.share - b.share);
  console.log(`\n══ ${n}: ${blocks} company block(s) · ${seen.length} with an identity line (the rest: no profile, no site text, or the run stopped before) · cut ${cut}`);
  console.log(`   distribution: ${["<0.10", "0.10–0.25", "0.25–0.40", "0.40–0.60", "≥0.60"].map((b) => `${b}: ${dist.get(b) ?? 0}`).join(" · ")}`);
  console.log(`   flagged (overlap < ${cut}): ${flagged.length}`);
  for (const s of flagged.slice(0, 30)) console.log(`     ${s.share.toFixed(2)}  ${s.co}`);
}
