/**
 * lib/enrichment/rejectedDomains.ts — the sources turned away because their domain is not on the allowed list (owner, 2026-11-14): search results
 * change between runs, so every run writes rejected_domains.csv (domain, count, field, an example headline, an example address) for the owner
 * to place the frequent ones (tier 2/3/4 or blocked) in one pass. Only "not on the allowed list" rejections.
 */
import { registrable } from "./addCompanies.ts";
import { roundSourceStanding } from "./roundSources.ts";

export interface RejectedDomainRow { domain: string; count: number; field: string; example_title: string; example_url: string; standing: string }

export const domainOf = (url: string): string | null => {
  try { return registrable(new URL(url).hostname.toLowerCase().replace(/^www\./, "")); } catch { return null; }
};

/** What a "not written" line names: the field (first word) and, for news, its headline. */
export function describeRejected(what: string): { field: string; title: string } {
  const news = what.match(/^news\s+"(.*)"\s*$/);
  if (news) return { field: "news", title: news[1] };
  return { field: what.trim().split(/[\s"]/)[0] || "unknown", title: what.trim() };
}

export class RejectedDomains {
  private rows = new Map<string, RejectedDomainRow>();
  note(field: string, url: string | null | undefined, title = ""): void {
    const domain = url ? domainOf(url) : null;
    if (!domain || !url) return;
    const k = `${domain}|${field}`;
    const have = this.rows.get(k);
    if (have) { have.count++; return; }
    this.rows.set(k, { domain, count: 1, field, example_title: title.slice(0, 140), example_url: url, standing: roundSourceStanding(url).kind });
  }
  rows_(): RejectedDomainRow[] { return [...this.rows.values()].sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain)); }
  get size(): number { return this.rows.size; }
  clear(): void { this.rows.clear(); }
}

/** The run's own registry; collect.ts notes into it, the run scripts write it out. */
export const rejectedDomains = new RejectedDomains();

const cell = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function rejectedDomainsCsv(rows: RejectedDomainRow[]): string {
  return "﻿" + ["domain,count,field,example_title,example_url,standing", ...rows.map((r) => [r.domain, r.count, r.field, r.example_title, r.example_url, r.standing].map(cell).join(","))].join("\r\n") + "\r\n";
}

/** The same rows from a run's log: lines "🚫  <what> not written — its source is not on the allowed list: <url>" (the older runs). */
export function rejectedFromLog(text: string): RejectedDomainRow[] {
  const reg = new RejectedDomains();
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/🚫\s+(.*?)\s+not written — its source is not on the allowed list:\s+(https?:\/\/\S+)/);
    if (!m) continue;
    const d = describeRejected(m[1]);
    reg.note(d.field, m[2], d.title);
  }
  return reg.rows_();
}

/** Several logs merged: one row per domain and field, the counts added. */
export function mergeRejected(all: RejectedDomainRow[][]): RejectedDomainRow[] {
  const m = new Map<string, RejectedDomainRow>();
  for (const rows of all) for (const r of rows) {
    const k = `${r.domain}|${r.field}`, have = m.get(k);
    if (have) have.count += r.count; else m.set(k, { ...r });
  }
  return [...m.values()].sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain));
}

/** Per domain over all its fields: the total count, the fields it was turned away for, one example. */
export function topDomains(rows: RejectedDomainRow[], n = 40): Array<{ domain: string; count: number; fields: string; example_title: string; example_url: string; standing: string }> {
  const by = new Map<string, { domain: string; count: number; fields: Set<string>; example_title: string; example_url: string; standing: string }>();
  for (const r of rows) {
    const have = by.get(r.domain);
    if (have) { have.count += r.count; have.fields.add(r.field); } else by.set(r.domain, { domain: r.domain, count: r.count, fields: new Set([r.field]), example_title: r.example_title, example_url: r.example_url, standing: r.standing });
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain)).slice(0, n).map((x) => ({ ...x, fields: [...x.fields].join("+") }));
}
