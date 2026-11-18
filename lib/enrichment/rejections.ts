/**
 * lib/enrichment/rejections.ts — what the rules turned away (owner, batch 7: "the rules reject correct values"). Every "🚫 … not written" line of a company's log becomes a row with a reason code,
 * the value, the source and the evidence the line carries; a sample of 30, stratified by reason code, goes to the owner to mark "the rejection is right / wrong".
 * A rule whose rejections are wrong more than 20% of the time is widened, with an acceptance check (rejectionStats reads the marked sample).
 */

export interface Rejection {
  company_id: string; company: string; field: string; value: string; reason_code: string; reason: string; source_url: string; evidence: string;
}

/** Ordered: the first that matches the reason text names the code. */
const CODES: Array<[string, RegExp]> = [
  ["source_not_allowed", /its source is not on the allowed list/i],
  ["no_allowed_source", /\bno allowed source\b/i],
  ["sentence_not_about_company", /its sentence is not about/i],
  ["title_at_another_company", /is at another company/i],
  ["role_not_next_to_name", /no source states the role next to the name/i],
  ["role_not_on_closed_list", /not on the closed list of leadership roles|is a past role/i],
  ["role_no_allowed_source", /no allowed source gives the title/i],
  ["legal_page_hq_kept_as_office", /comes from a legal page/i],
  ["news_same_event", /the same event as another item/i],
  ["news_no_date", /no date in its address or its page/i],
  ["news_own_site_page", /a page of the company's own site outside its news/i],
  ["news_guide_or_roundup", /a guide, a roundup or an explainer/i],
  ["news_headline_cut", /headline is cut off/i],
  ["news_same_name_other_company", /about another company of the same name/i],
  ["entity_other_company", /another company's/i],
  ["peer_not_a_company_with_a_site", /peer_not_a_company_with_a_site/i],
  ["peer_not_comparable", /peer_not_comparable/i],
  ["description_no_source_on_file", /no source on file for/i],
  ["round_without_quote", /no quote stands behind its amount/i],
  ["round_event_not_stated", /round_event_not_stated/i],
  ["round_without_substance", /round_without_substance/i],
  ["round_without_amount", /round_without_amount/i],
  ["round_amount_ambiguous", /round_amount_ambiguous/i],
  ["advisor_not_kept", /an advisor/i],
  ["description_sentence_dropped", /description sentence dropped/i],
];

const FIELD_OF: Array<[RegExp, string]> = [
  [/^news\b/i, "news"], [/^founded_year\b/i, "founded_year"], [/^founding_country\b/i, "founding_country"], [/^city\b/i, "hq_city"], [/^country\b/i, "hq_country"],
  [/^employee_range\b/i, "employee_range"], [/^employee_count\b/i, "employee_count"], [/^founder\b/i, "founder"], [/^leader\b/i, "leader"], [/^market peer\b/i, "competitor_market"],
  [/^description\b/i, "description"], [/^sector\b/i, "sector"], [/^background of\b/i, "founder_background"],
];

/** The rows of one company's log lines. */
export function parseRejections(lines: string[], company: string, companyId: string): Rejection[] {
  const out: Rejection[] = [];
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, " ").trim();
    const at = line.indexOf("🚫");
    if (at < 0) continue;
    const body = line.slice(at + "🚫".length).trim();
    if (/^REJECTED\b/.test(body) || /^The website \(/.test(body)) continue;           // a company-level turn-away, listed in not_enriched.csv
    const sentence = body.match(/^description sentence dropped \(([^)]*)\):\s*"([^"]*)"/);
    if (sentence) { out.push({ company_id: companyId, company, field: "description", value: sentence[2], reason_code: `description_sentence_${sentence[1]}`, reason: sentence[1], source_url: "", evidence: sentence[2] }); continue; }
    const m = body.match(/^(.*?)\s+not written(?:\s+as the headquarters)?\s*(?:—|\(|-)\s*(.*)$/);
    if (!m) continue;
    const what = m[1].trim(), reason = m[2].replace(/\)\s*$/, "").trim();
    const field = FIELD_OF.find(([re]) => re.test(what))?.[1] ?? (/\$[\d.]+[KMB]|\b(?:Seed|Series [A-Z]|Pre-Seed|Grant|Debt|Growth|Bridge|Convertible|Unknown|Other|Acquired|PE Buyout|IPO|Secondary)\b/i.test(what) ? "round" : "other");
    const code = CODES.find(([, re]) => re.test(body))?.[0] ?? `other_${field}`;
    const url = (body.match(/https?:\/\/[^\s)"]+/) ?? [])[0] ?? "";
    const quote = (reason.match(/:\s*"([^"]{8,300})"/) ?? reason.match(/"([^"]{20,300})"/) ?? [])[1] ?? "";
    const value = what.replace(/^(?:news|founded_year|founding_country|city|country|employee_range|employee_count|founder|leader|market peer|description|sector)\s*/i, "").replace(/^"|"$/g, "");
    out.push({ company_id: companyId, company, field, value: value || what, reason_code: code, reason: reason.slice(0, 260), source_url: url, evidence: quote });
  }
  return out;
}

/** `total` rows, stratified by reason code: each code gets an equal share, a code with fewer rows gives the rest to the others; a fixed seed picks the same rows every time. */
export function sampleRejections(rows: Rejection[], total = 30, seed = 30): Rejection[] {
  let s = seed;
  const rnd = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  const by = new Map<string, Rejection[]>();
  for (const r of rows) (by.get(r.reason_code) ?? by.set(r.reason_code, []).get(r.reason_code)!).push(r);
  const pools = [...by.entries()].sort((a, b) => b[1].length - a[1].length).map(([code, list]) => [code, [...list].sort(() => rnd() - 0.5)] as const);
  const picked: Rejection[] = [];
  while (picked.length < total && pools.some(([, l]) => l.length)) {
    for (const [, l] of pools) { if (picked.length >= total) break; const x = l.shift(); if (x) picked.push(x); }
  }
  return picked.sort((a, b) => a.reason_code.localeCompare(b.reason_code) || a.company.localeCompare(b.company));
}

const cell = (v: string | number) => { const x = String(v); return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
export function rejectionsCsv(rows: Rejection[], withVerdict: boolean): string {
  const head = ["n", "company", "field", "value", "reason_code", "reason", "source_url", "evidence (quote)", ...(withVerdict ? ["verdict (right/wrong)"] : [])];
  return "﻿" + [head.join(","), ...rows.map((r, i) => [i + 1, r.company, r.field, r.value.slice(0, 160), r.reason_code, r.reason, r.source_url, r.evidence, ...(withVerdict ? [""] : [])].map(cell).join(","))].join("\r\n") + "\r\n";
}

/** The marked sample: per reason code, how many rejections were wrong; a code over the limit is to be widened. */
export function rejectionStats(verdicts: Array<{ reason_code: string; verdict: string }>, limit = 0.2): Array<{ reason_code: string; marked: number; wrong: number; share: number; widen: boolean }> {
  const by = new Map<string, { marked: number; wrong: number }>();
  for (const v of verdicts) {
    const t = v.verdict.trim().toLowerCase();
    if (!t) continue;
    const e = by.get(v.reason_code) ?? by.set(v.reason_code, { marked: 0, wrong: 0 }).get(v.reason_code)!;
    e.marked++; if (/^(wrong|w|שגוי|שגויה)/.test(t)) e.wrong++;
  }
  return [...by.entries()].map(([reason_code, e]) => ({ reason_code, ...e, share: e.wrong / e.marked, widen: e.wrong / e.marked > limit })).sort((a, b) => b.share - a.share);
}
