/**
 * lib/enrichment/knownGaps.ts — what was searched and not found, and what was found and refused (owner, round 10).
 * The memory of verified sources (knownSources.ts) keeps values; this keeps, per company and missing field, which searches ran, which candidates came up
 * and why each was refused, so a later, targeted search does not repeat what was tried. The reasons are the pipeline's own log lines for the company.
 * Values the owner marked wrong are removed from the memory and recorded here as refused ("marked wrong by the owner").
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import type { KnownStore } from "./knownSources.ts";

export interface GapEntry { field: string; searched: string[]; rejected_candidates: string[]; last_run: string; run_id: string }
export interface CompanyGaps { company: string; fields: Record<string, GapEntry> }
export type GapStore = Record<string, CompanyGaps>;
export const GAPS_PATH = process.env.KNOWN_GAPS ?? "cache/known_gaps.json";

export const loadGaps = (path = GAPS_PATH): GapStore => { try { return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as GapStore : {}; } catch { return {}; } };
export function saveGaps(g: GapStore, path = GAPS_PATH): void { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(g, null, 1)); }

/** The log lines that speak about a field. */
const TOPIC: Array<[RegExp, RegExp]> = [
  [/^hq_|^office/, /headquarter|\bhq\b|🏢|office|address|based in/i],
  [/^founded|^founding/, /founded|founding|incorporat|register/i],
  [/^founder/, /founder|founded by/i],
  [/^leader/, /leader|title|advisor|board/i],
  [/^description/, /description|sentence dropped|📝/i],
  [/^sector/, /sector|🧭/i],
  [/^tags/, /\btag\b|🏷️\s+Tag/i],
  [/^round/, /round|funding|raised|acquisition/i],
  [/^news/, /news|article|headline/i],
  [/^employee/, /headcount|employee|staff/i],
  [/^competitor/, /competitor/i],
  [/^patent/, /patent/i],
];
const REFUSAL = /🚫|dropped|not written|refused|rejected|❔|not kept|no allowed source|not on the allowed|no source/i;

export function gapFor(field: string, lines: string[]): { searched: string[]; rejected: string[] } {
  const topic = TOPIC.find(([f]) => f.test(field))?.[1];
  const searched = lines.filter((l) => /Fixed searches|Deep dive|targeted search|🔎/.test(l)).map((l) => l.trim().slice(0, 200)).slice(0, 4);
  const rejected = topic ? [...new Set(lines.filter((l) => REFUSAL.test(l) && topic.test(l)).map((l) => l.trim().slice(0, 260)))].slice(0, 6) : [];
  return { searched, rejected };
}

export function recordGaps(g: GapStore, companyId: string, company: string, missing: string[], lines: string[], runId: string, today: string): void {
  const c = g[companyId] ?? (g[companyId] = { company, fields: {} });
  c.company = company;
  const keep = new Set(missing);
  for (const f of Object.keys(c.fields)) if (!keep.has(f) && !c.fields[f].rejected_candidates.some((x) => x.startsWith("marked wrong by the owner"))) delete c.fields[f];   // found since
  for (const f of missing) {
    const { searched, rejected } = gapFor(f, lines);
    const old = c.fields[f];
    const owner = (old?.rejected_candidates ?? []).filter((x) => x.startsWith("marked wrong by the owner"));
    c.fields[f] = { field: f, searched, rejected_candidates: [...new Set([...owner, ...rejected])].slice(0, 10), last_run: today, run_id: runId };
  }
}

/** Removes from the memory what the owner marked wrong, and keeps the refusal. Returns what was removed. */
export function purgeWrong(store: KnownStore, g: GapStore, wrong: (company: string, field: string, value: string) => boolean, today: string): string[] {
  const removed: string[] = [];
  for (const [id, list] of Object.entries(store)) {
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      if (!wrong(e.company, e.field, e.value)) continue;
      list.splice(i, 1);
      const c = g[id] ?? (g[id] = { company: e.company, fields: {} });
      const f = c.fields[e.field] ?? (c.fields[e.field] = { field: e.field, searched: [], rejected_candidates: [], last_run: today, run_id: "owner mark" });
      f.rejected_candidates.push(`marked wrong by the owner: ${e.value.slice(0, 80)} (${e.source_url})`);
      removed.push(`${e.company}: ${e.field} = ${e.value.slice(0, 50)}`);
    }
  }
  return removed;
}

/** The values the owner marked wrong (kept in the gaps), as keys for markKey(company, field, value): a rebuilt or re-seeded memory must not take them back. */
export function ownerWrongKeys(g: GapStore, keyOf: (company: string, field: string, value: string) => string): Set<string> {
  const out = new Set<string>();
  for (const c of Object.values(g)) for (const f of Object.values(c.fields)) for (const r of f.rejected_candidates) {
    const m = r.match(/^marked wrong by the owner: ([\s\S]*) \(https?:[^)]*\)$/);
    if (m) out.add(keyOf(c.company, f.field, m[1]));
  }
  return out;
}

export interface MissingRow { field: string; company: string; reason: string; searched: string; rejected: string }
/** One row per missing field and company, with the commonest reason: no source found / found and refused (why) / the site was not read. */
export function missingRows(g: GapStore, companyIds: string[], unreadable: Set<string>): MissingRow[] {
  const out: MissingRow[] = [];
  for (const id of companyIds) {
    const c = g[id]; if (!c) continue;
    for (const f of Object.values(c.fields)) {
      const owner = f.rejected_candidates.find((x) => x.startsWith("marked wrong by the owner"));
      const reason = unreadable.has(c.company) ? "site not read" : f.rejected_candidates.length ? `found and refused: ${(owner ?? f.rejected_candidates[0]).replace(/^\s*[^\p{L}\p{N}]+/u, "").slice(0, 120)}` : "no source found";
      out.push({ field: f.field, company: c.company, reason, searched: f.searched.join(" | ").slice(0, 200), rejected: f.rejected_candidates.join(" | ").slice(0, 400) });
    }
  }
  return out.sort((a, b) => a.field.localeCompare(b.field) || a.company.localeCompare(b.company));
}
export function missingCsv(rows: MissingRow[]): string {
  const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return "﻿" + [["field", "company", "reason", "searched", "rejected_candidates"].join(","), ...rows.map((r) => [r.field, r.company, r.reason, r.searched, r.rejected].map(q).join(","))].join("\r\n") + "\r\n";
}
