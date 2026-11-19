#!/usr/bin/env node
/**
 * scripts/domain_review.ts — the domains the rules turned away most (reason source_not_allowed), for the owner's decision (2026-11-19).
 *   npx tsx scripts/domain_review.ts              writes domain_review.csv: domain, rejections, 3 examples, country, decision (approve / reject)
 *   npx tsx scripts/domain_review.ts apply        reads the decisions and writes them to eval/source_decisions.json (read by roundSources.ts: approved → tier 3 press, rejected → denied)
 * After `apply`, REPLAY only (npx tsx scripts/regression.ts and a REPLAY dry run) shows how many values the decisions add. No cost.
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { parseCsv } from "../lib/enrichment/acceptance.ts";
import { reviewDomain } from "../lib/enrichment/roundSources.ts";

const TLD: Record<string, string> = { il: "Israel", uk: "United Kingdom", de: "Germany", fr: "France", pl: "Poland", es: "Spain", it: "Italy", nl: "Netherlands", se: "Sweden", no: "Norway", dk: "Denmark", fi: "Finland", ch: "Switzerland", at: "Austria", pt: "Portugal", br: "Brazil", mx: "Mexico", ar: "Argentina", cl: "Chile", co: "Colombia", in: "India", jp: "Japan", cn: "China", kr: "South Korea", au: "Australia", nz: "New Zealand", ca: "Canada", za: "South Africa", ng: "Nigeria", ke: "Kenya", eg: "Egypt", tr: "Turkey", ae: "UAE", sg: "Singapore", id: "Indonesia", ie: "Ireland", be: "Belgium", cz: "Czechia", ro: "Romania", ru: "Russia", ua: "Ukraine" };
const q = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

if (process.argv[2] === "list") {
  const [h, ...b] = parseCsv(readFileSync("domain_review.csv", "utf8"));
  b.forEach((r, i) => console.log(`${String(i + 1).padStart(2)}  ${r[h.indexOf("domain")].padEnd(30)} ×${r[1]}  ${r[5]}\n      ${(r[2] ?? "").slice(0, 150)}`));
  console.log("\nDecide: APPROVE=1,4,7 REJECT=2,3 npx tsx scripts/domain_review.ts apply   (numbers of this list; a domain name works too; a domain you leave out stays as it is)");
  process.exit(0);
}
if (process.argv[2] === "apply") {
  const [h, ...b] = parseCsv(readFileSync("domain_review.csv", "utf8"));
  const dec = { approved: [] as string[], rejected: [] as string[] };
  // Decisions on the command line: numbers of `list` (or domain names) — no file to edit.
  const pick = (v?: string) => (v ?? "").split(",").map((x) => x.trim()).filter(Boolean).map((x) => (/^\d+$/.test(x) ? b[Number(x) - 1]?.[h.indexOf("domain")] : x)).filter((x): x is string => !!x);
  dec.approved.push(...pick(process.env.APPROVE)); dec.rejected.push(...pick(process.env.REJECT));
  for (const r of b) { const d = (r[h.indexOf("decision")] ?? "").trim().toLowerCase(); const dom = r[h.indexOf("domain")]; if (/^(approve|yes|ok|אשר|מאשר)/.test(d)) dec.approved.push(dom); else if (/^(reject|no|דחה|דוחה)/.test(d)) dec.rejected.push(dom); }
  const prev = existsSync("eval/source_decisions.json") ? JSON.parse(readFileSync("eval/source_decisions.json", "utf8")) as typeof dec : { approved: [], rejected: [] };
  const out = { approved: [...new Set([...prev.approved, ...dec.approved])].sort(), rejected: [...new Set([...prev.rejected, ...dec.rejected])].sort() };
  writeFileSync("eval/source_decisions.json", JSON.stringify(out, null, 1) + "\n");
  console.log(`eval/source_decisions.json: ${out.approved.length} approved, ${out.rejected.length} rejected. Commit it, then REPLAY only.`);
  process.exit(0);
}
if (!existsSync("rejected_all.csv")) { console.error("rejected_all.csv not found (the dry run writes it)"); process.exit(1); }
const [h, ...b] = parseCsv(readFileSync("rejected_all.csv", "utf8"));
const ix = (c: string) => h.indexOf(c);
const by = new Map<string, { n: number; ex: string[]; countries: Map<string, number> }>();
for (const r of b) {
  if (r[ix("reason_code")] !== "source_not_allowed") continue;
  const url = r[ix("source_url")]; const dom = url ? reviewDomain(url) : null; if (!dom) continue;
  const e = by.get(dom) ?? by.set(dom, { n: 0, ex: [], countries: new Map() }).get(dom)!;
  e.n++; if (e.ex.length < 3) e.ex.push(`${r[ix("value")].slice(0, 70)} <${url.slice(0, 90)}>`);
  const tld = TLD[dom.split(".").pop() ?? ""]; if (tld) e.countries.set(tld, 1);
}
const lines = ["domain,rejections,example_1,example_2,example_3,country (from the address),decision (approve / reject)"];
for (const [d, e] of [...by].sort((a, c) => c[1].n - a[1].n)) lines.push([d, e.n, e.ex[0] ?? "", e.ex[1] ?? "", e.ex[2] ?? "", [...e.countries.keys()].join("/") || "(none in the address)", ""].map(q).join(","));
writeFileSync("domain_review.csv", "﻿" + lines.join("\r\n") + "\r\n");
console.log(`domain_review.csv: ${by.size} domain(s), ${[...by.values()].reduce((s, e) => s + e.n, 0)} rejection(s). Mark approve / reject in the last column, then: npx tsx scripts/domain_review.ts apply`);
