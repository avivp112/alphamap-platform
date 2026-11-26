#!/usr/bin/env node
/**
 * scripts/rejected_stats.ts — the owner's verdicts on rejected_sample_30.csv ("right" / "wrong" in the last column) per reason code. A code with more than 20% wrong rejections is to be widened
 * (and gets an acceptance check). Reads the file; writes nothing.   npx tsx scripts/rejected_stats.ts [file]
 */
import { readFileSync } from "fs";
import { parseCsv } from "../lib/enrichment/acceptance.ts";
import { rejectionStats } from "../lib/enrichment/rejections.ts";

const file = process.argv[2] ?? "rejected_sample_30.csv";
const [head, ...rows] = parseCsv(readFileSync(file, "utf8"));
const ix = (c: string) => { const e = head.findIndex((h) => h === c); return e >= 0 ? e : head.findIndex((h) => h.startsWith(c)); };
const verdicts = rows.map((r) => ({ reason_code: r[ix("reason_code")], verdict: r[ix("verdict")] ?? "" }));
const st = rejectionStats(verdicts);
const marked = st.reduce((n, x) => n + x.marked, 0), wrong = st.reduce((n, x) => n + x.wrong, 0);
console.log(`${marked} of ${rows.length} marked · ${wrong} wrong rejection(s)${marked ? ` (${Math.round((wrong / marked) * 100)}%)` : ""}\n`);
for (const x of st) console.log(`${x.widen ? "❌ widen" : "✅ keep "}  ${x.reason_code.padEnd(34)} ${x.wrong}/${x.marked} wrong (${Math.round(x.share * 100)}%)`);
if (st.some((x) => x.widen)) process.exitCode = 1;
