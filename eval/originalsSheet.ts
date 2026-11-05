/**
 * eval/originalsSheet.ts — the check sheet for the original golden companies (owner, 2026-11-05).
 * Pure. The owner approved rounds, competitors and patents in the earlier sheets; the other fields
 * (city, country, founded_year, founding_country, founders) were never reviewed by him. The sheet
 * lists every such value with its source and quote, numbered like the review report (v1.N); he
 * names only the wrong ones, and every other value is taken as correct. After the import those
 * fields are listed in the company's `reviewed_fields`, and the evaluation counts them as verified.
 */
import type { GoldenCompany } from "./score.ts";

export const SHEET_FIELDS = ["city", "country", "founded_year", "founding_country", "founders"] as const;
export type SheetField = (typeof SHEET_FIELDS)[number];

export interface SheetValue { id: string; company: string; field: SheetField | "founder"; value: string; source_url: string; quote: string; person?: number }

/** Every value of the sheet fields that is stated (not unknown, not "not declared"), numbered v1.1, v1.2 … */
export function sheetValues(companies: GoldenCompany[], quotes: Record<string, string> = {}): SheetValue[] {
  const out: SheetValue[] = [];
  let n = 0;
  const add = (g: GoldenCompany, field: SheetValue["field"], value: string, source_url: string | undefined, note: string | undefined, person?: number) => {
    n++;
    const id = `v1.${n}`;
    out.push({ id, company: g.name, field, value, source_url: source_url ?? "", quote: quotes[id] ?? note ?? "", person });
  };
  for (const g of companies) {
    if (g.judged_only) continue;
    for (const f of ["city", "country", "founded_year", "founding_country"] as const) {
      const x = g[f] as { value: unknown; confidence: string; source_url?: string; notes?: string; not_declared?: boolean } | undefined;
      if (!x || x.not_declared || x.confidence === "unknown" || x.value == null || x.value === "") continue;
      add(g, f, String(x.value), x.source_url, x.notes);
    }
    (g.founders ?? []).forEach((p, i) => {
      if (p.confidence === "unknown") return;
      add(g, "founder", p.title ? `${p.name} (${p.title})` : p.name, p.source_url, (p as { notes?: string }).notes, i);
    });
  }
  return out;
}

export function sheetText(values: SheetValue[]): string {
  const lines: string[] = [];
  let company = "";
  for (const v of values) {
    if (v.company !== company) { company = v.company; lines.push("", `── ${company}`); }
    lines.push(`${v.id.padEnd(7)} ${v.field.padEnd(17)} ${v.value}`, `        source: ${v.source_url || "(none)"}`, `        quote:  ${v.quote ? `"${v.quote}"` : "(none — open the source)"}`);
  }
  return lines.join("\n");
}

const cell = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
export function sheetCsv(values: SheetValue[]): string {
  const cols = ["id", "company", "field", "value", "source_url", "quote"] as const;
  return "﻿" + [cols.join(","), ...values.map((v) => cols.map((c) => cell(String(v[c] ?? ""))).join(","))].join("\r\n") + "\r\n";
}

/**
 * Applies the owner's verdict: the numbers he names are wrong, every other value is correct.
 * A wrong city/country/year/founding country becomes "unknown" with a note (it is no golden truth);
 * a wrong founder is removed. Every sheet field the company has is then listed in `reviewed_fields`.
 * "v1.4=London" gives the right value: it is kept as the golden value (verified, with a note); a
 * founder's replacement is the corrected name. Unknown numbers are returned, not guessed.
 */
export function applyVerdict(companies: GoldenCompany[], values: SheetValue[], wrong: string[]): { companies: GoldenCompany[]; unknown: string[]; wrongApplied: number } {
  const ids = new Set(values.map((v) => v.id));
  const entries = wrong.map((w) => w.trim()).filter(Boolean).map((w) => { const i = w.indexOf("="); return i < 0 ? [w, ""] as const : [w.slice(0, i).trim(), w.slice(i + 1).trim()] as const; });
  const wrongSet = new Set(entries.map(([id]) => id));
  const fixes = new Map(entries.filter(([, val]) => val).map(([id, val]) => [id, val]));
  const unknown = [...wrongSet].filter((w) => !ids.has(w));
  let wrongApplied = 0;
  const out = companies.map((g) => {
    const mine = values.filter((v) => v.company === g.name);
    if (!mine.length) return g;
    const next: GoldenCompany = { ...g };
    const dropPersons = new Set<number>();
    const renamed = new Map<number, string>();
    for (const v of mine) {
      if (!wrongSet.has(v.id)) continue;
      wrongApplied++;
      const fix = fixes.get(v.id);
      if (v.field === "founder") {
        if (!fix) { dropPersons.add(v.person!); continue; }
        renamed.set(v.person!, fix);
        continue;
      }
      const cur = next[v.field] as { value: unknown; confidence: string; notes?: string };
      const note = fix ? `owner corrected "${v.value}" to "${fix}" on the check sheet (${v.id}, 2026-11-05)` : `owner marked the value "${v.value}" wrong on the check sheet (${v.id}, 2026-11-05)`;
      (next as Record<string, unknown>)[v.field] = {
        ...cur, notes: [cur.notes, note].filter(Boolean).join(" · "),
        ...(fix ? { value: v.field === "founded_year" && /^\d{4}$/.test(fix) ? Number(fix) : fix, confidence: "verified" } : { confidence: "unknown" }),
      };
    }
    if (dropPersons.size || renamed.size) next.founders = (g.founders ?? []).map((p, i) => (renamed.has(i) ? { ...p, name: renamed.get(i)! } : p)).filter((_, i) => !dropPersons.has(i));
    const listed = new Set(next.reviewed_fields ?? []);
    for (const v of mine) listed.add(v.field === "founder" ? "founders" : v.field);
    next.reviewed_fields = [...listed];
    return next;
  });
  return { companies: out, unknown, wrongApplied };
}
