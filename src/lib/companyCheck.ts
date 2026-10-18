// Pure helpers for "check a company" in the app (CheckCompanyDialog, the
// /checks/:id page, My Area's list). The rows are company_checks (migrations
// 20261021010000 and 20261022000000), read through RLS: the user's own only.
// No Supabase import, so vitest runs these in Node — the data calls live in
// ./supabase.ts.

export type CheckStatus =
  | "matched" | "queued" | "running" | "awaiting_confirmation"
  | "ready" | "stealth" | "rejected_public" | "rejected_non_tech" | "done" | "failed" | "cancelled";

export interface IdentityCandidate {
  name: string;
  website: string | null;
  domain: string | null;
  description: string | null;
  location: string | null;
  source: "your_website" | "search";
  evidence_url: string | null;
  unreachable?: boolean;
  startup_id: string | null;
  startup_name: string | null;
}

export interface CheckInput {
  name: string;
  website: string | null;
  host: string | null;
  country: string | null;
  founder: string | null;
  linkedin: string | null;
  sector: string | null;
}

export interface CompanyCheckGate {
  status: string;
  reason: string;
  evidence?: { listing?: { url: string; quote: string } | null; tech?: { reason?: string } | null };
}

// ── The research (stage 3) — mirrors worker/profile.ts ──────────────────────

export type Confidence = "high" | "medium" | "low";

export interface Sourced<T> {
  value: T;
  source_url: string | null;
  quote: string | null;
  confidence: Confidence;
}

export interface ProfilePerson { name: string; title: string | null; bio: string | null; linkedin_url: string | null }

export interface ProfileRound {
  round_type: string;
  amount: number | null;
  valuation: number | null;
  date: string | null;
  lead_investor: string | null;
  investors: string[];
  source_url: string | null;
}

export interface InvestorFact {
  name: string;
  investor_id: string | null;
  investor_name: string | null;
  /** In AlphaMap's own data. */
  companies: number;
  rounds: number;
  rounds_led: number;
  main_stages: string[];
  led_here: boolean;
}

export interface CheckProfile {
  overview: {
    description: string | null;
    value_proposition: string | null;
    industry: string | null;
    sector: string | null;
    sub_sectors: string[];
    founded_year: Sourced<number> | null;
    city: Sourced<string> | null;
    country: Sourced<string> | null;
    headcount: Sourced<number> | null;
    employee_range: string | null;
    linkedin_url: string | null;
  };
  people: { founders: ProfilePerson[]; leadership: ProfilePerson[] };
  funding: { rounds: ProfileRound[]; total_raised: number | null; history_complete: boolean | null };
  sources_count: number;
}

export interface CheckResultData {
  profile?: CheckProfile;
  investors?: InvestorFact[];
}

export interface CheckProgress {
  stage?: string;
  sources?: number;
  sections?: string[];
  at?: string;
}

export interface CompanyCheckRow {
  id: string;
  status: CheckStatus;
  phase: "identify" | "check";
  input: CheckInput;
  candidates: IdentityCandidate[] | null;
  identity: Partial<IdentityCandidate> | null;
  gate: CompanyCheckGate | null;
  result: CheckResultData | null;
  progress: CheckProgress | null;
  matched_startup_id: string | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

/** The form, as typed. Only the name is required. */
export interface CheckFormValues {
  name: string;
  website: string;
  country: string;
  founder: string;
  linkedin: string;
  sector: string;
}

export const emptyCheckForm = (): CheckFormValues => ({ name: "", website: "", country: "", founder: "", linkedin: "", sector: "" });

/** Prefill the form from an earlier check (try again / add a website). */
export function formFromInput(input: Partial<CheckInput> | null | undefined): CheckFormValues {
  return {
    name: input?.name ?? "", website: input?.website ?? "", country: input?.country ?? "",
    founder: input?.founder ?? "", linkedin: input?.linkedin ?? "", sector: input?.sector ?? "",
  };
}

/** What the screen should show for a row. */
export type CheckStep = "identifying" | "confirm" | "checking" | "researching" | "final";

export function checkStep(row: Pick<CompanyCheckRow, "status" | "phase"> & { gate?: CompanyCheckGate | null }): CheckStep {
  if (row.status === "awaiting_confirmation") return "confirm";
  if (row.status === "queued" || row.status === "running") {
    if (row.phase === "identify") return "identifying";
    // The worker saves the verdict before the research starts.
    return row.status === "running" && row.gate?.status === "ready" ? "researching" : "checking";
  }
  return "final";
}

/** What the research is doing now, as a companyCheck.progress.* key. */
export function progressKey(stage: string | undefined): string {
  const known = ["starting", "searching", "reading", "extracting", "deep_dive", "people", "validating", "investors"];
  return known.includes(stage ?? "") ? stage! : "starting";
}

/** Still moving on the worker's side: keep polling. */
export const isPending = (row: Pick<CompanyCheckRow, "status">): boolean => row.status === "queued" || row.status === "running";

/** Poll every this many ms while a check is pending. */
export const CHECK_POLL_MS = 2000;

/** A worker that has not picked the check up after this long is probably down. */
export const SLOW_WORKER_MS = 60_000;

/** Name and website to show: the confirmed company's, else what the user typed. */
export function checkTitle(row: Pick<CompanyCheckRow, "identity" | "input">): { name: string; website: string | null } {
  const id = row.identity ?? {};
  return { name: (id.name as string | undefined) || row.input.name, website: (id.website as string | undefined) ?? row.input.website ?? null };
}

export type StatusTone = "progress" | "ok" | "warn" | "bad" | "neutral";

export function statusTone(status: CheckStatus): StatusTone {
  switch (status) {
    case "queued": case "running": case "awaiting_confirmation": return "progress";
    case "ready": case "done": case "matched": return "ok";
    case "stealth": return "warn";
    case "rejected_public": case "rejected_non_tech": case "failed": return "bad";
    default: return "neutral";
  }
}

/** The status label key under companyCheck.status.* (identify-phase rows read as "finding"). */
export function statusKey(row: Pick<CompanyCheckRow, "status" | "phase">): string {
  if ((row.status === "queued" || row.status === "running") && row.phase === "identify") return "finding";
  return row.status;
}

/** "nuova.ai" from a website, for display. */
export function displayDomain(website: string | null | undefined): string | null {
  if (!website) return null;
  try {
    return new URL(website.startsWith("http") ? website : `https://${website}`).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Errors the company-check function answers with, by field. */
export interface CheckRequestFailure {
  status: number;
  message: string;
  fields?: Record<string, string>;
  reason?: string;
}

export class CheckRequestError extends Error {
  constructor(public failure: CheckRequestFailure) {
    super(failure.message);
    this.name = "CheckRequestError";
  }
}

export type IdentifyResponse =
  | { status: "identifying"; check_id: string; remaining: number }
  | { status: "matched"; check_id: string; startup: { id: string; name: string | null; website?: string | null }; fresh?: boolean };

export type ConfirmResponse =
  | { status: "queued"; check_id: string }
  | { status: "matched"; check_id: string; startup: { id: string; name: string | null } };
