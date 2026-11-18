// Pure helpers for the admin company-review queue (/admin/review). No
// Supabase import here, so vitest can run them in plain Node — the data calls
// live in ./supabase.ts.
//
// A candidate is a company the sourcing engine proposes from a government
// filing (company_candidates, migration 20261016000000). It becomes a
// startups row only when an admin approves it.

export type CandidateSource = "sec_form_d" | "uk_companies_house" | "epo_ops" | "oss_github" | "hf_org";
export type CandidateStatus = "pending" | "approved" | "rejected";
export type CandidateTier = "queue" | "alert";

export interface CandidateOfficer {
  name?: string;
  relationships?: string[];
  // UK Companies House (register spelling, stored as-is).
  appointed_on?: string;
  nationality?: string;
  country_of_residence?: string;
  /** "YYYY-MM": the register publishes month and year of birth only. */
  born?: string;
  appointments_url?: string;
  // SEC Form D related person.
  address?: string;
}

/** A fact from the registers about the company or its people (supabase/functions/_shared/candidate-signals.ts). */
export interface CandidateSignal {
  kind: string;
  level: "positive" | "info" | "warning";
  text: string;
  /** The page at the source where the fact can be checked. */
  url?: string;
}

export interface CandidatePlacementAgent {
  name?: string;
  crd?: string | null;
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
  // Added after the ingest by merge_candidate_evidence (20261204000000).
  /** UK registered office / SEC issuer's principal place of business, one line. */
  address?: string;
  postal_code?: string;
  care_of?: string;
  company_status?: string;
  date_of_creation?: string;
  phone?: string;
  entity_type?: string;
  revenue_range?: string;
  investors?: number;
  non_accredited?: number;
  min_investment?: number;
  exemptions?: string[];
  placement_agents?: CandidatePlacementAgent[];
  date_of_first_sale?: string;
  // Added by the signals step (stage 2): absent until the candidate has been checked.
  signals?: { checked_at: string; items: CandidateSignal[] };
  // oss_github (migration 20261125000000): a growing GitHub project with a homepage of its own.
  github_url?: string;
  owner?: string;
  owner_type?: string;
  repo?: string;
  description?: string;
  homepage?: string;
  stars?: number;
  stars_7d?: number;
  forks?: number;
  open_issues?: number;
  created?: string;
  age_days?: number;
  /** Stars far above forks and open issues: a flag for the reviewer, never a rejection. */
  suspect_stars?: boolean;
  // hf_org (migration 20261126000000): a Hugging Face organization with a website of its own.
  hf_org?: string;
  hf_url?: string;
  fullname?: string;
  org_type?: string;
  github?: string;
  models?: number;
  first_model?: string;
  downloads?: number;
  downloads_7d?: number;
  likes?: number;
  followers?: number;
  plan?: string;
  num_users?: number;
  verified?: boolean;
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

/** What get_candidate_preview() returns: everything for a live candidate, only id + status once rejected. */
export type CandidatePreview =
  | { id: string; status: "rejected" }
  | (Pick<CompanyCandidate, "id" | "source" | "name" | "country" | "founded_year" | "cik" | "entity_number"
      | "website" | "gate_tier" | "filings_count" | "first_seen_at" | "evidence" | "startup_id">
      & { status: "pending" | "approved"; sector: string | null });

/** Where an approved candidate's alert should go: the company page. */
export function companyPath(startupId: string): string {
  return `/startups?company=${encodeURIComponent(startupId)}`;
}

export const SOURCE_LABEL: Record<string, string> = {
  sec_form_d: "SEC Form D",
  uk_companies_house: "UK Companies House",
  epo_ops: "EPO patents",
  oss_github: "GitHub project",
  hf_org: "Hugging Face org",
};

/** The official record, so the reviewer can check the source itself. */
export function registryUrl(c: Pick<CompanyCandidate, "source" | "cik" | "entity_number" | "name"> & { evidence?: CandidateEvidence }): string | null {
  switch (c.source) {
    case "oss_github":
      return typeof c.evidence?.github_url === "string" && /^https:\/\/github\.com\//.test(c.evidence.github_url) ? c.evidence.github_url : null;
    case "hf_org":
      return typeof c.evidence?.hf_url === "string" && /^https:\/\/huggingface\.co\//.test(c.evidence.hf_url) ? c.evidence.hf_url : null;
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

/**
 * "Jo Bloggs: appointed 2026-07-20, British, lives in United Kingdom, born 1985-03" —
 * only the people for whom the register or the form gave something beyond a name.
 */
export function formatPeopleDetails(officers: CandidateOfficer[] | undefined, max = 4): string | null {
  const rows = (officers ?? [])
    .filter((o) => o?.name && o.name.trim())
    .map((o) => {
      const bits = [
        o.appointed_on ? `appointed ${o.appointed_on}` : null,
        o.nationality ? o.nationality : null,
        o.country_of_residence ? `lives in ${o.country_of_residence}` : null,
        o.born ? `born ${o.born}` : null,
        o.address ? o.address : null,
      ].filter(Boolean);
      return bits.length ? `${o.name!.trim()}: ${bits.join(", ")}` : null;
    })
    .filter((x): x is string => x !== null);
  if (rows.length === 0) return null;
  return rows.length > max ? `${rows.slice(0, max).join("; ")}; +${rows.length - max}` : rows.join("; ");
}

/** The signals of one level, newest facts first as stored, in one reviewer-facing sentence list. */
export function signalTexts(e: CandidateEvidence | undefined, level: CandidateSignal["level"]): string[] {
  return (e?.signals?.items ?? []).filter((i) => i?.level === level && i.text).map((i) => i.text);
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
    add("Revenue", e.revenue_range);
    add("Investors", e.investors != null
      ? `${e.investors} in so far${e.non_accredited ? ` (${e.non_accredited} non-accredited)` : ""}`
      : null);
    add("Min. investment", formatUsd(e.min_investment));
    add("Exemption", e.exemptions && e.exemptions.length ? e.exemptions.join(", ") : null);
    add("Placement agents", e.placement_agents && e.placement_agents.length
      ? e.placement_agents.filter((a) => a?.name).map((a) => a.crd && /^\d+$/.test(a.crd) ? `${a.name} (CRD ${a.crd})` : a.name).join(", ")
      : null);
    add("First sale", e.date_of_first_sale);
    add("Entity type", e.entity_type);
  }
  if (c.source === "oss_github") {
    add("Project", e.owner && e.repo ? `${e.owner}/${e.repo}${e.owner_type ? ` (${e.owner_type.toLowerCase()})` : ""}` : null);
    const total = e.stars != null ? `${e.stars.toLocaleString("en-US")} stars` : null;
    add("Growth", e.stars_7d != null ? `+${e.stars_7d.toLocaleString("en-US")} stars in 7 days${total ? ` (${total} in all)` : ""}` : total);
    add("Forks / issues", e.forks != null || e.open_issues != null ? `${e.forks ?? "?"} forks, ${e.open_issues ?? "?"} open issues` : null);
    add("Created", e.created ? `${e.created}${e.age_days != null ? ` (${Math.round(e.age_days)} days old)` : ""}` : null);
    add("Homepage", e.homepage);
    add("Description", e.description && e.description.length > 400 ? `${e.description.slice(0, 400).trimEnd()}…` : e.description);
    if (e.suspect_stars) lines.push({ label: "Check", value: "Suspected bought stars: many stars, almost no forks or issues. Look at who starred it before approving." });
  }
  if (c.source === "hf_org") {
    const n = (v: number) => v.toLocaleString("en-US");
    add("Organization", e.hf_org ? `${e.hf_org}${e.fullname && e.fullname !== e.hf_org ? ` (${e.fullname})` : ""}` : null);
    add("Models", e.models != null ? `${e.models} model${e.models === 1 ? "" : "s"}${e.first_model ? `, the first on ${e.first_model}` : ""}` : null);
    add("Growth", e.downloads_7d != null ? `+${n(e.downloads_7d)} downloads in 7 days${e.downloads != null ? ` (${n(e.downloads)} in the last 30 days)` : ""}` : e.downloads != null ? `${n(e.downloads)} downloads in the last 30 days` : null);
    add("Likes / followers", e.likes != null || e.followers != null ? `${e.likes ?? "?"} likes, ${e.followers ?? "?"} followers` : null);
    add("Team", e.num_users != null || e.plan || e.verified != null ? [e.num_users != null ? `${e.num_users} member${e.num_users === 1 ? "" : "s"}` : null, e.plan ? `${e.plan} plan` : null, e.verified ? "verified" : null].filter(Boolean).join(", ") : null);
    add("Website", e.homepage);
    add("GitHub", e.github);
  }
  if (c.source === "epo_ops") {
    add("Patent", e.title);
    add("Abstract", e.abstract && e.abstract.length > 400 ? `${e.abstract.slice(0, 400).trimEnd()}…` : e.abstract);
  }
  add(c.source === "uk_companies_house" ? "SIC codes" : c.source === "epo_ops" ? "CPC codes" : "Codes",
    e.codes && e.codes.length ? e.codes.slice(0, 8).join(" ") + (e.codes.length > 8 ? " …" : "") : null);
  add(people, formatPeople(e.officers));
  add(c.source === "uk_companies_house" ? "Director details" : c.source === "sec_form_d" ? "People details" : "",
    c.source === "uk_companies_house" || c.source === "sec_form_d" ? formatPeopleDetails(e.officers) : null);
  if (c.source === "uk_companies_house" || c.source === "sec_form_d") {
    add(c.source === "uk_companies_house" ? "Registered office" : "Address",
      [e.care_of ? `c/o ${e.care_of}` : null, e.address].filter(Boolean).join(", "));
    add("Phone", e.phone);
    add("Status", c.source === "uk_companies_house" ? e.company_status : null);
  }
  add("Company type", c.source === "uk_companies_house" ? e.form_type : null);
  add("Jurisdiction", e.jurisdiction);
  const good = signalTexts(e, "positive"), notes = signalTexts(e, "info"), warns = signalTexts(e, "warning");
  add("Signals", good.join(" · "));
  add("Warnings", warns.join(" · "));
  add("Notes", notes.join(" · "));
  add("Founded", c.founded_year ? String(c.founded_year) : null);
  add("Country", c.country);
  add("Filed", e.filing_date);
  return lines;
}
