// Pure helpers for the investor CRM in My Area (crm_companies, crm_deal_terms,
// crm_documents — migration 20261024000000). Private to the user by RLS.
// No Supabase import, so vitest runs these in Node; the data calls live in
// ./supabase.ts.

import type { CheckStatus } from "./companyCheck";

export const CRM_STAGES = ["watching", "reviewing", "diligence", "term_sheet", "invested", "passed"] as const;
export type CrmStage = (typeof CRM_STAGES)[number];

export const DEAL_INSTRUMENTS = ["safe", "equity", "convertible_note", "other"] as const;
export type DealInstrument = (typeof DEAL_INSTRUMENTS)[number];
export type ValuationKind = "pre" | "post" | "cap";

export interface CrmCompany {
  id: string;
  startup_id: string | null;
  check_id: string | null;
  name: string;
  website: string | null;
  stage: CrmStage;
  notes: string | null;
  tags: string[];
  next_step: string | null;
  next_step_date: string | null;
  created_at: string;
  updated_at: string;
  /** Embedded: the AlphaMap company, when linked. */
  startup?: { id: string; name: string; website: string | null; country: string | null } | null;
  /** Embedded: the user's check, when the company came from one. */
  check?: { id: string; status: CheckStatus; phase: "identify" | "check" } | null;
}

export interface DealTerm {
  id: string;
  crm_company_id: string;
  instrument: DealInstrument;
  round_label: string | null;
  amount: number | null;
  valuation: number | null;
  valuation_kind: ValuationKind | null;
  invested_on: string | null;
  ownership_pct: number | null;
  notes: string | null;
  created_at: string;
}

export interface CrmDocument {
  id: string;
  crm_company_id: string;
  file_name: string;
  storage_path: string;
  size_bytes: number | null;
  mime_type: string | null;
  created_at: string;
}

/** Same limit as the crm-documents bucket. */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

export function stageCounts(rows: Pick<CrmCompany, "stage">[]): Record<CrmStage | "all", number> {
  const out = { all: rows.length } as Record<CrmStage | "all", number>;
  for (const s of CRM_STAGES) out[s] = 0;
  for (const r of rows) out[r.stage] = (out[r.stage] ?? 0) + 1;
  return out;
}

/** Overdue next steps first, then by date, then the most recently touched. */
export function sortCrm<T extends Pick<CrmCompany, "next_step_date" | "updated_at">>(rows: T[], today: string): T[] {
  const key = (r: T) => (r.next_step_date ? (r.next_step_date < today ? 0 : 1) : 2);
  return [...rows].sort((a, b) =>
    key(a) - key(b)
    || (a.next_step_date ?? "").localeCompare(b.next_step_date ?? "")
    || b.updated_at.localeCompare(a.updated_at));
}

export const isOverdue = (date: string | null, today: string): boolean => !!date && date < today;

/** "  AI ,fintech,AI " -> ["AI", "fintech"]: trimmed, de-duplicated case-insensitively, at most 30. */
export function normalizeTags(raw: string[] | string): string[] {
  const list = Array.isArray(raw) ? raw : raw.split(",");
  const out: string[] = [];
  for (const t of list) {
    const tag = t.replace(/\s+/g, " ").trim().slice(0, 40);
    if (tag && !out.some((o) => o.toLowerCase() === tag.toLowerCase())) out.push(tag);
  }
  return out.slice(0, 30);
}

/** Total the user put in across their deal terms (only amounts they entered). */
export function totalInvested(terms: Pick<DealTerm, "amount">[]): number | null {
  const amounts = terms.map((t) => t.amount).filter((a): a is number => a != null);
  return amounts.length ? amounts.reduce((s, a) => s + a, 0) : null;
}

/** <user id>/<crm company id>/<timestamp>-<safe file name> — the folder the Storage policy allows. */
export function documentPath(userId: string, crmCompanyId: string, fileName: string, now = Date.now()): string {
  const safe = fileName.normalize("NFKD").replace(/[^\w.\-]+/g, "_").replace(/_+/g, "_").replace(/^[_.]+/, "").slice(-120) || "file";
  return `${userId}/${crmCompanyId}/${now}-${safe}`;
}

export function documentProblem(file: { size: number; name: string }): "too_large" | "empty" | null {
  if (file.size === 0) return "empty";
  if (file.size > MAX_DOCUMENT_BYTES) return "too_large";
  return null;
}

export function fmtBytes(n: number | null | undefined): string {
  if (n == null) return "";
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

/** A number typed in a form: "1,500,000", "1.5m", "250k" -> 1500000 / 250000; "" -> null; junk -> NaN. */
export function parseMoney(input: string): number | null {
  const s = input.replace(/[$,\s]/g, "").toLowerCase();
  if (!s) return null;
  const m = /^(\d+(?:\.\d+)?)([kmb])?$/.exec(s);
  if (!m) return Number.NaN;
  const mult = m[2] === "k" ? 1e3 : m[2] === "m" ? 1e6 : m[2] === "b" ? 1e9 : 1;
  return Math.round(Number(m[1]) * mult);
}
