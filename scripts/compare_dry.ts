#!/usr/bin/env node
/**
 * scripts/compare_dry.ts — two dry runs of the same companies side by side (owner, 2026-11-15): per company and field, what is new, what is gone, what changed.
 * A run is lost when the next one overwrites its report, so keep copies:  cp pilot_report_dry.csv runs/dry_$(date +%m%d_%H%M).csv
 *
 *   A=runs/dry_1114.csv B=pilot_report_dry.csv npx tsx scripts/compare_dry.ts
 */
import { readFileSync, existsSync } from "fs";

function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cur = "", q = false;
  const t = text.replace(/^﻿/, "");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && t[i + 1] === "\n") i++; row.push(cur); cur = ""; if (row.some((x) => x !== "")) rows.push(row); row = []; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
const A = process.env.A, B = process.env.B ?? "pilot_report_dry.csv";
if (!A || !existsSync(A) || !existsSync(B)) { console.error("A=<older report.csv> [B=<newer, default pilot_report_dry.csv>]"); process.exit(1); }

function load(path: string): Map<string, Map<string, string[]>> {
  const [head, ...body] = parseCsv(readFileSync(path, "utf8"));
  const ix = (n: string) => head.indexOf(n);
  const m = new Map<string, Map<string, string[]>>();
  for (const r of body) {
    const c = r[ix("company")], f = r[ix("field")]; if (!c || !f || f === "(nothing)") continue;
    const fields = m.get(c) ?? m.set(c, new Map()).get(c)!;
    (fields.get(f) ?? fields.set(f, []).get(f)!).push((r[ix("after")] ?? "").replace(/\s+/g, " ").slice(0, 90));
  }
  return m;
}
const a = load(A), b = load(B);
let gained = 0, lost = 0, changed = 0, missed = 0;
// Companies whose replay lacked recordings (LOG=<run log>): a lost value there is not a regression.
const missCompanies = new Set<string>();
if (process.env.LOG) for (const l of readFileSync(process.env.LOG, "utf8").split("\n")) { const m = l.match(/REPLAY MISS (.+?): /); if (m) missCompanies.add(m[1]); }
const out: string[] = [];
for (const c of [...new Set([...a.keys(), ...b.keys()])].sort()) {
  const fa = a.get(c) ?? new Map<string, string[]>(), fb = b.get(c) ?? new Map<string, string[]>();
  const lines: string[] = [];
  for (const f of [...new Set([...fa.keys(), ...fb.keys()])].sort()) {
    const va = fa.get(f), vb = fb.get(f);
    if (!va && vb) { gained++; lines.push(`  + ${f}: ${vb.slice(0, 2).join(" | ")}${vb.length > 2 ? ` (+${vb.length - 2})` : ""}`); }
    else if (va && !vb && missCompanies.has(c)) { missed++; lines.push(`  ? ${f}: cache_miss (not a faithful replay) — was ${va.slice(0, 2).join(" | ")}`); }
    else if (va && !vb) { lost++; lines.push(`  − ${f}: ${va.slice(0, 2).join(" | ")}${va.length > 2 ? ` (+${va.length - 2})` : ""}`); }
    else if (va && vb && JSON.stringify([...va].sort()) !== JSON.stringify([...vb].sort())) {
      const onlyA = va.filter((x) => !vb.includes(x)), onlyB = vb.filter((x) => !va.includes(x));
      changed++;
      lines.push(`  ~ ${f}: ${onlyA.length ? `was ${onlyA.slice(0, 2).join(" | ")}` : ""}${onlyA.length && onlyB.length ? " → " : ""}${onlyB.length ? `now ${onlyB.slice(0, 2).join(" | ")}` : ""}`);
    }
  }
  const inA = a.has(c), inB = b.has(c);
  if (!inA && inB) out.push(`${c}: NEW in B (${fb.size} field(s))`);
  else if (inA && !inB) out.push(`${c}: GONE from B (had ${fa.size} field(s))`);
  else if (lines.length) out.push(`${c}\n${lines.join("\n")}`);
}
console.log(out.join("\n") || "No difference.");
console.log(`\n${gained} field(s) gained, ${lost} lost, ${changed} changed, ${missed} cache_miss.  (A: ${A} — B: ${B})`);
