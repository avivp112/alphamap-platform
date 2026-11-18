/**
 * lib/enrichment/acceptance.ts — automatic acceptance checks of a batch report (owner, round 10): every fix the owner asked for is a line of eval/acceptance_batch5.json with its
 * expected result, and the report is not sent until every line says PASS. Reads the report rows (pilot_report_dry.csv) and the list of companies not enriched.
 */
import { quoteIsNotASentence } from "./evidence.ts";
import { roleRegex } from "./people.ts";
import { rowProblem, roundKey, cleanCompetitorName } from "./rowRules.ts";
import { isAddressLine } from "./headquarters.ts";

export interface Row { company: string; field: string; after: string; source_url: string; quote: string; origin?: string }
export type Severity = "error" | "gap";
export type Check = (
  | { id: string; why: string; kind: "absent"; company?: string; field?: string; match?: string; quote_match?: string; source_match?: string }
  | { id: string; why: string; kind: "present"; company: string; field: string; match: string }
  | { id: string; why: string; kind: "max_count"; company: string; field: string; match: string; max: number }
  | { id: string; why: string; kind: "not_enriched"; company: string }
  | { id: string; why: string; kind: "no_duplicates"; field: string }
  | { id: string; why: string; kind: "no_url_quote" }
  | { id: string; why: string; kind: "present_quote"; company: string; field: string; match: string }
  | { id: string; why: string; kind: "single_value"; fields: string[] }
  | { id: string; why: string; kind: "round_type_in_quote" }
  | { id: string; why: string; kind: "no_non_sentence_quotes" }
  | { id: string; why: string; kind: "leader_role_in_quote" }
  | { id: string; why: string; kind: "memory_rows_pass_rules" }
  | { id: string; why: string; kind: "hq_quote_valid" }
) & { severity?: Severity }
  | { id: string; why: string; kind: "news_dates_before_run" }
  | { id: string; why: string; kind: "tags_include"; company: string; include: string; not_only?: string }
/** `offenders`: the report rows that broke the check — what a wet run does not write when the check is an ERROR (owner, batch 6). field "*" = the whole company. */
export interface Result { id: string; why: string; pass: boolean; detail: string; severity: "error" | "gap"; offenders?: Row[] }

export function parseCsv(text: string): string[][] {
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

export function rowsFromCsv(text: string): Row[] {
  const [head, ...body] = parseCsv(text);
  const ix = (n: string) => head.indexOf(n);
  return body.map((r) => ({ company: r[ix("company")] ?? "", field: r[ix("field")] ?? "", after: r[ix("after")] ?? "", source_url: r[ix("source_url")] ?? "", quote: r[ix("quote")] ?? "", origin: ix("origin") >= 0 ? r[ix("origin")] ?? "" : "" })).filter((r) => r.company && r.field && r.field !== "(nothing)");
}

const fold = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, "");
const same = (a: string, b: string) => fold(a) === fold(b);
const re = (s: string) => new RegExp(s, "iu");

export function runAcceptance(checks: Check[], rows: Row[], notEnriched: string[], today: string): Result[] {
  const of = (c: { company?: string; field?: string }) => rows.filter((r) => (!c.company || same(r.company, c.company)) && (!c.field || r.field === c.field));
  return checks.map((c): Result => {
    const base = { id: c.id, why: c.why, severity: (c.severity ?? "error") as Severity };
    switch (c.kind) {
      case "absent": {
        const hits = of(c).filter((r) => (!c.match || re(c.match).test(r.after)) && (!c.quote_match || re(c.quote_match).test(r.quote)) && (!c.source_match || re(c.source_match).test(r.source_url)));
        return { ...base, pass: hits.length === 0, detail: hits.length ? `found: ${hits.slice(0, 2).map((r) => `${r.company} ${r.field} "${r.after.slice(0, 60)}"`).join(" | ")}` : "none found", offenders: hits };
      }
      case "present": {
        const hits = of(c).filter((r) => re(c.match).test(r.after));
        return { ...base, pass: hits.length > 0, detail: hits.length ? `found: ${hits[0].after.slice(0, 80)}` : `no ${c.field} row of ${c.company} matches /${c.match}/` };
      }
      case "max_count": {
        const n = of(c).filter((r) => re(c.match).test(r.after)).length;
        return { ...base, pass: n <= c.max, detail: `${n} row(s), at most ${c.max}` };
      }
      case "single_value": {
        const per = new Map<string, number>();
        const fam = (f: string) => (f === "description_what_only" ? "description" : f);
        for (const r of rows.filter((x) => c.fields.includes(x.field))) { const k = `${fold(r.company)}|${fam(r.field)}`; per.set(k, (per.get(k) ?? 0) + 1); }
        const bad = [...per].filter(([, n]) => n > 1);
        return { ...base, pass: bad.length === 0, detail: bad.length ? `more than one: ${bad.slice(0, 3).map(([k]) => k).join(" | ")}` : "one value per company" };
      }
      case "round_type_in_quote": {
        // A round's type is written only when its quote names it; a type no quote names is "Unknown" (owner, round 10).
        const NAMED: Array<[string, RegExp]> = [["Pre-Seed", /pre[- ]?seed/i], ["Seed", /\bseed\b/i], ["Series A", /series[- ]a\b/i], ["Series B", /series[- ]b\b/i], ["Series C", /series[- ]c\b/i], ["Series D", /series[- ]d\b/i], ["Series E", /series[- ]e\b/i], ["Series F+", /series[- ][f-z]\b/i], ["Growth", /growth/i], ["Bridge", /bridge/i]];
        const bad = rows.filter((r) => r.field === "round").filter((r) => {
          const t = r.after.match(/^(Pre-Seed|Seed|Series [A-F]\+?|Growth|Bridge|Other)\b/)?.[1];
          if (!t) return false;
          if (t === "Other") return !/strategic|crowd|token|placement|pipe\b|spac\b|revenue.based|corporate/i.test(r.quote);
          return !(NAMED.find(([n]) => n === t)?.[1] ?? /./).test(r.quote);
        });
        return { ...base, pass: bad.length === 0, detail: bad.length ? `type not in its quote: ${bad.slice(0, 3).map((r) => `${r.company} "${r.after.slice(0, 40)}"`).join(" | ")}` : "every named type is in its quote", offenders: bad };
      }
      case "no_non_sentence_quotes": {
        const bad = rows.filter((r) => quoteIsNotASentence(r.quote));
        return { ...base, pass: bad.length === 0, detail: bad.length ? `${bad.length} quote(s) are page code: ${bad.slice(0, 2).map((r) => `${r.company} ${r.field}`).join(" | ")}` : "every quote is a sentence", offenders: bad };
      }
      case "leader_role_in_quote": {
        const bad = rows.filter((r) => r.field === "leader" && r.quote).filter((r) => {
          const role = r.after.split(" — ").slice(1).join(" — ").split(" · ")[0];
          const parts = role.split(/\s*(?:&|,|\/|\band\b)\s*/i).map((x) => x.trim()).filter((x) => x && !/^(?:co-?\s?)?founders?$/i.test(x));
          return parts.length > 0 && !parts.every((p) => roleRegex(p).test(r.quote));
        });
        return { ...base, pass: bad.length === 0, detail: bad.length ? `role not in its quote: ${bad.slice(0, 3).map((r) => `${r.company} ${r.after.slice(0, 40)}`).join(" | ")}` : "every leader's role is in its quote", offenders: bad };
      }
      case "no_duplicates": {
        const seen = new Map<string, number>();
        const dupRows: Row[] = [];
        for (const r of rows.filter((x) => x.field === c.field)) { const k = c.field === "round" ? roundKey(r) : /^competitor/.test(c.field) ? `${fold(r.company)}|${fold(cleanCompetitorName(r.after))}` : `${fold(r.company)}|${r.after.toLowerCase().replace(/\s+/g, " ").replace(/\s*·\s*lead\s+.*$/, "").trim()}`; if (seen.has(k)) dupRows.push(r); seen.set(k, (seen.get(k) ?? 0) + 1); }
        const dup = [...seen].filter(([, n]) => n > 1);
        return { ...base, pass: dup.length === 0, detail: dup.length ? `twice: ${dup.slice(0, 3).map(([k]) => k.slice(0, 60)).join(" | ")}` : "no duplicates", offenders: dupRows };
      }
      case "memory_rows_pass_rules": {
        const bad = rows.filter((r) => /known_source/.test(r.origin ?? "")).map((r) => ({ r, why: rowProblem({ field: r.field, after: r.after, source_url: r.source_url, quote: r.quote }, r.company, today) })).filter((x) => x.why);
        return { ...base, pass: bad.length === 0, detail: bad.length ? `${bad.length} remembered value(s) break today's rules: ${bad.slice(0, 3).map((x) => `${x.r.company} ${x.r.field} "${x.r.after.slice(0, 40)}" (${x.why})`).join(" | ")}` : "every remembered value passes today's rules", offenders: bad.map((x) => x.r) };
      }
      case "hq_quote_valid": {
        const DECL = /headquarter|\bhq\b|head ?office|\bbased\b|-based|\bsede\b|\bsitz\b|siège|matriz|siedzib|مقر|本社|본사|штаб/i;
        const bad = rows.filter((r) => r.field === "hq_city" && r.quote && !isAddressLine(r.quote) && !DECL.test(r.quote));
        return { ...base, pass: bad.length === 0, detail: bad.length ? `${bad.length} headquarters without an address or a declaration: ${bad.slice(0, 3).map((r) => `${r.company} "${r.after}" ← "${r.quote.slice(0, 60)}"`).join(" | ")}` : "every headquarters rests on an address or a declaration", offenders: bad };
      }
      case "no_url_quote": {
        const bad = rows.filter((r) => { const t = r.quote.trim(); return !!t && (/^https?:\/\//i.test(t) || (!/\s/.test(t) && /[a-z0-9]+(?:-[a-z0-9]+){3,}/i.test(t))); });
        return { ...base, pass: bad.length === 0, detail: bad.length ? `${bad.length} quote(s) are addresses: ${bad.slice(0, 2).map((r) => `${r.company} ${r.field}`).join(" | ")}` : "no quote is an address", offenders: bad };
      }
      case "present_quote": {
        const hits = of(c).filter((r) => re(c.match).test(r.quote));
        return { ...base, pass: hits.length > 0, detail: hits.length ? `quote: ${hits[0].quote.slice(0, 80)}` : `no ${c.field} row of ${c.company} has a quote matching /${c.match}/` };
      }
      case "not_enriched": {
        const listed = notEnriched.some((x) => same(x, c.company)), has = rows.some((r) => same(r.company, c.company));
        return { ...base, pass: listed || !has, detail: listed ? "listed as not enriched" : has ? "has values in the report" : "no values", offenders: listed || !has ? [] : rows.filter((r) => same(r.company, c.company)).map((r) => ({ ...r, field: "*" })) };
      }
      case "news_dates_before_run": {
        const bad = rows.filter((r) => r.field === "news" && /^\d{4}-\d{2}-\d{2}/.test(r.after) && r.after.slice(0, 10) >= today);
        return { ...base, pass: bad.length === 0, detail: bad.length ? `dated ${today} or later: ${bad.slice(0, 2).map((r) => `${r.company} ${r.after.slice(0, 50)}`).join(" | ")}` : `no news dated ${today} or later`, offenders: bad };
      }
      case "tags_include": {
        const tags = of({ company: c.company, field: "tags" }).flatMap((r) => r.after.split(/\s*,\s*/));
        const ok = tags.some((t) => fold(t) === fold(c.include)) && !(c.not_only && tags.length === 1 && fold(tags[0]) === fold(c.not_only));
        return { ...base, pass: ok, detail: `tags: ${tags.join(", ") || "none"}` };
      }
    }
  });
}

export function renderAcceptance(results: Result[]): string {
  const errors = results.filter((r) => !r.pass && r.severity === "error");
  const gaps = results.filter((r) => !r.pass && r.severity === "gap");
  return [...results.map((r) => `  ${r.pass ? "PASS" : r.severity === "gap" ? "GAP " : "FAIL"}  ${r.id} — ${r.why}${r.pass ? "" : `\n        ${r.detail}`}`),
    "", errors.length ? `ACCEPTANCE: ${errors.length} ERROR${gaps.length ? `, ${gaps.length} gap(s) recorded` : ""} of ${results.length} — a wrong value: this report is NOT to be sent.`
      : `ACCEPTANCE: no error${gaps.length ? ` — ${gaps.length} gap(s) recorded (a value that is missing, not a wrong one): ${gaps.map((g) => g.id).join(", ")}` : `: all ${results.length} PASS`}.`].join("\n");
}
