/**
 * eval/wrongValues.ts — every value the evaluation counted wrong, with what v2 wrote, what the golden
 * set says, and where v2 got it (owner, 2026-11-05). Pure: the same rules as eval/score.ts.
 */
import { newScoreboard, scoreCompany, roundBreakdown, wrongPatents, normalize, type GoldenCompany, type PipelineOutput } from "./score.ts";

export interface WrongValue { company: string; field: string; v2: string; golden: string; source_url: string; quote: string }

const usd = (n: number | null | undefined) => (n == null ? "?" : n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : `$${(n / 1e6).toFixed(1)}M`);
const roundText = (r: { round_type?: string; type?: string; amount_raised?: number | null; amount_usd?: number | null; date: string | null; lead_investor?: string | null }) =>
  `${r.round_type ?? r.type} ${usd(r.amount_raised ?? r.amount_usd)} ${r.date ?? "(no date)"}${r.lead_investor ? ` led by ${r.lead_investor}` : ""}`;

export function wrongValues(g: GoldenCompany, out: PipelineOutput): WrongValue[] {
  const rows: WrongValue[] = [];
  const fields = scoreCompany(newScoreboard(), g, out);
  for (const f of ["city", "country", "founding_country", "founded_year"] as const) {
    if (fields[f] !== "wrong") continue;
    const gv = g[f];
    const src = out.scalar_sources?.[f];
    rows.push({
      company: g.name, field: f, v2: String(out[f] ?? ""),
      golden: [gv?.value, ...(gv?.alternatives ?? [])].filter((x) => x != null).join(" | "),
      source_url: src?.source_url ?? "", quote: src ? src.quote ?? "" : "(not stored in this run — re-run this company with ONLY=)",
    });
  }
  if (fields.funding_rounds === "wrong" || (g.judged_only && roundBreakdown(g, out.rounds).wrongIdx.length)) {
    const { wrongIdx, verified } = roundBreakdown(g, out.rounds);
    for (const i of wrongIdx) {
      const r = out.rounds[i];
      rows.push({ company: g.name, field: "funding_round", v2: roundText(r), golden: verified.map(roundText).join(" ; ") || "(none)", source_url: r.source_url ?? "", quote: "(rounds carry no quote — open the source)" });
    }
  }
  if (fields.round_type === "wrong") {
    const { pairs } = roundBreakdown(g, out.rounds);
    for (const [gr, i] of pairs) {
      const t = out.rounds[i].round_type;
      if (t && normalize(t) !== normalize(gr.type)) rows.push({ company: g.name, field: "round_type", v2: roundText(out.rounds[i]), golden: roundText(gr), source_url: out.rounds[i].source_url ?? "", quote: "" });
    }
  }
  // Patents: a number the register gave that the owner did not mark as the company's (eval/review/patents_review.csv).
  for (const n of wrongPatents(g, out.patents)) {
    rows.push({ company: g.name, field: "patent", v2: n, golden: `not one of the ${g.patents?.numbers.length ?? 0} number(s) marked the company's${g.patents?.not_numbers?.includes(n) ? " — marked not the company's" : ""}`, source_url: `https://worldwide.espacenet.com/patent/search?q=pn%3D${encodeURIComponent(n)}`, quote: "(the register's own record — open Espacenet for its applicants)" });
  }
  return rows;
}

const cell = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
export function wrongValuesCsv(rows: WrongValue[]): string {
  const cols = ["company", "field", "v2", "golden", "source_url", "quote"] as const;
  return "﻿" + [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\r\n") + "\r\n";
}

export function wrongValuesText(rows: WrongValue[]): string {
  if (!rows.length) return "No value was counted wrong.";
  return rows.map((r, i) => `${String(i + 1).padStart(2)}. ${r.company} — ${r.field}\n    v2:     ${r.v2}\n    golden: ${r.golden}\n    source: ${r.source_url || "(none)"}\n    quote:  ${r.quote || "(none)"}`).join("\n");
}
