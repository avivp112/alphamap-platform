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

export interface CompanyCheckRow {
  id: string;
  status: CheckStatus;
  phase: "identify" | "check";
  input: CheckInput;
  candidates: IdentityCandidate[] | null;
  identity: Partial<IdentityCandidate> | null;
  gate: CompanyCheckGate | null;
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
export type CheckStep = "identifying" | "confirm" | "checking" | "final";

export function checkStep(row: Pick<CompanyCheckRow, "status" | "phase">): CheckStep {
  if (row.status === "awaiting_confirmation") return "confirm";
  if (row.status === "queued" || row.status === "running") return row.phase === "identify" ? "identifying" : "checking";
  return "final";
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
