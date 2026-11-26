#!/usr/bin/env node
/**
 * scripts/gaps_of.ts — are the companies a run could not read in the memory of known gaps or known sources? (owner, 2026-11-19: fetch_failed companies must not be remembered as a gap.)
 *   npx tsx scripts/gaps_of.ts                 lists the companies of not_enriched.csv found in cache/known_gaps.json and cache/known_sources.json
 *   REMOVE=1 npx tsx scripts/gaps_of.ts        takes their entries out
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { parseCsv } from "../lib/enrichment/acceptance.ts";

const fold = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "");
const [h, ...b] = parseCsv(readFileSync("not_enriched.csv", "utf8"));
const names = new Set(b.filter((r) => /domain_unresolved|fetch_failed|error/.test(r[h.indexOf("why")])).map((r) => fold(r[h.indexOf("company")])));
let found = 0;
for (const f of ["cache/known_gaps.json", "cache/known_sources.json"]) {
  if (!existsSync(f)) { console.log(`${f}: not there`); continue; }
  const j = JSON.parse(readFileSync(f, "utf8")) as Record<string, unknown>;
  const hits = Object.entries(j).filter(([, v]) => { const c = (v as { company?: string } | Array<{ company?: string }>); const name = Array.isArray(c) ? c[0]?.company : (c as { company?: string }).company; return !!name && names.has(fold(name)); });
  console.log(`${f}: ${hits.length} of the ${names.size} companies${hits.length ? ` — ${hits.map(([, v]) => (Array.isArray(v) ? (v as Array<{ company?: string }>)[0]?.company : (v as { company?: string }).company)).join(", ")}` : ""}`);
  found += hits.length;
  if (hits.length && process.env.REMOVE === "1") { for (const [k] of hits) delete j[k]; writeFileSync(f, JSON.stringify(j, null, 1)); console.log(`  removed ${hits.length}`); }
}
console.log(found ? (process.env.REMOVE === "1" ? "removed." : "REMOVE=1 takes them out.") : "none of them is remembered.");
