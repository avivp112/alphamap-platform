// Pure helpers for the admin company-review queue (/admin/review). No
// Supabase import here, so vitest can run them in plain Node — the data calls
// live in ./supabase.ts.
//
// A candidate is a company the sourcing engine proposes from a government
// filing (company_candidates, migration 20261016000000). It becomes a
// startups row only when an admin approves it.

export type CandidateSource = "sec_form_d" | "uk_companies_house" | "epo_ops";
export type CandidateStatus = "pending" | "approved" | "rejected";
export type CandidateTier = "queue" | "alert";

export interface CandidateOfficer {
  name?: string;
  relationships?: string[];
}

export interface CandidateEvidence {
  form_type?: string;
  jurisdiction?: string;
  industry_group?: string;
  codes?: string[];
  officers?: CandidateOfficer[];
  summary?: string;
  total_offering?: number;
  total_sold?: number;
  title?: string;
  abstract?: string;
  filing_date?: string;
}

export interface CompanyCandidate {
  id: string;
  source: CandidateSource | string;
  candidate_key: string;
  name: string;
  country: string | null;
  founded_year: number | null;
  cik: string | null;
  entity_number: string | null;
  website: string | null;
  gate_tier: CandidateTier;
  status: CandidateStatus;
  evidence: CandidateEvidence;
  filings_count: number;
  first_seen_at: string;
  last_seen_at: string;
  startup_id: string | null;
  reviewed_at: string | null;
  review_note: string | null;
}

export const SOURCE_LABEL: Record<string, string> = {
  sec_form_d: "SEC Form D",
  uk_companies_house: "UK Companies House",
  epo_ops: "EPO patents",
};

/** The official record, so the reviewer can check the source itself. */
export function registryUrl(c: Pick<CompanyCandidate, "source" | "cik" | "entity_number" | "name">): string | null {
  switch (c.source) {
    case "sec_form_d":
      return c.cik ? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(c.cik)}&type=D` : null;
    case "uk_companies_house":
      return c.entity_number
        ? `https://find-and-update.company-information.service.gov.uk/company/${encodeURIComponent(c.entity_number)}`
        : null;
    case "epo_ops":
      return `https://worldwide.espacenet.com/patent/search?q=${encodeURIComponent(`pa="${c.name}"`)}`;
    default:
      return null;
  }
}

/** "$2.5M", "$260K", "$950" — Form D amounts are whole dollars. */
export function formatUsd(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  if (n >= 1_000_000_000) return `$${+(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${+(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

/** "Jane Doe (director), John Roe (director)" — at most `max` names, then "+N". */
export function formatPeople(officers: CandidateOfficer[] | undefined, max = 4): string | null {
  const people = (officers ?? []).filter((o) => o?.name && o.name.trim());
  if (people.length === 0) return null;
  const shown = people.slice(0, max).map((o) => {
    const role = (o.relationships ?? []).filter(Boolean).join(", ");
    return role ? `${o.name!.trim()} (${role.toLowerCase()})` : o.name!.trim();
  });
  return people.length > max ? `${shown.join(", ")} +${people.length - max}` : shown.join(", ");
}

export interface EvidenceLine {
  label: string;
  value: string;
}

/** What the reviewer needs to decide, in the order that matters for each source. */
export function evidenceLines(c: Pick<CompanyCandidate, "source" | "evidence" | "country" | "founded_year">): EvidenceLine[] {
  const e = c.evidence ?? {};
  const lines: EvidenceLine[] = [];
  const add = (label: string, value: string | null | undefined) => {
    if (value && value.trim()) lines.push({ label, value: value.trim() });
  };
  const people = c.source === "epo_ops" ? "Inventors" : c.source === "sec_form_d" ? "Related people" : "Directors";

  if (c.source === "sec_form_d") {
    add("Industry", e.industry_group);
    const raising = formatUsd(e.total_offering);
    const sold = formatUsd(e.total_sold);
    add("Raising", raising && sold ? `${raising} (sold ${sold})` : raising ?? sold);
  }
  if (c.source === "epo_ops") {
    add("Patent", e.title);
    add("Abstract", e.abstract && e.abstract.length > 400 ? `${e.abstract.slice(0, 400).trimEnd()}…` : e.abstract);
  }
  add(c.source === "uk_companies_house" ? "SIC codes" : c.source === "epo_ops" ? "CPC codes" : "Codes",
    e.codes && e.codes.length ? e.codes.slice(0, 8).join(" ") + (e.codes.length > 8 ? " …" : "") : null);
  add(people, formatPeople(e.officers));
  add("Company type", c.source === "uk_companies_house" ? e.form_type : null);
  add("Jurisdiction", e.jurisdiction);
  add("Founded", c.founded_year ? String(c.founded_year) : null);
  add("Country", c.country);
  add("Filed", e.filing_date);
  return lines;
}
