#!/usr/bin/env node
/**
 * scripts/audit_sample.ts — the post-write audit of a batch (owner, 2026-11-20): 50 values of the core fields, 25 random and 25 aimed at hard cases. Reads the wet report; writes audit_batch_<N>.csv.
 *   BATCH_NO=8 npx tsx scripts/audit_sample.ts            (REPORT=pilot_report_write.csv by default)
 * Then the reviewer marks the wrong ones:  BATCH_NO=8 WRONG=3,17=reason npx tsx scripts/audit_apply.ts
 */
import { readFileSync, writeFileSync } from "fs";
import { parseCsv } from "../lib/enrichment/acceptance.ts";
import { draw } from "../lib/enrichment/audit.ts";

const batch = Number(process.env.BATCH_NO);
if (!Number.isInteger(batch) || batch < 1) { console.error("BATCH_NO=<n> is required"); process.exit(2); }
const report = process.env.REPORT ?? "pilot_report_write.csv";
const [h, ...b] = parseCsv(readFileSync(report, "utf8").replace(/^﻿/, ""));
const ix = (c: string) => h.indexOf(c);
const rows = b.map((r) => ({ company: r[ix("company")] ?? "", company_id: r[ix("company_id")] ?? "", field: r[ix("field")] ?? "", value: r[ix("after")] ?? "", source_url: r[ix("source_url")] ?? "", quote: r[ix("quote")] ?? "", rule: ix("rule") >= 0 ? r[ix("rule")] ?? "" : "" }));
const d = draw(rows, batch);
const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
writeFileSync(`audit_batch_${batch}.csv`, "﻿" + [["n", "kind", "company_id", "company", "field", "value", "source_url", "quote", "verdict"].join(","), ...d.map((x) => [x.n, x.kind, x.company_id, x.company, x.field, x.value, x.source_url, x.quote, ""].map((c) => q(String(c))).join(","))].join("\r\n") + "\r\n");
console.log(`${rows.length} core value(s) in ${report}; audit_batch_${batch}.csv: ${d.filter((x) => x.kind === "random").length} random + ${d.filter((x) => x.kind === "targeted").length} targeted.\n`);
for (const x of d) { console.log(`#${x.n} [${x.kind}] ${x.company} · ${x.field} · ${x.value.slice(0, 110)}`); console.log(`     ${x.source_url.slice(0, 130)}`); if (x.quote) console.log(`     "${x.quote.slice(0, 200)}"`); }
console.log(`\nThe WRONG ones:  BATCH_NO=${batch} WRONG=<numbers; N=reason optional> npx tsx scripts/audit_apply.ts   (none wrong: WRONG=none)`);
